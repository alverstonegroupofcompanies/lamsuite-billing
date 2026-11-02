import { checkUpdate, installUpdate, onUpdaterEvent, type UpdateStatusResult } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";
import { sqliteStorage } from "../db/sqliteStorage";
import { deviceSessionService } from "../devices/deviceSessionService";

export type UpdateChannel = "stable" | "legacy_win7" | "beta";

export interface UpdateCheckDiagnostic {
  timestamp: string;
  url: string;
  status: number | null;
  statusText?: string;
  errorCategory: string;
  readableMessage: string;
  rawError: string;
  targetPlatform?: string;
  currentVersion: string;
  responseTimeMs?: number;
  retryAttempts?: number;
}

export interface UpdateInfo {
  shouldUpdate: boolean;
  message?: string;
  manifest?: {
    version: string;
    date?: string;
    body?: string;
    downloadUrl?: string;
  };
  diagnostic?: UpdateCheckDiagnostic;
}

export interface UpdateSettingsConfig {
  channel: UpdateChannel;
  autoCheckOnStartup: boolean;
  backgroundCheckIntervalHours: number; // 0 = disabled, 4, 12, 24
  lastCheckTimestamp?: string;
  lastCheckResult?: UpdateInfo;
}

export type UpdateProgressCallback = (status: UpdateStatusResult) => void;

const CURRENT_VERSION = "2.0.23";
const STORAGE_KEY_CONFIG = "lamsuite_updater_config";
const STORAGE_KEY_DIAGNOSTICS = "lamsuite_updater_diagnostics";

function safeGetStorage(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage.getItem(key);
    }
  } catch {}
  return null;
}

function safeSetStorage(key: string, val: string): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(key, val);
    }
  } catch {}
}

const CHANNEL_ENDPOINTS: Record<UpdateChannel, string[]> = {
  stable: [
    "https://api.lamstonehealthcare.com/api/app/update/latest.json",
    "https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/latest/download/latest.json",
  ],
  legacy_win7: [
    "https://api.lamstonehealthcare.com/api/app/update/latest-legacy-win7.json",
    "https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/latest/download/latest-legacy-win7.json",
  ],
  beta: [
    "https://api.lamstonehealthcare.com/api/app/update/latest.json",
    "https://github.com/alverstonegroupofcompanies/lamsuite-billing/releases/latest/download/latest-beta.json",
  ],
};

/**
 * Classifies an updater error into a specific, readable message with actionable context.
 */
export function classifyUpdaterError(
  err: any,
  diagnosticUrl: string,
  statusCode?: number | null,
  context?: "check" | "install"
): { category: string; readableMessage: string; isOnline: boolean } {
  const isOnline = typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true;
  if (!isOnline && !statusCode) {
    return {
      category: "offline",
      readableMessage: "No internet connection",
      isOnline: false,
    };
  }

  const rawStr = typeof err === "string" ? err : (err?.message || err?.toString() || "");
  const lower = rawStr.toLowerCase();

  if (statusCode === 404 || lower.includes("404") || lower.includes("not found")) {
    const isInstall = context === "install" || lower.includes("download") || lower.includes(".zip") || lower.includes(".exe");
    return {
      category: "not_found",
      readableMessage: isInstall
        ? `Download failed (404): ${diagnosticUrl}`
        : "Update feed not found (HTTP 404)",
      isOnline: true,
    };
  }

  if (statusCode === 403 || lower.includes("403") || lower.includes("forbidden")) {
    return {
      category: "forbidden",
      readableMessage: "Update server access forbidden (HTTP 403)",
      isOnline: true,
    };
  }

  if (
    lower.includes("sec_e_untrusted_root") ||
    lower.includes("cert_e_untrustedroot") ||
    lower.includes("certificate verify failed") ||
    lower.includes("tls") ||
    lower.includes("ssl") ||
    lower.includes("cert")
  ) {
    return {
      category: "tls_error",
      readableMessage: "TLS certificate validation failed (ISRG Root X1 missing or untrusted)",
      isOnline: true,
    };
  }

  if (
    lower.includes("signature") ||
    lower.includes("minisign") ||
    lower.includes("verification failed") ||
    lower.includes("corrupted")
  ) {
    return {
      category: "bad_signature",
      readableMessage: "Update signature does not match",
      isOnline: true,
    };
  }

  if (
    lower.includes("syntaxerror") ||
    lower.includes("unexpected token") ||
    lower.includes("invalid json") ||
    lower.includes("manifest")
  ) {
    return {
      category: "invalid_feed",
      readableMessage: "Update feed is invalid",
      isOnline: true,
    };
  }

  if (
    lower.includes("permission") ||
    lower.includes("allowlist") ||
    lower.includes("blocked") ||
    lower.includes("scope")
  ) {
    return {
      category: "permission_blocked",
      readableMessage: "Permission blocked",
      isOnline: true,
    };
  }

  if (
    lower.includes("econnrefused") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("failed to fetch") ||
    lower.includes("failed to connect") ||
    lower.includes("network") ||
    lower.includes("unreachable") ||
    lower.includes("could not fetch") ||
    lower.includes("connection")
  ) {
    return {
      category: "server_unreachable",
      readableMessage: `Cannot reach the update server (${diagnosticUrl})`,
      isOnline: true,
    };
  }

  return {
    category: "unknown",
    readableMessage: rawStr || `Cannot reach the update server (${diagnosticUrl})`,
    isOnline: true,
  };
}

