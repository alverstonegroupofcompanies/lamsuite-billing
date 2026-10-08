export interface OperatorUser {
  id: string;
  name: string;
  username: string;
  role: "admin" | "manager" | "pharmacist" | "cashier";
  pinHash: string; // SHA-256 hash of 4-digit PIN
  isActive: boolean;
}

export interface OperatorSession {
  user: OperatorUser | null;
  isAuthenticated: boolean;
  locked: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
}

export async function hashPin(pin: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`lamsuite_pin_salt_${pin}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Simple fallback for environments without crypto.subtle
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    hash = (hash << 5) - hash + pin.charCodeAt(i);
    hash |= 0;
  }
  return `hash_${hash}`;
}

export class OperatorAuthService {
  private operators = new Map<string, OperatorUser>();
  private session: OperatorSession = {
    user: null,
    isAuthenticated: false,
    locked: true,
    failedAttempts: 0,
    lockedUntil: null,
  };

  private idleTimeoutMs = 5 * 60 * 1000; // 5 minutes default
  private maxFailedAttempts = 5;
  private lockoutDurationMs = 15 * 60 * 1000; // 15 minutes

  constructor() {
    this.reset();
  }

  reset() {
    this.operators.clear();
    this.session = {
      user: null,
      isAuthenticated: false,
      locked: true,
      failedAttempts: 0,
      lockedUntil: null,
    };
  }

  setIdleTimeoutMinutes(minutes: number) {
    this.idleTimeoutMs = minutes * 60 * 1000;
  }

  getIdleTimeoutMs(): number {
    return this.idleTimeoutMs;
  }

  registerOperator(user: OperatorUser) {
    this.operators.set(user.id, { ...user });
  }

  getOperator(id: string): OperatorUser | null {
    return this.operators.get(id) || null;
  }

  listOperators(): OperatorUser[] {
    return Array.from(this.operators.values()).filter((u) => u.isActive);
  }

  getSession(): OperatorSession {
    return { ...this.session };
  }

  isLockedOut(): boolean {
    if (!this.session.lockedUntil) return false;
    if (Date.now() < this.session.lockedUntil) return true;
    // Lockout expired
    this.session.lockedUntil = null;
    this.session.failedAttempts = 0;
    return false;
  }

  async authenticateWithPin(operatorId: string, pin: string): Promise<{ success: boolean; error?: string }> {
    if (this.isLockedOut()) {
      const remainingMinutes = Math.ceil((this.session.lockedUntil! - Date.now()) / 60000);
      return { success: false, error: `Account locked due to multiple failed attempts. Try again in ${remainingMinutes}m.` };
    }

    const op = this.operators.get(operatorId);
    if (!op || !op.isActive) {
      return { success: false, error: "Operator not found or inactive" };
    }

    const inputHash = await hashPin(pin);
    if (inputHash === op.pinHash) {
      // Success: reset failed attempts and unlock session
      this.session = {
        user: op,
        isAuthenticated: true,
        locked: false,
        failedAttempts: 0,
        lockedUntil: null,
      };
      return { success: true };
    }

    // Failed attempt
    this.session.failedAttempts += 1;
    if (this.session.failedAttempts >= this.maxFailedAttempts) {
      this.session.lockedUntil = Date.now() + this.lockoutDurationMs;
      return {
        success: false,
        error: "Too many failed attempts. Terminal locked for 15 minutes.",
      };
    }

    const attemptsRemaining = this.maxFailedAttempts - this.session.failedAttempts;
    return {
      success: false,
      error: `Invalid PIN. ${attemptsRemaining} attempt(s) remaining.`,
    };
  }

  lockSession() {
    this.session.locked = true;
  }

  unlockSession() {
    if (this.session.isAuthenticated) {
      this.session.locked = false;
    }
  }

  switchOperator() {
    this.session.user = null;
    this.session.isAuthenticated = false;
    this.session.locked = true;
  }

  hasPermission(permission: string): boolean {
    if (!this.session.user || this.session.locked) return false;
    const role = this.session.user.role;
    if (role === "admin") return true;

    if (permission === "pos.discount_override") {
      return role === "manager";
    }
    if (permission === "reports.view_profit") {
      return false; // only admin
    }
    if (permission === "pos.sell_negative_stock") {
      return role === "manager" || role === "pharmacist" || role === "cashier";
    }
    if (permission === "pos.sell_expired_stock") {
      return role === "manager" || role === "pharmacist";
    }
    return true;
  }
}

export const operatorAuthService = new OperatorAuthService();
