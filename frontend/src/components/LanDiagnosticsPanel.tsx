import React, { useState, useEffect } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Copy,
  Check,
  Shield,
  Wifi,
  Terminal,
  HelpCircle,
} from "lucide-react";
import { lanDiscoveryService, type NetworkInterfaceInfo, type HubHealthCheck } from "../lib/lan/lanDiscoveryService";
import { lanServerControlService } from "../lib/lan/lanServerControlService";

interface LanDiagnosticsPanelProps {
  hubIp?: string;
  hubPort?: number;
  isHubMode?: boolean;
}

export const LanDiagnosticsPanel: React.FC<LanDiagnosticsPanelProps> = ({
  hubIp = "127.0.0.1",
  hubPort = 8089,
  isHubMode = false,
}) => {
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [healthStatus, setHealthStatus] = useState<HubHealthCheck | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  const runDiagnostics = async () => {
    setIsTesting(true);
    try {
      const ifaces = await lanDiscoveryService.getLocalNetworkInterfaces();
      setInterfaces(ifaces);

      // Probe health on target port and on backend port 8000
      let health = await lanDiscoveryService.checkHubHealth(hubIp, hubPort, 1500);
      if (!health.isHealthy) {
        health = await lanDiscoveryService.checkHubHealth(hubIp, 8000, 1500);
      }
      setHealthStatus(health);
    } catch (_) {
    } finally {
      setIsTesting(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, [hubIp, hubPort]);

  const copyDiagnosticReport = () => {
    const report = [
      "=== LAMSUITE LAN DIAGNOSTIC REPORT ===",
      `Timestamp: ${new Date().toISOString()}`,
      `Role: ${isHubMode ? "Store Hub Server" : "Secondary Counter Terminal"}`,
      `Target Hub: ${hubIp}:${hubPort}`,
      `Hub Health: ${healthStatus?.isHealthy ? "ONLINE / VERIFIED" : "UNREACHABLE"}`,
      `Latency: ${healthStatus?.latencyMs || 0}ms`,
      `Error Detail: ${healthStatus?.error || "None"}`,
      "",
      "--- NETWORK INTERFACES ---",
      ...interfaces.map((i) => `* ${i.name}: ${i.ip} (${i.family}) [Internal: ${i.isInternal}]`),
      "",
      "--- ENVIRONMENT RECOMMENDATIONS ---",
      "* Check if both devices are on the same subnet (e.g. 192.168.0.x).",
      "* Verify AP/Client Isolation is OFF on Wi-Fi router.",
      "* Allow inbound TCP port 8000 & 8089 in Windows Firewall or macOS Security.",
      "=======================================",
    ].join("\n");

    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-canvas border border-border-main rounded-card p-4 text-xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-main pb-2.5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          <span className="font-bold text-text-main">LAN Network Diagnostics & Self-Test</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyDiagnosticReport}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-surface hover:bg-canvas text-text-muted hover:text-text-main border border-border-main rounded-btn text-[11px] font-medium transition-colors"
            title="Copy Report to Clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? "Copied" : "Copy Report"}</span>
          </button>
          <button
            type="button"
            onClick={runDiagnostics}
            disabled={isTesting}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-accent-soft hover:bg-accent-soft/80 text-accent border border-accent/20 rounded-btn text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isTesting ? "animate-spin" : ""}`} />
            <span>Run Self-Test</span>
          </button>
        </div>
      </div>

      {/* Target Connection Status */}
      <div
        className={`p-3 rounded-btn border flex items-start justify-between gap-3 ${
          healthStatus?.isHealthy
            ? "bg-status-success/10 border-status-success/30 text-status-success"
            : "bg-status-danger/10 border-status-danger/30 text-status-danger"
        }`}
      >
        <div className="flex items-start gap-2.5">
          {healthStatus?.isHealthy ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <div>
            <div className="font-bold">
              {healthStatus?.isHealthy
                ? `Hub Reachable: ${healthStatus.hubLabel} (${healthStatus.latencyMs}ms)`
                : `Hub Unreachable at ${hubIp}:${hubPort}`}
            </div>
            <div className="text-[11px] mt-0.5 opacity-90">
              {healthStatus?.isHealthy
                ? `Hub Identity: ${healthStatus.hubLabel} • Version ${healthStatus.appVersion} • ${healthStatus.pairingMode ? "Pairing Open" : "Pairing Closed"}`
                : healthStatus?.error || "Connection timed out or refused. Check firewall and IP address."}
            </div>
          </div>
        </div>
      </div>

      {/* Detected Interfaces */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-text-muted">
          Local Network Adapters ({interfaces.length})
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {interfaces.map((iface, idx) => (
            <div
              key={idx}
              className="bg-surface border border-border-main p-2.5 rounded-btn flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Wifi className="w-3.5 h-3.5 text-text-muted" />
                <div>
                  <div className="font-medium text-text-main text-[11px]">{iface.name}</div>
                  <div className="font-mono text-accent text-xs font-semibold">{iface.ip}</div>
                </div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-canvas border border-border-main text-text-muted uppercase font-bold">
                {iface.isInternal ? "Host" : "LAN"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Firewall & Router Guidance */}
      <div className="bg-surface border border-border-main p-3 rounded-btn space-y-2">
        <div className="flex items-center gap-1.5 font-bold text-text-main text-[11px]">
          <Shield className="w-3.5 h-3.5 text-accent" />
          <span>Firewall & Wi-Fi Settings Checklist</span>
        </div>
        <ul className="text-[11px] text-text-muted space-y-1 list-disc list-inside">
          <li>
            <strong className="text-text-main">Windows Firewall:</strong> Add inbound rule for ports{" "}
            <code className="text-accent font-mono">8089</code> & <code className="text-accent font-mono">8000</code>{" "}
            (TCP) in Windows Defender Firewall for Private Networks.
          </li>
          <li>
            <strong className="text-text-main">macOS Firewall:</strong> Under System Settings → Network → Firewall, click
            Options and allow incoming connections for LamSuite Billing.
          </li>
          <li>
            <strong className="text-text-main">Wi-Fi Router:</strong> Disable <em>AP Isolation / Client Isolation</em> in
            your router admin page so terminals can communicate over LAN.
          </li>
        </ul>
      </div>
    </div>
  );
};
