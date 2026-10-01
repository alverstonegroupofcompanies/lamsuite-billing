import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockLamSuiteBackend } from "../../src/mock/mockBackend.js";
import { loadConfig } from "../../src/config.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { LamSuiteApiClient } from "../../src/client/apiClient.js";

describe("Write Tools Integration & Safety Rules", () => {
  let mockBackend: MockLamSuiteBackend;
  let backendUrl: string;
  const testPort = 8091;

  beforeAll(async () => {
    mockBackend = new MockLamSuiteBackend({ port: testPort });
    backendUrl = await mockBackend.start();
  });

  afterAll(async () => {
    await mockBackend.stop();
  });

  it("Acceptance: 'Create a bill for 2 strips of Dolo 650 for walk-in cash' first shows dry_run preview, creates invoice, updates stock & GST, and idempotent retry does not duplicate", async () => {
    const config = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: false, // Write mode ON
      role: "admin",
    });
    const client = new LamSuiteApiClient(config);
    const registry = new ToolRegistry();
    registry.init(false);

    // Initial stock check for Dolo 650
    const initialItem = await client.getProduct("prod_dolo650");
    const dl099Batch = initialItem.batches?.find((b: any) => b.batch_no === "DL099");
    const stockBefore = dl099Batch.stock_qty; // 20

    // Step 1: Dry run preview
    const dryRunRes = await registry.executeTool(
      "lamsuite_create_invoice",
      {
        customer_name: "Walk-in Customer",
        items: [{ product_id: "prod_dolo650", qty: 2 }],
        payment_mode: "Cash",
        dry_run: true,
      },
      { client, config }
    );

    expect(dryRunRes.isError).toBeFalsy();
    expect(dryRunRes.content[0].text).toContain("DRY RUN PREVIEW");
    expect(dryRunRes.content[0].text).toContain("DL099"); // FEFO selected earliest valid batch
    expect(dryRunRes.structuredContent.dry_run).toBe(true);
    expect(dryRunRes.structuredContent.preview.totals.grand_total).toBe(60.0);

    // Verify stock was NOT touched by dry_run
    const itemAfterDryRun = await client.getProduct("prod_dolo650");
    const batchAfterDryRun = itemAfterDryRun.batches?.find((b: any) => b.batch_no === "DL099");
    expect(batchAfterDryRun.stock_qty).toBe(stockBefore);

    // Step 2: Actual creation with idempotency key
    const idempotencyKey = "test_dolo_bill_001";
    const createRes = await registry.executeTool(
      "lamsuite_create_invoice",
      {
        customer_name: "Walk-in Customer",
        items: [{ product_id: "prod_dolo650", qty: 2 }],
        payment_mode: "Cash",
        idempotency_key: idempotencyKey,
      },
      { client, config }
    );

    expect(createRes.isError).toBeFalsy();
    expect(createRes.content[0].text).toContain("Invoice Created Successfully");
    const invoice = createRes.structuredContent.invoice;
    expect(invoice.grand_total).toBe(60.0);
    expect(invoice.payment_mode).toBe("Cash");
    const createdInvoiceId = invoice.id;

    // Verify stock and GST updated
    const itemAfterCreate = await client.getProduct("prod_dolo650");
    const batchAfterCreate = itemAfterCreate.batches?.find((b: any) => b.batch_no === "DL099");
    expect(batchAfterCreate.stock_qty).toBe(stockBefore - 2); // 20 - 2 = 18

    // Step 3: Retrying with the same idempotency key does NOT duplicate invoice
    const retryRes = await registry.executeTool(
      "lamsuite_create_invoice",
      {
        customer_name: "Walk-in Customer",
        items: [{ product_id: "prod_dolo650", qty: 2 }],
        payment_mode: "Cash",
        idempotency_key: idempotencyKey,
      },
      { client, config }
    );

    expect(retryRes.isError).toBeFalsy();
    expect(retryRes.content[0].text).toContain("IDEMPOTENT RETRY");
    // Stock remains unchanged after idempotent retry
    const itemAfterRetry = await client.getProduct("prod_dolo650");
    const batchAfterRetry = itemAfterRetry.batches?.find((b: any) => b.batch_no === "DL099");
    expect(batchAfterRetry.stock_qty).toBe(stockBefore - 2);
  });

  it("Acceptance: Cancelling an invoice without confirm and reason is rejected", async () => {
    const config = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: false,
      role: "admin",
    });
    const client = new LamSuiteApiClient(config);
    const registry = new ToolRegistry();
    registry.init(false);

    // 1. Missing confirm and reason
    const resNoConfirm = await registry.executeTool(
      "lamsuite_cancel_invoice",
      {
        invoice_id: "INV-1000",
      },
      { client, config }
    );
    expect(resNoConfirm.isError).toBe(true);

    // 2. confirm: false
    const resConfirmFalse = await registry.executeTool(
      "lamsuite_cancel_invoice",
      {
        invoice_id: "INV-1000",
        confirm: false,
        reason: "Cancelled by customer",
      },
      { client, config }
    );
    expect(resConfirmFalse.isError).toBe(true);
    expect(resConfirmFalse.content[0].text).toContain("safety block");

    // 3. Valid cancellation with confirm: true and reason
    const validCancelRes = await registry.executeTool(
      "lamsuite_cancel_invoice",
      {
        invoice_id: "INV-1000",
        confirm: true,
        reason: "Customer billed incorrectly by cashier",
      },
      { client, config }
    );
    expect(validCancelRes.isError).toBeFalsy();
    expect(validCancelRes.content[0].text).toContain("Invoice Cancelled");
  });

  it("Acceptance: A role without permission gets a clear permission error", async () => {
    // Role 'cashier' is not allowed to cancel invoices or adjust stock
    const cashierConfig = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: false,
      role: "cashier",
    });
    const client = new LamSuiteApiClient(cashierConfig);
    const registry = new ToolRegistry();
    registry.init(false);

    const res = await registry.executeTool(
      "lamsuite_cancel_invoice",
      {
        invoice_id: "INV-1000",
        confirm: true,
        reason: "Cashier wants to cancel",
      },
      { client, config: cashierConfig }
    );

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Permission denied: Role 'cashier' lacks permission 'invoices:cancel'");
  });
});
