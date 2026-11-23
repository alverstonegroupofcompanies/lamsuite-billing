import { describe, it, expect, beforeEach } from "vitest";
import { posCartService } from "./posCartService";
import { companySettingsService } from "../settings/companySettingsService";
import { productsStore } from "../masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";
import { onlineTransactionService } from "../sync/onlineTransactionService";

/**
 * TAX-02 at the counter: the server refuses a rate above MRP, but a till billing
 * offline never asks it, so the cart has to hold the same ceiling — the batch MRP,
 * the product's when the batch has none, split per piece for a loose rate.
 */

async function seed(batchMrp?: number): Promise<void> {
  await productsStore.upsertProduct({
    id: "prod_mrp",
    name: "QA Paracet 500 Strip",
    mrp: 90,
    sel_rate: 90,
    gst_percent: 12,
    units_per_pack: 15,
  } as any);
  await productsStore.upsertBatch({
    id: "batch_mrp",
    product_id: "prod_mrp",
    batch_no: "PA-NEW",
    expiry_date: "2028-01-31",
    stock_qty: 300,
    mrp: batchMrp,
    selling_rate: 90,
  });
}

async function oneLine(): Promise<string> {
  const prod = await productsStore.getProductById("prod_mrp");
  const batch = await sqliteStorage.findById<any>("product_batches", "batch_mrp");
  posCartService.addItem(prod!, batch!, 1);
  return posCartService.getLines()[0].id;
}

describe("A counter cannot bill above MRP (TAX-02)", () => {
  beforeEach(async () => {
    (onlineTransactionService as any).connectionState = "offline";
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    posCartService.clearCart();
    localStorage.clear();
    await companySettingsService.saveLocalSettings({
      sequences: { invoicePrefix: "INV", nextInvoiceNumber: 1001 },
      enforce_mrp_capping: undefined,
    } as any);
  });

  it("refuses Rs 150 on a strip whose batch MRP is Rs 90, even offline", async () => {
    await seed(90);
    const lineId = await oneLine();
    posCartService.updateLinePrice(lineId, 150);

    await expect(posCartService.finalizeInvoice("INV-1001", "Cash")).rejects.toThrow(/MRP/);
    const invoices = await sqliteStorage.findAll<any>("invoices");
    expect(invoices.length).toBe(0);
  });

  it("measures against the product MRP when the batch carries none", async () => {
    await seed(undefined);
    const lineId = await oneLine();
    posCartService.updateLinePrice(lineId, 95);

    await expect(posCartService.finalizeInvoice("INV-1001", "Cash")).rejects.toThrow(/MRP/);
  });

  it("caps a loose rate at the pack MRP split over the pack", async () => {
    await seed(90);
    const lineId = await oneLine();
    posCartService.updateLinePrice(lineId, 6.5, "loose_rate");

    await expect(posCartService.finalizeInvoice("INV-1001", "Cash")).rejects.toThrow(/MRP/);
  });

  it("bills a rate equal to the MRP", async () => {
    await seed(90);
    const lineId = await oneLine();
    posCartService.updateLinePrice(lineId, 90);

    const saved = await posCartService.finalizeInvoice("INV-1001", "Cash");
    expect(saved.success).toBe(true);
  });

  it("lets a store that switched the ceiling off bill above MRP", async () => {
    await companySettingsService.updateLocalFromRemote({ billing: { enforce_mrp_capping: false } });
    expect(companySettingsService.getSettings().enforce_mrp_capping).toBe(false);

    await seed(90);
    const lineId = await oneLine();
    posCartService.updateLinePrice(lineId, 150);

    const saved = await posCartService.finalizeInvoice("INV-1001", "Cash");
    expect(saved.success).toBe(true);
  });
});
