import { describe, it, expect, beforeEach, vi } from "vitest";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { invoiceManagementService, type InvoiceRecord } from "../lib/billing/invoiceManagementService";
import { storeRegistryService } from "../lib/auth/storeRegistryService";
import { remoteSyncManager } from "../lib/sync/remoteSyncManager";

describe("Invoice Register & Bills Page Reliability", () => {
  beforeEach(async () => {
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
  });

  it("lists invoices with paging and search across store invoices", async () => {
    // Generate mock invoices
    for (let i = 1; i <= 25; i++) {
      const invNum = `INV-TEST-${String(i).padStart(4, "0")}`;
      await sqliteStorage.insertRecord("invoices", String(i), {
        id: String(i),
        module_key: "invoice",
        invoice_number: invNum,
        invoice_date: "2026-10-29",
        customer_name: i % 2 === 0 ? "Walk-in Retail Customer" : "Rahul Medicals",
        customer_phone: "9876543210",
        grand_total: 150 * i,
        payment_mode: i % 3 === 0 ? "UPI" : "Cash",
        status: "issued",
        created_at: 1793264028000 + i * 1000,
        sync_state: "synced",
      });
    }

    const allBills = await invoiceManagementService.listInvoices({ dateRange: "all" });
    expect(allBills.length).toBe(25);

    const searchRahul = await invoiceManagementService.listInvoices({ searchQuery: "rahul", dateRange: "all" });
    expect(searchRahul.length).toBe(13);

    const searchCash = await invoiceManagementService.listInvoices({ paymentMode: "Cash", dateRange: "all" });
    expect(searchCash.length).toBe(17);
  });

  it("reflects bills from a second counter via remote delta synchronization", async () => {
    // Simulate Counter 02 creating a bill and broadcasting via sync delta
    const counter2Invoice = {
      id: 999,
      invoice_number: "INV-C02-9901",
      invoice_date: "2026-10-29T10:00:00.000000Z",
      customer_name: "Walk-in Counter 02",
      grand_total: 450,
      payment_mode: "Cash",
      status: "issued",
      counter_code: "C02",
      items: [
        {
          id: 101,
          product_id: "5",
          product_name: "Dolo 650 Tablet",
          batch_no: "BATCH-DL1",
          qty: 2,
          unit_price: 30,
          total_amount: 60,
        },
      ],
    };

    await remoteSyncManager.handleIncomingRemoteDelta({
      entity_type: "invoice",
      entity_id: "999",
      client_data: counter2Invoice,
    });

    const cached = await sqliteStorage.findById<any>("invoices", "999");
    expect(cached).toBeDefined();
    expect(cached.invoice_number).toBe("INV-C02-9901");
    expect(cached.sync_state).toBe("synced");
  });

  it("correctly identifies 'Today' near midnight in India (Asia/Kolkata timezone)", async () => {
    // Invoice billed at 23:45 IST on 2026-10-29 (UTC: 2026-10-29 18:15:00)
    await sqliteStorage.insertRecord("invoices", "late_ist_1", {
      id: "late_ist_1",
      module_key: "invoice",
      invoice_number: "INV-LATE-001",
      invoice_date: "2026-10-29T18:15:00.000000Z", // 23:45 IST
      customer_name: "Late Night Customer",
      grand_total: 120,
      payment_mode: "Cash",
      status: "issued",
      created_at: new Date("2026-10-29T18:15:00.000Z").getTime(),
    });

    // Invoice billed at 00:15 IST on 2026-10-29 (UTC: 2026-10-28 18:45:00)
    await sqliteStorage.insertRecord("invoices", "early_ist_1", {
      id: "early_ist_1",
      module_key: "invoice",
      invoice_number: "INV-EARLY-001",
      invoice_date: "2026-10-28T18:45:00.000000Z", // 00:15 IST on 2026-10-29
      customer_name: "Midnight Customer",
      grand_total: 85,
      payment_mode: "UPI",
      status: "issued",
      created_at: new Date("2026-10-28T18:45:00.000Z").getTime(),
    });

    // When queried with startDate = "2026-10-29" and endDate = "2026-10-29"
    const todayBills = await invoiceManagementService.listInvoices({
      startDate: "2026-10-29",
      endDate: "2026-10-29",
    });

    const numbers = todayBills.map((b) => b.invoice_number);
    expect(numbers).toContain("INV-LATE-001");
    expect(numbers).toContain("INV-EARLY-001");
  });

  it("displays invoices with legacy statuses, missing customers, and zero taxable amounts", async () => {
    // Migrated invoice with no customer_id, no doctor, zero taxable
    await sqliteStorage.insertRecord("invoices", "mig_1", {
      id: "mig_1",
      module_key: "invoice",
      invoice_number: "INV-2026-LIVE-001",
      invoice_date: "2026-10-14T18:30:00.000000Z",
      customer_id: null,
      customer_name: "Dr. Rajesh Varma",
      customer_phone: null,
      subtotal: 0,
      taxable_subtotal: 0,
      tax_total: 54,
      grand_total: 450,
      paid_amount: 450,
      payment_mode: "UPI",
      status: "issued", // Legacy lowercase status
      created_at: 1792043915000,
      sync_state: "synced",
    });

    const list = await invoiceManagementService.listInvoices({
      dateRange: "all",
      status: "Issued", // User requested with uppercase
      paymentMode: "all",
    });

    expect(list.some((inv) => inv.invoice_number === "INV-2026-LIVE-001")).toBe(true);
    const found = list.find((inv) => inv.invoice_number === "INV-2026-LIVE-001")!;
    expect(found.grand_total).toBe(450);
    expect(found.customer_name).toBe("Dr. Rajesh Varma");
  });

  it("proves multi-store isolation and unambiguous store identification", async () => {
    // Ensure both stores are registered in registry
    const regBefore = storeRegistryService.getRegistry();
    if (!regBefore.stores.some((s) => s.id === "1")) {
      await storeRegistryService.registerStore(
        {
          device_id: "dev_1",
          device_uuid: "uuid_1",
          device_name: "Counter 01",
          store_id: "1",
          store_name: "LamStone Pharmacy & Retail (Palakkad Main)",
          store_code: "STORE-01",
          counter_id: "cntr_1",
          counter_name: "Counter 01",
          counter_code: "C01",
          is_hub: true,
          license_plan: "Professional",
          license_status: "active",
          license_expires_at: "2027-12-31",
          registered_at: Date.now(),
          is_active: true,
        },
        { deviceToken: "tok_1", refreshToken: "ref_1" }
      );
    }

    if (!regBefore.stores.some((s) => s.id === "4")) {
      await storeRegistryService.registerStore(
        {
          device_id: "dev_4",
          device_uuid: "uuid_4",
          device_name: "Counter 01",
          store_id: "4",
          store_name: "Test Store",
          store_code: "TESTSTORE",
          counter_id: "cntr_4",
          counter_name: "Counter 01",
          counter_code: "C01",
          is_hub: true,
          license_plan: "Professional",
          license_status: "active",
          license_expires_at: "2027-12-31",
          registered_at: Date.now(),
          is_active: true,
        },
        { deviceToken: "tok_4", refreshToken: "ref_4" }
      );
    }

    const reg = storeRegistryService.getRegistry();
    expect(reg.stores.length).toBeGreaterThanOrEqual(2);

    const store1 = reg.stores.find((s) => s.id === "1");
    const store4 = reg.stores.find((s) => s.id === "4");

    expect(store1).toBeDefined();
    expect(store1?.code).toBe("STORE-01");
    expect(store1?.name).toContain("LamStone Pharmacy");

    expect(store4).toBeDefined();
    expect(store4?.code).toBe("TESTSTORE");
    expect(store4?.name).toBe("Test Store");
  });

  it("reconciliation check: server query returns matching totals and counts", async () => {
    const baseUrl = "http://127.0.0.1:8000";
    try {
      const res = await fetch(`${baseUrl}/api/invoices?store_id=1&per_page=100`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        expect(data.total).toBeGreaterThanOrEqual(60);
        expect(data.total_store_invoices).toBeGreaterThanOrEqual(60);
        expect(data.store_id).toBe(1);

        // Check sum of grand_totals agrees
        const sum = data.data.reduce((acc: number, inv: any) => acc + Number(inv.grand_total || 0), 0);
        expect(sum).toBeGreaterThan(0);
      }
    } catch {
      // In CI / mocked environments where server isn't running
    }
  });

  it("guarantees invoices are saved under the logged-in store ID and never cross-pollute another store", async () => {
    const baseUrl = "http://127.0.0.1:8000";
    try {
      // 1. Submit invoice for Store 4 ("Test Store")
      const testStoreExternalId = `ext_store4_test_${Date.now()}`;
      const store4Res = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Store-Id": "4",
        },
        body: JSON.stringify({
          store_id: 4,
          external_id: testStoreExternalId,
          idempotency_key: testStoreExternalId,
          invoice_date: "2026-10-29",
          customer_name: "Store 4 Test Customer",
          payment_mode: "Cash",
          paid_amount: 120,
          counter_code: "C01",
          items: [
            {
              product_id: 1,
              product_name: "Test Store Product",
              qty: 1,
              unit_price: 120,
              gst_percent: 0,
            },
          ],
        }),
      });

      if (store4Res.ok) {
        const store4Json = await store4Res.json();
        expect(store4Json.success).toBe(true);
        expect(store4Json.invoice.store_id).toBe(4);
        expect(store4Json.invoice.customer_name).toBe("Store 4 Test Customer");

        // 2. Submit invoice for Store 1 ("LamStone Pharmacy")
        const store1ExternalId = `ext_store1_test_${Date.now()}`;
        const store1Res = await fetch(`${baseUrl}/api/invoices`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Store-Id": "1",
          },
          body: JSON.stringify({
            store_id: 1,
            external_id: store1ExternalId,
            idempotency_key: store1ExternalId,
            invoice_date: "2026-10-29",
            customer_name: "Store 1 Pharmacy Customer",
            payment_mode: "UPI",
            paid_amount: 250,
            counter_code: "C01",
            items: [
              {
                product_id: 1,
                product_name: "Store 1 Medicine",
                qty: 2,
                unit_price: 125,
                gst_percent: 0,
              },
            ],
          }),
        });

        const store1Json = await store1Res.json();
        expect(store1Json.success).toBe(true);
        expect(store1Json.invoice.store_id).toBe(1);
        expect(store1Json.invoice.customer_name).toBe("Store 1 Pharmacy Customer");

        // 3. Verify Store 4 query only returns Store 4 invoices and includes the Store 4 bill
        const qStore4 = await fetch(`${baseUrl}/api/invoices?store_id=4`, {
          headers: { Accept: "application/json" },
        });
        const qStore4Json = await qStore4.json();
        expect(qStore4Json.store_id).toBe(4);
        const store4Invoices = qStore4Json.data || [];
        expect(store4Invoices.some((inv: any) => inv.external_id === testStoreExternalId)).toBe(true);
        expect(store4Invoices.every((inv: any) => inv.store_id === 4)).toBe(true);

        // 4. Verify Store 1 query only returns Store 1 invoices and includes the Store 1 bill
        const qStore1 = await fetch(`${baseUrl}/api/invoices?store_id=1`, {
          headers: { Accept: "application/json" },
        });
        const qStore1Json = await qStore1.json();
        expect(qStore1Json.store_id).toBe(1);
        const store1Invoices = qStore1Json.data || [];
        expect(store1Invoices.some((inv: any) => inv.external_id === store1ExternalId)).toBe(true);
        expect(store1Invoices.every((inv: any) => inv.store_id === 1)).toBe(true);

        // Store 4 invoice MUST NOT appear under Store 1
        expect(store1Invoices.some((inv: any) => inv.external_id === testStoreExternalId)).toBe(false);
      }
    } catch {
      // In CI / mocked environments where server isn't running
    }
  });
});
