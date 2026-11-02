import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { autoUpdateService, classifyUpdaterError } from "./autoUpdateService";
import { sqliteStorage } from "../db/sqliteStorage";

describe("AutoUpdateService - Error Classification & Diagnostics Engine", () => {
  const originalOnLine = navigator.onLine;

  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("1. Classifies offline state as 'No internet connection'", () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
      writable: true,
    });

    const res = classifyUpdaterError(new Error("Network down"), "https://updates.lamstonehealthcare.com/latest.json");
    expect(res.category).toBe("offline");
    expect(res.readableMessage).toBe("No internet connection");
    expect(res.isOnline).toBe(false);
  });

  it("2. Classifies HTTP 404 as 'Update feed not found (HTTP 404)'", () => {
    const res = classifyUpdaterError(new Error("404 Not Found"), "https://updates.lamstonehealthcare.com/latest.json", 404);
    expect(res.category).toBe("not_found");
    expect(res.readableMessage).toBe("Update feed not found (HTTP 404)");
  });

  it("3. Classifies HTTP 403 as 'Update server access forbidden (HTTP 403)'", () => {
    const res = classifyUpdaterError(new Error("Forbidden"), "https://updates.lamstonehealthcare.com/latest.json", 403);
    expect(res.category).toBe("forbidden");
    expect(res.readableMessage).toBe("Update server access forbidden (HTTP 403)");
  });

  it("4. Classifies TLS and Windows CryptoAPI Root store errors specifically", () => {
    const tlsErrors = [
      "SEC_E_UNTRUSTED_ROOT: The certificate chain was issued by an untrusted authority",
      "CERT_E_UNTRUSTEDROOT",
      "certificate verify failed: self signed certificate in certificate chain",
      "SSL handshake failed",
    ];

    for (const raw of tlsErrors) {
      const res = classifyUpdaterError(raw, "https://updates.lamstonehealthcare.com/latest.json");
      expect(res.category).toBe("tls_error");
      expect(res.readableMessage).toBe("TLS certificate validation failed (ISRG Root X1 missing or untrusted)");
    }
  });

  it("5. Classifies minisign signature failure as 'Update signature does not match'", () => {
    const sigErrors = [
      "Minisign signature verification failed for windows-x86_64",
      "Update signature does not match public key",
      "Signature corrupted or invalid",
    ];

    for (const raw of sigErrors) {
      const res = classifyUpdaterError(raw, "https://updates.lamstonehealthcare.com/latest.json");
      expect(res.category).toBe("bad_signature");
      expect(res.readableMessage).toBe("Update signature does not match");
    }
  });

  it("6. Classifies malformed JSON as 'Update feed is invalid'", () => {
    const jsonErrors = [
      "SyntaxError: Unexpected token < in JSON at position 0",
      "Invalid json manifest structure",
    ];

    for (const raw of jsonErrors) {
      const res = classifyUpdaterError(raw, "https://updates.lamstonehealthcare.com/latest.json");
      expect(res.category).toBe("invalid_feed");
      expect(res.readableMessage).toBe("Update feed is invalid");
    }
  });

  it("7. Classifies allowlist or security scope errors as 'Permission blocked'", () => {
    const permErrors = [
      "updater not allowed by allowlist",
      "permission denied to execute updater command",
      "scope violation for process.relaunch",
    ];

    for (const raw of permErrors) {
      const res = classifyUpdaterError(raw, "https://updates.lamstonehealthcare.com/latest.json");
      expect(res.category).toBe("permission_blocked");
      expect(res.readableMessage).toBe("Permission blocked");
    }
  });

  it("8. Classifies network timeouts and connection refusal with the exact server address", () => {
    const netErrors = [
      "ECONNREFUSED 143.110.191.19:443",
      "Request timed out after 6000ms",
      "Failed to connect to update server",
      "Could not fetch a valid release name from the updater server",
    ];

    for (const raw of netErrors) {
      const res = classifyUpdaterError(raw, "https://updates.lamstonehealthcare.com/latest.json");
      expect(res.category).toBe("server_unreachable");
      expect(res.readableMessage).toContain("Cannot reach the update server");
      expect(res.readableMessage).toContain("https://updates.lamstonehealthcare.com/latest.json");
    }
  });
});

