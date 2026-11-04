import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { companySettingsService, DEFAULT_SETTINGS } from "./companySettingsService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { staffAuthService } from "../auth/staffAuthService";

describe("Store Settings DB Synchronization & Cross-Device Parity", () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("Billing & Taxes Settings Saved to DB", () => {
    it("persists billing and taxes configuration to local SQLite and pushes to server DB", async () => {
      let pushedPayload: any = null;
      let targetUrl = "";

      vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
        targetUrl = String(input);
        if (init && init.body) {
          pushedPayload = JSON.parse(init.body);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            message: "Store settings saved successfully.",
            settings: pushedPayload,
          }),
        } as Response;
      });

      const updated = await companySettingsService.updateSettings({
        store_id: "store_main",
        tax_mode: "exclusive",
        purchase_tax_mode: "inclusive",
        gst_type: "composition",
        gstin: "32ABCDE1234F1Z5",
        state_code: "32",
        allow_tax_override_per_bill: true,
        default_rate_basis: "mrp",
        credit_period_days: 45,
        default_discount_percent: 5,
        round_off_enabled: false,
        default_hsn_code: "30049090",
      });

      // 1. In-memory & local SQLite persistence
      expect(updated.tax_mode).toBe("exclusive");
      expect(updated.purchase_tax_mode).toBe("inclusive");
      expect(updated.gst_type).toBe("composition");
      expect(updated.gstin).toBe("32ABCDE1234F1Z5");
      expect(updated.allow_tax_override_per_bill).toBe(true);
      expect(updated.credit_period_days).toBe(45);
      expect(updated.round_off_enabled).toBe(false);

      const localRecord = await sqliteStorage.findById<any>("store_settings", "active_config");
      expect(localRecord).not.toBeNull();
      expect(localRecord.tax_mode).toBe("exclusive");
      expect(localRecord.gst_type).toBe("composition");
      expect(localRecord.credit_period_days).toBe(45);

      // 2. Verified push to backend API / database
      expect(targetUrl).toContain("/api/settings");
      expect(pushedPayload).not.toBeNull();
      expect(pushedPayload.tax_mode).toBe("exclusive");
      expect(pushedPayload.gst_type).toBe("composition");
      expect(pushedPayload.gstin).toBe("32ABCDE1234F1Z5");
      expect(pushedPayload.allow_tax_override_per_bill).toBe(true);
    });

    it("enqueues settings into sync_queue when server is offline or unreachable", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network connection offline"));

      await companySettingsService.updateSettings({
        store_id: "store_offline_01",
        tax_mode: "exclusive",
        gst_type: "no_tax",
        round_off_enabled: false,
      });

      // Should still save locally to SQLite
      const local = await companySettingsService.loadSettings();
      expect(local.tax_mode).toBe("exclusive");
      expect(local.gst_type).toBe("no_tax");

      // And must queue into sync_queue for automatic transmission
      const queue = await sqliteStorage.findAll<any>("sync_queue");
      const settingItem = queue.find((q) => q.entity_type === "settings");
      expect(settingItem).toBeDefined();
      expect(settingItem.entity_id).toBe("store_offline_01");

      const payload = JSON.parse(settingItem.payload_json);
      expect(payload.tax_mode).toBe("exclusive");
      expect(payload.gst_type).toBe("no_tax");
    });
  });

  describe("Cross-Device Settings Parity (Same Store)", () => {
    it("fetches authoritative store settings from server database and updates local SQLite", async () => {
      const serverSettings = {
        store_id: "store_chain_01",
        store_name: "Metro Medicos Central",
        tax_mode: "exclusive",
        purchase_tax_mode: "exclusive",
        gst_type: "regular",
        gstin: "32MMMM0000M1Z9",
        state_code: "32",
        allow_tax_override_per_bill: false,
        credit_period_days: 15,
        default_discount_percent: 10,
        round_off_enabled: true,
        sequences: {
          invoicePrefix: "METRO",
          nextInvoiceNumber: 2001,
        },
        printing: {
          paperSize: "thermal_80mm",
          footerNote: "Metro Medicos - Thank you!",
        },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => serverSettings,
      } as Response);

      const loaded = await companySettingsService.fetchRemoteSettings("store_chain_01");

      // Verify that Device 2 loaded exact server settings
      expect(loaded.store_name).toBe("Metro Medicos Central");
      expect(loaded.tax_mode).toBe("exclusive");
      expect(loaded.gstin).toBe("32MMMM0000M1Z9");
      expect(loaded.credit_period_days).toBe(15);
      expect(loaded.sequences.invoicePrefix).toBe("METRO");
      expect(loaded.sequences.nextInvoiceNumber).toBe(2001);
      expect(loaded.printing.footerNote).toBe("Metro Medicos - Thank you!");

      // Verify saved in local SQLite storage
      const sqliteRecord = await sqliteStorage.findById<any>("store_settings", "active_config");
      expect(sqliteRecord.store_name).toBe("Metro Medicos Central");
      expect(sqliteRecord.tax_mode).toBe("exclusive");
      expect(sqliteRecord.sequences.invoicePrefix).toBe("METRO");
    });

    it("applies store settings from server when staff logs into terminal", async () => {
      const mockLoginResponse = {
        success: true,
        token: "staff_token_test_abc",
        user: {
          id: "1",
          username: "cashier1",
          name: "John Doe",
          role: "cashier",
          store_id: "store_chain_01",
        },
        store: {
          id: "store_chain_01",
          name: "Metro Medicos Central",
          code: "MMC01",
          tax_mode: "exclusive",
        },
        settings: {
          store_id: "store_chain_01",
          store_name: "Metro Medicos Central",
          tax_mode: "exclusive",
          gst_type: "composition",
          gstin: "32COMP9999C1Z2",
          credit_period_days: 60,
          round_off_enabled: false,
          sequences: {
            invoicePrefix: "TERM",
            nextInvoiceNumber: 9999,
          },
        },
      };

      // Ingest settings payload as would occur during staff login
      await companySettingsService.updateLocalFromRemote(mockLoginResponse.settings);

      const activeSettings = companySettingsService.getSettings();
      expect(activeSettings.store_name).toBe("Metro Medicos Central");
      expect(activeSettings.tax_mode).toBe("exclusive");
      expect(activeSettings.gst_type).toBe("composition");
      expect(activeSettings.gstin).toBe("32COMP9999C1Z2");
      expect(activeSettings.credit_period_days).toBe(60);
      expect(activeSettings.sequences.invoicePrefix).toBe("TERM");
      expect(activeSettings.sequences.nextInvoiceNumber).toBe(9999);
    });
  });
});
