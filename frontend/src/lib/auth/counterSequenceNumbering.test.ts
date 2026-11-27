import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  counterSequenceService,
  DOC_TAILS,
  numberingRuleOf,
  type DocType,
  type SequenceManifest,
} from "./counterSequenceService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";

/**
 * TALLY-01: the server resolves each counter series' rendering rule (its own override, else the
 * store default) and ships it with the series, so a till prints the padded, suffixed number the
 * store's book holds rather than the bare serial it would invent. A series from a server that
 * predates the rule keeps printing exactly as it always did.
 */

const FY = "2026-27";

interface RuleSeed {
  suffix?: string | null;
  serial_width?: number | null;
  pad_zeros?: boolean;
}

function manifest(counterId: number, counterCode: string, rules: Partial<Record<DocType, RuleSeed>> = {}): SequenceManifest {
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
      next_number: 1,
      range_start: null,
      range_end: null,
      ...rules[docType as DocType],
    })),
  };
}

describe("counter series numbering rules (TALLY-01)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    counterSequenceService.clearActiveCounter();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("prints the series with the rule the server resolved", async () => {
    await counterSequenceService.primeFromManifest(
      manifest(12, "C01", {
        sales_return: { suffix: "/26", serial_width: 5, pad_zeros: true },
        invoice: { serial_width: 4, pad_zeros: true },
      })
    );

    expect(counterSequenceService.previewForActive("sales_return")).toBe("C01-SR-00001/26");
    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "sales_return", FY)).toBe("C01-SR-00001/26");
    expect(counterSequenceService.previewForActive("sales_return")).toBe("C01-SR-00002/26");
    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "invoice", FY)).toBe("C01-INV-0001");

    const row = await sqliteStorage.findById<any>("counter_sequences", `12_sales_return_${FY}`);
    expect(numberingRuleOf(row)).toEqual({ prefix: "C01-SR", suffix: "/26", width: 5, padZeros: true });
  });

  it("prints a bare serial for a series whose rule the server never sent", async () => {
    await counterSequenceService.primeFromManifest(manifest(12, "C01"));

    expect(counterSequenceService.previewForActive("quotation")).toBe("C01-QUO-1");
    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "quotation", FY)).toBe("C01-QUO-1");
    expect((await counterSequenceService.getSequence(12, "quotation", FY))?.suffix).toBeNull();
  });

  it("never truncates a serial that outgrew its width", async () => {
    await counterSequenceService.primeFromManifest(
      manifest(12, "C01", { receipt: { serial_width: 3, pad_zeros: true } })
    );
    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      doc_type: "receipt",
      financial_year: FY,
      prefix: "C01-REC",
      range_start: 1,
      range_end: 1200,
      next_number: 999,
      serial_width: 3,
      pad_zeros: true,
    });

    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "receipt", FY)).toBe("C01-REC-999");
    expect(await counterSequenceService.getNextDocumentNumber(12, "C01", "receipt", FY)).toBe("C01-REC-1000");
  });

  it("keeps a block's numbers readable and stops at its end", async () => {
    await counterSequenceService.primeFromManifest(
      manifest(12, "C01", { invoice: { suffix: "-27", serial_width: 4, pad_zeros: true } })
    );
    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      doc_type: "invoice",
      financial_year: FY,
      prefix: "C01-INV",
      range_start: 1,
      range_end: 1,
      block_size: 1,
      next_number: 1,
      suffix: "-27",
      serial_width: 4,
      pad_zeros: true,
    });

    expect(await counterSequenceService.takeLeasedNumber(12, "C01", "invoice", FY)).toBe("C01-INV-0001-27");
    expect(await counterSequenceService.leaseStatus(12, "invoice", FY)).toEqual({ remaining: 0, isLow: true });
    await expect(counterSequenceService.takeLeasedNumber(12, "C01", "invoice", FY)).rejects.toThrow(/lease/i);
  });

  it("inherits a block it is told about in plain terms, and keeps the store default the series already had", async () => {
    await counterSequenceService.primeFromManifest(
      manifest(12, "C01", { stock_transfer: { suffix: "/27", serial_width: 5, pad_zeros: true } })
    );

    // The lease answer of a server that has not heard about rules must not wipe the store default.
    await counterSequenceService.saveLeasedBlock({
      counter_id: 12,
      doc_type: "stock_transfer",
      financial_year: FY,
      prefix: "C01-TRF",
      range_start: 1,
      range_end: 50,
      next_number: 5,
    });

    const row = await counterSequenceService.getSequence(12, "stock_transfer", FY);
    expect(row?.next_number).toBe(5);
    expect(row?.suffix).toBe("/27");
    expect(row?.serial_width).toBe(5);
    expect(row?.pad_zeros).toBe(true);
    expect(counterSequenceService.previewForActive("transfer")).toBe("C01-TRF-00005/27");
  });

  it("steps its cursor over a number the counter filed under the rule", async () => {
    await counterSequenceService.primeFromManifest(
      manifest(12, "C01", { sales_return: { suffix: "/26", serial_width: 5, pad_zeros: true } })
    );

    await counterSequenceService.stepOverForActiveCounter("C01-SR-00005/26");
    expect((await counterSequenceService.getSequence(12, "sales_return", FY))?.next_number).toBe(6);
    expect(counterSequenceService.previewForActive("sales_return")).toBe("C01-SR-00006/26");

    // An older bill of the same series, printed before the rule existed, still moves it on.
    await counterSequenceService.stepOverForActiveCounter("C01-SR-9");
    expect((await counterSequenceService.getSequence(12, "sales_return", FY))?.next_number).toBe(10);

    // Another counter's number, or a temporary offline marker, spends nothing here.
    await counterSequenceService.stepOverForActiveCounter("C02-INV-700");
    await counterSequenceService.stepOverForActiveCounter("TEMP-700");
    expect((await counterSequenceService.getSequence(12, "sales_return", FY))?.next_number).toBe(10);
    expect((await counterSequenceService.getSequence(12, "invoice", FY))?.next_number).toBe(1);
  });
});
