/**
 * Network Adapter Discovery & Subnet Scanner for LAN Hub & Counters
 */

export interface NetworkInterfaceInfo {
  name: string;
  ip: string;
  netmask: string;
  family: "IPv4" | "IPv6";
  isInternal: boolean;
  type?: "wifi" | "ethernet" | "vpn" | "virtual" | "other";
}

export interface HubHealthCheck {
  isHealthy: boolean;
  hubId: string;
  hubLabel: string;
  appVersion: string;
  protocolVersion: string;
  port: number;
  apiPort: number;
  timestamp: number;
  pairingMode: boolean;
  pairingExpiresIn: number;
  error?: string;
  latencyMs?: number;
}

export interface DiscoveredHubPeer {
  id: string;
  hub_label: string;
  ip_address: string;
  port: number;
  api_port: number;
  app_version: string;
  protocol_version: string;
  pairing_mode: boolean;
  pairing_expires_in: number;
  is_paired: boolean;
  status: "online" | "idle";
  is_main: boolean;
  discovery_method: "udp_beacon" | "mdns" | "subnet_sweep" | "host_probe";
  discovered_at: number;
  latency_ms: number;
}

class LanDiscoveryService {
  private activeSweepAbort: AbortController | null = null;

  /**
   * Detect real host network interfaces via browser APIs, WebRTC STUN candidate inspection,
   * window location hostname, and local storage fallback.
   */
  async getLocalNetworkInterfaces(): Promise<NetworkInterfaceInfo[]> {
    const interfaces: NetworkInterfaceInfo[] = [];
    const seenIps = new Set<string>();

    const addIfUnique = (info: NetworkInterfaceInfo) => {
      if (!seenIps.has(info.ip)) {
        seenIps.add(info.ip);
        interfaces.push(info);
      }
    };

    // 1. Check window.location if accessed via LAN IP directly (e.g. 192.168.0.x)
    if (typeof window !== "undefined" && window.location.hostname) {
      const host = window.location.hostname.trim();
      // Exclude localhost, loopbacks, and desktop webview internal origins like tauri.localhost
      const isInternalHost =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "tauri.localhost" ||
        host.endsWith(".localhost") ||
        host.includes("tauri");

      if (!isInternalHost) {
        addIfUnique({
          name: "Active Host Connection",
          ip: host,
          netmask: "255.255.255.0",
          family: "IPv4",
          isInternal: false,
          type: "wifi",
        });
      }
    }

    // 2. Gather candidate private IPs via WebRTC RTCPeerConnection candidate discovery
    if (typeof window !== "undefined" && (window.RTCPeerConnection || (window as any).webkitRTCPeerConnection)) {
      try {
        const RTCPC = window.RTCPeerConnection || (window as any).webkitRTCPeerConnection;
        const pc = new RTCPC({ iceServers: [] });
        pc.createDataChannel("");
        
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            try { pc.close(); } catch (_) {}
            resolve();
          }, 600);

          pc.onicecandidate = (e: any) => {
            if (!e || !e.candidate || !e.candidate.candidate) {
              clearTimeout(timeout);
              try { pc.close(); } catch (_) {}
              resolve();
              return;
            }
            const candidateStr = e.candidate.candidate;
            const match = candidateStr.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
            if (match && match[1]) {
              const ip = match[1];
              // Exclude loopback
              if (ip !== "127.0.0.1" && !ip.startsWith("0.")) {
                addIfUnique({
                  name: ip.startsWith("192.168.") ? "Wi-Fi / Ethernet LAN" : "Local Network Interface",
                  ip,
                  netmask: "255.255.255.0",
                  family: "IPv4",
                  isInternal: false,
                  type: ip.startsWith("192.168.") ? "wifi" : "ethernet",
                });
              }
            }
          };

          pc.createOffer().then((offer: any) => pc.setLocalDescription(offer)).catch(() => resolve());
        });
      } catch (_) {}
    }

    // 3. Fallback known common private IP if none discovered in sandbox environment
    if (interfaces.length === 0) {
      const cachedIp = typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" ? localStorage.getItem("lamsuite_lan_adapter_ip") : null;
      if (cachedIp) {
        addIfUnique({
          name: "Configured LAN Adapter",
          ip: cachedIp,
          netmask: "255.255.255.0",
          family: "IPv4",
          isInternal: false,
          type: "wifi",
        });
      }
    }

    // Always ensure loopback is documented as local fallback with explicit loopback label
    addIfUnique({
      name: "Loopback Interface (Host only)",
      ip: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4",
      isInternal: true,
      type: "other",
    });

    return interfaces;
  }

  /**
   * Verify Hub Health and verify identity endpoint
   */
  async checkHubHealth(host: string, port = 8000, timeoutMs = 2500): Promise<HubHealthCheck> {
    const cleanHost = host.trim().replace(/^http:\/\//, "").replace(/\/.*$/, "").replace(/:.*$/, "");
    const url = `http://${cleanHost}:${port}/lan/v1/health`;
    const start = performance.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        return {
          isHealthy: false,
          hubId: "",
          hubLabel: "",
          appVersion: "",
          protocolVersion: "",
          port: 8089,
          apiPort: port,
          timestamp: 0,
          pairingMode: false,
          pairingExpiresIn: 0,
          error: `HTTP ${res.status}: ${res.statusText}`,
          latencyMs,
        };
      }

      const data = await res.json();
      return {
        isHealthy: true,
        hubId: data.hub_id || `hub_${cleanHost}`,
        hubLabel: data.hub_label || "Main Counter Hub",
        appVersion: data.app_version || data.version || "2.0.0",
        protocolVersion: data.protocol_version || "1.0",
        port: data.port || 8089,
        apiPort: data.api_port || port,
        timestamp: data.timestamp || Date.now(),
        pairingMode: Boolean(data.pairing_mode),
        pairingExpiresIn: Number(data.pairing_expires_in) || 0,
        latencyMs,
      };
    } catch (err: any) {
      clearTimeout(timer);
      let errorMsg = err?.message || "Connection failed";
      if (err?.name === "AbortError") {
        errorMsg = "Connection timed out (Host unreachable or blocked by firewall)";
      } else if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError")) {
        errorMsg = `Port ${port} unreachable or connection refused`;
      }
      return {
        isHealthy: false,
        hubId: "",
        hubLabel: "",
        appVersion: "",
        protocolVersion: "",
        port: 8089,
        apiPort: port,
        timestamp: 0,
        pairingMode: false,
        pairingExpiresIn: 0,
        error: errorMsg,
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }

  /**
   * Fast targeted subnet scan with live progress callback
   */
  async scanSubnetForHubs(
    baseIp: string,
    onProgress?: (scanned: number, total: number, found: DiscoveredHubPeer[]) => void
  ): Promise<DiscoveredHubPeer[]> {
    if (this.activeSweepAbort) {
      this.activeSweepAbort.abort();
    }
    this.activeSweepAbort = new AbortController();

    const discovered: DiscoveredHubPeer[] = [];
    const parts = baseIp.split(".");
    const subnetPrefix = parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : "192.168.0";

    // Build candidate IPs: prioritising common IPs: .1, .2, .100, .101, .150, .200, current IP, etc.
    const priorityHosts = [
      baseIp,
      "127.0.0.1",
      `${subnetPrefix}.1`,
      `${subnetPrefix}.100`,
      `${subnetPrefix}.101`,
      `${subnetPrefix}.102`,
      `${subnetPrefix}.105`,
      `${subnetPrefix}.150`,
      `${subnetPrefix}.200`,
      `${subnetPrefix}.2`,
      `${subnetPrefix}.3`,
      `${subnetPrefix}.4`,
      `${subnetPrefix}.5`,
      `${subnetPrefix}.10`,
      `${subnetPrefix}.20`,
      `${subnetPrefix}.50`,
    ];

    const uniqueHosts = Array.from(new Set(priorityHosts.filter(Boolean)));
    let completed = 0;
    const total = uniqueHosts.length;

    // Concurrent batch scanning (chunks of 4)
    const chunkSize = 4;
    for (let i = 0; i < uniqueHosts.length; i += chunkSize) {
      if (this.activeSweepAbort?.signal.aborted) break;
      const chunk = uniqueHosts.slice(i, i + chunkSize);

      await Promise.all(
        chunk.map(async (host) => {
          // Check ports 8000 and 8089
          let health = await this.checkHubHealth(host, 8000, 1200);
          if (!health.isHealthy) {
            health = await this.checkHubHealth(host, 8089, 800);
          }

          if (health.isHealthy) {
            const peer: DiscoveredHubPeer = {
              id: health.hubId,
              hub_label: health.hubLabel,
              ip_address: host,
              port: health.port,
              api_port: health.apiPort,
              app_version: health.appVersion,
              protocol_version: health.protocolVersion,
              pairing_mode: health.pairingMode,
              pairing_expires_in: health.pairingExpiresIn,
              is_paired: false,
              status: "online",
              is_main: true,
              discovery_method: "subnet_sweep",
              discovered_at: Date.now(),
              latency_ms: health.latencyMs || 0,
            };

            if (!discovered.some((d) => d.ip_address === peer.ip_address)) {
              discovered.push(peer);
            }
          }

          completed += 1;
          onProgress?.(completed, total, [...discovered]);
        })
      );
    }

    return discovered;
  }

  cancelScan(): void {
    if (this.activeSweepAbort) {
      this.activeSweepAbort.abort();
      this.activeSweepAbort = null;
    }
  }
}

export const lanDiscoveryService = new LanDiscoveryService();
