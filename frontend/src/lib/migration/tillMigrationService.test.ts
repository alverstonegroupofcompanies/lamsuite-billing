import { beforeEach, describe, expect, it, vi } from "vitest";
import { MigrationRequestError, tillMigrationService } from "./tillMigrationService";
import { storeDeviceService } from "../auth/storeDeviceService";
import { API_BASE_URL } from "../../config/env";

vi.mock("../auth/storeDeviceService", () => ({
  storeDeviceService: {
    getDeviceAuthHeaders: vi.fn(),
    getDeviceProfile: vi.fn(),
  },
}));

const headers = storeDeviceService.getDeviceAuthHeaders as unknown as ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("the till drives the server pipeline", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    headers.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("refuses to start before this terminal belongs to a counter", async () => {
    headers.mockResolvedValue({});

    await expect(tillMigrationService.precheck("api", { url: "https://x", token: "t" })).rejects.toThrow(
      /Claim this terminal/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the till route with the device token and unwraps the report", async () => {
    headers.mockResolvedValue({ "X-Device-Token": "dev-1", "X-Store-Id": "7" });
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { can_proceed: true, record_counts: {}, issues: [], summary: {} } })
    );

    const report = await tillMigrationService.precheck("file", { bundle_ref: "abc" });

    expect(report.can_proceed).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/till/migrations/precheck`);
    expect(init.method).toBe("POST");
    expect(init.headers["X-Device-Token"]).toBe("dev-1");
    // The branch is the token's business, so the body never names a store.
    expect(JSON.parse(init.body)).toEqual({ source_type: "file", config: { bundle_ref: "abc" } });
  });

  it("uploads the bundle as a file, not as JSON", async () => {
    headers.mockResolvedValue({ "X-Device-Token": "dev-1" });
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { bundle_ref: "r", bytes: 10, entities: {} } }));

    const file = new File(['{"products":[]}'], "bundle.json", { type: "application/json" });
    await tillMigrationService.uploadBundle(file);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/till/migrations/bundle`);
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("carries the server's refusal code through to the caller", async () => {
    headers.mockResolvedValue({ "X-Device-Token": "dev-1" });
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: false, code: "data_migration_disabled", message: "Data migration is switched off for this store." },
        403
      )
    );

    const err = await tillMigrationService
      .start("api", { url: "https://x", token: "t" }, false)
      .catch((e) => e as MigrationRequestError);

    expect(err).toBeInstanceOf(MigrationRequestError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("data_migration_disabled");
    expect(err.message).toMatch(/switched off/);
  });

  it("treats a refusal at HTTP 200 as a failure", async () => {
    headers.mockResolvedValue({ "X-Device-Token": "dev-1" });
    fetchMock.mockResolvedValue(jsonResponse({ success: false, message: "Cannot cutover: no reconciliation report." }));

    await expect(tillMigrationService.cutover("u-1", "CUTOVER-X")).rejects.toThrow(/no reconciliation report/);
  });

  it("rolls back and reports the rows the server removed", async () => {
    headers.mockResolvedValue({ "X-Device-Token": "dev-1" });
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { products_deleted: 3, invoices_deleted: 12 } }));

    await expect(tillMigrationService.rollback("u/1")).resolves.toMatchObject({ invoices_deleted: 12 });
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/till/migrations/u%2F1/rollback`);
  });
});
