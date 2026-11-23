import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBusinessRuleError } from "../errors/businessRuleError";
import {
  PharmacistConfirmationRequiredError,
  isPharmacistRefusal,
  pharmacistFields,
  withoutPharmacistPin,
} from "./pharmacistGate";
import { posCartService } from "./posCartService";
import { cashShiftService } from "./cashShiftService";
import { productsStore } from "../masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { onlineTransactionService } from "../sync/onlineTransactionService";

/** The body the server actually sends for a restricted drug with no confirmation. */
const refusalBody = {
  code: "PHARMACIST_CONFIRMATION_REQUIRED",
  message: "A restricted drug is on this bill. It needs a pharmacist's confirmation.",
  rule: "PHR-004",
  line: 2,
  field: "pharmacist_id",
  fix: "Ask the pharmacist on duty to enter their PIN.",
  actions: ["pos.pharmacist_confirmation"],
  restricted_items: [
    {
      line: 2,
      product_id: 41,
      product_name: "Alprazolam 0.25 Strip",
      batch_no: "BCH-ALP",
      schedule_code: "H1",
      qty: 1,
    },
    {
      line: 3,
      product_id: 42,
      product_name: "Diazepam 5mg",
      batch_no: "BCH-DIA",
      schedule_code: "H1",
      qty: 2,
    },
  ],
};

describe("pharmacistGate", () => {
  it("recognises only the two pharmacist refusals as a confirmation prompt", () => {
    expect(isPharmacistRefusal("PHARMACIST_CONFIRMATION_REQUIRED")).toBe(true);
    expect(isPharmacistRefusal("PHARMACIST_CONFIRMATION_INVALID")).toBe(true);
    expect(isPharmacistRefusal("approval_required")).toBe(false);
    expect(isPharmacistRefusal("PERIOD_LOCKED")).toBe(false);
    expect(isPharmacistRefusal(undefined)).toBe(false);
    expect(isPharmacistRefusal(null)).toBe(false);
  });

  it("carries every restricted line, so the prompt names what needs a pharmacist", () => {
    const payload = parseBusinessRuleError(refusalBody);
    expect(payload).not.toBeNull();

    const refusal = new PharmacistConfirmationRequiredError(payload!, "ext_bill_1");

    expect(refusal.code).toBe("PHARMACIST_CONFIRMATION_REQUIRED");
    expect(refusal.field).toBe("pharmacist_id");
    expect(refusal.externalId).toBe("ext_bill_1");
    expect(refusal.message).toBe(refusalBody.message);
    expect(refusal.fix).toBe(refusalBody.fix);
    expect(refusal.restrictedItems.map((item) => item.product_name)).toEqual([
      "Alprazolam 0.25 Strip",
      "Diazepam 5mg",
    ]);
    expect(refusal.restrictedItems.map((item) => item.line)).toEqual([2, 3]);
    expect(refusal.restrictedItems[0].schedule_code).toBe("H1");
  });

  it("drops a half credential instead of sending it", () => {
    expect(pharmacistFields({ pharmacistId: "12", pin: "582913" })).toEqual({
      pharmacist_id: "12",
      pharmacist_pin: "582913",
    });
    expect(pharmacistFields(null)).toEqual({});
    expect(pharmacistFields(undefined)).toEqual({});
    expect(pharmacistFields({ pharmacistId: "", pin: "582913" })).toEqual({});
    expect(pharmacistFields({ pharmacistId: "12", pin: "   " })).toEqual({});
  });

  it("strips the PIN from a document being queued and keeps who was named", () => {
    const payload = {
      external_id: "ext_bill_1",
      pharmacist_id: "12",
      pharmacist_pin: "582913",
      items: [{ product_id: "41", qty: 1 }],
    };

    const queued = withoutPharmacistPin(payload);

    expect(queued).not.toHaveProperty("pharmacist_pin");
    expect(queued.pharmacist_id).toBe("12");
    expect(JSON.stringify(queued)).not.toContain("582913");
    // The live save still has its own copy untouched.
    expect(payload.pharmacist_pin).toBe("582913");
  });

  it("keeps every other field of the document it strips", () => {
    const queued = withoutPharmacistPin({
      invoice_number: "C01-INV-1001",
      grand_total: 240,
      pharmacist_id: "12",
      pharmacist_pin: "582913",
    });

    expect(queued).toEqual({
      invoice_number: "C01-INV-1001",
      grand_total: 240,
      pharmacist_id: "12",
    });
  });
});

