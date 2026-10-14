import { describe, it, expect, beforeEach } from "vitest";
import { staffAuthService } from "./staffAuthService";
import { counterSequenceService } from "./counterSequenceService";
import { sqliteStorage } from "../db/sqliteStorage";

describe("StaffAuthService and Multi-Counter Sequencing", () => {
  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await staffAuthService.initDemoStaffIfEmpty();
    staffAuthService.logout();
  });

  it("authenticates cashier with quick PIN offline", async () => {
    const res = await staffAuthService.authenticateWithPin("cashier1", "1111");
    expect(res.success).toBe(true);
    expect(res.user?.username).toBe("cashier1");
    expect(res.user?.role).toBe("cashier");

    const session = staffAuthService.getCurrentSession();
    expect(session).not.toBeNull();
    expect(session?.user.username).toBe("cashier1");
    expect(session?.isLocked).toBe(false);
  });

  it("authenticates manager with full password", async () => {
    const res = await staffAuthService.authenticateWithPassword("manager", "manager123");
    expect(res.success).toBe(true);
    expect(res.user?.role).toBe("manager");
  });

  it("locks account after 5 consecutive failed PIN attempts and permits Admin Unlock", async () => {
    // 4 failed attempts
    for (let i = 1; i <= 4; i++) {
      const res = await staffAuthService.authenticateWithPin("cashier1", "0000");
      expect(res.success).toBe(false);
      expect(res.error).toContain("attempt(s) remaining");
    }

    // 5th failed attempt triggers 15-minute lock
    const fifthRes = await staffAuthService.authenticateWithPin("cashier1", "0000");
    expect(fifthRes.success).toBe(false);
    expect(fifthRes.error).toContain("Account locked for 15 minutes");

    // Subsequent valid PIN is rejected during lockout
    const blockedRes = await staffAuthService.authenticateWithPin("cashier1", "1111");
    expect(blockedRes.success).toBe(false);
    expect(blockedRes.error).toContain("temporarily locked");

    // Admin unlocks the cashier
    const unlockRes = await staffAuthService.adminUnlock("admin", "1234", "cashier1");
    expect(unlockRes.success).toBe(true);

    // Cashier can now log in immediately
    const recoveredRes = await staffAuthService.authenticateWithPin("cashier1", "1111");
    expect(recoveredRes.success).toBe(true);
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
