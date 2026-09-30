import { describe, it, expect, beforeEach } from "vitest";
import { reportEngine, type InvoiceRecord, type InvoiceItemRecord } from "./reportEngine";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { productsStore } from "../masters/productsStore";

describe("Reports & Indian GST Compliance Engine (REP-001 - REP-006)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    reportEngine.setDefaultStoreStateCode("32"); // Kerala
  });

  describe("REP-001: Sales Register & Daily Collection Summary", () => {
    it("generates sales register and breaks down tender collections across Cash, UPI, Card, and Credit", async () => {
      // 1. Insert Cash Bill
      await sqliteStorage.insertRecord("invoices", "inv_1", {
        id: "inv_1",
        module_key: "invoice",
        invoice_number: "INV-001",
        invoice_date: "2026-09-30",
        customer_name: "John Doe",
        subtotal: 1000,
        tax_total: 120,
        round_off: 0,
        grand_total: 1120,
        paid_amount: 1120,
        payment_mode: "Cash",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      await sqliteStorage.insertRecord("invoice_items", "item_1", {
        id: "item_1",
        invoice_id: "inv_1",
        product_id: "p1",
        product_name: "Medicine A",
        hsn_code: "3004",
        qty: 10,
        unit_price: 100,
        gst_percent: 12,
        cgst_amount: 60,
        sgst_amount: 60,
        igst_amount: 0,
        total_amount: 1120,
      } as InvoiceItemRecord);

      // 2. Insert UPI Bill
      await sqliteStorage.insertRecord("invoices", "inv_2", {
        id: "inv_2",
        module_key: "invoice",
        invoice_number: "INV-002",
        invoice_date: "2026-09-30",
        customer_name: "Jane Smith",
        subtotal: 500,
        tax_total: 25,
        round_off: 0,
        grand_total: 525,
        paid_amount: 525,
        payment_mode: "UPI",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      await sqliteStorage.insertRecord("invoice_items", "item_2", {
        id: "item_2",
        invoice_id: "inv_2",
        product_id: "p2",
        product_name: "Syrup B",
        hsn_code: "3004",
        qty: 5,
        unit_price: 100,
        gst_percent: 5,
        cgst_amount: 12.5,
        sgst_amount: 12.5,
        igst_amount: 0,
        total_amount: 525,
      } as InvoiceItemRecord);

      // 3. Insert Sales Return (Credit Note)
      await sqliteStorage.insertRecord("invoices", "cn_1", {
        id: "cn_1",
        module_key: "credit_note",
        invoice_number: "CN-001",
        invoice_date: "2026-09-30",
        original_invoice_number: "INV-001",
        customer_name: "John Doe",
        subtotal: 200,
        tax_total: 24,
        round_off: 0,
        grand_total: 224,
        paid_amount: 224,
        payment_mode: "Cash",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      const register = await reportEngine.getSalesRegister("2026-09-01", "2026-09-30");
      expect(register.length).toBe(2);
      expect(register[0].invoice_number).toBe("INV-001");
      expect(register[0].cgst_amount).toBe(60);
      expect(register[0].sgst_amount).toBe(60);

      const daily = await reportEngine.getDailyCollectionSummary("2026-09-30", "2026-09-30");
      expect(daily.total_invoices_count).toBe(2);
      expect(daily.gross_sales).toBe(1645); // 1120 + 525
      expect(daily.total_returns).toBe(224);
      expect(daily.net_sales).toBe(1421); // 1645 - 224
      expect(daily.by_tender.cash).toBe(896); // 1120 cash - 224 return
      expect(daily.by_tender.upi).toBe(525);
    });
  });

  describe("REP-002: GSTR-1 Compliance Summary", () => {
    it("categorizes transactions into B2B (Table 4), B2C Large (Table 5), B2C Small (Table 7), and Returns (Table 9)", async () => {
      // 1. B2B Invoice: Customer with valid GSTIN
      await sqliteStorage.insertRecord("invoices", "inv_b2b", {
        id: "inv_b2b",
        module_key: "invoice",
        invoice_number: "INV-B2B-01",
        invoice_date: "2026-09-15",
        customer_name: "Apex Hospital",
        customer_gstin: "32AAAAA0000A1Z5",
        place_of_supply: "32",
        subtotal: 10000,
        tax_total: 1200,
        round_off: 0,
        grand_total: 11200,
        paid_amount: 11200,
        payment_mode: "Bank Transfer",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      await sqliteStorage.insertRecord("invoice_items", "item_b2b", {
        id: "item_b2b",
        invoice_id: "inv_b2b",
        product_id: "p_b2b",
        product_name: "Surgical Gloves",
        hsn_code: "4015",
        qty: 100,
        unit_price: 100,
        gst_percent: 12,
        cgst_amount: 600,
        sgst_amount: 600,
        igst_amount: 0,
        total_amount: 11200,
      } as InvoiceItemRecord);

      // 2. B2C Large: Inter-state unregistered invoice > ₹2.5 Lakhs (e.g. ₹2,80,000 to Tamil Nadu 33)
      await sqliteStorage.insertRecord("invoices", "inv_b2c_lg", {
        id: "inv_b2c_lg",
        module_key: "invoice",
        invoice_number: "INV-B2C-LG",
        invoice_date: "2026-09-18",
        customer_name: "Out of State Patient",
        customer_gstin: "",
        place_of_supply: "33-Tamil Nadu",
        subtotal: 250000,
        tax_total: 30000,
        round_off: 0,
        grand_total: 280000,
        paid_amount: 280000,
        payment_mode: "Card",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      await sqliteStorage.insertRecord("invoice_items", "item_b2c_lg", {
        id: "item_b2c_lg",
        invoice_id: "inv_b2c_lg",
        product_id: "p_implant",
        product_name: "Orthopedic Implant",
        hsn_code: "9021",
        qty: 1,
        unit_price: 250000,
        gst_percent: 12,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 30000,
        total_amount: 280000,
      } as InvoiceItemRecord);

      // 3. B2C Small: Intra-state unregistered sale (e.g. ₹560)
      await sqliteStorage.insertRecord("invoices", "inv_b2c_sm", {
        id: "inv_b2c_sm",
        module_key: "invoice",
        invoice_number: "INV-B2C-SM",
        invoice_date: "2026-09-20",
        customer_name: "Local Retail Customer",
        customer_gstin: "",
        place_of_supply: "32",
        subtotal: 500,
        tax_total: 60,
        round_off: 0,
        grand_total: 560,
        paid_amount: 560,
        payment_mode: "Cash",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      await sqliteStorage.insertRecord("invoice_items", "item_b2c_sm", {
        id: "item_b2c_sm",
        invoice_id: "inv_b2c_sm",
        product_id: "p_syrup",
        product_name: "Cough Syrup",
        hsn_code: "3004",
        qty: 5,
        unit_price: 100,
        gst_percent: 12,
        cgst_amount: 30,
        sgst_amount: 30,
        igst_amount: 0,
        total_amount: 560,
      } as InvoiceItemRecord);

      // 4. Table 9: Credit Note
      await sqliteStorage.insertRecord("invoices", "cn_ret", {
        id: "cn_ret",
        module_key: "credit_note",
        invoice_number: "CN-002",
        invoice_date: "2026-09-22",
        original_invoice_number: "INV-B2B-01",
        customer_name: "Apex Hospital",
        customer_gstin: "32AAAAA0000A1Z5",
        subtotal: 1000,
        tax_total: 120,
        round_off: 0,
        grand_total: 1120,
        paid_amount: 1120,
        payment_mode: "Cash",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      await sqliteStorage.insertRecord("invoice_items", "item_cn", {
        id: "item_cn",
        invoice_id: "cn_ret",
        product_id: "p_b2b",
        product_name: "Surgical Gloves",
        hsn_code: "4015",
        qty: 10,
        unit_price: 100,
        gst_percent: 12,
        cgst_amount: 60,
        sgst_amount: 60,
        igst_amount: 0,
        total_amount: 1120,
      } as InvoiceItemRecord);

      const gstr1 = await reportEngine.getGstr1Summary("2026-09-01", "2026-09-30");

      // Verify Table 4 (B2B)
      expect(gstr1.table_4_b2b.length).toBe(1);
      expect(gstr1.table_4_b2b[0].invoice_number).toBe("INV-B2B-01");
      expect(gstr1.table_4_b2b[0].gstin).toBe("32AAAAA0000A1Z5");
      expect(gstr1.table_4_b2b[0].taxable_value).toBe(10000);

      // Verify Table 5 (B2C Large)
      expect(gstr1.table_5_b2c_large.length).toBe(1);
      expect(gstr1.table_5_b2c_large[0].invoice_number).toBe("INV-B2C-LG");
      expect(gstr1.table_5_b2c_large[0].place_of_supply).toBe("33");
      expect(gstr1.table_5_b2c_large[0].integrated_tax).toBe(30000);

      // Verify Table 7 (B2C Small)
      expect(gstr1.table_7_b2c_small.length).toBe(1);
      expect(gstr1.table_7_b2c_small[0].place_of_supply).toBe("32");
      expect(gstr1.table_7_b2c_small[0].rate).toBe(12);
      expect(gstr1.table_7_b2c_small[0].taxable_value).toBe(500);

      // Verify Table 9 (Credit/Debit Notes)
      expect(gstr1.table_9_credit_debit_notes.length).toBe(1);
      expect(gstr1.table_9_credit_debit_notes[0].note_number).toBe("CN-002");
      expect(gstr1.table_9_credit_debit_notes[0].original_invoice_number).toBe("INV-B2B-01");
    });
  });

  describe("REP-003: HSN / SAC Summary", () => {
    it("groups sales lines by HSN code and GST rate with statutory tax breakdowns", async () => {
      await sqliteStorage.insertRecord("invoices", "inv_hsn_1", {
        id: "inv_hsn_1",
        module_key: "invoice",
        invoice_number: "INV-HSN-1",
        invoice_date: "2026-09-25",
        subtotal: 1500,
        tax_total: 160,
        round_off: 0,
        grand_total: 1660,
        paid_amount: 1660,
        payment_mode: "Cash",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      // Line 1: HSN 3004 @ 12%
      await sqliteStorage.insertRecord("invoice_items", "hsn_item_1", {
        id: "hsn_item_1",
        invoice_id: "inv_hsn_1",
        product_id: "p1",
        product_name: "Amoxicillin 500",
        hsn_code: "3004",
        qty: 10,
        units_per_pack: 1,
        unit_price: 100,
        gst_percent: 12,
        cgst_amount: 60,
        sgst_amount: 60,
        igst_amount: 0,
        total_amount: 1120,
      } as InvoiceItemRecord);

      // Line 2: HSN 3004 @ 12% (Another product with same HSN & rate -> should aggregate)
      await sqliteStorage.insertRecord("invoice_items", "hsn_item_2", {
        id: "hsn_item_2",
        invoice_id: "inv_hsn_1",
        product_id: "p2",
        product_name: "Cefixime 200",
        hsn_code: "3004",
        qty: 5,
        units_per_pack: 1,
        unit_price: 60,
        gst_percent: 12,
        cgst_amount: 18,
        sgst_amount: 18,
        igst_amount: 0,
        total_amount: 336,
      } as InvoiceItemRecord);

      // Line 3: HSN 3003 @ 5% (Different HSN & rate)
      await sqliteStorage.insertRecord("invoice_items", "hsn_item_3", {
        id: "hsn_item_3",
        invoice_id: "inv_hsn_1",
        product_id: "p3",
        product_name: "Ayurvedic Balm",
        hsn_code: "3003",
        qty: 2,
        units_per_pack: 1,
        unit_price: 95.24,
        gst_percent: 5,
        cgst_amount: 4.76,
        sgst_amount: 4.76,
        igst_amount: 0,
        total_amount: 204, // ~200 taxable + ~9.52 tax
      } as InvoiceItemRecord);

      const hsnSummary = await reportEngine.getHsnSummary("2026-09-01", "2026-09-30");

      expect(hsnSummary.length).toBe(2);

      // 1st entry: HSN 3003 @ 5%
      const entry3003 = hsnSummary.find((e) => e.hsn_code === "3003");
      expect(entry3003).toBeDefined();
      expect(entry3003?.gst_rate).toBe(5);
      expect(entry3003?.total_qty).toBe(2);

      // 2nd entry: HSN 3004 @ 12% (Aggregated 10 + 5 = 15 units)
      const entry3004 = hsnSummary.find((e) => e.hsn_code === "3004");
      expect(entry3004).toBeDefined();
      expect(entry3004?.gst_rate).toBe(12);
      expect(entry3004?.total_qty).toBe(15);
      expect(entry3004?.central_tax).toBe(78); // 60 + 18
      expect(entry3004?.state_tax).toBe(78);
      expect(entry3004?.total_value).toBe(1456); // 1120 + 336
    });
  });

  describe("REP-005: Customer Outstanding & Aging Ledger", () => {
    it("computes customer outstanding balances and places into aging buckets (0-30, 31-60, 61+ days)", async () => {
      const asOf = new Date("2026-10-01");

      // Bill 1: 10 days ago (2026-09-21) -> 0-30 days bucket. Grand Total 1000, Paid 0 -> Bal 1000
      await sqliteStorage.insertRecord("invoices", "inv_c1", {
        id: "inv_c1",
        module_key: "invoice",
        invoice_number: "INV-C1",
        invoice_date: "2026-09-21",
        customer_id: "cust_rahul",
        customer_name: "Rahul Verma",
        grand_total: 1000,
        paid_amount: 0,
        payment_mode: "Credit",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      // Bill 2: 45 days ago (2026-08-17) -> 31-60 days bucket. Grand Total 2000, Paid 500 -> Bal 1500
      await sqliteStorage.insertRecord("invoices", "inv_c2", {
        id: "inv_c2",
        module_key: "invoice",
        invoice_number: "INV-C2",
        invoice_date: "2026-08-17",
        customer_id: "cust_rahul",
        customer_name: "Rahul Verma",
        grand_total: 2000,
        paid_amount: 500,
        payment_mode: "Credit",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      // Bill 3: 75 days ago (2026-07-18) -> 61+ days bucket. Grand Total 3000, Paid 0 -> Bal 3000
      await sqliteStorage.insertRecord("invoices", "inv_c3", {
        id: "inv_c3",
        module_key: "invoice",
        invoice_number: "INV-C3",
        invoice_date: "2026-07-18",
        customer_id: "cust_rahul",
        customer_name: "Rahul Verma",
        grand_total: 3000,
        paid_amount: 0,
        payment_mode: "Credit",
        status: "issued",
        created_at: Date.now(),
      } as InvoiceRecord);

      const agingList = await reportEngine.getCustomerOutstandingLedger(asOf);

      expect(agingList.length).toBe(1);
      const cust = agingList[0];
      expect(cust.customer_id).toBe("cust_rahul");
      expect(cust.total_outstanding).toBe(5500); // 1000 + 1500 + 3000
      expect(cust.aging.days_0_to_30).toBe(1000);
      expect(cust.aging.days_31_to_60).toBe(1500);
      expect(cust.aging.days_61_plus).toBe(3000);
      expect(cust.invoice_count).toBe(3);
    });
  });

  describe("REP-006: High-Speed Local Export (CSV)", () => {
    it("escapes special characters, quotes, commas, and builds valid RFC4180 CSV", () => {
      const headers = ["Invoice No", "Customer Name", "Grand Total", "Notes"];
      const rows = [
        ["INV-001", "Acme, Inc.", 1500.5, "Discount applied\nSpecial promo"],
        ["INV-002", 'John "The Doc" Doe', 800, null],
      ];

      const csv = reportEngine.exportToCsv(headers, rows);

      expect(csv).toContain('"Invoice No","Customer Name","Grand Total","Notes"');
      expect(csv).toContain('"Acme, Inc."'); // escaped comma
      expect(csv).toContain('"John ""The Doc"" Doe"'); // escaped quotes
      expect(csv).toContain('"Discount applied\nSpecial promo"'); // escaped newline
      expect(csv).toContain('""'); // null value
    });
  });
});
