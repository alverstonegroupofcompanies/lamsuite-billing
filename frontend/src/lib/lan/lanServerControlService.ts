import { sqliteStorage } from "../db/sqliteStorage";
import { lanPeerService } from "./lanPeerService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { lanDiscoveryService, type NetworkInterfaceInfo } from "./lanDiscoveryService";

export interface ConnectedCounterClient {
  id: string;
  counter_name: string;
  counter_code: string;
  device_name?: string;
  ip_address: string;
  status: "active" | "blocked" | "pending_approval" | "disconnected";
  is_online: boolean;
  last_seen_at: number | null;
  last_sync_at: number | null;
}

export interface LanServerStatus {
  isRunning: boolean;
  port: number;
  apiPort: number;
  bindAddress: string;
  lanIpAddresses: string[];
  selectedAdapterIp: string;
  autoStart: boolean;
  startedAt: number | null;
  activeClientsCount: number;
  activeClients: ConnectedCounterClient[];
  lastSnapshotAt: number | null;
  availableAdapters: NetworkInterfaceInfo[];
  hubId: string;
  hubLabel: string;
  announceEnabled: boolean;
  pairingMode: boolean;
  pairingExpiresIn: number;
  pairingCode: string;
}

const LAN_SERVER_STORAGE_KEY = "lamsuite_lan_server_config";

class LanServerControlService {
  private isRunning = false;
  private autoStart = true;
  private port = 8089;
  private apiPort = 8000;
  private bindAddress = "0.0.0.0";
  private selectedAdapterIp = "";
  private lanIpAddresses: string[] = [];
  private availableAdapters: NetworkInterfaceInfo[] = [];
  private startedAt: number | null = null;
  private activeClients: ConnectedCounterClient[] = [];
  private lastSnapshotAt: number | null = null;
  private hubId = "hub_main";
  private hubLabel = "Main Counter Hub";
  private announceEnabled = true;
  private pairingMode = false;
  private pairingExpiresIn = 0;
  private pairingCode = "729481";
  private listeners: Set<(status: LanServerStatus) => void> = new Set();
  private pollClientsTimer: any = null;

  constructor() {
    this.initAdapters().then(() => {
      this.loadConfig();
    });
  }

  private async initAdapters(): Promise<void> {
    try {
      this.availableAdapters = await lanDiscoveryService.getLocalNetworkInterfaces();
      const nonLoopback = this.availableAdapters.filter((a) => !a.isInternal);
      this.lanIpAddresses = nonLoopback.map((a) => a.ip);

      if (this.lanIpAddresses.length > 0 && !this.selectedAdapterIp) {
        this.selectedAdapterIp = this.lanIpAddresses[0];
      } else if (!this.selectedAdapterIp) {
        this.selectedAdapterIp = "127.0.0.1";
      }
    } catch (_) {
      this.lanIpAddresses = ["127.0.0.1"];
      this.selectedAdapterIp = "127.0.0.1";
    }
  }

  private loadConfig(): void {
    try {
      const raw = localStorage.getItem(LAN_SERVER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.autoStart = parsed.autoStart ?? true;
        this.port = parsed.port || 8089;
        this.apiPort = parsed.apiPort || 8000;
        this.bindAddress = "0.0.0.0";
        if (parsed.selectedAdapterIp) {
          this.selectedAdapterIp = parsed.selectedAdapterIp;
        }
        if (this.autoStart) {
          this.startServer().catch(() => {});
        }
      } else {
        this.autoStart = true;
        this.startServer().catch(() => {});
      }
    } catch (_) {
      this.autoStart = true;
    }
  }

  private saveConfig(): void {
    try {
      localStorage.setItem(
        LAN_SERVER_STORAGE_KEY,
        JSON.stringify({
          autoStart: this.autoStart,
          port: this.port,
          apiPort: this.apiPort,
          bindAddress: this.bindAddress,
          selectedAdapterIp: this.selectedAdapterIp,
        })
      );
    } catch (_) {}
  }

  getStatus(): LanServerStatus {
    const activeSecondaryCount = this.activeClients.filter((c) => c.status === "active" && c.is_online).length;

    return {
      isRunning: this.isRunning,
      port: this.port,
      apiPort: this.apiPort,
      bindAddress: this.bindAddress,
      lanIpAddresses: this.lanIpAddresses.length > 0 ? this.lanIpAddresses : [this.selectedAdapterIp || "127.0.0.1"],
      selectedAdapterIp: this.selectedAdapterIp || (this.lanIpAddresses[0] || "127.0.0.1"),
      autoStart: this.autoStart,
      startedAt: this.startedAt,
      activeClientsCount: activeSecondaryCount,
      activeClients: this.activeClients,
      lastSnapshotAt: this.lastSnapshotAt,
      availableAdapters: this.availableAdapters,
      hubId: this.hubId,
      hubLabel: this.hubLabel,
      announceEnabled: this.announceEnabled,
      pairingMode: this.pairingMode,
      pairingExpiresIn: this.pairingExpiresIn,
      pairingCode: this.pairingCode,
    };
  }

