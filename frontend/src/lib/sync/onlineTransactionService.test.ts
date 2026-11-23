import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OnlineTransactionService, onlineTransactionService } from "./onlineTransactionService";
import { storeRegistryService, type RegisteredStoreRecord } from "../auth/storeRegistryService";

function okResponse(): Response {
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("OnlineTransactionService - pre-claim health probe", () => {
  let service: OnlineTransactionService | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(storeRegistryService, "getActiveStore").mockReturnValue(null);
  });

  afterEach(() => {
    service?.stopHealthMonitor();
    onlineTransactionService.stopHealthMonitor();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never names a store before one is claimed", async () => {
    service = new OnlineTransactionService("http://127.0.0.1:8000");
    service.stopHealthMonitor();
    vi.spyOn(service, "getPendingQueueCount").mockResolvedValue(0);
    vi.spyOn(service, "checkLeaseBlockStatus").mockResolvedValue({ remaining: 999, isLow: false });

    await service.checkConnectionHealth();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/license/check"))).toBe(false);
    expect(urls.some((url) => url.endsWith("/up"))).toBe(true);

    for (const url of urls) {
      expect(new URL(url).host).toBe("127.0.0.1:8000");
    }
  });

  it("licence-checks the store once one is claimed", async () => {
    vi.mocked(storeRegistryService.getActiveStore).mockReturnValue({
      id: 7,
      is_active: true,
    } as unknown as RegisteredStoreRecord);

    service = new OnlineTransactionService("http://127.0.0.1:8000");
    service.stopHealthMonitor();
    vi.spyOn(service, "getPendingQueueCount").mockResolvedValue(0);
    vi.spyOn(service, "checkLeaseBlockStatus").mockResolvedValue({ remaining: 999, isLow: false });

    await service.checkConnectionHealth();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/license/check?store_id=7"))).toBe(true);
    expect(urls.some((url) => url.includes("store_id=1"))).toBe(false);
  });
});
