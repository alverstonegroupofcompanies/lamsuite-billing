import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  Building2,
  KeyRound,
  Network,
  Cpu,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Server,
  Lock,
  Check,
  Wifi,
  Radio,
} from "lucide-react";
import { storeDeviceService, type StoreDeviceProfile } from "../lib/auth/storeDeviceService";
import { INITIAL_BRANCH_STORES, type BranchStore } from "../lib/masters/storeService";
import { storeRegistryService } from "../lib/auth/storeRegistryService";
import { lanPeerService, type LanPeerInfo } from "../lib/lan/lanPeerService";
import { cloudDeltaSyncService } from "../lib/sync/cloudDeltaSyncService";
import { lanDiscoveryService, type DiscoveredHubPeer, type HubHealthCheck } from "../lib/lan/lanDiscoveryService";
import { LanDiagnosticsPanel } from "../components/LanDiagnosticsPanel";
import { API_BASE_URL, DEFAULT_LAN_PORT } from "../config/env";

export interface LanServerItem {
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
}

interface StoreSetupPageProps {
  onSetupComplete: (profile: StoreDeviceProfile) => void;
  onCancel?: () => void;
}

export const StoreSetupPage: React.FC<StoreSetupPageProps> = ({ onSetupComplete, onCancel }) => {
  const [setupMode, setSetupMode] = useState<"activation_key" | "owner_login" | "lan_secondary">("activation_key");
  const [activationKey, setActivationKey] = useState("");
  const [counterName, setCounterName] = useState("Counter 01");
  const [isHub, setIsHub] = useState(true);

  // Owner login mode
  const [ownerEmail, setOwnerEmail] = useState("owner@lamstone.in");
  const [ownerPassword, setOwnerPassword] = useState("password123");
  const [branches, setBranches] = useState<BranchStore[]>(INITIAL_BRANCH_STORES);
  const [selectedBranchId, setSelectedBranchId] = useState("store_main");
  const [totpCode, setTotpCode] = useState("");
  const [requires2fa, setRequires2fa] = useState(false);

  // Secondary counter LAN mode
  const [hubIp, setHubIp] = useState("");
  const [hubPort, setHubPort] = useState(DEFAULT_LAN_PORT);
  const [storeKeyInput, setStoreKeyInput] = useState("");
  const [isDiscoveringLan, setIsDiscoveringLan] = useState(false);
  const [lanScanProgress, setLanScanProgress] = useState({ scanned: 0, total: 0 });
  const [lanServers, setLanServers] = useState<LanServerItem[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>("");
  const [testResult, setTestResult] = useState<{ status: "idle" | "testing" | "success" | "error"; message?: string; latency?: number }>({ status: "idle" });
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // First admin setup
  const [needsFirstAdmin, setNeedsFirstAdmin] = useState(false);
  const [firstAdminName, setFirstAdminName] = useState("Store Admin");
  const [firstAdminUsername, setFirstAdminUsername] = useState("admin");
  const [firstAdminPassword, setFirstAdminPassword] = useState("admin123");
  const [firstAdminPin, setFirstAdminPin] = useState("1234");

  // Progress screen
  const [isProgressing, setIsProgressing] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // Populate discovered LAN servers from registered stores & active network peers
  const loadLanServers = async () => {
    try {
      const servers: LanServerItem[] = [];

      // Only check live verified hub if user has configured one or previously discovered one
      const cachedIp = localStorage.getItem("lamsuite_hub_ip");
      if (cachedIp && cachedIp !== "127.0.0.1" && cachedIp !== "tauri.localhost") {
        const health = await lanDiscoveryService.checkHubHealth(cachedIp, 8000, 800);
        if (health.isHealthy) {
          servers.push({
            id: health.hubId,
            hub_label: health.hubLabel,
            ip_address: cachedIp,
            port: health.port,
            api_port: health.apiPort,
            app_version: health.appVersion,
            protocol_version: health.protocolVersion,
            pairing_mode: health.pairingMode,
            pairing_expires_in: health.pairingExpiresIn,
            is_paired: false,
            status: "online",
            is_main: true,
          });
        }
      }

      setLanServers(servers);
      if (servers.length > 0 && !hubIp) {
        setHubIp(servers[0].ip_address);
        setSelectedServerId(servers[0].id);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    storeDeviceService.fetchBranchesForOwner().then((b) => {
      if (b.length > 0) {
        setBranches(b);
        setSelectedBranchId(b[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (setupMode === "lan_secondary") {
      loadLanServers();
    }
  }, [setupMode]);

  const handleLanDiscovery = async () => {
    setIsDiscoveringLan(true);
    setErrorMsg("");
    setLanScanProgress({ scanned: 0, total: 16 });

    try {
      // 1. Gather all local network adapters
      const ifaces = await lanDiscoveryService.getLocalNetworkInterfaces();
      const localIps = ifaces.filter((i) => !i.isInternal).map((i) => i.ip);
      const baseIp = localIps[0] || (typeof window !== "undefined" && window.location.hostname !== "localhost" ? window.location.hostname : "192.168.0.143");

      // 2. Perform targeted live subnet sweep across ports 8000 and 8089
      const discoveredPeers = await lanDiscoveryService.scanSubnetForHubs(baseIp, (scanned, total, found) => {
        setLanScanProgress({ scanned, total });
        if (found.length > 0) {
          const mapped: LanServerItem[] = found.map((p) => ({
            id: p.id,
            hub_label: p.hub_label,
            ip_address: p.ip_address,
            port: p.port,
            api_port: p.api_port,
            app_version: p.app_version,
            protocol_version: p.protocol_version,
            pairing_mode: p.pairing_mode,
            pairing_expires_in: p.pairing_expires_in,
            is_paired: false,
            status: "online",
            is_main: true,
          }));
          setLanServers(mapped);
          if (!hubIp) {
            setHubIp(mapped[0].ip_address);
            setSelectedServerId(mapped[0].id);
          }
        }
      });

      // 3. Check native peer discovery if running inside desktop container
      const nativePeer = await lanPeerService.discoverMainStation().catch(() => null);

      if (discoveredPeers.length > 0) {
        const mapped: LanServerItem[] = discoveredPeers.map((p) => ({
          id: p.id,
          hub_label: p.hub_label,
          ip_address: p.ip_address,
          port: p.port,
          api_port: p.api_port,
          app_version: p.app_version,
          protocol_version: p.protocol_version,
          pairing_mode: p.pairing_mode,
          pairing_expires_in: p.pairing_expires_in,
          is_paired: false,
          status: "online",
          is_main: true,
        }));
        setLanServers(mapped);
        setHubIp(mapped[0].ip_address);
        setSelectedServerId(mapped[0].id);
      } else if (nativePeer && nativePeer.ip_address !== "127.0.0.1" && nativePeer.ip_address !== "tauri.localhost") {
        setLanServers((prev) => {
          const exists = prev.some((p) => p.ip_address === nativePeer.ip_address);
          if (!exists) {
            return [
              {
                id: `peer_${nativePeer.station_id}`,
                hub_label: "Main Counter Hub",
                ip_address: nativePeer.ip_address,
                port: nativePeer.port,
                api_port: 8000,
                app_version: "2.0.0",
                protocol_version: "1.0",
                pairing_mode: false,
                pairing_expires_in: 0,
                is_paired: false,
                status: "online",
                is_main: nativePeer.is_main,
              },
              ...prev,
            ];
          }
          return prev;
        });
        setHubIp(nativePeer.ip_address);
        setSelectedServerId(`peer_${nativePeer.station_id}`);
      } else {
        setErrorMsg("No active store hubs responded to scan. You can enter the Hub IP manually below or click 'Test Connection'.");
      }
      setIsDiscoveringLan(false);
    } catch (e: any) {
      setIsDiscoveringLan(false);
      setErrorMsg(e?.message || "LAN Scan failed. Please check network adapters or enter IP manually.");
    }
  };

  const handleTestConnection = async () => {
    if (!hubIp.trim()) {
      setTestResult({ status: "error", message: "Please enter the Store Main Hub IP Address first." });
      return;
    }

    setTestResult({ status: "testing" });
    try {
      let health = await lanDiscoveryService.checkHubHealth(hubIp.trim(), hubPort, 2000);
      if (!health.isHealthy) {
        // Fallback probe port 8000
        health = await lanDiscoveryService.checkHubHealth(hubIp.trim(), 8000, 2000);
      }

      if (health.isHealthy) {
        setTestResult({
          status: "success",
          latency: health.latencyMs,
          message: `Reachable: ${health.hubLabel} (v${health.appVersion}) • Latency: ${health.latencyMs}ms • ${health.pairingMode ? "Pairing Open" : "Needs Pairing Approval/Store Key"}`,
        });
      } else {
        setTestResult({
          status: "error",
          message: health.error || `Unable to reach ${hubIp}:${hubPort}. Verify firewall and IP address.`,
        });
      }
    } catch (err: any) {
      setTestResult({
        status: "error",
        message: err?.message || "Connection refused or timed out.",
      });
    }
  };

  const handleSelectServer = (server: LanServerItem) => {
    setSelectedServerId(server.id);
    setHubIp(server.ip_address);
    // Auto-suggest next secondary counter name if current is Counter 01
    if (counterName === "Counter 01") {
      setCounterName("Counter 02");
    }
  };

  const handleStartSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setIsProgressing(true);
    setProgressPercent(10);
    setProgressStep("Initializing workstation registration handshake...");

    try {
      let profile: StoreDeviceProfile;

      if (setupMode === "activation_key") {
        profile = await storeDeviceService.registerWithActivationKey(
          activationKey,
          counterName,
          isHub,
          (step, pct) => {
            setProgressStep(step);
            setProgressPercent(pct);
          }
        );
      } else if (setupMode === "owner_login") {
        profile = await storeDeviceService.registerWithOwnerCredentials(
          ownerEmail,
          ownerPassword,
          selectedBranchId,
          counterName,
          isHub,
          totpCode || undefined,
          (step, pct) => {
            setProgressStep(step);
            setProgressPercent(pct);
          }
        );
      } else {
        // LAN secondary counter pairing
        const cleanHub = hubIp.trim();
        if (!cleanHub) {
          throw new Error("Store Main Hub IP Address is required to onboard a secondary counter.");
        }

        localStorage.setItem("lamsuite_hub_ip", cleanHub);
        localStorage.setItem("lamsuite_hub_port", String(hubPort));

        // 1. First perform health check to verify hub is alive & reachable
        setProgressStep(`Probing LAN Hub at ${cleanHub}...`);
        setProgressPercent(30);

        let health = await lanDiscoveryService.checkHubHealth(cleanHub, hubPort, 2500);
        if (!health.isHealthy) {
          health = await lanDiscoveryService.checkHubHealth(cleanHub, 8000, 2500);
        }

        if (!health.isHealthy) {
          throw new Error(`Failed to reach Store Hub at ${cleanHub}: ${health.error}. Verify IP and firewall settings.`);
        }

        // 2. Perform authenticated counter pairing handshake
        setProgressStep(`Authenticating counter "${counterName}" with LAN Hub...`);
        setProgressPercent(50);

        const deviceUuid = `dev_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        const counterCode = counterName.replace(/[^0-9]/g, "")
          ? `C${counterName.replace(/[^0-9]/g, "").padStart(2, "0")}`
          : "C02";

        const clientDeviceName = typeof navigator !== "undefined" && navigator.userAgent
          ? (navigator.userAgent.includes("Mac") ? "Mac-Terminal" : navigator.userAgent.includes("Win") ? "Windows-Terminal" : "Client-Terminal")
          : "Secondary-PC";

        const pairRes = await fetch(`http://${cleanHub}:${health.apiPort}/api/lan/v1/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            counter_name: counterName,
            counter_code: counterCode,
            device_name: clientDeviceName,
            store_key: storeKeyInput.trim(),
            device_uuid: deviceUuid,
          }),
        });

        if (!pairRes.ok) {
          const errData = await pairRes.json().catch(() => ({}));
          throw new Error(errData.message || `Hub pairing rejected with status ${pairRes.status}`);
        }

        const pairData = await pairRes.json();
        const deviceToken = pairData.device_token;
        if (deviceToken) {
          localStorage.setItem("lamsuite_device_token", deviceToken);
        }

        profile = {
          device_id: pairData.counter_id || `cntr_${Date.now()}`,
          device_uuid: deviceUuid,
          device_name: counterName,
          store_id: String(pairData.store_id || "1"),
          store_name: pairData.store_name || "LamStone Store",
          store_code: pairData.store_code || "STORE-01",
          counter_id: pairData.counter_id || `cntr_${Date.now()}`,
          counter_name: counterName,
          counter_code: counterCode,
          is_hub: false,
          license_plan: "Retail & Pharmacy Chain Pro (LAN Secondary)",
          license_status: "active",
          license_expires_at: "2027-12-31",
          registered_at: Date.now(),
          is_active: pairData.status === "active",
        };

        // 3. Ingest Master Snapshot directly from Hub
        setProgressStep(`Fetching master catalog from LAN Hub (${cleanHub})...`);
        setProgressPercent(80);
        let appliedCount = 0;
        try {
          const fetchRes = await lanPeerService.pullMasterSnapshotFromMain(cleanHub, hubPort, undefined, deviceToken);
          appliedCount = fetchRes.appliedCount;
        } catch (lanErr: any) {
          try {
            const fetchRes8000 = await lanPeerService.pullMasterSnapshotFromMain(cleanHub, 8000, undefined, deviceToken);
            appliedCount = fetchRes8000.appliedCount;
          } catch {
            console.warn("LAN master pull deferred:", lanErr?.message || lanErr);
          }
        }
        setProgressStep(`Ingested ${appliedCount} items from LAN Hub.`);

        // Register the paired secondary store in Registry and secure storage
        try {
          const refreshToken = `ref_lan_${Date.now()}`;
          await storeRegistryService.registerStore(profile, {
            deviceToken: deviceToken || `tok_lan_${Date.now()}`,
            refreshToken,
          });
        } catch (regErr) {
          console.warn("Registry store registration notice:", regErr);
        }
      }

      // If initial cloud setup (activation key or owner login), check and fetch master catalog deltas from backend server
      if (setupMode !== "lan_secondary") {
        setProgressStep("Checking backend for initial master catalog data...");
        setProgressPercent(85);
        try {
          const syncRes = await cloudDeltaSyncService.pullMasterDelta({
            fetchMasterDeltas: async (wm) => {
              const res = await fetch(`${API_BASE_URL}/api/sync/pull/deltas?store_id=${profile.store_id}&since_watermark=${wm}`);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.json();
            },
          });
          const totalFetched = (syncRes.appliedProducts || 0) + (syncRes.appliedBatches || 0) + (syncRes.appliedParties || 0);
          if (totalFetched > 0) {
            setProgressStep(`Ingested ${totalFetched} items from backend server.`);
          }
        } catch (fetchErr) {
          console.warn("Backend delta fetch deferred:", fetchErr);
        }
      }

      if (needsFirstAdmin) {
        setProgressStep("Provisioning first store administrator account...");
        await storeDeviceService.setupFirstAdmin({
          name: firstAdminName,
          username: firstAdminUsername,
          password: firstAdminPassword,
          pin: firstAdminPin,
        });
      } else if (setupMode !== "lan_secondary" && profile.admin_staff_present === false) {
        // Backend indicated this store does not have an admin staff member yet!
        // Pause and prompt operator to create the store administrator account.
        setIsProgressing(false);
        setNeedsFirstAdmin(true);
        setErrorMsg("Notice: No administrator account was found for this store in the central system. Please create the initial Store Administrator account below to complete setup.");
        return;
      }

      setProgressStep("Setup complete! Redirecting to workspace...");
      setProgressPercent(100);

      setTimeout(() => {
        onSetupComplete(profile);
      }, 400);
    } catch (err: any) {
      setIsProgressing(false);
      if (err?.requires_2fa) {
        setRequires2fa(true);
        setErrorMsg("Two-factor authentication code (TOTP) required. Please enter the 6-digit code from your authenticator app below.");
        return;
      }
      setErrorMsg(err?.message || "Device registration failed. Please check credentials or network.");
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4 font-sans text-text-main select-none">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="relative text-center mb-6">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="absolute left-0 top-0 px-3 py-1.5 rounded-btn border border-border-main bg-surface hover:bg-canvas text-xs font-medium text-text-muted transition-colors"
            >
              ← Back to Stores
            </button>
          )}
          <div className="w-14 h-14 rounded-card bg-accent flex items-center justify-center text-white mx-auto shadow-xs mb-3">
            <Building2 className="w-7 h-7" />
          </div>
          <h1 className="text-[26px] font-bold tracking-tight text-text-main">LamSuite Billing Setup</h1>
          <p className="text-xs text-text-muted mt-1">
            Workstation Device Registration & Offline Master Data Ingestion
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-surface border border-border-main rounded-card p-6 sm:p-8 shadow-xs">
          {errorMsg && (
            <div className="mb-4 bg-status-danger/10 border border-status-danger/20 rounded-btn p-3 text-xs text-status-danger flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isProgressing ? (
            /* Progress Screen */
            <div className="py-6 space-y-6 text-center">
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <RefreshCw className="w-12 h-12 text-accent animate-spin" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-text-main">Synchronizing Store Environment</h3>
                <p className="text-xs text-accent font-mono animate-pulse">{progressStep}</p>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-canvas rounded-full h-2.5 overflow-hidden border border-border-main">
                <div
                  className="bg-accent h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="flex justify-between text-[11px] text-text-muted">
                <span>OS Secure Token Vault</span>
                <span className="font-mono font-bold text-text-main tabular-nums">{progressPercent}%</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleStartSetup} className="space-y-4">
              {/* Setup Mode Navigation */}
              <div className="grid grid-cols-3 gap-2 p-1 bg-canvas rounded-btn border border-border-main text-xs">
                <button
                  type="button"
                  onClick={() => setSetupMode("activation_key")}
                  className={`py-2 rounded-btn font-medium transition-colors ${
                    setupMode === "activation_key"
                      ? "bg-surface text-accent shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Store Key
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode("owner_login")}
                  className={`py-2 rounded-btn font-medium transition-colors ${
                    setupMode === "owner_login"
                      ? "bg-surface text-accent shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Owner Login
                </button>
                <button
                  type="button"
                  onClick={() => setSetupMode("lan_secondary")}
                  className={`py-2 rounded-btn font-medium transition-colors ${
                    setupMode === "lan_secondary"
                      ? "bg-surface text-accent shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  LAN Counter
                </button>
              </div>

              {/* Mode 1: Activation Key */}
              {setupMode === "activation_key" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                      Store Activation Key / License Token
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-text-muted absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={activationKey}
                        onChange={(e) => setActivationKey(e.target.value.toUpperCase())}
                        placeholder="LAM-STORE-XXXX-YYYY"
                        className="w-full pl-9 pr-3.5 py-2.5 bg-surface border border-border-main rounded-btn text-text-main font-mono text-xs focus:border-accent focus:outline-none"
                      />
                    </div>
                    <p className="text-[11px] text-text-muted mt-1">
                      Provided on store creation in Central Admin or license dispatch letter.
                    </p>
                  </div>
                </div>
              )}

              {/* Mode 2: Store Owner Login */}
              {setupMode === "owner_login" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Owner Email</label>
                    <input
                      type="email"
                      required
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="w-full px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Password</label>
                    <input
                      type="password"
                      required
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className="w-full px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                      Select Store / Branch (Multi-Store Ownership)
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className="w-full px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.code}) — {b.city}
                        </option>
                      ))}
                    </select>
                  </div>

                  {requires2fa && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-btn space-y-1.5">
                      <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Two-Factor Authentication Code (TOTP)
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        required
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="000000"
                        className="w-full px-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main font-mono text-center tracking-widest text-sm focus:border-accent focus:outline-none tabular-nums"
                      />
                      <p className="text-[10px] text-text-muted">Enter the 6-digit code from your authenticator app</p>
                    </div>
                  )}
                </div>
              )}

              {/* Mode 3: LAN Secondary Counter */}
              {setupMode === "lan_secondary" && (
                <div className="space-y-3.5">
                  <div className="bg-accent-soft p-3 rounded-card border border-accent/20 text-xs text-accent">
                    <p className="flex items-center gap-1.5 font-bold mb-1">
                      <Network className="w-4 h-4 shrink-0 text-accent" />
                      Connecting as a Secondary Terminal
                    </p>
                    <p className="text-[11px] text-text-muted">
                      This terminal will synchronize catalog, pricing and shifts from your Main Counter Server over LAN.
                    </p>
                  </div>

                  {/* Discovered LAN Servers List */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Available LAN Servers & Hubs ({lanServers.length})
                      </label>
                      <button
                        type="button"
                        onClick={handleLanDiscovery}
                        disabled={isDiscoveringLan}
                        className="px-2.5 py-1 bg-accent-soft hover:bg-accent-soft/80 text-accent border border-accent/20 rounded-btn text-[11px] font-semibold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isDiscoveringLan ? "animate-spin" : ""}`} />
                        <span>{isDiscoveringLan ? "Scanning Network..." : "Scan LAN"}</span>
                      </button>
                    </div>

                    {isDiscoveringLan && lanServers.length === 0 ? (
                      <div className="p-4 rounded-btn border border-dashed border-border-main text-center text-xs text-text-muted space-y-1 bg-canvas">
                        <RefreshCw className="w-4 h-4 text-accent animate-spin mx-auto" />
                        <p className="font-semibold text-text-main">Searching local subnet for Store Hubs...</p>
                        <p className="text-[11px]">Listening on port 8089 for broadcast beacons</p>
                      </div>
                    ) : lanServers.length > 0 ? (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                        {lanServers.map((srv) => {
                          const isSelected = selectedServerId === srv.id || hubIp === srv.ip_address;
                          return (
                            <div
                              key={srv.id}
                              onClick={() => handleSelectServer(srv)}
                              className={`p-3 rounded-card border transition-all cursor-pointer flex items-center justify-between text-xs ${
                                isSelected
                                  ? "border-accent bg-accent-soft/30 ring-1 ring-accent"
                                  : "border-border-main bg-surface hover:bg-canvas hover:border-accent/40"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`w-9 h-9 rounded-btn flex items-center justify-center shrink-0 ${
                                    isSelected
                                      ? "bg-accent text-white shadow-2xs"
                                      : "bg-canvas text-accent border border-border-main"
                                  }`}
                                >
                                  <Server className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-text-main truncate">{srv.hub_label}</span>
                                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider">
                                      Not Paired
                                    </span>
                                    {srv.pairing_mode && (
                                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider animate-pulse">
                                        Pairing Open
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-muted font-mono flex-wrap">
                                    <span className="text-accent">{srv.ip_address}:{srv.port}</span>
                                    <span>•</span>
                                    <span>v{srv.app_version}</span>
                                    <span>•</span>
                                    <span className="text-slate-500">ID: {srv.id.slice(0, 10)}...</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 pl-2">
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  Online
                                </span>
                                {isSelected && (
                                  <div className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center">
                                    <Check className="w-3 h-3 stroke-[3]" />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-3.5 rounded-btn border border-dashed border-border-main text-center text-xs text-text-muted bg-canvas">
                        No active LAN hubs automatically detected. Click "Scan LAN" or enter IP manually below.
                      </div>
                    )}
                  </div>

                  {/* Selected / Manual IP Address Field */}
                  <div className="pt-1 space-y-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                          Store Main Hub IP Address
                        </label>
                        <div className="relative">
                          <Network className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                          <input
                            type="text"
                            required
                            value={hubIp}
                            onChange={(e) => {
                              setHubIp(e.target.value);
                              setSelectedServerId("");
                              setTestResult({ status: "idle" });
                            }}
                            placeholder="e.g. 192.168.0.143 or 10.0.0.15"
                            className="w-full pl-9 pr-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main font-mono text-xs focus:border-accent focus:outline-none tabular-nums"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                          Port
                        </label>
                        <input
                          type="number"
                          value={hubPort}
                          onChange={(e) => {
                            setHubPort(Number(e.target.value) || 8089);
                            setTestResult({ status: "idle" });
                          }}
                          placeholder="8089"
                          className="w-full px-3 py-2 bg-surface border border-border-main rounded-btn text-text-main font-mono text-xs focus:border-accent focus:outline-none tabular-nums"
                        />
                      </div>
                    </div>

                    {/* Store Key / Pairing Code */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                          Store Key or Hub Pairing Code
                        </label>
                        <span className="text-[10px] text-text-muted">Required for secure authentication</span>
                      </div>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                        <input
                          type="text"
                          value={storeKeyInput}
                          onChange={(e) => setStoreKeyInput(e.target.value)}
                          placeholder="e.g. STORE-01 or 6-digit PIN"
                          className="w-full pl-9 pr-3.5 py-2 bg-surface border border-border-main rounded-btn text-text-main font-mono text-xs focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Test Connection Button & Status */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testResult.status === "testing" || !hubIp.trim()}
                        className="px-3 py-1.5 bg-surface hover:bg-canvas text-accent border border-accent/30 rounded-btn text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${testResult.status === "testing" ? "animate-spin" : ""}`} />
                        <span>{testResult.status === "testing" ? "Probing Hub..." : "Test Connection"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowDiagnostics(!showDiagnostics)}
                        className="px-2.5 py-1.5 text-text-muted hover:text-text-main text-xs underline font-medium"
                      >
                        {showDiagnostics ? "Hide LAN Diagnostics" : "Show LAN Diagnostics"}
                      </button>
                    </div>

                    {testResult.status !== "idle" && (
                      <div
                        className={`p-2.5 rounded-btn border text-xs flex items-start gap-2 ${
                          testResult.status === "success"
                            ? "bg-status-success/10 border-status-success/30 text-status-success"
                            : testResult.status === "error"
                            ? "bg-status-danger/10 border-status-danger/30 text-status-danger"
                            : "bg-surface border-border-main text-text-muted"
                        }`}
                      >
                        {testResult.status === "success" && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                        {testResult.status === "error" && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                        <span className="font-medium">{testResult.message}</span>
                      </div>
                    )}

                    {/* Expandable Diagnostics Panel */}
                    {showDiagnostics && (
                      <div className="pt-2">
                        <LanDiagnosticsPanel hubIp={hubIp || "127.0.0.1"} hubPort={hubPort} isHubMode={false} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Counter Designation */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-main">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">Counter Name</label>
                  <input
                    type="text"
                    required
                    value={counterName}
                    onChange={(e) => setCounterName(e.target.value)}
                    placeholder="Counter 01"
                    className="w-full px-3 py-2 bg-surface border border-border-main rounded-btn text-text-main text-xs focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={setupMode === "lan_secondary" ? false : isHub}
                      disabled={setupMode === "lan_secondary"}
                      onChange={(e) => setIsHub(e.target.checked)}
                      className="rounded border-border-main text-accent focus:ring-accent h-4 w-4"
                    />
                    <span className="text-xs text-text-main font-medium">Designate as Store Hub</span>
                  </label>
                </div>
              </div>

              {/* First Admin Onboarding (Triggered only if server confirms store has no administrator) */}
              {needsFirstAdmin && (
                <div className="bg-canvas p-4 rounded-card border border-border-main space-y-3">
                  <h4 className="text-xs font-bold text-text-main flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-accent" />
                    First Administrator Account (Server-Verified New Store)
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Full Name</label>
                      <input
                        type="text"
                        value={firstAdminName}
                        onChange={(e) => setFirstAdminName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Username</label>
                      <input
                        type="text"
                        value={firstAdminUsername}
                        onChange={(e) => setFirstAdminUsername(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Password</label>
                      <input
                        type="password"
                        value={firstAdminPassword}
                        onChange={(e) => setFirstAdminPassword(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1 uppercase tracking-wider">Quick PIN (4 digits)</label>
                      <input
                        type="password"
                        maxLength={6}
                        value={firstAdminPin}
                        onChange={(e) => setFirstAdminPin(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-surface border border-border-main rounded-btn text-text-main font-mono focus:border-accent focus:outline-none tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full mt-4 py-2.5 px-4 bg-accent hover:bg-accent/90 text-white text-xs font-semibold rounded-btn shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <span>Complete Store Onboarding</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
