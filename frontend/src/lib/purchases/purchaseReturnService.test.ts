import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";
import { partiesStore } from "../masters/partiesStore";
import { purchaseReturnService, type PurchaseReturnInput } from "./purchaseReturnService";
import { onlineTransactionService } from "../sync/onlineTransactionService";
import { storeDeviceService } from "../auth/storeDeviceService";

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

  const queueItemFor = async (returnId: string) => {
    const queue = await sqliteStorage.findAll<any>("sync_queue");
    return queue
      .filter((q) => q.entity_id === returnId)
      .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0))
      .pop();
  };

  const parsePayload = (item: any) => JSON.parse(item.payload_json ?? item.payload ?? "{}");

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
    expect(res.returnNumber).toMatch(/^PR-\d+$/);

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

  it("queues the debit note as a purchase document, not as a product", async () => {
    const res = await purchaseReturnService.createPurchaseReturn({
      original_purchase_number: "PUR-2026-001",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      supplier_gstin: "32AAACA1234B1Z2",
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
    });

    // entity_type "product" made the server drop the whole document: it has no name to match.
    const queued = await queueItemFor(res.returnId);
    expect(queued).toBeDefined();
    expect(queued.entity_type).toBe("purchase");
    expect(queued.action).toBe("create");
    const payload = parsePayload(queued);
    expect(payload.module_key).toBe("purchase_return");
    expect(payload.return_number).toBe(res.returnNumber);
    expect(payload.original_purchase_number).toBe("PUR-2026-001");
    expect(payload.lines[0].return_qty).toBe(10);
  });

  it("queues the cancellation so the server gives the units back too", async () => {
    const res = await purchaseReturnService.createPurchaseReturn({
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
          purchased_qty: 20,
          return_qty: 4,
          purchase_rate: 60.0,
          gst_percent: 12,
          reason: "wrong_supply",
        },
      ],
    });
    await purchaseReturnService.cancelPurchaseReturn(res.returnId, "Entered in error");

    const queued = await queueItemFor(res.returnId);
    expect(queued.action).toBe("update");
    const payload = parsePayload(queued);
    expect(payload.status).toBe("cancelled");
    expect(payload.module_key).toBe("purchase_return");
  });
});

/**
 * A debit note only ever lived on the till that typed it, so the notes a migration imported or
 * another counter posted were invisible here even though the backend held them.
 */
