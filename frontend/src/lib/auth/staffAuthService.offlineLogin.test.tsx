import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { staffAuthService } from "./staffAuthService";
import { sqliteStorage } from "../db/sqliteStorage";
import { decryptStaffSecret, encryptStaffSecret } from "./offlineStaffVault";

const BCRYPT_PIN_HASH = "$2y$10$hTzMsa5MFZkXttfaY0htQeiuj8fWX6Wei0rR0jOO497evXtbTU38S";
const BCRYPT_PASSWORD_HASH = "$2y$10$eddzfvbKkdbJLhchDI4GOOXY9U32xweVKUbxXyZk0O5B.w1GmCG3a";

async function seedBcryptCashier(): Promise<void> {
  const existing = await sqliteStorage.findAll<any>("staff_users");
  for (const user of existing || []) {
    if (String(user.id).startsWith("test_offline_")) {
      await sqliteStorage.deleteRecord("staff_users", user.id);
    }
  }

  await sqliteStorage.insertRecord("staff_users", "test_offline_cashier", {
    id: "test_offline_cashier",
    store_id: "1",
    username: "offline_cashier",
    full_name: "Offline Cashier",
    role: "cashier",
    password_hash: await encryptStaffSecret(BCRYPT_PASSWORD_HASH),
    pin_hash: await encryptStaffSecret(BCRYPT_PIN_HASH),
    is_active: 1,
    must_change_password: 0,
    biometric_registered: 0,
    failed_attempts: 0,
    locked_until: null,
    permissions_json: JSON.stringify(["pos.bill"]),
    enabled_menus_json: JSON.stringify(["pos"]),
    updated_at: Date.now(),
  });
}

describe("StaffAuthService offline credentials", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await seedBcryptCashier();
    staffAuthService.logout();
    staffAuthService.setOfflineGraceHours(72);
    try {
      localStorage.removeItem("lamsuite_staff_offline_sync_at_1");
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.unstubAllGlobals();
    try {
      localStorage.removeItem("lamsuite_staff_offline_sync_at_1");
      localStorage.removeItem("staff_token");
    } catch {
      // ignore
    }
  });

  it("signs in offline using the bcrypt hash served by the cloud", async () => {
    const ok = await staffAuthService.authenticateWithPin("offline_cashier", "4826");
    expect(ok.success).toBe(true);
    expect(ok.user?.username).toBe("offline_cashier");

    staffAuthService.logout();
    const bad = await staffAuthService.authenticateWithPin("offline_cashier", "9999");
    expect(bad.success).toBe(false);

    staffAuthService.logout();
    const passwordOk = await staffAuthService.authenticateWithPassword(
      "offline_cashier",
      "StoreCashier@2026!"
    );
    expect(passwordOk.success).toBe(true);
  });

  it("never overwrites the cached offline hash during an online sign-in", async () => {
    process.env.NODE_ENV = "development";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/staff/offline-cache")) {
          return new Response("{}", { status: 503 });
        }
        if (url.includes("/api/staff/login")) {
          return new Response(
            JSON.stringify({
              success: true,
              token: "test-token",
              user: {
                id: "test_offline_cashier",
                store_id: "1",
                username: "offline_cashier",
                name: "Offline Cashier",
                role: "cashier",
                permissions: ["pos.bill"],
                enabled_menus: ["pos"],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new TypeError(`Network disabled in test: ${url}`);
      })
    );

    const online = await staffAuthService.authenticateWithPin("offline_cashier", "4826");
    expect(online.success).toBe(true);

    const stored = await sqliteStorage.findById<any>("staff_users", "test_offline_cashier");
    expect(stored?.pin_hash).toBeTruthy();
    expect(stored?.password_hash).toBeTruthy();
    expect(await decryptStaffSecret(stored!.pin_hash)).toBe(BCRYPT_PIN_HASH);
    expect(await decryptStaffSecret(stored!.password_hash)).toBe(BCRYPT_PASSWORD_HASH);

    // Still unlockable with the PIN after the online session was established.
    process.env.NODE_ENV = "test";
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    staffAuthService.lockCurrentSession();
    const unlocked = await staffAuthService.unlockCurrentSession("4826");
    expect(unlocked.success).toBe(true);
  });

  it("fails closed when the offline cache is older than the grace period", async () => {
    localStorage.setItem("lamsuite_staff_offline_sync_at_1", String(Date.now() - 73 * 60 * 60 * 1000));

    const res = await staffAuthService.authenticateWithPin("offline_cashier", "4826");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Offline sign-in has expired");

    staffAuthService.setOfflineGraceHours(96);
    const allowed = await staffAuthService.authenticateWithPin("offline_cashier", "4826");
    expect(allowed.success).toBe(true);
  });

  it("uploads offline security audit events once and marks them synced", async () => {
    const existingLogs = await sqliteStorage.findAll<any>("security_audit_logs");
    for (const log of existingLogs || []) {
      await sqliteStorage.deleteRecord("security_audit_logs", log.id);
    }

    await sqliteStorage.insertRecord("security_audit_logs", "test_audit_1", {
      id: "test_audit_1",
      event_type: "LOGIN_SUCCESS",
      user_id: "test_offline_cashier",
      user_name: "Offline Cashier",
      counter_id: "C01",
      details: "Offline sign-in",
      ip_address: "127.0.0.1",
      created_at: Date.now(),
      synced: 0,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/sync/push/security-audit")) {
        return new Response(JSON.stringify({ success: true, ingested_count: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new TypeError(`Network disabled in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const uploaded = await staffAuthService.flushOfflineAudit();
    expect(uploaded).toBe(1);

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.events[0].event_type).toBe("LOGIN_SUCCESS");
    expect(body.events[0].id).toBe("test_audit_1");

    const stored = await sqliteStorage.findById<any>("security_audit_logs", "test_audit_1");
    expect(stored?.synced).toBe(1);

    expect(await staffAuthService.flushOfflineAudit()).toBe(0);
  });
});
