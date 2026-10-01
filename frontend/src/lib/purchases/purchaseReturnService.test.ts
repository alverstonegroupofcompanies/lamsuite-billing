import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { purchaseReturnService, type PurchaseReturnInput } from "./purchaseReturnService";

describe("purchaseReturnService - Debit Notes & Purchase Returns", () => {
  const dummyProduct = {
    id: "prod_amx_pr",
    name: "Amoxicillin 500mg Capsule",
    barcode: "8901234000222",
    mrp: 100.0,
    sel_rate: 90.0,
    gst_percent: 12,
    units_per_pack: 10,
    is_active: true,
  };

  const dummyBatch = {
    id: "batch_amx_pr1",
    product_id: "prod_amx_pr",
    batch_no: "AMX501",
    expiry_date: "2027-12",
    stock_qty: 50, // 50 units in stock
    purchase_rate: 60.0,
    selling_rate: 90.0,
  };

  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("purchase_returns");
    await sqliteStorage.clearTable("stock_transactions");
    await sqliteStorage.clearTable("products");
    await sqliteStorage.clearTable("product_batches");
    await sqliteStorage.clearTable("suppliers");

    await productsStore.upsertProduct(dummyProduct);
    await productsStore.upsertBatch({ ...dummyBatch });

    await partiesStore.upsertSupplier({
      id: "supp_apollo_pr",
      name: "Apollo Pharma Distributors Pvt Ltd",
      phone: "9847012345",
      gstin: "32AAACA1234B1Z2",
      address: "Cochin Hub",
      credit_period_days: 30,
      is_active: true,
    });
  });

  it("successfully creates a purchase return, reduces batch stock, and records debit note", async () => {
    const input: PurchaseReturnInput = {
      original_purchase_number: "PUR-2026-001",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      supplier_gstin: "32AAACA1234B1Z2",
      supplier_invoice_no: "AP-9988",
      settlement_type: "credit_adjust",
      lines: [
        {
          product_id: "prod_amx_pr",
          product_name: "Amoxicillin 500mg Capsule",
          batch_id: "batch_amx_pr1",
          batch_no: "AMX501",
          expiry_date: "2027-12",
          purchased_qty: 20,
          return_qty: 10,
          purchase_rate: 60.0,
          gst_percent: 12,
          reason: "near_expiry",
        },
      ],
    };

    const res = await purchaseReturnService.createPurchaseReturn(input);
    expect(res.success).toBe(true);
    expect(res.returnNumber).toMatch(/^PR-\d{2}-\d{2}-\d{4}$/);

    // Stock was 50, returned 10 -> new stock should be 40
    const updatedBatch = await sqliteStorage.findById<any>("product_batches", "batch_amx_pr1");
    expect(updatedBatch.stock_qty).toBe(40);

    // Financial check: 10 @ 60 = 600 taxable, GST 12% = 72, Total = 672
    expect(res.grandTotal).toBe(672);

    // Stock transaction check
    const txs = await sqliteStorage.findAll<any>("stock_transactions");
    const prTx = txs.find((t) => t.event_type === "PURCHASE_RETURN");
    expect(prTx).toBeDefined();
    expect(prTx.qty_delta).toBe(-10);

    // Verify record in purchase_returns
    const saved = await purchaseReturnService.getPurchaseReturnById(res.returnId);
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe("completed");
    expect(saved?.grand_total).toBe(672);
  });

  it("hard blocks return if requested quantity exceeds current in-store physical stock (stock already sold)", async () => {
    // Current stock is 50. Suppose we originally bought 100, but already sold 60, leaving only 40 in store.
    const batch = await sqliteStorage.findById<any>("product_batches", "batch_amx_pr1");
    batch.stock_qty = 40;
    await productsStore.upsertBatch(batch);

    const inputExcess: PurchaseReturnInput = {
      original_purchase_number: "PUR-2026-002",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      settlement_type: "credit_adjust",
      lines: [
        {
          product_id: "prod_amx_pr",
          product_name: "Amoxicillin 500mg Capsule",
          batch_id: "batch_amx_pr1",
          batch_no: "AMX501",
          purchased_qty: 100,
          return_qty: 45, // Stock is only 40!
          purchase_rate: 60.0,
          gst_percent: 12,
          reason: "expired",
        },
      ],
    };

    await expect(purchaseReturnService.createPurchaseReturn(inputExcess)).rejects.toThrow(
      /Available physical stock in store is only 40.*already sold/i
    );
  });

  it("hard blocks return if requested quantity exceeds purchased bill allowance", async () => {
    // 1st return: return 15 of 20
    const return1: PurchaseReturnInput = {
      original_purchase_number: "PUR-2026-003",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      settlement_type: "credit_adjust",
      lines: [
        {
          product_id: "prod_amx_pr",
          product_name: "Amoxicillin 500mg Capsule",
          batch_id: "batch_amx_pr1",
          batch_no: "AMX501",
          purchased_qty: 20,
          return_qty: 15,
          purchase_rate: 60.0,
          gst_percent: 12,
          reason: "wrong_supply",
        },
      ],
    };
    await purchaseReturnService.createPurchaseReturn(return1);

    // 2nd return: trying to return 10 more (only 5 left on bill) -> MUST FAIL
    const return2Excess: PurchaseReturnInput = {
      original_purchase_number: "PUR-2026-003",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      settlement_type: "credit_adjust",
      lines: [
        {
          product_id: "prod_amx_pr",
          product_name: "Amoxicillin 500mg Capsule",
          batch_id: "batch_amx_pr1",
          batch_no: "AMX501",
          purchased_qty: 20,
          return_qty: 10,
          purchase_rate: 60.0,
          gst_percent: 12,
          reason: "wrong_supply",
        },
      ],
    };

    await expect(purchaseReturnService.createPurchaseReturn(return2Excess)).rejects.toThrow(
      /Maximum bill allowance is 5/
    );
  });

  it("cancelling a purchase return restores stock back to batch", async () => {
    const input: PurchaseReturnInput = {
      original_purchase_number: "PUR-2026-004",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      settlement_type: "credit_adjust",
      lines: [
        {
          product_id: "prod_amx_pr",
          product_name: "Amoxicillin 500mg Capsule",
          batch_id: "batch_amx_pr1",
          batch_no: "AMX501",
          purchased_qty: 20,
          return_qty: 10,
          purchase_rate: 60.0,
          gst_percent: 12,
          reason: "damaged",
        },
      ],
    };

    const res = await purchaseReturnService.createPurchaseReturn(input);
    // Stock decreased from 50 to 40
    expect((await sqliteStorage.findById<any>("product_batches", "batch_amx_pr1")).stock_qty).toBe(40);

    // Cancel return
    const cancelRes = await purchaseReturnService.cancelPurchaseReturn(res.returnId, "Supplier rejected return note");
    expect(cancelRes.success).toBe(true);

    // Stock restored back to 50
    expect((await sqliteStorage.findById<any>("product_batches", "batch_amx_pr1")).stock_qty).toBe(50);

    const saved = await purchaseReturnService.getPurchaseReturnById(res.returnId);
    expect(saved?.status).toBe("cancelled");
    expect(saved?.cancellation_reason).toBe("Supplier rejected return note");
  });
});
