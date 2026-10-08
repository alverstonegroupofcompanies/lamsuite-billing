import { describe, it, expect, beforeEach } from "vitest";
import { companySettingsService, DEFAULT_SETTINGS } from "./companySettingsService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("Company Settings, Sequences & Menu Visibility (CFG-001, CFG-002)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("CFG-001: Store Profile & Sequential Invoice Numbers", () => {
    it("generates sequential formatted invoice numbers and persists next sequence", async () => {
      await companySettingsService.updateSettings({
        invoice_prefix: "LS",
        next_invoice_number: 50,
      });

      const inv1 = await companySettingsService.generateNextInvoiceNumber();
      expect(inv1).toMatch(/^LS-\d{4}-00050$/);

      const inv2 = await companySettingsService.generateNextInvoiceNumber();
      expect(inv2).toMatch(/^LS-\d{4}-00051$/);

      const settings = await companySettingsService.loadSettings();
      expect(settings.next_invoice_number).toBe(52);
    });

    it("updates store statutory headers and drug licenses", async () => {
      await companySettingsService.updateSettings({
        store_name: "Apex Super Specialty Pharmacy",
        drug_license_numbers: ["KL-PLK-20B-9988", "KL-PLK-21B-9989"],
        fssai_no: "10019041000888",
      });

      const loaded = await companySettingsService.loadSettings();
      expect(loaded.store_name).toBe("Apex Super Specialty Pharmacy");
      expect(loaded.drug_license_numbers).toContain("KL-PLK-20B-9988");
      expect(loaded.fssai_no).toBe("10019041000888");
    });
  });

  describe("CFG-002: Dynamic Per-Store Menu Visibility", () => {
    it("controls module visibility via enabled_menu_items array", () => {
      companySettingsService.setEnabledMenuItems(["dashboard", "pos", "stock"]);

      expect(companySettingsService.isMenuEnabled("dashboard")).toBe(true);
      expect(companySettingsService.isMenuEnabled("pos")).toBe(true);
      expect(companySettingsService.isMenuEnabled("stock")).toBe(true);
      expect(companySettingsService.isMenuEnabled("reports")).toBe(false);
      expect(companySettingsService.isMenuEnabled("purchases")).toBe(false);
    });

    it("persists workspace defaultLandingPage setting", async () => {
      await companySettingsService.updateSettings({
        workspace: {
          ...DEFAULT_SETTINGS.workspace,
          defaultLandingPage: "pos",
        },
      });

      const loaded = await companySettingsService.loadSettings();
      expect(loaded.workspace.defaultLandingPage).toBe("pos");
    });
  });

  describe("CFG-003: Billing Screen Layout, Columns & Presets", () => {
    it("provides built-in presets (Pharmacy, Retail, Fast Counter)", () => {
      const presets = companySettingsService.getBillingPresets();
      expect(presets.length).toBeGreaterThanOrEqual(3);
      expect(presets.map((p) => p.id)).toEqual(
        expect.arrayContaining(["pharmacy", "retail", "fast_counter"])
      );
    });

    it("applies Retail preset hiding batch and expiry while keeping required columns visible", async () => {
      const { columns, headerFields } = await companySettingsService.applyBillingPreset("retail");
      
      const batchCol = columns.find((c) => c.id === "batch_no");
      expect(batchCol?.visible).toBe(false);

      const productCol = columns.find((c) => c.id === "product_name");
      expect(productCol?.visible).toBe(true);

      const totalCol = columns.find((c) => c.id === "total");
      expect(totalCol?.visible).toBe(true);

      const docField = headerFields.find((h) => h.id === "doctor");
      expect(docField?.visible).toBe(false);
    });

    it("supports saving and deleting custom user presets", async () => {
      const customCols = companySettingsService.getBillingColumns();
      const customHeaders = companySettingsService.getHeaderFields();

      const created = await companySettingsService.saveCustomBillingPreset(
        "Supermarket Express",
        "Custom layout for rush hour",
        customCols,
        customHeaders
      );

      expect(created.name).toBe("Supermarket Express");
      expect(companySettingsService.getBillingPresets().some((p) => p.name === "Supermarket Express")).toBe(true);

      const deleted = await companySettingsService.deleteCustomBillingPreset(created.id);
      expect(deleted).toBe(true);
      expect(companySettingsService.getBillingPresets().some((p) => p.id === created.id)).toBe(false);
    });
  });
});
