import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";
import { centralKeyMap } from "./lib/keyboard/centralKeyMap";

/**
 * SEC-001 — nothing signs a person in to reach a till.
 *
 * The counter itself is the account: it claimed the store, it carries the
 * permission document, and its own PIN is what opens it after the idle lock.
 * The sign-in screen, the cashier switcher and the chord that opened it are
 * retired, and this guard is what keeps them retired.
 */

const SRC = new URL("./", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) return [];
    return [full];
  });
}

const files = sources(SRC);

function grep(pattern: RegExp): string[] {
  return files
    .filter((f) => pattern.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f));
}

describe("the counter is the account at the till (SEC-001)", () => {
  it("the staff sign-in screen and the cashier switcher are gone", () => {
    expect(existsSync(join(SRC, "pages/StaffLoginPage.tsx"))).toBe(false);
    expect(existsSync(join(SRC, "components/AccountSwitcherModal.tsx"))).toBe(false);
    expect(grep(/StaffLoginPage|AccountSwitcherModal/)).toEqual([]);
    expect(grep(/login\.sign_in|Switch Cashier/)).toEqual([]);
  });

  it("the app boots the counter session, not an operator session", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");

    expect(app).toContain("counterSessionService");
    expect(app).not.toMatch(/hasStaffSession/);
    expect(app).not.toMatch(/staffAuthService\.getCurrentSession\(\)/);
  });

  it("the counter's document, not a person's role, decides the surface", () => {
    for (const file of ["components/AccessGate.tsx", "components/TopNav.tsx", "components/CommandPalette.tsx"]) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, file).toContain("counterSessionService");
      expect(source, file).not.toContain("canAccessMenu");
    }
  });

  it("the switch-account chord is off the keyboard", () => {
    expect(centralKeyMap.filter((s) => s.action === "accountSwitcher")).toEqual([]);
    expect(grep(/accountSwitcher/)).toEqual([]);
  });

  it("no screen at the till takes its own access from a person's role", () => {
    expect(grep(/staffAuthService\.canAccessMenu\(/)).toEqual([]);

    for (const file of ["components/settings/StaffManagementPanel.tsx", "pages/MastersPage.tsx"]) {
      expect(readFileSync(join(SRC, file), "utf8"), file).toContain("counterSessionService");
    }
  });

  it("nothing at the till reads a signed-in person", () => {
    expect(grep(/staffAuthService\.getCurrentSession\(\)/)).toEqual([]);
  });

  it("no credential material is kept in browser storage", () => {
    expect(grep(/setItem\(\s*["']staff_token/)).toEqual([]);
    expect(grep(/getItem\(\s*["']staff_token/)).toEqual([]);
    expect(grep(/setItem\(\s*["']active_staff_session/)).toEqual([]);
    expect(grep(/getItem\(\s*["']active_staff_session/)).toEqual([]);
  });

  it("staff management at the till is asked for by the counter, not a person", () => {
    const source = readFileSync(join(SRC, "lib/auth/staffAuthService.ts"), "utf8");
    const panel = source.slice(
      source.indexOf("private async getStaffAdminContext"),
      source.indexOf("private async findStaff")
    );

    expect(panel).not.toEqual("");
    // A16b: the counter-authorised twin of the admin staff routes, device token
    // only — a bearer token here would mean the panel silently needs a sign-in.
    expect(panel).toContain("${API_BASE_URL}/api/till${path}");
    expect(source).not.toMatch(/staffAdminRequest[^\n]*[`"]\/users/);
    expect(panel).toContain('deviceHeaders["X-Device-Token"]');
    expect(panel).not.toContain("Authorization");
    expect(panel).not.toContain("Bearer");
  });

  it("presence and locks belong to the counter", () => {
    const source = readFileSync(join(SRC, "lib/devices/deviceSessionService.ts"), "utf8");
    const heartbeat = source.slice(
      source.indexOf("async sendHeartbeat"),
      source.indexOf("reportUpdateFailure")
    );
    expect(heartbeat).not.toEqual("");
    expect(heartbeat).not.toContain("user_id");
    expect(heartbeat).not.toContain("user_role");
    expect(source).toContain("counterLockingService.lock()");

    const switching = readFileSync(join(SRC, "lib/auth/storeRegistryService.ts"), "utf8");
    expect(switching).toContain("counter_id");
  });
});
