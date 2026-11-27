import { beforeEach, describe, expect, it, vi } from "vitest";
import { companySettingsService } from "./companySettingsService";
import { counterSequenceService, DOC_TAILS } from "../auth/counterSequenceService";
import { salesReturnService } from "../billing/salesReturnService";
import { purchaseService } from "../purchases/purchaseService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { resetMockHandlers } from "../ipc/ipcBridge";

/**
 * TALLY-01 at store scope: the numbering a store sets for a series (suffix, minimum digit width,
 * zero fill) is what the till previews and generates, and what it reads back out of a number the
 * server filed. A store that never set a rule keeps printing `PREFIX-N`.
 */

const FY = counterSequenceService.getCurrentFinancialYear();

describe("store numbering defaults (TALLY-01)", () => {
  beforeEach(async () => {
    resetMockHandlers();
    sqliteStorage.registerMockIpcHandlers();
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    counterSequenceService.clearActiveCounter();
    localStorage.clear();
    await companySettingsService.loadSettings();
    vi.restoreAllMocks();
  });

  it("previews and generates under the store rule", async () => {
    await companySettingsService.saveLocalSettings({
      sequences: {
        returnPrefix: "SR",
        nextReturnNumber: 474,
        numbering: { sales_return: { suffix: "/26", width: 5, padZeros: true } },
      },
    });

    expect(companySettingsService.getNumbering("sales_return")).toEqual({
      prefix: "SR",
      next: 474,
      rule: { suffix: "/26", width: 5, padZeros: true },
    });
    expect(companySettingsService.previewNextDocumentNumber("return")).toBe("SR-00474/26");
    expect(await companySettingsService.generateNextDocumentNumber("return")).toBe("SR-00474/26");
    expect(companySettingsService.getSettings().sequences?.nextReturnNumber).toBe(475);
    expect(companySettingsService.previewNextDocumentNumber("return")).toBe("SR-00475/26");
  });

  it("prints the old number for a series with no rule", async () => {
    await companySettingsService.saveLocalSettings({
      sequences: {
        quotationPrefix: "QUO",
        nextQuotationNumber: 101,
        returnPrefix: "SR",
        nextReturnNumber: 1,
        purchasePrefix: "PUR",
        nextPurchaseNumber: 201,
        numbering: {},
      },
    });

    expect(companySettingsService.previewNextDocumentNumber("quotation")).toBe("QUO-101");
    expect(await salesReturnService.previewNextReturnNumber()).toBe("SR-1");
    expect(await purchaseService.previewNextPurchaseNumber()).toBe("PUR-201");
  });

  it("routes the document generators through the same rule", async () => {
    await companySettingsService.saveLocalSettings({
      sequences: {
        returnPrefix: "SR",
        nextReturnNumber: 7,
        purchasePrefix: "PUR",
        nextPurchaseNumber: 301,
        numbering: {
          sales_return: { suffix: "/26", width: 4, padZeros: true },
          purchase: { width: 5, padZeros: true },
        },
      },
    });

    expect(await salesReturnService.generateNextReturnNumber()).toBe("SR-0007/26");
    expect(await purchaseService.generateNextPurchaseNumber()).toBe("PUR-00301");
  });

  it("reads a padded, suffixed number back into the cursor", async () => {
    await companySettingsService.saveLocalSettings({
      sequences: {
        returnPrefix: "SR",
        nextReturnNumber: 1,
        numbering: { sales_return: { suffix: "/26", width: 5, padZeros: true } },
      },
    });

    await companySettingsService.syncNextDocumentSequence("return", "SR-000473/26");
    expect(companySettingsService.getSettings().sequences?.nextReturnNumber).toBe(474);
    expect(companySettingsService.previewNextDocumentNumber("return")).toBe("SR-00474/26");

    // A number this store's rule cannot contain is not this series' to spend.
    await companySettingsService.syncNextDocumentSequence("return", "SR-99");
    expect(companySettingsService.getSettings().sequences?.nextReturnNumber).toBe(474);

    // A bill printed before the rule existed has no padding or suffix, and still moves the cursor on.
    await companySettingsService.syncNextDocumentSequence("return", "SR-500");
    expect(companySettingsService.getSettings().sequences?.nextReturnNumber).toBe(501);
  });

  it("takes the rule from the server payload and keeps the local rules it omits", async () => {
    await companySettingsService.saveLocalSettings({
      sequences: {
        invoicePrefix: "INV",
        nextInvoiceNumber: 273,
        returnPrefix: "SR",
        nextReturnNumber: 474,
        numbering: { sales_return: { suffix: "/26", width: 5, padZeros: true } },
      },
    });

    await companySettingsService.updateLocalFromRemote({
      invoice_prefix: "INV",
      sequences: {
        invoicePrefix: "INV",
        nextInvoiceNumber: 101,
        numbering: { invoice: { serial_width: 4, pad_zeros: true } },
      },
    });

    const settings = companySettingsService.getSettings();
    expect(settings.sequences?.numbering?.invoice).toEqual({ suffix: null, width: 4, padZeros: true });
    expect(settings.sequences?.numbering?.sales_return).toEqual({ suffix: "/26", width: 5, padZeros: true });

    // The panel's rule renders a cursor the till is already past: the store numbers forward, not back.
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("INV-0273");
  });

  it("leaves the counter series in charge of its own rendering", async () => {
    await companySettingsService.saveLocalSettings({
      sequences: {
        invoicePrefix: "INV",
        nextInvoiceNumber: 273,
        numbering: { invoice: { width: 4, padZeros: true } },
      },
    });

    await counterSequenceService.primeFromManifest({
      counter_id: 12,
      counter_code: "C01",
      financial_year: FY,
      doc_types: Object.keys(DOC_TAILS),
      items: Object.entries(DOC_TAILS).map(([docType, tail]) => ({
        counter_id: 12,
        doc_type: docType,
        financial_year: FY,
        prefix: `C01-${tail}`,
        next_number: 41,
        range_start: null as number | null,
        range_end: null as number | null,
        ...(docType === "invoice" ? { suffix: "/IND", serial_width: 3, pad_zeros: true } : {}),
      })),
    });

    // The store pads to four; this counter's series overrode it with width three and a suffix.
    expect(companySettingsService.previewNextInvoiceNumber()).toBe("C01-INV-041/IND");
    expect(companySettingsService.getNumbering("invoice").rule).toEqual({ suffix: null, width: 4, padZeros: true });
  });
});
