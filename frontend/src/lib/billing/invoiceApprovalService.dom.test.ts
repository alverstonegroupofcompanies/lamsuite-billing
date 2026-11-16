import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvoiceApprovalService,
  type InvoiceApprovalGrant,
} from "./invoiceApprovalService";

const okResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("invoice approval service", () => {
  let service: InvoiceApprovalService;

  beforeEach(() => {
    service = new InvoiceApprovalService();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("verifies a manager and normalises the grant", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        success: true,
        token: "grant-token",
        approval: {
          id: 7,
          action: "edit",
          mode: "manager",
          approved_by_name: "Floor Manager",
          expires_at: "2030-01-01T00:05:00+00:00",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.verifyManager({
      storeId: "4",
      invoiceId: "inv-1",
      action: "edit",
      identifier: " manager1 ",
      secret: "secret",
    });

    expect(result.success).toBe(true);
    expect(result.grant).toMatchObject({
      id: "7",
      token: "grant-token",
      action: "edit",
      mode: "manager",
      approvedByName: "Floor Manager",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/invoices/inv-1/approvals/verify");
    expect((init.headers as Record<string, string>)["X-Store-Id"]).toBe("4");
    expect(JSON.parse(String(init.body))).toMatchObject({
      action: "edit",
      mode: "manager",
      identifier: "manager1",
    });
  });

  it("passes the one-time PIN and bound user id", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        success: true,
        token: "pin-token",
        approval: { id: "9", action: "cancel", mode: "one_time_pin", expires_at: "2030-01-01T00:05:00+00:00" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await service.verifyOneTimePin({
      storeId: "4",
      invoiceId: "inv-2",
      action: "cancel",
      userId: "42",
      pin: "123456",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      action: "cancel",
      mode: "one_time_pin",
      user_id: "42",
      pin: "123456",
    });
  });

  it("returns the server error without a grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({ success: false, code: "INVALID_ONE_TIME_PIN", error: "PIN expired." }, 422)
      )
    );

    const result = await service.verifyOneTimePin({
      storeId: "4",
      invoiceId: "inv-2",
      action: "cancel",
      userId: "42",
      pin: "000000",
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_ONE_TIME_PIN");
    expect(result.error).toBe("PIN expired.");
    expect(result.grant).toBeUndefined();
  });

  it("fails closed when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    const result = await service.verifyManager({
      storeId: "4",
      invoiceId: "inv-1",
      action: "edit",
      identifier: "manager1",
      secret: "secret",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connect to the store server");
    expect(result.grant).toBeUndefined();
  });

  it("stores a grant and drops it once expired", () => {
    const grant: InvoiceApprovalGrant = {
      id: "1",
      token: "t",
      action: "edit",
      mode: "manager",
      approvedByName: "Manager",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    service.saveGrant("inv-1", grant);
    expect(service.getGrant("inv-1")).toMatchObject({ id: "1" });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));
    expect(service.getGrant("inv-1")).toBeNull();
  });
});
