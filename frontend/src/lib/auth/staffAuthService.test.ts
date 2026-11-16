import { describe, it, expect, beforeEach } from "vitest";
import { staffAuthService } from "./staffAuthService";
import { staffCryptoService } from "./staffCryptoService";
import { counterSequenceService } from "./counterSequenceService";
import { sqliteStorage } from "../db/sqliteStorage";

const TEST_CASHIER_PIN = "6153";
const TEST_MANAGER_PASSWORD = "test-manager-pass-91";
const TEST_ADMIN_PIN = "9071";

async function seedTestStaff(): Promise<void> {
  const existing = await sqliteStorage.findAll<any>("staff_users");
  for (const user of existing || []) {
    if (user.id.startsWith("test_usr_")) {
      await sqliteStorage.deleteRecord("staff_users", user.id);
    }
  }

  const records = [
    {
      id: "test_usr_admin",
      username: "test_admin",
      full_name: "Test Administrator",
      role: "admin",
      pin: TEST_ADMIN_PIN,
      password: "test-admin-pass-73",
    },
    {
      id: "test_usr_manager",
      username: "test_manager",
      full_name: "Test Manager",
      role: "manager",
      pin: "4832",
      password: TEST_MANAGER_PASSWORD,
    },
    {
      id: "test_usr_cashier",
      username: "test_cashier",
      full_name: "Test Cashier",
      role: "cashier",
      pin: TEST_CASHIER_PIN,
      password: "test-cashier-pass-46",
    },
  ];

  for (const record of records) {
    await sqliteStorage.insertRecord("staff_users", record.id, {
      id: record.id,
      store_id: "1",
      username: record.username,
      full_name: record.full_name,
      role: record.role,
      password_hash: await staffCryptoService.hashSecret(record.password),
      pin_hash: await staffCryptoService.hashPin(record.pin),
      is_active: 1,
      must_change_password: 0,
      biometric_registered: 0,
      failed_attempts: 0,
      locked_until: null,
      permissions_json: JSON.stringify(record.role === "cashier" ? ["pos.bill", "bills.view"] : ["*"]),
      enabled_menus_json: JSON.stringify(["pos", "bills"]),
      updated_at: Date.now(),
    });
  }
}

describe("StaffAuthService and Multi-Counter Sequencing", () => {
  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await seedTestStaff();
    staffAuthService.logout();
  });

  it("authenticates cashier with quick PIN offline", async () => {
    const res = await staffAuthService.authenticateWithPin("test_cashier", TEST_CASHIER_PIN);
    expect(res.success).toBe(true);
    expect(res.user?.username).toBe("test_cashier");
    expect(res.user?.role).toBe("cashier");

    const session = staffAuthService.getCurrentSession();
    expect(session).not.toBeNull();
    expect(session?.user.username).toBe("test_cashier");
    expect(session?.isLocked).toBe(false);
  });

  it("authenticates manager with full password", async () => {
    const res = await staffAuthService.authenticateWithPassword("test_manager", TEST_MANAGER_PASSWORD);
    expect(res.success).toBe(true);
    expect(res.user?.role).toBe("manager");
  });

  it("locks account after 5 consecutive failed PIN attempts and permits Admin Unlock", async () => {
    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const res = await staffAuthService.authenticateWithPin("test_cashier", "0000");
      expect(res.success).toBe(false);
      expect(res.error).toContain("attempt(s) remaining");
    }

    // 5th failed attempt triggers 15-minute lock
    const fifthRes = await staffAuthService.authenticateWithPin("test_cashier", "0000");
    expect(fifthRes.success).toBe(false);
    expect(fifthRes.error).toContain("Account locked for 15 minutes");

    // Subsequent valid PIN is rejected during lockout
    const blockedRes = await staffAuthService.authenticateWithPin("test_cashier", TEST_CASHIER_PIN);
    expect(blockedRes.success).toBe(false);
    expect(blockedRes.error).toContain("temporarily locked");

    // Admin unlocks the cashier
    const unlockRes = await staffAuthService.adminUnlock("test_admin", TEST_ADMIN_PIN, "test_cashier");
    expect(unlockRes.success).toBe(true);

    // Cashier can now log in immediately
    const recoveredRes = await staffAuthService.authenticateWithPin("test_cashier", TEST_CASHIER_PIN);
    expect(recoveredRes.success).toBe(true);
  });

  it("rejects weak password and PIN changes", async () => {
    const weakPin = await staffAuthService.changePasswordOrPin("test_usr_cashier", undefined, "1234");
    expect(weakPin.success).toBe(false);
    expect(weakPin.error).toContain("sequence");

    const weakPassword = await staffAuthService.changePasswordOrPin("test_usr_cashier", "short", undefined);
    expect(weakPassword.success).toBe(false);
    expect(weakPassword.error).toContain("at least 8");
  });

  it("generates distinct, collision-free numbering sequences for two concurrent counters", async () => {
    const fy = "2026-27";
    // Counter 01 bills 3 invoices
    const c1Num1 = await counterSequenceService.getNextDocumentNumber("cntr_01", "C01", "invoice", fy);
    const c1Num2 = await counterSequenceService.getNextDocumentNumber("cntr_01", "C01", "invoice", fy);
    const c1Num3 = await counterSequenceService.getNextDocumentNumber("cntr_01", "C01", "invoice", fy);

    // Counter 02 bills 2 invoices
    const c2Num1 = await counterSequenceService.getNextDocumentNumber("cntr_02", "C02", "invoice", fy);
    const c2Num2 = await counterSequenceService.getNextDocumentNumber("cntr_02", "C02", "invoice", fy);

    expect(c1Num1).toBe("C01-INV-1001");
    expect(c1Num2).toBe("C01-INV-1002");
    expect(c1Num3).toBe("C01-INV-1003");

    expect(c2Num1).toBe("C02-INV-1001");
    expect(c2Num2).toBe("C02-INV-1002");

    // All 5 invoice numbers are guaranteed unique
    const set = new Set([c1Num1, c1Num2, c1Num3, c2Num1, c2Num2]);
    expect(set.size).toBe(5);
  });
});
