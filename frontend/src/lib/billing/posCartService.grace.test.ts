import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { posCartService } from "./posCartService";
import { counterGraceService } from "../auth/counterGraceService";
import { companySettingsService } from "../settings/companySettingsService";
import { productsStore } from "../masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";

/**
 * CNT-011 where the money moves: a counter may keep billing through the grace
 * its owner set and must stop the moment that window closes — from the billing
 * screen or from anything else that reaches the same cart.
 */

const HOUR = 60 * 60 * 1000;

async function seedProduct(): Promise<void> {
  await productsStore.upsertProduct({ id: "prod_grace", name: "Dolo 650", mrp: 50, gst_percent: 5 });
  await productsStore.upsertBatch({
    id: "batch_grace",
    product_id: "prod_grace",
    batch_no: "B1",
    expiry_date: "2028-12-31",
    stock_qty: 100,
    mrp: 50,
    selling_rate: 50,
  });
}

async function arm(counterKey: string, graceHours: number): Promise<void> {
  const serverNow = Date.now();

  await counterGraceService.arm(counterKey, {
    server_time: new Date(serverNow).toISOString(),
    offline: {
      grace_hours: graceHours,
      last_seen_at: new Date(serverNow).toISOString(),
      grace_until: new Date(serverNow + graceHours * HOUR).toISOString(),
    },
  });
  counterGraceService.use(counterKey);
}

async function oneLineCart(): Promise<void> {
  const prod = await productsStore.getProductById("prod_grace");
  const batch = await sqliteStorage.findById<any>("product_batches", "batch_grace");
  posCartService.addItem(prod!, batch!, 1);
}

describe("Billing stops when the counter's grace ran out (CNT-011)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));

    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    posCartService.clearCart();
    await counterGraceService.clear();
    localStorage.clear();
    vi.restoreAllMocks();

    await companySettingsService.saveLocalSettings({
      sequences: { invoicePrefix: "INV", nextInvoiceNumber: 1001 },
    });
    await seedProduct();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bills normally while the window is open", async () => {
    await arm("21", 24);
    await oneLineCart();

    const saved = await posCartService.finalizeInvoice("INV-1001", "Cash");
    expect(saved.invoiceNumber).toBe("INV-1001");
  });

  it("refuses the sale once the window is spent", async () => {
    await arm("22", 24);
    vi.advanceTimersByTime(30 * HOUR);
    await oneLineCart();

    await expect(posCartService.finalizeInvoice("INV-1001", "Cash")).rejects.toThrow(
      /offline longer than the store allows/i
    );
    expect(await sqliteStorage.findAll("invoices")).toEqual([]);
  });

  it("stops a counter with no grace allowance the moment contact drops", async () => {
    await arm("23", 0);
    await oneLineCart();

    await expect(posCartService.finalizeInvoice("INV-1001", "Cash")).rejects.toThrow(/offline/i);
  });

  it("leaves a till the server never measured alone", async () => {
    counterGraceService.use("24");
    await oneLineCart();

    const saved = await posCartService.finalizeInvoice("INV-1001", "Cash");
    expect(saved.invoiceNumber).toBe("INV-1001");
  });
});
