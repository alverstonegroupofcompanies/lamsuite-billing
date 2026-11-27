import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SERIES,
  formatDocumentNumber,
  formatSerial,
  mergeNumberingRules,
  minWidthForSerial,
  nextSerialAfter,
  numberingFor,
  parseSerialNumber,
  readSeries,
} from "./documentNumberFormat";

/**
 * TALLY-01: a series prints prefix + serial + suffix, where the serial is the number zero-filled to
 * the configured width. The width is a minimum — a number that has grown past it keeps every digit,
 * because shortening it would hand out a serial the book already holds.
 */
describe("document number formatting (TALLY-01)", () => {
  it("leaves the serial alone when no rule is set", () => {
    expect(formatSerial(1001, {})).toBe("1001");
    expect(formatDocumentNumber({ prefix: "INV" }, 1001)).toBe("INV-1001");
    expect(formatDocumentNumber({}, 1001)).toBe("1001");
  });

  it("zero-fills only when padding is on", () => {
    expect(formatSerial(7, { width: 5 })).toBe("7");
    expect(formatSerial(7, { width: 5, padZeros: true })).toBe("00007");
    expect(formatDocumentNumber({ prefix: "SR", width: 5, padZeros: true }, 7)).toBe("SR-00007");
  });

  it("treats the width as a minimum, so 9999 rolls into 10000", () => {
    expect(formatSerial(9999, { width: 4, padZeros: true })).toBe("9999");
    expect(formatSerial(10000, { width: 4, padZeros: true })).toBe("10000");
    expect(formatSerial(123456, { width: 3, padZeros: true })).toBe("123456");
    expect(formatDocumentNumber({ prefix: "INV", width: 4, padZeros: true }, 10000)).toBe("INV-10000");
  });

  it("rides a nullable suffix on the end of the serial", () => {
    expect(formatSerial(1, { width: 5, padZeros: true, suffix: "/26" })).toBe("00001/26");
    expect(formatDocumentNumber({ prefix: "SR", width: 5, padZeros: true, suffix: "/26" }, 1)).toBe("SR-00001/26");
    expect(formatSerial(1, { width: 5, padZeros: true, suffix: "   " })).toBe("00001");
  });

  it("joins prefix and serial with exactly one dash", () => {
    expect(formatDocumentNumber({ prefix: "INV-" }, 5)).toBe("INV-5");
    expect(formatDocumentNumber({ prefix: "  " }, 5)).toBe("5");
  });

  it("reads the serial back out of a number as printed", () => {
    expect(parseSerialNumber("INV-1001")).toBe(1001);
    expect(parseSerialNumber("INV-00007", "/26")).toBe(7);
    expect(parseSerialNumber("C01-SR-00001/26", "/26")).toBe(1);
    expect(parseSerialNumber("ADH-SL26-27-0273")).toBe(273);
    // The suffix has to be passed for it to be cut: read blind, the trailing digits win. Every till
    // path that owns a series rule passes it, which is what keeps `.../26` from being read as 26.
    expect(parseSerialNumber("INV-1001/26")).toBe(26);
    expect(parseSerialNumber("INV-1001/26", "/26")).toBe(1001);
    expect(parseSerialNumber("")).toBeNull();
    expect(parseSerialNumber(null)).toBeNull();
    expect(parseSerialNumber("NO-NUMBER-HERE")).toBeNull();
  });

  it("keeps a suffix holding digits from being read as the serial", () => {
    expect(parseSerialNumber("SR-473/26", "/26")).toBe(473);
    expect(parseSerialNumber("QUO-2026-27-0101")).toBe(101);
  });

  it("refuses a width narrower than a serial already issued", () => {
    expect(minWidthForSerial(473, "/26")).toBe(6);
    expect(minWidthForSerial(1001)).toBe(4);
    expect(formatSerial(473, { width: 2, padZeros: true })).toBe("473");
  });

  it("raises the cursor past numbers the till already holds", () => {
    expect(nextSerialAfter(1, ["SR-1", "SR-2", "SR-10"], { width: 3, padZeros: true })).toBe(11);
    expect(nextSerialAfter(5, ["SR-00004/26", "SR-00003/26"], { suffix: "/26" })).toBe(5);
    expect(nextSerialAfter(5, [], {})).toBe(5);
    expect(nextSerialAfter(5, [undefined, null, "TEMP-9"], {})).toBe(10);
  });
});

describe("store numbering rules", () => {
  const sequences = {
    invoicePrefix: "INV",
    nextInvoiceNumber: 1001,
    returnPrefix: "SR",
    nextReturnNumber: 474,
    purchaseReturnPrefix: "PR",
    nextPurchaseReturnNumber: 101,
    purchasePrefix: "PUR",
    nextPurchaseNumber: 301,
    quotationPrefix: "QUO",
    nextQuotationNumber: 101,
    adjustmentPrefix: "ADJ",
    nextAdjustmentNumber: 401,
    transferPrefix: "TRF",
    nextTransferNumber: 501,
    numbering: {
      invoice: { width: 4, padZeros: true },
      sales_return: { width: 5, padZeros: true, suffix: "/26" },
    },
  };

  it("prints each series under its own rule", () => {
    expect(numberingFor(sequences, "invoice").prefix).toBe("INV");
    expect(formatDocumentNumber({ ...readSeries(sequences, "invoice").rule, prefix: "INV" }, 1001)).toBe("INV-1001");
    expect(numberingFor(sequences, "sales_return")).toEqual({
      prefix: "SR",
      searchPrefix: "SR-",
      next: 474,
      rule: { suffix: "/26", width: 5, padZeros: true },
    });
  });

  it("prints a series with no rule exactly as it did before", () => {
    const { prefix, next, rule } = readSeries(sequences, "quotation");
    expect(formatDocumentNumber({ ...rule, prefix }, next)).toBe("QUO-101");
  });

  it("accepts the snake_case shapes the admin panel writes", () => {
    const merged = mergeNumberingRules(undefined, {
      purchase: { serial_width: 3, pad_zeros: "true" },
      transfer: { digits: 6, pad: 1, serial_suffix: "-IND" },
      adjustment: { pad_zeros: true },
    });

    expect(merged.purchase).toEqual({ suffix: null, width: 3, padZeros: true });
    expect(merged.transfer).toEqual({ suffix: "-IND", width: 6, padZeros: true });
    expect(merged.adjustment).toEqual({ suffix: null, width: null, padZeros: true });
  });

  it("keeps the rules of the series a panel never mentions", () => {
    const merged = mergeNumberingRules(sequences.numbering, { quotation: { width: 4, pad: true } });

    expect(merged.sales_return).toEqual({ suffix: "/26", width: 5, padZeros: true });
    expect(merged.quotation).toEqual({ suffix: null, width: 4, padZeros: true });
  });

  it("covers every series the till generates", () => {
    expect(DOCUMENT_SERIES).toEqual([
      "invoice",
      "sales_return",
      "purchase_return",
      "purchase",
      "quotation",
      "adjustment",
      "transfer",
    ]);
  });
});
