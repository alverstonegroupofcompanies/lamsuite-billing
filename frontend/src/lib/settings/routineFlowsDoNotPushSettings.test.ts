import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { companySettingsService, SettingsConflictError } from "./companySettingsService";
import { purchaseService } from "../purchases/purchaseService";
import { salesReturnService } from "../billing/salesReturnService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

/**
 * SET-03: routine document-number advancement is a local mirror of the
 * counter's own series. It must never POST the till's settings document to
 * /api/settings. Only an explicit store save (the Settings screen, "save as
 * store default") publishes, and it sends only the keys it changed plus the
 * version it read, so a stale till cannot overwrite newer store settings.
 */
describe("Routine flows never push the settings document", () => {
  const originalFetch = global.fetch;
  let pushed: { url: string; body: any }[] = [];
  let respond: () => Response;

  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    // The service is a singleton: start each test from an inclusive store so a
    // save of "exclusive" is always a real change.
    await companySettingsService.saveLocalSettings({ tax_mode: "inclusive" });
    pushed = [];
    respond = () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, settings: { settings_version: 8 } }),
      }) as Response;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      pushed.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return respond();
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const settingsPushes = () => pushed.filter((p) => p.url.includes("/api/settings") && p.body !== null);

  it("keeps a local sequence advance local", async () => {
    await companySettingsService.loadSettings();

    const updated = await companySettingsService.saveLocalSettings({ next_invoice_number: 1002 });

    expect(updated.next_invoice_number).toBe(1002);
    expect(settingsPushes()).toHaveLength(0);

    const stored = await sqliteStorage.findById<any>("store_settings", "active_config");
    expect(stored.next_invoice_number).toBe(1002);
  });

  it("does not publish settings while issuing a purchase number", async () => {
    await purchaseService.generateNextPurchaseNumber();

    expect(settingsPushes()).toHaveLength(0);
  });

  it("does not publish settings while issuing a return number", async () => {
    await salesReturnService.createSalesReturn({
      customer_id: "c1",
      customer_name: "Walk-in",
      refund_mode: "cash",
      refund_amount: 100,
      lines: [
        {
          product_id: "p1",
          product_name: "Item A",
          batch_no: "B1",
          expiry_date: "2027-10-10",
          return_qty: 1,
          unit_rate: 100,
          gst_percent: 0,
          taxable_amount: 100,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          cess_amount: 0,
          total_refund_amount: 100,
          reason: "damaged",
          restock_condition: "damaged",
        },
      ],
    });

    expect(settingsPushes()).toHaveLength(0);
  });

  it("a store save sends only the changed keys and the version it read", async () => {
    await companySettingsService.updateLocalFromRemote({ settings_version: 7, store_id: "5" });
    await companySettingsService.saveLocalSettings({ next_invoice_number: 1500 });

    await companySettingsService.saveStoreSettings({ tax_mode: "exclusive" });

    expect(settingsPushes()).toHaveLength(1);
    const body = settingsPushes()[0].body;
    expect(Object.keys(body).sort()).toEqual(["settings_version", "store_id", "tax_mode"]);
    expect(body.settings_version).toBe(7);
    expect(body.tax_mode).toBe("exclusive");
  });

  it("takes the new version from the server after a store save", async () => {
    await companySettingsService.updateLocalFromRemote({ settings_version: 7, store_id: "5" });

    const saved = await companySettingsService.saveStoreSettings({ tax_mode: "exclusive" });

    expect(saved.settings_version).toBe(8);
    expect(companySettingsService.getSettings().settings_version).toBe(8);
  });

  it("a stale store save reloads the server's settings and reports the conflict", async () => {
    await companySettingsService.updateLocalFromRemote({ settings_version: 3, store_id: "5", tax_mode: "inclusive" });
    respond = () =>
      ({
        ok: false,
        status: 409,
        json: async () => ({
          error: "SETTINGS_CONFLICT",
          current_version: 4,
          settings: { settings_version: 4, store_id: "5", tax_mode: "inclusive" },
        }),
      }) as Response;

    await expect(companySettingsService.saveStoreSettings({ tax_mode: "exclusive" })).rejects.toBeInstanceOf(
      SettingsConflictError
    );

    expect(companySettingsService.getSettings().settings_version).toBe(4);
    expect(companySettingsService.getSettings().tax_mode).toBe("inclusive");
    const queue = await sqliteStorage.findAll<any>("sync_queue");
    expect(queue.filter((q) => q.entity_type === "settings")).toHaveLength(0);
  });

  it("an offline store save queues only the changed keys and the version", async () => {
    await companySettingsService.updateLocalFromRemote({ settings_version: 9, store_id: "5" });
    respond = () => {
      throw new Error("offline");
    };

    await companySettingsService.saveStoreSettings({ tax_mode: "exclusive" });

    expect(companySettingsService.getSettings().tax_mode).toBe("exclusive");
    const queue = await sqliteStorage.findAll<any>("sync_queue");
    const item = queue.find((q) => q.entity_type === "settings");
    expect(item).toBeDefined();
    const payload = JSON.parse(item.payload_json);
    expect(Object.keys(payload).sort()).toEqual(["settings_version", "store_id", "tax_mode"]);
    expect(payload.settings_version).toBe(9);
  });
});
