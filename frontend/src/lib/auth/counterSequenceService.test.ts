import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  counterSequenceService,
  DOC_TAILS,
  canonicalDocType,
  type DocType,
  type SequenceManifest,
} from "./counterSequenceService";
import { sqliteStorage, getMockDatabase } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";
import { companySettingsService } from "../settings/companySettingsService";

/**
 * CNT-014: the counter owns its number series. The till speaks the server's
 * doc-type names, keys its local series by the server counter id, numbers an
 * offline document only inside a leased block, and accepts whatever number the
 * server hands back when it worked in the dark.
 */

const FY = "2026-27";

function manifest(
  counterId: number,
  counterCode: string,
  nextNumbers: Partial<Record<DocType, number>> = {}
): SequenceManifest {
  return {
    counter_id: counterId,
    counter_code: counterCode,
    financial_year: FY,
    doc_types: Object.keys(DOC_TAILS),
    items: Object.entries(DOC_TAILS).map(([docType, tail]) => ({
      counter_id: counterId,
      doc_type: docType,
      financial_year: FY,
      prefix: `${counterCode}-${tail}`,
      next_number: nextNumbers[docType as DocType] ?? 1001,
      range_start: null,
      range_end: null,
    })),
  };
}

describe("Counter-owned document series (CNT-014)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    counterSequenceService.clearActiveCounter();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("speaks the server's doc-type names, including the names older tills used", () => {
    expect(counterSequenceService.docTypes).toEqual([
      "invoice",
      "sales_return",
      "quotation",
      "purchase_bill",
      "receipt",
      "stock_adjustment",
      "stock_transfer",
    ]);

    expect(canonicalDocType("return")).toBe("sales_return");
    expect(canonicalDocType("credit_note")).toBe("sales_return");
    expect(canonicalDocType("purchase")).toBe("purchase_bill");
    expect(canonicalDocType("adjustment")).toBe("stock_adjustment");
    expect(canonicalDocType("transfer")).toBe("stock_transfer");
    expect(canonicalDocType("SALES-RETURN")).toBe("sales_return");
    expect(canonicalDocType("voucher")).toBeNull();
  });

  it("boots from the claim manifest and keys every series by the server counter id", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));

    const rows = await sqliteStorage.findAll<any>("counter_sequences");
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [
        "12_invoice_2026-27",
        "12_purchase_bill_2026-27",
        "12_quotation_2026-27",
        "12_receipt_2026-27",
        "12_sales_return_2026-27",
        "12_stock_adjustment_2026-27",
        "12_stock_transfer_2026-27",
      ].sort()
    );

    const invoice = await counterSequenceService.getSequence(12, "invoice", FY);
    expect(invoice?.prefix).toBe("C01-INV");
    expect(invoice?.next_number).toBe(1001);
  });

  it("numbers from the counter's own series and stops at the end of a leased block", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));

    expect(counterSequenceService.previewNext(12, "invoice", FY)).toBe("C01-INV-1001");
    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY)).toBe("C01-INV-1001");

    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      counter_code: "C01",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1002,
      block_size: 2,
      next_number: 1002,
    });

    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY)).toBe("C01-INV-1002");
    await expect(counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY)).rejects.toThrow(/lease/i);

    // Offline billing only takes numbers the server reserved. A series with no
    // block left hands out nothing, so the till marks the bill temporary and
    // the counter numbers it when the push lands.
    await expect(counterSequenceService.takeLeasedNumber(12, "C01", "invoice", FY)).rejects.toThrow(/lease/i);

    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      counter_code: "C01",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 1003,
      range_end: 1004,
      block_size: 2,
      next_number: 1003,
    });
    expect(await counterSequenceService.takeLeasedNumber(12, "C01", "invoice", FY)).toBe("C01-INV-1003");
  });

  it("refuses to number offline outside a leased block", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));

    // Nothing leased yet: the till has no reserved number to spend.
    await expect(counterSequenceService.takeLeasedNumber(12, "C01", "invoice", FY)).rejects.toThrow(/leased .* block/i);
    expect(await counterSequenceService.leaseStatus(12, "invoice", FY)).toEqual({ remaining: 0, isLow: true });
  });

  it("leases from the counter series route by counter id, not by a counter code in the url", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        counter_id: 12,
        counter_code: "C01",
        doc_type: "sales_return",
        financial_year: FY,
        prefix: "C01-SR",
        range_start: 2001,
        range_end: 2050,
        block_size: 50,
        next_number: 2001,
      }),
    } as unknown as Response);

    const leased = await counterSequenceService.lease(12, "return", 50, {
      baseUrl: "https://store.internal",
      token: "lsd_device_token_12",
      storeId: "7",
    });

    expect(leased.doc_type).toBe("sales_return");
    expect(leased.range_end).toBe(2050);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://store.internal/api/counter/sequences/lease");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Device-Token"]).toBe("lsd_device_token_12");
    expect(JSON.parse(String(init.body))).toEqual({ doc_type: "sales_return", block_size: 50 });

    const row = await counterSequenceService.getSequence(12, "sales_return", FY);
    expect(row?.range_start).toBe(2001);
    expect(row?.range_end).toBe(2050);
    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "sales_return", FY)).toBe("C01-SR-2001");
  });

  it("reports what it spent on the next lease, so a heartbeat cannot burn a fresh block", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));
    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      counter_code: "C01",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 5001,
      range_end: 5050,
      block_size: 50,
      next_number: 5001,
    });

    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);
    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);
    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);

    // The server answers with the same open block, its cursor where the till left it.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        counter_id: 12,
        counter_code: "C01",
        doc_type: "invoice",
        financial_year: FY,
        prefix: "C01-INV",
        range_start: 5001,
        range_end: 5050,
        block_size: 50,
        next_number: 5004,
      }),
    } as unknown as Response);

    await counterSequenceService.lease(12, "invoice", 50, { baseUrl: "https://store.internal" });

    const init = (vi.mocked(fetch).mock.calls[0] as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      doc_type: "invoice",
      block_size: 50,
      used_through: 5003,
    });

    expect(await counterSequenceService.leaseStatus(12, "invoice", FY)).toEqual({
      remaining: 47,
      isLow: false,
    });
  });

  it("never rewinds its cursor to a count the server has not caught up with", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));
    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      counter_code: "C01",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1050,
      block_size: 50,
      next_number: 1001,
    });

    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);
    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);
    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);

    // The store's book has not heard about bills numbered offline yet.
    await counterSequenceService.primeFromManifest(manifest(12, "C01", { invoice: 1001 }));

    const row = await counterSequenceService.getSequence(12, "invoice", FY);
    expect(row?.next_number).toBe(1004);
    expect(row?.range_end).toBe(1050);
    expect(counterSequenceService.previewForActive("invoice")).toBe("C01-INV-1004");

    // Nor does a lease answer carrying an older cursor pull the till back.
    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      counter_code: "C01",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1050,
      block_size: 50,
      next_number: 1001,
    });
    expect((await counterSequenceService.getSequence(12, "invoice", FY))?.next_number).toBe(1004);
  });

  it("reads the counter's series off the store server when the till holds none", async () => {    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, ...manifest(12, "C01", { invoice: 1050 }) }),
    } as unknown as Response);

    const pulled = await counterSequenceService.pull({
      baseUrl: "https://store.internal",
      token: "lsd_device_token_12",
      storeId: "7",
    });

    expect(pulled?.counter_id).toBe(12);
    expect(pulled?.items).toHaveLength(7);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://store.internal/api/counter/sequences");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["X-Device-Token"]).toBe("lsd_device_token_12");

    // A till that lost its own numbers does not invent them: it boots onto the server's count.
    expect(counterSequenceService.previewForActive("invoice")).toBe("C01-INV-1050");
  });

  it("throws and touches nothing when the server will not answer", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(counterSequenceService.pull({ baseUrl: "https://store.internal", token: "t" })).rejects.toThrow();
    expect(counterSequenceService.getActiveCounter()).toBeNull();
  });

  it("treats an unleased series as low so a reconnecting till leases before it bills", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));

    expect(await counterSequenceService.leaseStatus(12, "invoice", FY)).toEqual({
      remaining: 0,
      isLow: true,
    });

    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      counter_code: "C01",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1010,
      block_size: 10,
      next_number: 1001,
    });
    expect(await counterSequenceService.leaseStatus(12, "invoice", FY)).toEqual({
      remaining: 10,
      isLow: false,
    });

    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);
    await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY);
    expect(await counterSequenceService.leaseStatus(12, "invoice", FY)).toEqual({
      remaining: 8,
      isLow: true,
    });
  });

  it("numbers two counters of one store from series that never meet", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));
    await counterSequenceService.primeFromManifest(manifest(13, "C02"));

    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      counter_code: "C01",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 1001,
      range_end: 1002,
      block_size: 2,
      next_number: 1001,
    });
    await counterSequenceService.saveLeasedBlock({
      counter_id: 13,
      counter_code: "C02",
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C02-INV",
      range_start: 1001,
      range_end: 1002,
      block_size: 2,
      next_number: 1001,
    });

    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY)).toBe("C01-INV-1001");
    expect(await counterSequenceService.getNextDocumentNumber(13, "C02", "invoice", FY)).toBe("C02-INV-1001");
    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY)).toBe("C01-INV-1002");
    expect(await counterSequenceService.getNextDocumentNumber(13, "C02", "invoice", FY)).toBe("C02-INV-1002");
  });

  it("numbers the POS from the active counter and steps the settings mirror along", async () => {
    await companySettingsService.saveLocalSettings({
      sequences: { invoicePrefix: "INV", nextInvoiceNumber: 1001 },
    });

    // No counter primed: the till still bills on its store-wide settings series.
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("INV-1001");

    await counterSequenceService.primeFromManifest(manifest(12, "C01"));
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("C01-INV-1001");
    expect(companySettingsService.previewNextDocumentNumber("return")).toBe("C01-SR-1001");
    expect(companySettingsService.previewNextDocumentNumber("purchase")).toBe("C01-PUR-1001");
    expect(companySettingsService.previewNextDocumentNumber("quotation")).toBe("C01-QUO-1001");
    expect(companySettingsService.previewNextDocumentNumber("adjustment")).toBe("C01-ADJ-1001");
    expect(companySettingsService.previewNextDocumentNumber("transfer")).toBe("C01-TRF-1001");

    // The server filed the bill under its own number; the mirror steps over it.
    await companySettingsService.syncNextInvoiceSequence("C01-INV-1001");
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("C01-INV-1002");

    counterSequenceService.clearActiveCounter();
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("INV-1002");
  });
});
