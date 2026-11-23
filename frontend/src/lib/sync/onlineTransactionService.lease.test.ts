import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OnlineTransactionService } from "./onlineTransactionService";
import { counterSequenceService, type LeasedBlock } from "../auth/counterSequenceService";
import {
  storeDeviceService,
  counterSequenceKey,
  type StoreDeviceProfile,
} from "../auth/storeDeviceService";
import { storeRegistryService } from "../auth/storeRegistryService";

/**
 * NUM-01: the heartbeat leased a fresh 50-number block on every tick because it
 * never named the counter correctly and never waited for the previous ask. The
 * till now keys its series by the real counter id and asks for numbers only
 * when the block is actually spent, once at a time.
 */

function profile(overrides: Partial<StoreDeviceProfile> = {}): StoreDeviceProfile {
  return {
    device_id: "dev_1",
    device_uuid: "uuid-1",
    device_name: "Counter PC",
    store_id: "7",
    store_name: "Store Seven",
    store_code: "STORE-07",
    counter_id: "cntr_12",
    counter_name: "Counter 12",
    counter_code: "C12",
    is_hub: false,
    license_plan: "Retail",
    license_status: "active",
    license_expires_at: "2027-12-31",
    registered_at: Date.now(),
    is_active: true,
    ...overrides,
  };
}

describe("counterSequenceKey", () => {
  it("reads the server counter id the claim wrote", () => {
    expect(counterSequenceKey({ server_counter_id: 12, counter_id: "cntr_9", counter_code: "C09" })).toBe(12);
  });

  it("recovers the number from a legacy local counter id", () => {
    expect(counterSequenceKey({ counter_id: "cntr_9" })).toBe(9);
    expect(counterSequenceKey({ counter_id: "7" })).toBe(7);
  });

  it("falls back to the counter code when no number exists", () => {
    expect(counterSequenceKey({ counter_id: "C02" })).toBe("C02");
    expect(counterSequenceKey({ counter_code: "c02" })).toBe("C02");
    expect(counterSequenceKey(null, "c05")).toBe("C05");
  });
});

describe("OnlineTransactionService - lease block heartbeat", () => {
  let service: OnlineTransactionService;

  beforeEach(() => {
    // Park the constructor's initial health probe so it cannot race the test.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<never>(() => {})));
    vi.spyOn(storeRegistryService, "getActiveStore").mockReturnValue(null);
    vi.spyOn(storeDeviceService, "getDeviceProfile").mockResolvedValue(profile());
    vi.spyOn(storeDeviceService, "getDeviceToken").mockResolvedValue("lsd_device_token_12");

    service = new OnlineTransactionService("http://127.0.0.1:8000");
    service.stopHealthMonitor();
  });

  afterEach(() => {
    service?.stopHealthMonitor();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never asks for more numbers while the block still has some", async () => {
    const statusSpy = vi
      .spyOn(counterSequenceService, "leaseStatus")
      .mockResolvedValue({ remaining: 20, isLow: false });
    const replenishSpy = vi.spyOn(service, "replenishLeasedBlock");
    const leaseSpy = vi.spyOn(counterSequenceService, "lease");

    const status = await service.checkLeaseBlockStatus("invoice");

    expect(status).toEqual({ remaining: 20, isLow: false });
    expect(statusSpy).toHaveBeenCalledWith(12, "invoice");
    expect(replenishSpy).not.toHaveBeenCalled();
    expect(leaseSpy).not.toHaveBeenCalled();
  });

  it("leases once for a spent block even when two heartbeats overlap", async () => {
    vi.spyOn(counterSequenceService, "leaseStatus").mockResolvedValue({ remaining: 0, isLow: true });

    let resolveLease!: (block: LeasedBlock) => void;
    const inFlight = new Promise<LeasedBlock>((resolve) => {
      resolveLease = resolve;
    });
    const leaseSpy = vi.spyOn(counterSequenceService, "lease").mockReturnValue(inFlight);

    const first = service.checkLeaseBlockStatus("invoice");
    const second = service.checkLeaseBlockStatus("invoice");
    await Promise.all([first, second]);

    await vi.waitFor(() => expect(leaseSpy).toHaveBeenCalledTimes(1));
    expect(leaseSpy.mock.calls[0][0]).toBe(12);

    resolveLease({
      counter_id: 12,
      counter_code: "C12",
      doc_type: "invoice",
      financial_year: "2026-27",
      prefix: "C12-INV",
      range_start: 5001,
      range_end: 5050,
      next_number: 5001,
    });
    await Promise.resolve();
  });

  it("never leases while the till believes it is offline", async () => {
    service.setConnectionState("offline");
    vi.spyOn(counterSequenceService, "leaseStatus").mockResolvedValue({ remaining: 0, isLow: true });
    const replenishSpy = vi.spyOn(service, "replenishLeasedBlock");
    const leaseSpy = vi.spyOn(counterSequenceService, "lease");

    await service.checkLeaseBlockStatus("invoice");

    expect(replenishSpy).not.toHaveBeenCalled();
    expect(leaseSpy).not.toHaveBeenCalled();
  });
});
