import { describe, it, expect, beforeEach, vi } from "vitest";
import { storeDeviceService } from "./storeDeviceService";
import { counterSequenceService, DOC_TAILS, type DocType } from "./counterSequenceService";
import { companySettingsService } from "../settings/companySettingsService";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { resetMockHandlers, invokeCommand } from "../ipc/ipcBridge";

/**
 * CNT-014: the counter owns its numbers, so a till that boots without the
 * series in its own store reads it off the server. It never restarts a count
 * the store's book has already moved past.
 */

const TOKEN = "lsd_boot_token_1a2b3c4d";
const FY = counterSequenceService.getCurrentFinancialYear();

function profileJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    device_id: "cntr_12",
    device_uuid: "uuid-workstation-12",
    device_name: "Front Counter",
    store_id: "7",
    store_name: "LamStone Pharmacy Main",
    store_code: "STORE-07",
    counter_id: "cntr_12",
    server_counter_id: 12,
    counter_name: "Front Counter",
    counter_code: "C01",
    is_hub: false,
    license_plan: "Retail & Pharmacy Chain Pro",
    license_status: "active",
    license_expires_at: "2027-12-31",
    registered_at: Date.now(),
    is_active: true,
    ...overrides,
  });
}

function manifestReply(
  counterId: number,
  counterCode: string,
  nextNumbers: Partial<Record<DocType, number>> = {}
) {
  return {
    success: true,
    counter_id: counterId,
    counter_code: counterCode,
    financial_year: FY,
    doc_types: Object.keys(DOC_TAILS),
    items: Object.entries(DOC_TAILS).map(([docType, tail]) => ({
      counter_id: counterId,
      doc_type: docType,
      financial_year: FY,
      prefix: `${counterCode}-${tail}`,
      next_number: nextNumbers[docType as DocType] ?? 1001,
      range_start: null,
      range_end: null,
    })),
  };
}

describe("Counter series boot (CNT-014)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    storeDeviceService.clearProfileCache();
    counterSequenceService.clearActiveCounter();
    localStorage.clear();
    vi.restoreAllMocks();
    await invokeCommand("secure_store_delete", { key: "device_token" });
    await invokeCommand("secure_store_delete", { key: "store_device_profile" });
  });

  it("boots a till that holds no series onto the counter's server count", async () => {
    await invokeCommand("secure_store_set", { key: "device_token", value: TOKEN });
    await invokeCommand("secure_store_set", { key: "store_device_profile", value: profileJson() });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => manifestReply(12, "C01", { invoice: 1050 }),
    } as unknown as Response);

    await storeDeviceService.getDeviceProfile();

    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/counter/sequences");
    expect(companySettingsService.previewNextInvoiceNumber()).toBe(`C01-INV-1050`);
  });

  it("keeps the series already in the till's own store, without a request", async () => {
    await invokeCommand("secure_store_set", { key: "device_token", value: TOKEN });
    await invokeCommand("secure_store_set", { key: "store_device_profile", value: profileJson() });

    await counterSequenceService.primeFromManifest(manifestReply(12, "C01", { invoice: 1080 }));
    counterSequenceService.clearActiveCounter();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await storeDeviceService.getDeviceProfile();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("C01-INV-1080");
  });

  it("boots offline on the numbers it holds and tries the server again next time", async () => {
    await invokeCommand("secure_store_set", { key: "device_token", value: TOKEN });
    await invokeCommand("secure_store_set", { key: "store_device_profile", value: profileJson() });

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(storeDeviceService.getDeviceProfile()).resolves.toMatchObject({ counter_code: "C01" });
    // No server answer and no local series: the till falls back to its store-wide
    // settings, but it does not restart the counter's own count at 1001.
    expect(companySettingsService.previewNextInvoiceNumber()).not.toMatch(/C01/);

    storeDeviceService.clearProfileCache();
    counterSequenceService.clearActiveCounter();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => manifestReply(12, "C01", { invoice: 1050 }),
    } as unknown as Response);

    await storeDeviceService.getDeviceProfile();
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("C01-INV-1050");
  });
});