  subscribe(fn: (status: LanServerStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.getStatus());
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const status = this.getStatus();
    this.listeners.forEach((fn) => {
      try {
        fn(status);
      } catch (_) {}
    });
  }

  setAutoStart(enabled: boolean): void {
    this.autoStart = enabled;
    this.saveConfig();
    this.notify();
  }

  setPort(port: number): void {
    this.port = port;
    this.saveConfig();
    this.notify();
  }

  setSelectedAdapter(ip: string): void {
    this.selectedAdapterIp = ip;
    this.saveConfig();
    this.notify();
  }

  async setHubLabel(label: string): Promise<boolean> {
    this.hubLabel = label;
    try {
      await fetch(`http://127.0.0.1:${this.apiPort}/api/lan/v1/hub/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_label: label }),
      });
    } catch (_) {}
    this.notify();
    return true;
  }

  async setAnnounceEnabled(enabled: boolean): Promise<boolean> {
    this.announceEnabled = enabled;
    try {
      await fetch(`http://127.0.0.1:${this.apiPort}/api/lan/v1/hub/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announce_enabled: enabled }),
      });
    } catch (_) {}
    this.notify();
    return true;
  }

  async setPairingMode(durationMinutes: number): Promise<boolean> {
    this.pairingMode = durationMinutes > 0;
    this.pairingExpiresIn = durationMinutes * 60;
    try {
      await fetch(`http://127.0.0.1:${this.apiPort}/api/lan/v1/hub/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_mode_duration_minutes: durationMinutes }),
      });
    } catch (_) {}
    this.notify();
    return true;
  }

  async fetchHubStatus(): Promise<void> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.apiPort}/lan/v1/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.hub_id) this.hubId = data.hub_id;
        if (data.hub_label) this.hubLabel = data.hub_label;
        if (typeof data.pairing_mode === "boolean") this.pairingMode = data.pairing_mode;
        if (typeof data.pairing_expires_in === "number") this.pairingExpiresIn = data.pairing_expires_in;
        this.notify();
      }
    } catch (_) {}
  }

  async refreshActiveClients(): Promise<ConnectedCounterClient[]> {
    await this.fetchHubStatus();
    try {
      const res = await fetch(`http://127.0.0.1:${this.apiPort}/api/lan/v1/clients`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.clients)) {
          this.activeClients = data.clients;
          this.notify();
          return this.activeClients;
        }
      }
    } catch (_) {}
    return this.activeClients;
  }

  async updateClientStatus(clientId: string, status: "active" | "blocked" | "disconnected"): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.apiPort}/api/lan/v1/clients/${clientId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await this.refreshActiveClients();
        return true;
      }
    } catch (_) {}
    return false;
  }

  async startServer(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: true, message: "LAN Hub Server is already active and listening on 0.0.0.0." };
    }

    try {
      await this.initAdapters();
      const profile = await storeDeviceService.getDeviceProfile();
      const stationName = profile?.counter_name || "Counter 01 (Store Hub)";

      // Configure LAN peer role as main hub station
      lanPeerService.configureStation("main_station", stationName, this.port);

      this.isRunning = true;
      this.startedAt = Date.now();

      // Start periodic refresh of active connected secondary terminals
      await this.refreshActiveClients();
      if (this.pollClientsTimer) clearInterval(this.pollClientsTimer);
      this.pollClientsTimer = setInterval(() => {
        if (!this.isRunning) return;
        this.refreshActiveClients().catch(() => {});
      }, 5000);

      this.saveConfig();
      this.notify();
      return {
        success: true,
        message: `In-Store LAN Hub listening on 0.0.0.0:${this.port} (LAN IP: ${this.selectedAdapterIp || "127.0.0.1"}).`,
      };
    } catch (e: any) {
      this.isRunning = false;
      this.notify();
      return { success: false, message: e?.message || "Failed to start LAN server" };
    }
  }

  async stopServer(): Promise<{ success: boolean; message: string }> {
    if (!this.isRunning) {
      return { success: true, message: "LAN Server is already stopped." };
    }

    if (this.pollClientsTimer) {
      clearInterval(this.pollClientsTimer);
      this.pollClientsTimer = null;
    }

    this.isRunning = false;
    this.startedAt = null;

    lanPeerService.configureStation("counter_client", "Counter Station", this.port);
    this.notify();
    return { success: true, message: "LAN Hub Server stopped." };
  }

  async restartServer(): Promise<{ success: boolean; message: string }> {
    await this.stopServer();
    await new Promise((r) => setTimeout(r, 400));
    return await this.startServer();
  }
}

export const lanServerControlService = new LanServerControlService();
