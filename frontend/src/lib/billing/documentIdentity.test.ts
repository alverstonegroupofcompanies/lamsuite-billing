import { describe, expect, it } from "vitest";
import { canonicalDocumentKey, dedupeDocuments } from "./documentIdentity";

const base = {
  module_key: "invoice",
  store_id: "store_main",
  invoice_date: "2026-11-14",
  created_at: 1000,
};

describe("documentIdentity", () => {
  it("prefers the external id as the canonical business key", () => {
    expect(
      canonicalDocumentKey({ ...base, id: "local_1", external_id: "ext_abc", invoice_number: "INV-1" })
    ).toBe("ext:ext_abc");
    expect(
      canonicalDocumentKey({ ...base, id: "8", external_id: "ext_abc", invoice_number: "INV-1" })
    ).toBe("ext:ext_abc");
  });

  it("falls back to store + module + normalised number", () => {
    expect(canonicalDocumentKey({ ...base, id: "x", invoice_number: " inv-1 " })).toBe(
      "doc:store_main|invoice|INV-1"
    );
    expect(
      canonicalDocumentKey({ ...base, id: "x", module_key: "sales_return", invoice_number: "SR-1" })
    ).toBe("doc:store_main|sales_return|SR-1");
  });

  it("keeps the same invoice number in different stores apart", () => {
    const a = canonicalDocumentKey({ ...base, store_id: "store_a", invoice_number: "INV-1" });
    const b = canonicalDocumentKey({ ...base, store_id: "store_b", invoice_number: "INV-1" });
    expect(a).not.toBe(b);
  });

  it("collapses the local and server cache copies of one bill", () => {
    const localCopy = { ...base, id: "offline_1", external_id: "ext_1", invoice_number: "TEMP-C01-1", updated_at: 1000 };
    const serverCopy = {
      ...base,
      id: "42",
      server_id: 42,
      external_id: "ext_1",
      invoice_number: "INV-1001",
      sync_state: "synced",
      updated_at: 2000,
    };

    const result = dedupeDocuments([localCopy, serverCopy]);

    expect(result).toHaveLength(1);
    expect(result[0].invoice_number).toBe("INV-1001");
  });

  it("does not merge an invoice with its credit note", () => {
    const invoice = { ...base, id: "1", invoice_number: "INV-1" };
    const creditNote = { ...base, id: "2", module_key: "credit_note", invoice_number: "SR-1" };

    expect(dedupeDocuments([invoice, creditNote])).toHaveLength(2);
  });

  it("dedupes repeated rows that share only the invoice number", () => {
    const first = { ...base, id: "a", invoice_number: "INV-7", updated_at: 10 };
    const second = { ...base, id: "b", invoice_number: "INV-7", updated_at: 20 };

    const result = dedupeDocuments([first, second]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("prefers a non-temporary number over a temp number at equal scores", () => {
    const temp = { ...base, id: "off_1", external_id: "ext_9", invoice_number: "TEMP-C01-9", updated_at: 20 };
    const real = { ...base, id: "9", external_id: "ext_9", invoice_number: "INV-9", updated_at: 10 };

    const result = dedupeDocuments([temp, real]);

    expect(result[0].invoice_number).toBe("INV-9");
  });
});
