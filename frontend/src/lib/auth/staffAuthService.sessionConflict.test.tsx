import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { staffAuthService } from "./staffAuthService";
import { storeDeviceService } from "./storeDeviceService";
import { sqliteStorage } from "../db/sqliteStorage";

describe("StaffAuthService one-active-counter policy", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    process.env.NODE_ENV = "development";
    await sqliteStorage.initDatabase();
    staffAuthService.logout();
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue({
      device_uuid: "device_b",
      device_name: "Workstation B",
      counter_id: "C02",
      counter_code: "C02",
      counter_name: "Back Counter",
      store_id: "4",
    } as any);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    staffAuthService.logout();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps a 409 ACTIVE_SESSION_ELSEWHERE response to a conflict result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: "ACTIVE_SESSION_ELSEWHERE",
            message: "This account is already signed in on 'Front Counter' since 10:00.",
            can_force_out: false,
            active_session: {
              id: "9",
              device_uuid: "device_a",
              counter_name: "Front Counter",
              last_active_at: "2026-11-14T10:00:00Z",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const res = await staffAuthService.authenticateWithPin("cashier_conflict", "4826");

    expect(res.success).toBe(false);
    expect(res.error).toContain("Front Counter");
    expect(res.conflict?.canForceOut).toBe(false);
    expect(res.conflict?.activeSession?.device_uuid).toBe("device_a");
  });

  it("sends force_out when a privileged operator confirms the replacement", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.force_out !== true) {
        return new Response(JSON.stringify({ success: false, error: "ACTIVE_SESSION_ELSEWHERE" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
          token: "staff-token-new",
          user: {
            id: "77",
            store_id: "4",
            username: "cashier_conflict",
            name: "Cashier Conflict",
            role: "manager",
            permissions: ["*"],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await staffAuthService.authenticateWithPin("cashier_conflict", "4826", {
      forceOut: true,
    });

    expect(res.success).toBe(true);
    expect(res.user?.id).toBe("77");
    const loginCall = fetchMock.mock.calls.find(([input]) =>
      String(input instanceof Request ? input.url : input).includes("/api/staff/login")
    );
    const sent = JSON.parse(String((loginCall?.[1] as RequestInit).body));
    expect(sent.force_out).toBe(true);
    expect(sent.counter_id).toBe("C02");
  });
});
