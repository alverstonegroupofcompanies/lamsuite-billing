import { describe, it, expect, beforeEach } from "vitest";
import { CompanySettingsService, companySettingsService, DEFAULT_SETTINGS } from "./companySettingsService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("Company Settings, Sequences & Menu Visibility (CFG-001, CFG-002)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("CFG-001: Store Profile & Sequential Invoice Numbers", () => {
    it("generates sequential formatted invoice numbers and persists next sequence", async () => {
      await companySettingsService.saveLocalSettings({
        invoice_prefix: "LS",
        next_invoice_number: 50,
      });

      const inv1 = await companySettingsService.generateNextInvoiceNumber();
      expect(inv1).toBe("LS-50");

      const inv2 = await companySettingsService.generateNextInvoiceNumber();
      expect(inv2).toBe("LS-51");

      const settings = await companySettingsService.loadSettings();
      expect(settings.next_invoice_number).toBe(52);
    });

    it("updates store statutory headers and drug licenses", async () => {
      await companySettingsService.saveLocalSettings({
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
      await companySettingsService.saveLocalSettings({
        workspace: {
          ...DEFAULT_SETTINGS.workspace,
          defaultLandingPage: "pos",
        },
      });

      const loaded = await companySettingsService.loadSettings();
      expect(loaded.workspace.defaultLandingPage).toBe("pos");
    });

    it("persists the store-owner default bills period", async () => {
      expect(DEFAULT_SETTINGS.workspace.billsDefaultPeriod).toBe("today");

      await companySettingsService.saveLocalSettings({
        workspace: {
          ...DEFAULT_SETTINGS.workspace,
          billsDefaultPeriod: "last7days",
        },
      });

      const loaded = await companySettingsService.loadSettings();
      expect(loaded.workspace.billsDefaultPeriod).toBe("last7days");
    });
  });

  /**
   * MIG-02: the switch lives on the store row and travels with the settings payload.
   * A till that has never received it behaves as it did before the switch existed —
   * the wizard was open on every till, and closing it silently would strand them.
   */
  describe("MIG-02: the store's Data Migration switch", () => {
    it("is open for a till that never received the flag", () => {
      expect(new CompanySettingsService().isMigrationAllowed()).toBe(true);
    });

    it("closes when the admin panel switches migration off for the branch", async () => {
      await companySettingsService.updateLocalFromRemote({
        feature_flags: { allow_data_migration: false },
      });

      expect(companySettingsService.getSettings().allow_data_migration).toBe(false);
      expect(companySettingsService.isMigrationAllowed()).toBe(false);
    });

    it("reopens, and a payload without the flag keeps the answer this till already has", async () => {
      await companySettingsService.updateLocalFromRemote({
        feature_flags: { allow_data_migration: true },
      });
      expect(companySettingsService.isMigrationAllowed()).toBe(true);

      await companySettingsService.updateLocalFromRemote({ feature_flags: {} });
      expect(companySettingsService.isMigrationAllowed()).toBe(true);

      await companySettingsService.updateLocalFromRemote({});
      expect(companySettingsService.isMigrationAllowed()).toBe(true);
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

  describe("Purchase columns (items 24, 26)", () => {
    it("keeps newly added columns available when a saved layout predates them", async () => {
      await companySettingsService.saveLocalSettings({
        purchase_columns: [
          { id: "product_name", label: "Product", visible: true, width: 220, order: 0 },
          { id: "qty", label: "Qty", visible: true, width: 70, order: 1 },
        ],
      });

      const columns = companySettingsService.getPurchaseColumns();
      expect(columns.find((c) => c.id === "mfg_date")).toBeDefined();
      expect(columns.find((c) => c.id === "hsn")).toBeDefined();
      expect(columns.find((c) => c.id === "ptr")).toBeDefined();
      expect(columns.find((c) => c.id === "pts")).toBeDefined();
      expect(columns.find((c) => c.id === "ptss")).toBeDefined();
    });

    it("exposes the discount column as percent or amount", () => {
      const columns = companySettingsService.getPurchaseColumns();
      const discount = columns.find((c) => c.id === "discount");
      expect(discount?.label).toContain("%");
      expect(discount?.visible).toBe(true);
    });
  });

  describe("Purchase charge payable policy (PUR-016, CFG-003)", () => {
    const remoteWith = (separatelyPaidInPayable: unknown) => ({
      purchase_charges: { separately_paid_in_payable: separatelyPaidInPayable },
    });

    it("turns the payable inclusion on for the spellings a settings payload can carry", async () => {
      for (const value of [true, 1, "1", "true"]) {
        const settings = await companySettingsService.updateLocalFromRemote(remoteWith(value));
        expect(settings.purchase_charges.separately_paid_in_payable, JSON.stringify(value)).toBe(true);
      }
    });

    it("keeps every other spelling off, so a stray value cannot silently reprice a bill", async () => {
      for (const value of [false, 0, "0", "", "maybe", null]) {
        const settings = await companySettingsService.updateLocalFromRemote(remoteWith(value));
        expect(settings.purchase_charges.separately_paid_in_payable, JSON.stringify(value)).toBe(false);
      }
    });

    it("leaves the till's own answer alone when a remote form has never shown the switch", async () => {
      await companySettingsService.updateLocalFromRemote(remoteWith(true));

      const kept = await companySettingsService.updateLocalFromRemote({
        billing: { purchase_charges: { reverse_on_return: "sunk" } },
      });

      expect(kept.purchase_charges.separately_paid_in_payable).toBe(true);
      expect(kept.purchase_charges.reverse_on_return).toBe("sunk");
    });
  });
});
