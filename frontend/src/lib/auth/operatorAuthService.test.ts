import { describe, it, expect, beforeEach } from "vitest";
import { operatorAuthService, hashPin, type OperatorUser } from "./operatorAuthService";

describe("Operator Auth & PIN Security (SEC-001, SEC-003)", () => {
  let testCashier: OperatorUser;
  let testAdmin: OperatorUser;

  beforeEach(async () => {
    operatorAuthService.reset();

    testCashier = {
      id: "op_cashier_1",
      name: "Suresh (Counter 1)",
      username: "suresh",
      role: "cashier",
      pinHash: await hashPin("1234"),
      isActive: true,
    };

    testAdmin = {
      id: "op_admin_1",
      name: "Store Manager",
      username: "manager",
      role: "admin",
      pinHash: await hashPin("9999"),
      isActive: true,
    };

    operatorAuthService.registerOperator(testCashier);
    operatorAuthService.registerOperator(testAdmin);
  });

  it("authenticates operator with valid PIN in sub-20ms", async () => {
    const start = performance.now();
    const result = await operatorAuthService.authenticateWithPin(testCashier.id, "1234");
    const duration = performance.now() - start;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(20); // Sub-20ms latency requirement

    const session = operatorAuthService.getSession();
    expect(session.isAuthenticated).toBe(true);
    expect(session.locked).toBe(false);
    expect(session.user?.name).toBe("Suresh (Counter 1)");
  });

  it("rejects invalid PIN and tracks remaining attempts", async () => {
    const result = await operatorAuthService.authenticateWithPin(testCashier.id, "0000");

    expect(result.success).toBe(false);
    expect(result.error).toContain("4 attempt(s) remaining");

    const session = operatorAuthService.getSession();
    expect(session.isAuthenticated).toBe(false);
    expect(session.failedAttempts).toBe(1);
  });

  it("locks account for 15 minutes after 5 failed attempts", async () => {
    for (let i = 1; i <= 4; i++) {
      await operatorAuthService.authenticateWithPin(testCashier.id, "wrong");
    }

    const fifthAttempt = await operatorAuthService.authenticateWithPin(testCashier.id, "wrong");
    expect(fifthAttempt.success).toBe(false);
    expect(fifthAttempt.error).toContain("Terminal locked for 15 minutes");
    expect(operatorAuthService.isLockedOut()).toBe(true);

    // Further attempts while locked out fail immediately
    const lockedAttempt = await operatorAuthService.authenticateWithPin(testCashier.id, "1234");
    expect(lockedAttempt.success).toBe(false);
    expect(lockedAttempt.error).toContain("Account locked");
  });

  it("enforces role-based permissions between cashier and admin", async () => {
    // Authenticate as Cashier
    await operatorAuthService.authenticateWithPin(testCashier.id, "1234");
    expect(operatorAuthService.hasPermission("pos.create")).toBe(true);
    expect(operatorAuthService.hasPermission("pos.discount_override")).toBe(false);
    expect(operatorAuthService.hasPermission("reports.view_profit")).toBe(false);

    // Switch to Admin
    operatorAuthService.switchOperator();
    expect(operatorAuthService.getSession().isAuthenticated).toBe(false);

    await operatorAuthService.authenticateWithPin(testAdmin.id, "9999");
    expect(operatorAuthService.hasPermission("pos.discount_override")).toBe(true);
    expect(operatorAuthService.hasPermission("reports.view_profit")).toBe(true);
  });
});
