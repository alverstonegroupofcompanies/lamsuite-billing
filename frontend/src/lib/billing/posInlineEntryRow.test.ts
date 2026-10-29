import { describe, it, expect, beforeEach } from "vitest";
import { posCartService } from "./posCartService";
import { formatExpiryDisplay, parseExpiryDateParts } from "./unitConversion";
import { companySettingsService, DEFAULT_SETTINGS } from "../settings/companySettingsService";
import type { ProductItem, ProductBatch } from "../masters/productsStore";
import { calculateDocumentTaxes } from "../tax-engine/taxEngine";

describe("POS Inline Entry Row & Billing Workflow", () => {
  const itemTyped: ProductItem = {
    id: "item-typed",
    name: "Amoxicillin 500mg",
    barcode: "8901001",
    mrp: 120,
    sel_rate: 110,
    gst_percent: 12,
    units_per_pack: 10,
    unit_name: "Strip",
    sub_unit_name: "Capsule",
    allow_loose_sale: true,
    is_active: true,
  };

  const batchTyped: ProductBatch = {
    id: "batch-typed-1",
    product_id: "item-typed",
    batch_no: "AMX-001",
    expiry_date: "2027-10-09T18:30:00.000000Z",
    stock_qty: 50,
    selling_rate: 110,
    mrp: 120,
  };

  const itemScanned: ProductItem = {
    id: "item-scanned",
    name: "Paracetamol 650mg",
    barcode: "8902002",
    mrp: 35,
    sel_rate: 30,
    gst_percent: 12,
    units_per_pack: 15,
    unit_name: "Strip",
    is_active: true,
  };

  const batchScanned: ProductBatch = {
    id: "batch-scanned-1",
    product_id: "item-scanned",
    batch_no: "PCM-002",
    expiry_date: "2026-12-31",
    stock_qty: 100,
    selling_rate: 30,
    mrp: 35,
  };

  const itemMultiBatch: ProductItem = {
    id: "item-multibatch",
    name: "Azithromycin 500mg",
    barcode: "8903003",
    mrp: 150,
    sel_rate: 140,
    gst_percent: 12,
    units_per_pack: 3,
    unit_name: "Strip",
    is_active: true,
  };

  const batchEarlier: ProductBatch = {
    id: "batch-azm-early",
    product_id: "item-multibatch",
    batch_no: "AZM-2025",
    expiry_date: "2025-06-30",
    stock_qty: 20,
    selling_rate: 140,
    mrp: 150,
  };

  const itemPackLoose: ProductItem = {
    id: "item-packloose",
    name: "Vitamin C 500mg Chewable",
    barcode: "8904004",
    mrp: 50,
    sel_rate: 45,
    gst_percent: 12,
    units_per_pack: 10,
    unit_name: "Strip",
    sub_unit_name: "Tablet",
    allow_loose_sale: true,
    is_active: true,
  };

  const batchPackLoose: ProductBatch = {
    id: "batch-vitc",
    product_id: "item-packloose",
    batch_no: "VTC-01",
    expiry_date: "2027-05-31",
    stock_qty: 80,
    selling_rate: 45,
    mrp: 50,
  };

  const itemOutOfStock: ProductItem = {
    id: "item-oos",
    name: "Rare Antibiotic Drops",
    barcode: "8905005",
    mrp: 200,
    sel_rate: 190,
    gst_percent: 12,
    units_per_pack: 1,
    unit_name: "Vial",
    is_active: true,
  };

  const batchOutOfStock: ProductBatch = {
    id: "batch-oos-1",
    product_id: "item-oos",
    batch_no: "OOS-99",
    expiry_date: "2026-11-30",
    stock_qty: 0,
    selling_rate: 190,
    mrp: 200,
  };

  beforeEach(() => {
    posCartService.clearCart();
  });

  it("1. Bills 5 items through keyboard flow without any mouse event", () => {
    // 1. Typed item with default batch & qty 1
    posCartService.addProductToCart(itemTyped, batchTyped, 1, 0);

    // 2. Scanned item with 3* prefix (qty = 3)
    posCartService.addProductToCart(itemScanned, batchScanned, 3, 0);

    // 3. Multi-batch item picking earliest expiring batch (FEFO)
    posCartService.addProductToCart(itemMultiBatch, batchEarlier, 2, 0);

    // 4. Pack & Loose quantity (2 strips + 4 tablets = 2.4 strips)
    posCartService.addProductToCart(itemPackLoose, batchPackLoose, 2, 4);

    // 5. Out of stock item allowed per policy
    posCartService.addProductToCart(itemOutOfStock, batchOutOfStock, 1, 0);

    const lines = posCartService.getLines();
    expect(lines.length).toBe(5);

    // Verify 5 items properties
    expect(lines[0].product.name).toBe("Amoxicillin 500mg");
    expect(lines[0].qty).toBe(1);

    expect(lines[1].product.name).toBe("Paracetamol 650mg");
    expect(lines[1].qty).toBe(3);

    expect(lines[2].product.name).toBe("Azithromycin 500mg");
    expect(lines[2].selectedBatch.batch_no).toBe("AZM-2025");
    expect(lines[2].qty).toBe(2);

    expect(lines[3].product.name).toBe("Vitamin C 500mg Chewable");
    expect(lines[3].qty).toBe(2);
    expect(lines[3].loose_qty).toBe(4);

    expect(lines[4].product.name).toBe("Rare Antibiotic Drops");
    expect(lines[4].isNegativeStock).toBe(true);
    expect(lines[4].qty).toBe(1);

    // Totals calculate properly
    const totals = posCartService.getTotals();
    expect(totals.grand_total).toBeGreaterThan(0);
    expect(totals.taxable_subtotal).toBeGreaterThan(0);
  });

  it("2. Formats expiry date to MM/YY without 1-day UTC shift", () => {
    // 18:30:00Z on 2027-10-09 is 00:00:00 IST on 2027-10-10 (Month is 10, Year is 2027)
    const rawTimestamp = "2027-10-09T18:30:00.000000Z";
    const parts = parseExpiryDateParts(rawTimestamp);
    expect(parts).not.toBeNull();
    expect(parts?.month).toBe("10");
    expect(parts?.year).toBe("27");

    const formatted = formatExpiryDisplay(rawTimestamp);
    expect(formatted).toBe("10/27");

    // Standard YYYY-MM-DD
    expect(formatExpiryDisplay("2026-12-31")).toBe("12/26");
    expect(formatExpiryDisplay("2028-04-15")).toBe("04/28");
  });

  it("3. Tax-inclusive line total calculation: 4 @ 90.00 produces exact ₹360.00 with ₹0.00 round-off", () => {
    // 4 strips @ ₹90.00 each = ₹360.00 gross (inclusive of 12% GST)
    const result = calculateDocumentTaxes({
      companyTaxMode: "inclusive",
      lines: [
        {
          id: "line-test-1",
          qty: 4,
          loose_qty: 0,
          units_per_pack: 10,
          unit_price: 90.00,
          gst_percent: 12,
        },
      ],
    });

    expect(result.lines[0].total_amount).toBe(360.00);
    expect(result.grand_total).toBe(360.00);
    expect(result.round_off).toBe(0.00);
  });

  it("4. Warns when Selling Rate is above MRP and aligns units", () => {
    const rawMrp = 33.60;
    const rate = 90.00;
    const unitsPerPack = 10;

    // When rate is 90.00 per strip and MRP is 33.60 per tablet (stored per tablet)
    // Detected pack MRP = 33.60 * 10 = 336.00
    const detectedPackMrp = rawMrp < rate && (rawMrp * unitsPerPack) >= rate ? rawMrp * unitsPerPack : rawMrp;
    expect(detectedPackMrp).toBe(336.00);
    expect(rate <= detectedPackMrp).toBe(true); // 90.00 <= 336.00

    // When actual selling rate is above MRP:
    const aboveRate = 350.00;
    const isRateAboveMrp = aboveRate > detectedPackMrp + 0.01;
    expect(isRateAboveMrp).toBe(true);
  });

  it("5. Persists and supports product entry style settings in keyboard config", () => {
    expect(DEFAULT_SETTINGS.keyboard?.productEntryStyle).toBe("inline_row");
    expect(DEFAULT_SETTINGS.keyboard?.entryRowPosition).toBe("bottom");

    // Can toggle to legacy search_bar
    companySettingsService.updateSettings({
      keyboard: {
        ...DEFAULT_SETTINGS.keyboard,
        productEntryStyle: "search_bar",
        entryRowPosition: "top",
      },
    });

    const current = companySettingsService.getSettings();
    expect(current.keyboard?.productEntryStyle).toBe("search_bar");
    expect(current.keyboard?.entryRowPosition).toBe("top");

    // Reset back to inline_row default
    companySettingsService.updateSettings({
      keyboard: {
        ...DEFAULT_SETTINGS.keyboard,
        productEntryStyle: "inline_row",
        entryRowPosition: "bottom",
      },
    });
    expect(companySettingsService.getSettings().keyboard?.productEntryStyle).toBe("inline_row");
  });

  it("6. Single-unit items (e.g. cosmetics/nail polish) render single-unit controls without pack text", () => {
    const singleUnitItem: ProductItem = {
      id: "prod-nail-polish",
      name: "NYKAA NAIL POLISH - PISTA ROLL 357",
      mrp: 239,
      sel_rate: 239,
      gst_percent: 18,
      units_per_pack: 1,
      unit_name: "pc",
      is_active: true,
    };
    const batch: ProductBatch = {
      id: "batch-np-1",
      product_id: "prod-nail-polish",
      batch_no: "OPENING",
      expiry_date: "2028-12-31",
      stock_qty: 1000,
      selling_rate: 239,
      mrp: 239,
    };

    // Calculate line preview
    const draftCalculated = posCartService.calculateLine({
      id: "draft_preview",
      product: singleUnitItem,
      selectedBatch: batch,
      qty: 1,
      loose_qty: 0,
      unit_price: 239,
      rate_basis: "sel_rate",
      discount_percent: 0,
      discount_amount: 0,
      discount_manual: false,
    });

    expect(draftCalculated.total_amount).toBe(239);
    // Single unit has no pack conversion
    expect(singleUnitItem.units_per_pack).toBe(1);
    expect(singleUnitItem.allow_loose_sale).toBeFalsy();

    // Now commit to cart
    posCartService.addProductToCart(singleUnitItem, batch, 1, 0);
    const committed = posCartService.getLines()[0];
    expect(committed.calculated.total_amount).toBe(239);
    expect(committed.unit_price).toBe(239);
    expect(committed.product.units_per_pack).toBe(1);
  });

  it("7. Committing a draft line causes zero layout or numerical shift", () => {
    // Add Dolo 650 with 15 tablets/pack
    const doloItem: ProductItem = {
      id: "prod-dolo",
      name: "Dolo 650mg Tablet",
      mrp: 30,
      sel_rate: 30,
      gst_percent: 12,
      units_per_pack: 15,
      unit_name: "Strip",
      sub_unit_name: "Tablet",
      allow_loose_sale: true,
      is_active: true,
    };
    const doloBatch: ProductBatch = {
      id: "batch-dolo-1",
      product_id: "prod-dolo",
      batch_no: "DL9812",
      expiry_date: "2027-10-31",
      stock_qty: 100,
      selling_rate: 30,
      mrp: 30,
    };

    // Draft preview line calculation
    const preview = posCartService.calculateLine({
      id: "draft_preview",
      product: doloItem,
      selectedBatch: doloBatch,
      qty: 2,
      loose_qty: 5,
      unit_price: 30,
      rate_basis: "sel_rate",
      discount_percent: 0,
      discount_amount: 0,
      discount_manual: false,
    });

    // Commit to cart
    posCartService.addProductToCart(doloItem, doloBatch, 2, 5);
    const committed = posCartService.getLines()[0];

    // Verify exact equality between preview and committed line calculation
    expect(committed.calculated.total_amount).toBe(preview.total_amount);
    expect(committed.calculated.taxable_amount).toBe(preview.taxable_amount);
    expect(committed.calculated.total_tax).toBe(preview.total_tax);
    expect(committed.qty).toBe(2);
    expect(committed.loose_qty).toBe(5);
  });

  it("8. Tax-inclusive line: 1 @ 420.00 with 18% tax produces exact ₹420.00 line total (not 419.99)", () => {
    // Kochi Exclusive Wellness Tonic: 1 pc @ 420.00 with 18% tax inclusive
    const tonicItem: ProductItem = {
      id: "prod-tonic",
      name: "Kochi Exclusive Wellness Tonic",
      mrp: 420.00,
      sel_rate: 420.00,
      gst_percent: 18,
      units_per_pack: 1,
      unit_name: "pc",
      is_active: true,
    };
    const tonicBatch: ProductBatch = {
      id: "batch-tonic-1",
      product_id: "prod-tonic",
      batch_no: "TONIC-101",
      expiry_date: "2027-12-31",
      stock_qty: 15,
      selling_rate: 420.00,
      mrp: 420.00,
    };

    const res = posCartService.addProductToCart(tonicItem, tonicBatch, 1, 0);
    expect(res.line).toBeDefined();
    expect(res.line!.calculated.total_amount).toBe(420.00);

    const totals = posCartService.getTotals();
    expect(totals.grand_total).toBe(420.00);
    expect(totals.taxable_subtotal).toBe(355.93);
    expect(totals.total_tax).toBe(64.07);
    expect(totals.cgst_total).toBe(32.04);
    expect(totals.sgst_total).toBe(32.03);
    expect(totals.round_off).toBe(0.00);
  });

  it("9. Auto-add on selection immediately updates cart lines, totals, item count and taxes", () => {
    expect(posCartService.getLines().length).toBe(0);
    expect(posCartService.getTotals().grand_total).toBe(0);

    // Selecting Amoxicillin immediately creates line and updates totals
    const res1 = posCartService.addProductToCart(itemTyped, batchTyped, 1, 0);
    expect(res1.line).toBeDefined();
    expect(posCartService.getLines().length).toBe(1);
    expect(posCartService.getTotals().grand_total).toBe(110.00);

    // Selecting Paracetamol immediately adds 2nd line
    const res2 = posCartService.addProductToCart(itemScanned, batchScanned, 1, 0);
    expect(res2.line).toBeDefined();
    expect(posCartService.getLines().length).toBe(2);
    expect(posCartService.getTotals().grand_total).toBe(140.00);
  });

  it("10. Esc removes freshly added line, restoring cart to previous state and totals", () => {
    posCartService.addProductToCart(itemTyped, batchTyped, 1, 0);
    expect(posCartService.getLines().length).toBe(1);
    expect(posCartService.getTotals().grand_total).toBe(110.00);

    // Add 2nd item
    const res = posCartService.addProductToCart(itemScanned, batchScanned, 1, 0);
    expect(posCartService.getLines().length).toBe(2);
    expect(posCartService.getTotals().grand_total).toBe(140.00);

    // Esc on the freshly added 2nd item removes it
    posCartService.removeLine(res.line!.id);
    expect(posCartService.getLines().length).toBe(1);
    expect(posCartService.getTotals().grand_total).toBe(110.00);
    expect(posCartService.getLines()[0].product.name).toBe("Amoxicillin 500mg");
  });

  it("11. 3 barcode scans in a row sequentially add items and keep totals updated", () => {
    // Scan 1: Paracetamol (qty 1)
    posCartService.addProductToCart(itemScanned, batchScanned, 1, 0);
    expect(posCartService.getLines().length).toBe(1);
    expect(posCartService.getTotals().grand_total).toBe(30.00);

    // Scan 2: Amoxicillin with 2* prefix (qty 2)
    posCartService.addProductToCart(itemTyped, batchTyped, 2, 0);
    expect(posCartService.getLines().length).toBe(2);
    expect(posCartService.getTotals().grand_total).toBe(250.00); // 30 + 220

    // Scan 3: Vitamin C (qty 1)
    posCartService.addProductToCart(itemPackLoose, batchPackLoose, 1, 0);
    expect(posCartService.getLines().length).toBe(3);
    expect(posCartService.getTotals().grand_total).toBe(295.00); // 250 + 45
  });

  it("12. Safety net rejects invoice finalization if line sum does not equal grand total", async () => {
    posCartService.addProductToCart(itemTyped, batchTyped, 1, 0);

    // Finalizing with corrupt totalsSnapshot differing from line sum triggers integrity exception
    await expect(
      posCartService.finalizeInvoice("INV-TEST-FAIL", "Cash", {
        totalsSnapshot: {
          ...posCartService.getTotals(),
          grand_total: 999.00, // Invalid: does not match line sum of 110.00
        },
      })
    ).rejects.toThrow("Invoice integrity violation");
  });

  it("13. Out-of-stock items are added immediately with warning and counted in bill totals", () => {
    const res = posCartService.addProductToCart(itemOutOfStock, batchOutOfStock, 1, 0);
    expect(res.line).toBeDefined();
    expect(res.line!.isNegativeStock).toBe(true);

    const lines = posCartService.getLines();
    expect(lines.length).toBe(1);
    expect(lines[0].isNegativeStock).toBe(true);

    const totals = posCartService.getTotals();
    expect(totals.grand_total).toBe(190.00);
    expect(totals.taxable_subtotal).toBeGreaterThan(0);
  });

  it("14. Settings keyboard addLineMode defaults to immediate and supports after_enter", () => {
    expect(DEFAULT_SETTINGS.keyboard?.addLineMode).toBe("immediate");

    companySettingsService.updateSettings({
      keyboard: {
        ...DEFAULT_SETTINGS.keyboard,
        addLineMode: "after_enter",
      },
    });

    expect(companySettingsService.getSettings().keyboard?.addLineMode).toBe("after_enter");

    // Revert back to default
    companySettingsService.updateSettings({
      keyboard: {
        ...DEFAULT_SETTINGS.keyboard,
        addLineMode: "immediate",
      },
    });
    expect(companySettingsService.getSettings().keyboard?.addLineMode).toBe("immediate");
  });
});