describe("purchaseReturnService - documents held on the server", () => {
  const serverDebitNote = {
    id: 77,
    external_id: null,
    module_key: "purchase_return",
    invoice_number: "PR-1-0007",
    invoice_date: "2026-11-19",
    supplier_id: 4,
    supplier_name: "ACME Distributors",
    supplier_gstin: "32AAACA1234B1Z2",
    supplier_invoice_no: "ACME-INV-55",
    subtotal: -500,
    tax_total: -60,
    cgst_total: -30,
    sgst_total: -30,
    igst_total: 0,
    round_off: 0,
    grand_total: -560,
    status: "completed",
    created_at: "2026-11-19T10:15:00.000000Z",
    updated_at: "2026-11-19T10:15:00.000000Z",
    items: [
      {
        id: 301,
        product_id: 12,
        product_name: "Amoxicillin 500mg Capsule",
        hsn_code: "2901",
        batch_no: "AMX501",
        expiry_date: "2027-12",
        pack_qty: 5,
        loose_qty: 0,
        units_per_pack: 10,
        qty: 5,
        purchase_rate: 60,
        gst_percent: 12,
        taxable_amount: 500,
        cgst_amount: 30,
        sgst_amount: 30,
        total_amount: 560,
      },
    ],
  };

  const serverPurchaseBill = {
    id: 60,
    external_id: null,
    module_key: "purchase",
    invoice_number: "PUR-1-0031",
    invoice_date: "2026-11-10",
    supplier_id: 4,
    supplier_name: "ACME Distributors",
    supplier_invoice_no: "ACME-INV-55",
    subtotal: 1000,
    tax_total: 120,
    grand_total: 1120,
    status: "received",
    items: [
      {
        id: 401,
        product_id: 12,
        product_name: "Amoxicillin 500mg Capsule",
        batch_no: "AMX501",
        expiry_date: "2027-12",
        pack_qty: 10,
        loose_qty: 3,
        units_per_pack: 10,
        qty: 10,
        purchase_rate: 60,
        taxable_amount: 600,
        gst_percent: 12,
      },
    ],
  };

  beforeEach(async () => {
    await sqliteStorage.initDatabase();
    await sqliteStorage.clearTable("purchase_returns");
    await sqliteStorage.clearTable("purchase_documents");
    vi.spyOn(onlineTransactionService, "getEffectiveBaseUrl").mockReturnValue("http://server.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const stubLists = (purchases: any[], bills: any[]) => {
    const calls: any[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (...args: any[]) => {
        calls.push(args);
        const url = String(args[0]);
        return {
          ok: true,
          json: async () => ({ data: url.includes("module=purchase_returns") ? purchases : bills }),
        };
      })
    );
    return calls;
  };

  it("lists a debit note the backend holds and this till never saw", async () => {
    const calls = stubLists([serverDebitNote], []);

    const list = await purchaseReturnService.getPurchaseReturns();

    expect(String(calls[0][0])).toContain("/api/purchases?");
    expect(String(calls[0][0])).toContain("module=purchase_returns");
    expect(list.map((r) => r.return_number)).toEqual(["PR-1-0007"]);
    expect(list[0].supplier_name).toBe("ACME Distributors");
    expect(list[0].original_purchase_number).toBe("ACME-INV-55");
    expect(list[0].settlement_type).toBe("credit_adjust");
    expect(list[0].created_at).toBeGreaterThan(0);
    // The server bills a line in packs, so the return line has to be in base units.
    expect(list[0].lines[0]).toMatchObject({
      product_name: "Amoxicillin 500mg Capsule",
      batch_no: "AMX501",
      purchased_qty: 50,
      return_qty: 50,
      purchase_rate: 60,
    });
  });

  it("authenticates the server read with this workstation's device token", async () => {
    // The till routes answer 401 without it, and a silent 401 is indistinguishable from a store
    // that has no debit notes — which is how the merged lists first shipped looking empty.
    vi.spyOn(storeDeviceService, "getDeviceAuthHeaders").mockResolvedValue({
      "X-Device-Token": "tok-store-7",
      "X-Store-Id": "7",
      "Store-Id": "7",
    });
    const calls = stubLists([serverDebitNote], []);

    const list = await purchaseReturnService.getPurchaseReturns();

    expect(list.map((r) => r.return_number)).toEqual(["PR-1-0007"]);
    expect(calls[0][1].headers["X-Device-Token"]).toBe("tok-store-7");
    expect(String(calls[0][0])).toContain("store_id=7");
  });

  it("keeps the till's own note when the server echoes it back", async () => {
    await sqliteStorage.insertRecord("purchase_returns", "prat_1", {
      id: "prat_1",
      return_number: "PR-1-0007",
      return_date: "2026-11-19",
      return_time: "10:15:00",
      original_purchase_number: "PUR-1-0031",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      lines: [
        {
          id: "prat_1_line",
          return_id: "prat_1",
          product_id: "prod_amx_pr",
          product_name: "Amoxicillin 500mg Capsule",
          batch_id: "batch_amx_pr1",
          batch_no: "AMX501",
          purchased_qty: 50,
          return_qty: 50,
          purchase_rate: 60,
          gst_percent: 12,
          reason: "expired",
          taxable_amount: 500,
          cgst_amount: 30,
          sgst_amount: 30,
          igst_amount: 0,
          total_amount: 560,
        },
      ],
      subtotal: 500,
      tax_total: 60,
      cgst_total: 30,
      sgst_total: 30,
      igst_total: 0,
      round_off: 0,
      grand_total: 560,
      settlement_type: "credit_adjust",
      status: "completed",
      created_at: 1763777700000,
      updated_at: 1763777700000,
    });

    stubLists([{ ...serverDebitNote, external_id: "prat_1" }], []);

    const list = await purchaseReturnService.getPurchaseReturns();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("prat_1");
    expect(list[0].lines[0].reason).toBe("expired");
  });

  it("offers a server purchase bill as a bill to return against", async () => {
    await sqliteStorage.insertRecord("purchase_documents", "pur_local", {
      id: "pur_local",
      purchase_number: "PUR-LOCAL-1",
      module_key: "purchase",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      supplier_invoice_no: "LOCAL-1",
      purchase_date: "2026-11-21",
      grand_total: 900,
      sync_state: "pending",
    });

    stubLists([], [serverPurchaseBill, { ...serverPurchaseBill, id: 61, external_id: "pur_local" }]);

    const bills = await purchaseReturnService.getOriginalBills();

    expect(bills.map((b) => b.purchase_number)).toEqual(["PUR-LOCAL-1", "PUR-1-0031"]);
    const serverBill = bills.find((b) => b.purchase_number === "PUR-1-0031");
    expect(serverBill.lines).toHaveLength(1);
    expect(serverBill.lines[0]).toMatchObject({ pack_qty: 10, units_per_pack: 10, loose_qty: 3 });
  });

  it("still answers from the local book when the server will not reply", async () => {
    await sqliteStorage.insertRecord("purchase_returns", "prat_off", {
      id: "prat_off",
      return_number: "PR-OFF-1",
      return_date: "2026-11-25",
      return_time: "09:00:00",
      supplier_id: "supp_apollo_pr",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      lines: [],
      subtotal: 0,
      tax_total: 0,
      cgst_total: 0,
      sgst_total: 0,
      igst_total: 0,
      round_off: 0,
      grand_total: 100,
      settlement_type: "refund",
      refund_mode: "Cash",
      status: "completed",
      created_at: 1763900000000,
      updated_at: 1763900000000,
    });

    await sqliteStorage.insertRecord("purchase_documents", "pur_off", {
      id: "pur_off",
      purchase_number: "PUR-OFF-1",
      module_key: "purchase",
      supplier_name: "Apollo Pharma Distributors Pvt Ltd",
      purchase_date: "2026-11-24",
      grand_total: 400,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const list = await purchaseReturnService.getPurchaseReturns();
    const bills = await purchaseReturnService.getOriginalBills();

    expect(list.map((r) => r.return_number)).toEqual(["PR-OFF-1"]);
    expect(bills.map((b) => b.purchase_number)).toContain("PUR-OFF-1");
  });
});