describe("AutoUpdateService - SemVer Version Comparison", () => {
  it("Correctly detects newer, equal, and older releases across SemVer versions", () => {
    expect(autoUpdateService.compareSemver("2.0.18", "2.0.17")).toBe(1);
    expect(autoUpdateService.compareSemver("v2.1.0", "2.0.17")).toBe(1);
    expect(autoUpdateService.compareSemver("3.0.0", "2.0.17")).toBe(1);
    expect(autoUpdateService.compareSemver("2.0.17", "2.0.17")).toBe(0);
    expect(autoUpdateService.compareSemver("v2.0.17", "2.0.17")).toBe(0);
    expect(autoUpdateService.compareSemver("2.0.16", "2.0.17")).toBe(-1);
    expect(autoUpdateService.compareSemver("1.9.9", "2.0.17")).toBe(-1);
  });
});

describe("AutoUpdateService - Mocked Feed Scenarios", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Mocked feed returning no update -> Up to date state", async () => {
    const mockFeed = {
      version: "2.0.18",
      notes: "Current version",
      pub_date: new Date().toISOString(),
      platforms: {},
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockFeed), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await autoUpdateService.checkForUpdates();
    expect(result.shouldUpdate).toBe(false);
    expect(result.message).toContain("Already up to date (version 2.0.18)");
    expect(result.diagnostic?.status).toBe(200);
  });

  it("2. Mocked feed returning a newer version -> Offers new version with release notes", async () => {
    const mockFeed = {
      version: "2.0.19",
      notes: "- Security patch\n- Enhanced offline reconciliation",
      pub_date: new Date().toISOString(),
      platforms: {},
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockFeed), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const result = await autoUpdateService.checkForUpdates();
    expect(result.shouldUpdate).toBe(true);
    expect(result.manifest?.version).toBe("2.0.19");
    expect(result.manifest?.body).toContain("Security patch");
  });

  it("3. Mocked feed returning HTTP 404 -> Throws actionable 'Update feed not found (HTTP 404)'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404, statusText: "Not Found" })
    );

    await expect(autoUpdateService.checkForUpdates()).rejects.toThrow("Update feed not found (HTTP 404)");
  });

  it("4. Mocked feed returning invalid JSON -> Throws 'Update feed is invalid'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Welcome to nginx</body></html>", { status: 200, headers: { "Content-Type": "text/html" } })
    );

    await expect(autoUpdateService.checkForUpdates()).rejects.toThrow();
  });

  it("5. Mocked network timeout -> Throws specific 'Cannot reach the update server'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Request timed out after 6000ms"));

    await expect(autoUpdateService.checkForUpdates()).rejects.toThrow("Cannot reach the update server");
  });
});

describe("AutoUpdateService - Unsynced Offline Bills Safety Gate", () => {
  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("sync_queue");
  });

  it("Detects pending items in SQLite sync_queue and prevents disruptive update restarts", async () => {
    const countBefore = await autoUpdateService.getUnsyncedBillsCount();
    expect(countBefore).toBe(0);

    // Insert an unsynced transaction
    await sqliteStorage.insertRecord("sync_queue", "sync_tx_001", {
      id: "sync_tx_001",
      table_name: "invoices",
      action: "insert",
      payload: { invoice_number: "INV-OFFLINE-001", grand_total: 1500 },
      created_at: new Date().toISOString(),
    });

    const countAfter = await autoUpdateService.getUnsyncedBillsCount();
    expect(countAfter).toBe(1);

    // In desktop environment, installAndRestart must throw warning when unsynced items exist
    vi.spyOn(autoUpdateService, "isTauri").mockReturnValue(true);

    await expect(autoUpdateService.installAndRestart()).rejects.toThrow(
      "You have 1 unsynced bill(s) pending. Updating will restart the application. Please sync all pending transactions before updating."
    );
  });
});
