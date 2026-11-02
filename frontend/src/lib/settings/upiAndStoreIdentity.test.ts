import { describe, it, expect, beforeEach } from "vitest";
import { companySettingsService, validateUpiId } from "./companySettingsService";

describe("Phase 4: Store Identity & UPI Settings Verification", () => {
  beforeEach(async () => {
    await companySettingsService.resetLocalData();
  });

  describe("UPI ID Format Validation", () => {
    it("validates correct UPI VPA formats", () => {
      expect(validateUpiId("store@icici")).toBe(true);
      expect(validateUpiId("merchant123@okaxis")).toBe(true);
      expect(validateUpiId("billing.dept@hdfcbank")).toBe(true);
      expect(validateUpiId("9876543210@paytm")).toBe(true);
      expect(validateUpiId("dr-sharma.clinic@upi")).toBe(true);
    });

    it("rejects invalid UPI handles", () => {
      expect(validateUpiId("")).toBe(false);
      expect(validateUpiId("notanupi")).toBe(false);
      expect(validateUpiId("@hdfc")).toBe(false);
      expect(validateUpiId("merchant@")).toBe(false);
      expect(validateUpiId("bad vpa@axis")).toBe(false);
      expect(validateUpiId("merchant@bad!bank")).toBe(false);
    });
  });

  describe("Store Identity Dynamic Loading (Item 5)", () => {
    it("serves configured store header without hardcoded fallbacks", async () => {
      await companySettingsService.updateSettings({
        store_name: "Apex Electronics & Gadgets",
        display_name: "Apex Store #1",
        address: "77 Brigade Road, Bangalore, Karnataka - 560001",
        phone: "080-25581234",
        email: "contact@apexstore.in",
        gstin: "29AABCU9603R1ZM",
        store_type: "electronics",
        gst_type: "regular",
      });

      const header = companySettingsService.getStorePrintHeader();
      expect(header.store_name).toBe("Apex Store #1");
      expect(header.store_address).toBe("77 Brigade Road, Bangalore, Karnataka - 560001");
      expect(header.store_phone).toBe("080-25581234");
      expect(header.store_email).toBe("contact@apexstore.in");
      expect(header.store_gstin).toBe("29AABCU9603R1ZM");
      expect(header.store_type).toBe("electronics");
      expect(header.gst_type).toBe("regular");

      // Verify no hardcoded sample values leak through
      expect(header.store_name).not.toContain("LamStone");
      expect(header.store_address).not.toContain("Palakkad");
      expect(header.store_phone).not.toBe("9876543210");
    });
  });

  describe("Multi-Account UPI Resolution & Counter Overrides (Item 10)", () => {
    it("resolves default UPI ID and counter-specific overrides", async () => {
      await companySettingsService.updateSettings({
        store_name: "City Supermarket",
        payments: {
          modes: [],
          enableDynamicUpiQr: true,
          enableQuickDenominations: true,
          creditPolicy: "warn_on_exceed",
          printShowReferences: false,
          upi: {
            enabled: true,
            showInSettlement: true,
            showOnPrintedBills: true,
            qrSubtext: "Scan with any UPI app to pay",
            accounts: [
              {
                id: "upi_main",
                upiId: "citysupermarket@icici",
                payeeName: "City Supermarket Main",
                merchantCode: "5411",
                isDefault: true,
                counterOverrides: [],
              },
              {
                id: "upi_express",
                upiId: "cityexpress@icici",
                payeeName: "City Supermarket Express Counter",
                merchantCode: "5411",
                isDefault: false,
                counterOverrides: ["Counter 02", "Express 01"],
              },
            ],
          },
        },
      });

      // Default resolution (Counter 01 has no override -> gets main)
      const defaultActive = companySettingsService.getActiveUpi("Counter 01");
      expect(defaultActive).not.toBeNull();
      expect(defaultActive?.vpa).toBe("citysupermarket@icici");
      expect(defaultActive?.payeeName).toBe("City Supermarket Main");

      // Counter override resolution (Counter 02 matches upi_express)
      const counter2Active = companySettingsService.getActiveUpi("Counter 02");
      expect(counter2Active).not.toBeNull();
      expect(counter2Active?.vpa).toBe("cityexpress@icici");
      expect(counter2Active?.payeeName).toBe("City Supermarket Express Counter");

      // Express 01 counter override
      const expressActive = companySettingsService.getActiveUpi("Express 01");
      expect(expressActive?.vpa).toBe("cityexpress@icici");
    });

    it("returns null when UPI is disabled", async () => {
      await companySettingsService.updateSettings({
        payments: {
          modes: [],
          enableDynamicUpiQr: false,
          enableQuickDenominations: false,
          creditPolicy: "warn_on_exceed",
          printShowReferences: false,
          upi: {
            enabled: false,
            showInSettlement: false,
            showOnPrintedBills: false,
            qrSubtext: "Disabled",
            accounts: [
              {
                id: "acc_1",
                upiId: "test@upi",
                payeeName: "Test Store",
                isDefault: true,
              },
            ],
          },
        },
      });

      const active = companySettingsService.getActiveUpi();
      expect(active).toBeNull();
    });
  });
});