/**
 * PHR-004/006 at the boundary the cashier actually stands at: the bill is held,
 * not saved, and the retry sends the same document with the confirmation.
 */
describe("posCartService pharmacist hold", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    posCartService.clearCart();

    await productsStore.upsertProduct({
      id: "prod_alp",
      name: "Alprazolam 0.25 Strip",
      barcode: "8903333",
      hsn_sac_code: "3004",
      mrp: 120,
      sel_rate: 100,
      gst_percent: 5,
      units_per_pack: 10,
      is_active: true,
    });
    await productsStore.upsertBatch({
      id: "batch_alp",
      product_id: "prod_alp",
      batch_no: "BCH-ALP",
      expiry_date: "2028-12-31",
      stock_qty: 40,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("holds a restricted bill instead of saving it and hands the lines over", async () => {
    await posCartService.scanBarcodeAndAddToCart("8903333");

    vi.spyOn(onlineTransactionService, "submitAuthoritativeInvoice").mockResolvedValue({
      success: false,
      isOnline: true,
      invoice: null,
      error: "A restricted drug is on this bill.",
      businessRule: {
        code: "PHARMACIST_CONFIRMATION_REQUIRED",
        rule: "PHR-004",
        line: 1,
        field: "pharmacist_id",
        message: "A restricted drug is on this bill. It needs a pharmacist's confirmation.",
        fix: "Ask the pharmacist on duty to enter their PIN.",
        actions: ["pos.pharmacist_confirmation"],
        restricted_items: [
          {
            line: 1,
            product_id: 41,
            product_name: "Alprazolam 0.25 Strip",
            batch_no: "BCH-ALP",
            schedule_code: "H1",
            qty: 1,
          },
        ],
      },
    });

    let caught: unknown;
    await posCartService
      .finalizeInvoice("INV-PHR-1", "Cash", { autoClear: false, externalId: "ext_phr_1" })
      .catch((err) => {
        caught = err;
      });

    expect(caught).toBeInstanceOf(PharmacistConfirmationRequiredError);
    const refusal = caught as PharmacistConfirmationRequiredError;
    expect(refusal.externalId).toBe("ext_phr_1");
    expect(refusal.restrictedItems.map((item) => item.product_name)).toEqual(["Alprazolam 0.25 Strip"]);
  });

  it("sends the same bill again with the pharmacist the cashier named", async () => {
    await posCartService.scanBarcodeAndAddToCart("8903333");

    const submit = vi
      .spyOn(onlineTransactionService, "submitAuthoritativeInvoice")
      .mockResolvedValue({
        success: true,
        isOnline: true,
        invoice: { id: "77", invoice_number: "INV-PHR-2" },
      });
    vi.spyOn(cashShiftService, "recordSaleTenders").mockResolvedValue(undefined as never);

    const saved = await posCartService.finalizeInvoice("INV-PHR-2", "Cash", {
      autoClear: false,
      externalId: "ext_phr_1",
      pharmacist: { pharmacistId: "11", pin: "582913" },
    });

    expect(saved.success).toBe(true);

    const sent = submit.mock.calls[0][0];
    // The identity the first attempt was refused under is reused, so the
    // confirmation lands on the bill it was given for.
    expect(sent.external_id).toBe("ext_phr_1");
    expect(sent.idempotency_key).toBe("ext_phr_1");
    expect(sent.pharmacist_id).toBe("11");
    expect(sent.pharmacist_pin).toBe("582913");
  });
});
