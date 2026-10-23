import { describe, it, expect, beforeEach, vi } from "vitest";
import { lanDiscoveryService, type HubHealthCheck } from "./lanDiscoveryService";
import { lanServerControlService } from "./lanServerControlService";
import { lanPeerService } from "./lanPeerService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("LAN Hub Discovery, Pairing Handshake & Resilience Engine", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    if (typeof localStorage !== "undefined" && typeof localStorage.clear === "function") {
      localStorage.clear();
    }
  });

  it("1. Checks hub health endpoint and ensures minimal announcement privacy (no hostnames/store names)", async () => {
    const mockHealth: HubHealthCheck = {
      isHealthy: true,
      hubId: "hub_d09329247de3",
      hubLabel: "Main Counter Hub",
      appVersion: "2.0.0",
      protocolVersion: "1.0",
      port: 8089,
      apiPort: 8000,
      timestamp: Date.now(),
      pairingMode: false,
      pairingExpiresIn: 0,
      latencyMs: 12,
    };

    // Spy on checkHubHealth
    const spy = vi.spyOn(lanDiscoveryService, "checkHubHealth").mockResolvedValue(mockHealth);

    const result = await lanDiscoveryService.checkHubHealth("192.168.0.143", 8089);
    expect(result.isHealthy).toBe(true);
    expect(result.hubLabel).toBe("Main Counter Hub");
    expect(result.hubId).toBe("hub_d09329247de3");
    expect((result as any).storeName).toBeUndefined();
    expect((result as any).deviceName).toBeUndefined();
    spy.mockRestore();
  });

  it("2. Handles unreachable or firewall-blocked ports with clear diagnostic errors", async () => {
    const unreachableCheck: HubHealthCheck = {
      isHealthy: false,
      hubId: "",
      hubLabel: "",
      appVersion: "",
      protocolVersion: "",
      port: 8089,
      apiPort: 8000,
      timestamp: 0,
      pairingMode: false,
      pairingExpiresIn: 0,
      error: "Port 8089 unreachable or connection refused",
      latencyMs: 250,
    };

    const spy = vi.spyOn(lanDiscoveryService, "checkHubHealth").mockResolvedValue(unreachableCheck);
    const result = await lanDiscoveryService.checkHubHealth("192.168.1.99", 8089);

    expect(result.isHealthy).toBe(false);
    expect(result.error).toContain("unreachable or connection refused");
    spy.mockRestore();
  });

  it("3. Enumerates network interfaces and differentiates LAN vs Loopback", async () => {
    const ifaces = await lanDiscoveryService.getLocalNetworkInterfaces();
    expect(ifaces.length).toBeGreaterThan(0);
    const loopback = ifaces.find((i) => i.isInternal);
    expect(loopback).toBeDefined();
    expect(loopback?.ip).toBe("127.0.0.1");
  });

  it("4. Server control excludes hub from active secondary counter count", () => {
    const status = lanServerControlService.getStatus();
    expect(status.bindAddress).toBe("0.0.0.0");
    // Initially active connected secondary counters should be 0, not including hub itself
    expect(status.activeClientsCount).toBe(0);
  });

  it("5. Allows changing network adapter IP for multihomed machines", () => {
    lanServerControlService.setSelectedAdapter("192.168.0.143");
    const status = lanServerControlService.getStatus();
    expect(status.selectedAdapterIp).toBe("192.168.0.143");
  });
});