class AutoUpdateService {
  private isChecking: boolean = false;
  private isDownloading: boolean = false;
  private unlistenStatus: (() => void) | null = null;
  private backgroundIntervalId: any = null;
  private lastDiagnostic: UpdateCheckDiagnostic | null = null;
  private cachedDownloadUrl: string = "";

  constructor() {
    this.initBackgroundTimer();
  }

  /**
   * Check if running in a Tauri desktop environment
   */
  public isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_IPC__" in window;
  }

  /**
   * Get current installed app version
   */
  public getCurrentVersion(): string {
    return CURRENT_VERSION;
  }

  /**
   * Retrieve active updater configuration
   */
  public getConfig(): UpdateSettingsConfig {
    try {
      const stored = safeGetStorage(STORAGE_KEY_CONFIG);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Fallback
    }

    return {
      channel: "stable",
      autoCheckOnStartup: true,
      backgroundCheckIntervalHours: 24,
    };
  }

  /**
   * Update configuration and persist
   */
  public saveConfig(config: Partial<UpdateSettingsConfig>): UpdateSettingsConfig {
    const current = this.getConfig();
    const updated: UpdateSettingsConfig = { ...current, ...config };
    safeSetStorage(STORAGE_KEY_CONFIG, JSON.stringify(updated));
    this.initBackgroundTimer();
    return updated;
  }

  /**
   * Get the primary update server endpoint for the active channel
   */
  public getPrimaryEndpoint(channel?: UpdateChannel): string {
    const ch = channel || this.getConfig().channel;
    return CHANNEL_ENDPOINTS[ch]?.[0] || CHANNEL_ENDPOINTS.stable[0];
  }

  /**
   * Get the last diagnostic log entry
   */
  public getLastDiagnostic(): UpdateCheckDiagnostic | null {
    if (this.lastDiagnostic) return this.lastDiagnostic;
    try {
      const stored = safeGetStorage(STORAGE_KEY_DIAGNOSTICS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Fallback
    }
    return null;
  }

  /**
   * Perform direct probe against update feeds to test server reachability, TLS, and status
   */
  public async probeUpdateFeed(
    channel?: UpdateChannel,
    maxRetries: number = 2
  ): Promise<{
    url: string;
    status: number | null;
    statusText: string;
    data: any | null;
    error?: any;
    responseTimeMs: number;
    attempts: number;
  }> {
    const ch = channel || this.getConfig().channel;
    const endpoints = CHANNEL_ENDPOINTS[ch] || CHANNEL_ENDPOINTS.stable;

    let lastError: any = null;
    let lastUrl = endpoints[0];
    let lastStatus: number | null = null;
    let attempts = 0;

    for (const url of endpoints) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        attempts++;
        const startTime = Date.now();
        lastUrl = url;

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);

          const res = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json, text/plain, */*",
              "Cache-Control": "no-cache",
            },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          const responseTimeMs = Date.now() - startTime;
          lastStatus = res.status;

          if (res.ok) {
            let json = null;
            try {
              json = await res.json();
            } catch {
              // Not valid json
            }
            return {
              url,
              status: res.status,
              statusText: res.statusText,
              data: json,
              responseTimeMs,
              attempts,
            };
          } else {
            // Non-200 status code
            lastError = new Error(`HTTP ${res.status}: ${res.statusText}`);
          }
        } catch (err: any) {
          lastError = err;
          // Exponential backoff wait if retrying same endpoint
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
          }
        }
      }
    }

    return {
      url: lastUrl,
      status: lastStatus,
      statusText: lastError?.message || "Failed to reach endpoint",
      data: null,
      error: lastError,
      responseTimeMs: 0,
      attempts,
    };
  }

  /**
   * Check if a new version is available with full error classification and diagnostics
   */
  public async checkForUpdates(): Promise<UpdateInfo> {
    if (this.isChecking) {
      return { shouldUpdate: false, message: "Update check already in progress" };
    }

    this.isChecking = true;
    const config = this.getConfig();
    const primaryUrl = this.getPrimaryEndpoint(config.channel);
    const startTime = Date.now();

    try {
      if (!this.isTauri()) {
        // In browser development, perform simulated feed check against real endpoint
        const probe = await this.probeUpdateFeed(config.channel, 1);
        const responseTimeMs = probe.responseTimeMs || Date.now() - startTime;

        if (probe.error || !probe.data) {
          const classified = classifyUpdaterError(probe.error, probe.url, probe.status);
          const diag: UpdateCheckDiagnostic = {
            timestamp: new Date().toISOString(),
            url: probe.url,
            status: probe.status,
            statusText: probe.statusText,
            errorCategory: classified.category,
            readableMessage: classified.readableMessage,
            rawError: probe.error?.message || String(probe.error || "No data"),
            currentVersion: CURRENT_VERSION,
            responseTimeMs,
            retryAttempts: probe.attempts,
          };
          this.recordDiagnostic(diag);
          const err = new Error(classified.readableMessage);
          (err as any).diagnostic = diag;
          throw err;
        }

        const remoteVer = probe.data.version?.replace(/^v/, "") || CURRENT_VERSION;
        const isNewer = this.compareSemver(remoteVer, CURRENT_VERSION) > 0;

        let downloadUrl = "";
        if (probe.data?.platforms) {
          const platKey = Object.keys(probe.data.platforms).find((k) => k.includes("windows") || k.includes("darwin") || k.includes("linux")) || Object.keys(probe.data.platforms)[0];
          if (platKey && probe.data.platforms[platKey]?.url) {
            downloadUrl = probe.data.platforms[platKey].url;
            this.cachedDownloadUrl = downloadUrl;
          }
        }

        const diag: UpdateCheckDiagnostic = {
          timestamp: new Date().toISOString(),
          url: probe.url,
          status: probe.status || 200,
          statusText: probe.statusText,
          errorCategory: "success",
          readableMessage: isNewer ? `New version ${remoteVer} available` : `Already up to date (version ${CURRENT_VERSION})`,
          rawError: "",
          currentVersion: CURRENT_VERSION,
          responseTimeMs,
          retryAttempts: probe.attempts,
        };
        this.recordDiagnostic(diag);

        const result: UpdateInfo = {
          shouldUpdate: isNewer,
          message: diag.readableMessage,
          manifest: {
            version: remoteVer,
            date: probe.data.pub_date,
            body: probe.data.notes,
            downloadUrl,
          },
          diagnostic: diag,
        };
        this.cacheLastCheck(result);
        return result;
      }

      // Desktop Tauri Environment
      let updateResult: any = null;
      try {
        updateResult = await checkUpdate();
      } catch (ipcErr: any) {
        // Native Tauri updater encountered an issue; probe endpoint to gather granular error details
        const probe = await this.probeUpdateFeed(config.channel, 1);
        const responseTimeMs = Date.now() - startTime;
        const classified = classifyUpdaterError(ipcErr || probe.error, probe.url, probe.status);

        const diag: UpdateCheckDiagnostic = {
          timestamp: new Date().toISOString(),
          url: probe.url,
          status: probe.status,
          statusText: probe.statusText,
          errorCategory: classified.category,
          readableMessage: classified.readableMessage,
          rawError: typeof ipcErr === "string" ? ipcErr : (ipcErr?.message || String(ipcErr)),
          currentVersion: CURRENT_VERSION,
          responseTimeMs,
          retryAttempts: probe.attempts,
        };
        this.recordDiagnostic(diag);

        const err = new Error(classified.readableMessage);
        (err as any).diagnostic = diag;
        throw err;
      }

      const responseTimeMs = Date.now() - startTime;
      const manifest = updateResult.manifest;
      const shouldUpdate = !!updateResult.shouldUpdate;
      const remoteVer = manifest?.version || CURRENT_VERSION;

      const readableMsg = shouldUpdate
        ? `Update available: version ${remoteVer}`
        : `Already up to date (version ${CURRENT_VERSION})`;

      const diag: UpdateCheckDiagnostic = {
        timestamp: new Date().toISOString(),
        url: primaryUrl,
        status: 200,
        statusText: "OK",
        errorCategory: "success",
        readableMessage: readableMsg,
        rawError: "",
        currentVersion: CURRENT_VERSION,
        responseTimeMs,
      };
      this.recordDiagnostic(diag);

      // In desktop environment, also query probe asynchronously to cache platform download URL
      this.probeUpdateFeed(config.channel, 1).then((probe) => {
        if (probe?.data?.platforms) {
          const pKey = Object.keys(probe.data.platforms).find((k) => k.includes("windows") || k.includes("darwin") || k.includes("linux")) || Object.keys(probe.data.platforms)[0];
          if (pKey && probe.data.platforms[pKey]?.url) {
            this.cachedDownloadUrl = probe.data.platforms[pKey].url;
          }
        }
      }).catch(() => {});

      const result: UpdateInfo = {
        shouldUpdate,
        message: readableMsg,
        manifest: manifest
          ? {
              version: manifest.version,
              date: manifest.date,
              body: manifest.body,
              downloadUrl: this.cachedDownloadUrl || undefined,
            }
          : undefined,
        diagnostic: diag,
      };

      this.cacheLastCheck(result);
      return result;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check if there are unsynced items in SQLite sync_queue before allowing update
   */
  public async getUnsyncedBillsCount(): Promise<number> {
    try {
      const items = await sqliteStorage.findAll<any>("sync_queue");
      return (items || []).length;
    } catch (e) {
      console.warn("[AutoUpdate] Failed checking sync_queue:", e);
      return 0;
    }
  }

  /**
   * Download and install the update, then relaunch the application
   */
  public async installAndRestart(
    onProgress?: UpdateProgressCallback,
    skipSafetyCheck: boolean = false,
    explicitDownloadUrl?: string
  ): Promise<void> {
    if (!this.isTauri()) {
      throw new Error("Updates can only be installed in the desktop environment");
    }

    if (!skipSafetyCheck) {
      const unsyncedCount = await this.getUnsyncedBillsCount();
      if (unsyncedCount > 0) {
        throw new Error(
          `You have ${unsyncedCount} unsynced bill(s) pending. Updating will restart the application. Please sync all pending transactions before updating.`
        );
      }
    }

    if (this.isDownloading) {
      return;
    }

    this.isDownloading = true;
    const targetUrl = explicitDownloadUrl || this.cachedDownloadUrl || this.getPrimaryEndpoint();

    try {
      if (onProgress) {
        if (this.unlistenStatus) {
          this.unlistenStatus();
        }
        this.unlistenStatus = await onUpdaterEvent((status) => {
          onProgress(status);
        });
      }

      await installUpdate();

      // Relaunch the app to apply the installed update
      await relaunch();
    } catch (err: any) {
      console.error("[AutoUpdate] Installation failed:", err);
      const rawMsg = typeof err === "string" ? err : (err?.message || String(err));
      const statusMatch = rawMsg.match(/status:\s*(\d{3})/i) || rawMsg.match(/\b(\d{3})\b/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 404;

      const urlMatch = rawMsg.match(/https?:\/\/[^\s"',)]+/);
      const failingUrl = urlMatch ? urlMatch[0] : targetUrl;
      const formattedError = `Download failed (${statusCode}): ${failingUrl}`;

      console.error(`[AutoUpdate] ${formattedError}`);

      // Report failure to admin panel device session status
      deviceSessionService.reportUpdateFailure(failingUrl, statusCode, rawMsg).catch((e) => {
        console.warn("[AutoUpdate] Failed reporting to device session:", e);
      });

      // Keep current version running smoothly and expose clear error
      const errorObj = new Error(formattedError);
      (errorObj as any).failingUrl = failingUrl;
      (errorObj as any).statusCode = statusCode;
      (errorObj as any).rawError = rawMsg;
      throw errorObj;
    } finally {
      this.isDownloading = false;
      if (this.unlistenStatus) {
        this.unlistenStatus();
        this.unlistenStatus = null;
      }
    }
  }

  /**
   * Simple SemVer comparison (returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal)
   */
  public compareSemver(v1: string, v2: string): number {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
    const p1 = parse(v1);
    const p2 = parse(v2);

    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  private recordDiagnostic(diag: UpdateCheckDiagnostic): void {
    this.lastDiagnostic = diag;
    safeSetStorage(STORAGE_KEY_DIAGNOSTICS, JSON.stringify(diag));
    console.info(`[AutoUpdate] Check [${diag.status || "ERR"}] ${diag.readableMessage} (${diag.url})`);
  }

  private cacheLastCheck(result: UpdateInfo): void {
    const config = this.getConfig();
    config.lastCheckTimestamp = new Date().toISOString();
    config.lastCheckResult = result;
    this.saveConfig(config);
  }

  private initBackgroundTimer(): void {
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = null;
    }

    const config = this.getConfig();
    if (config.backgroundCheckIntervalHours > 0) {
      const ms = config.backgroundCheckIntervalHours * 3600 * 1000;
      this.backgroundIntervalId = setInterval(() => {
        this.checkForUpdates().catch(() => {});
      }, ms);
    }
  }
}

export const autoUpdateService = new AutoUpdateService();
