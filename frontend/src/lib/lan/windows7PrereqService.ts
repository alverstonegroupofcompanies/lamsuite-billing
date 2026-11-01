/**
 * Windows 7 SP1 & 8.1 Runtime Prerequisites and Certificate Verification Service.
 *
 * Windows 7 SP1 (NT 6.1) and Windows 8.1 (NT 6.3) machines often lack:
 * 1. TLS 1.2 enabled in WinHTTP / Schannel registry
 * 2. Modern Root Certificates (specifically ISRG Root X1 / Let's Encrypt CA)
 * 3. SHA-2 code signing update (KB4474419) and Universal C Runtime (KB2999226)
 *
 * This service runs connectivity probes against https://api.DOMAIN and wss://ws.DOMAIN,
 * detects SSL handshake / certificate authority failures, and surfaces actionable guidance.
 */

import { API_BASE_URL } from "../../config/env";
import { isTauri } from "../ipc/ipcBridge";

export interface Windows7PrereqStatus {
  isLegacyWindows: boolean;
  osName: string;
  isSp1OrLater: boolean;
  httpsProbePassed: boolean;
  wsProbePassed: boolean;
  certStoreIssueDetected: boolean;
  tls12IssueDetected: boolean;
  errorMessage?: string;
}

class Windows7PrereqService {
  private hasChecked = false;
  private cachedStatus: Windows7PrereqStatus | null = null;

  public detectLegacyWindows(): { isLegacy: boolean; osName: string } {
    if (typeof window === "undefined" || !navigator) {
      return { isLegacy: false, osName: "Unknown" };
    }

    const ua = navigator.userAgent;
    if (ua.includes("Windows NT 6.1")) {
      return { isLegacy: true, osName: "Windows 7 SP1" };
    }
    if (ua.includes("Windows NT 6.2")) {
      return { isLegacy: true, osName: "Windows 8" };
    }
    if (ua.includes("Windows NT 6.3")) {
      return { isLegacy: true, osName: "Windows 8.1" };
    }

    return { isLegacy: false, osName: "Windows (Modern / Non-Legacy)" };
  }

  public async runDiagnostics(): Promise<Windows7PrereqStatus> {
    const { isLegacy, osName } = this.detectLegacyWindows();

    const status: Windows7PrereqStatus = {
      isLegacyWindows: isLegacy,
      osName,
      isSp1OrLater: true,
      httpsProbePassed: false,
      wsProbePassed: false,
      certStoreIssueDetected: false,
      tls12IssueDetected: false,
    };

    if (!isLegacy && !isTauri()) {
      status.httpsProbePassed = true;
      status.wsProbePassed = true;
      this.cachedStatus = status;
      this.hasChecked = true;
      return status;
    }

    // 1. HTTPS Probe
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${API_BASE_URL}/health`, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      }).catch(async () => {
        // Fallback to checking root or api/v1/health
        return fetch(`${API_BASE_URL}/`, {
          method: "HEAD",
          signal: controller.signal,
          cache: "no-store",
        });
      });
      clearTimeout(timeoutId);

      if (res && res.status >= 200 && res.status < 500) {
        status.httpsProbePassed = true;
      } else {
        status.httpsProbePassed = false;
        status.errorMessage = `HTTP Probe returned status ${res?.status || "Unknown"}`;
      }
    } catch (err: unknown) {
      const errMsg = String(err);
      status.httpsProbePassed = false;
      status.errorMessage = errMsg;

      if (
        errMsg.includes("CERT") ||
        errMsg.includes("certificate") ||
        errMsg.includes("SSL") ||
        errMsg.includes("authority")
      ) {
        status.certStoreIssueDetected = true;
      } else if (
        errMsg.includes("Failed to fetch") ||
        errMsg.includes("NetworkError") ||
        errMsg.includes("abort")
      ) {
        // On Windows 7 with disabled TLS 1.2, fetch fails immediately with Failed to fetch
        if (isLegacy) {
          status.tls12IssueDetected = true;
          status.certStoreIssueDetected = true;
        }
      }
    }

    // 2. WebSocket Probe (wss://)
    try {
      const wsUrl = API_BASE_URL.replace(/^http/, "ws") + "/ws";
      status.wsProbePassed = await this.probeWebSocket(wsUrl, 5000);
    } catch {
      status.wsProbePassed = false;
    }

    this.cachedStatus = status;
    this.hasChecked = true;
    return status;
  }

  private probeWebSocket(url: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(url);
        let finished = false;

        const timer = setTimeout(() => {
          if (!finished) {
            finished = true;
            try { ws.close(); } catch {}
            resolve(false);
          }
        }, timeoutMs);

        ws.onopen = () => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            resolve(true);
          }
        };

        ws.onerror = () => {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            resolve(false);
          }
        };
      } catch {
        resolve(false);
      }
    });
  }

  public getCachedStatus(): Windows7PrereqStatus | null {
    return this.cachedStatus;
  }

  public generateTls12RegistryScript(): string {
    return `Windows Registry Editor Version 5.00

; Enable TLS 1.2 in WinHTTP and Schannel for Windows 7 SP1 / Windows 8.1
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\WinHttp]
"DefaultSecureProtocols"=dword:00000a00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\WinHttp]
"DefaultSecureProtocols"=dword:00000a00

[HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\SCHANNEL\\Protocols\\TLS 1.2]

[HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\SCHANNEL\\Protocols\\TLS 1.2\\Client]
"DisabledByDefault"=dword:00000000
"Enabled"=dword:00000001
`;
  }
}

export const windows7PrereqService = new Windows7PrereqService();
