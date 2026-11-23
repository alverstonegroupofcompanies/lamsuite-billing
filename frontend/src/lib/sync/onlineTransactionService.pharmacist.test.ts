import { beforeEach, describe, expect, it, vi } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { onlineTransactionService, type OnlineInvoicePayload } from "./onlineTransactionService";
import { counterSequenceService } from "../auth/counterSequenceService";

/**
 * GAP-02 / PHR-006 — what the till does with a pharmacist's PIN.
 *
 * The credential belongs to the moment of the save: it goes to the server once,
 * and nothing the till keeps on disk may hold it. An offline bill therefore
 * queues who was named and lets the server re-check the credential when the
 * document lands — the same answer a live save gives.
 */

const PIN = "582913";

const payload = (overrides: Partial<OnlineInvoicePayload> = {}): OnlineInvoicePayload => ({
  external_id: "ext_phx_1",
  idempotency_key: "ext_phx_1",
  counter_code: "C01",
  customer_name: "Walk-in Customer",
  payment_mode: "Cash",
  pharmacist_id: "11",
  pharmacist_pin: PIN,
  items: [{ product_id: "prod_alp", batch_id: "batch_alp", batch_no: "BCH-ALP", qty: 1, unit_price: 100 }],
  ...overrides,
});

async function queuedDocuments(): Promise<string> {
  const wal = await sqliteStorage.findAll<any>("offline_durable_queue");
  const queue = await sqliteStorage.findAll<any>("sync_queue");
  const invoices = await sqliteStorage.findAll<any>("invoices");

  return JSON.stringify({ wal, queue, invoices });
}

describe("onlineTransactionService pharmacist credential", () => {
  beforeEach(async () => {
    (sqliteStorage as any).reset?.();
    for (const table of ["sync_queue", "offline_durable_queue", "invoices", "invoice_items", "stock_transactions"]) {
      await sqliteStorage.clearTable(table);
    }

    onlineTransactionService.setBaseUrl("http://localhost:8000");
    (onlineTransactionService as any).connectionState = "online";

    await sqliteStorage.insertRecord("products", "prod_alp", {
      id: "prod_alp",
      name: "Alprazolam 0.25 Strip",
      schedule_code: "H1",
      current_stock: 10,
      units_per_pack: 1,
      mrp: 200,
      sel_rate: 100,
    });
    await sqliteStorage.insertRecord("product_batches", "batch_alp", {
      id: "batch_alp",
      product_id: "prod_alp",
      batch_no: "BCH-ALP",
      expiry_date: "2028-12-31",
      stock_qty: 10,
      mrp: 200,
      selling_rate: 100,
    });
  });

  it("sends the PIN once, to the server, on the live save", async () => {
    const seen: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, opts: any) => {
        seen.push({ url, body: JSON.parse(opts.body) });
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              success: true,
              invoice: { id: 901, invoice_number: "C01-INV-1001", external_id: "ext_phx_1", grand_total: 100 },
            }),
        });
      })
    );

    const res = await onlineTransactionService.submitAuthoritativeInvoice(payload());

    expect(res.success).toBe(true);
    const sent = seen.find((call) => call.url.includes("/api/invoices"))?.body;
    expect(sent?.pharmacist_id).toBe("11");
    expect(sent?.pharmacist_pin).toBe(PIN);
  });

  it("keeps the structured refusal so the till can ask a pharmacist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () =>
          Promise.resolve({
            code: "PHARMACIST_CONFIRMATION_REQUIRED",
            message: "A restricted drug is on this bill.",
            rule: "PHR-004",
            line: 1,
            field: "pharmacist_id",
            fix: "Ask the pharmacist on duty to enter their PIN.",
            actions: ["pos.pharmacist_confirmation"],
            restricted_items: [
              { line: 1, product_id: 41, product_name: "Alprazolam 0.25 Strip", batch_no: "BCH-ALP", schedule_code: "H1", qty: 1 },
            ],
          }),
      })
    );

    const res = await onlineTransactionService.submitAuthoritativeInvoice(payload());

    expect(res.success).toBe(false);
    expect(res.businessRule?.code).toBe("PHARMACIST_CONFIRMATION_REQUIRED");
    expect(res.businessRule?.restricted_items?.[0]?.product_name).toBe("Alprazolam 0.25 Strip");
    // A refused bill is not queued twice: nothing was written while it waited.
    expect(await queuedDocuments()).not.toContain("ext_phx_1");
  });

  it("queues an offline bill with the pharmacist named and the PIN nowhere", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));

    await sqliteStorage.insertRecord("salespeople", "11", {
      id: "11",
      store_id: "1",
      name: "Dr. Firoza Ali",
      code: "SP-01",
      reg_no: "KPK-2019-45512",
      is_pharmacist: true,
      is_active: true,
    });

    const fy = counterSequenceService.getCurrentFinancialYear();
    await sqliteStorage.insertRecord("counter_sequences", `C01_invoice_${fy}`, {
      id: `C01_invoice_${fy}`,
      counter_id: "C01",
      doc_type: "invoice",
      financial_year: fy,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1100,
      next_number: 1001,
    });

    const res = await onlineTransactionService.submitAuthoritativeInvoice(payload());

    expect(res.isOfflineQueued).toBe(true);

    const stored = await queuedDocuments();
    expect(stored).not.toContain(PIN);
    expect(stored).toContain("pharmacist_id");

    const wal = await sqliteStorage.findById<any>("offline_durable_queue", "ext_phx_1");
    expect(JSON.parse(wal.payload_json).pharmacist_id).toBe("11");
    expect(JSON.parse(wal.payload_json)).not.toHaveProperty("pharmacist_pin");

    // The register the store reads while it is still offline names the person.
    const local = (await sqliteStorage.findAll<any>("invoices")).find(
      (row) => row.is_offline === true
    );
    expect(local?.pharmacist_id).toBe("11");
    expect(local?.pharmacist_name).toBe("Dr. Firoza Ali");
    expect(local?.pharmacist_reg_no).toBe("KPK-2019-45512");
  });
});
