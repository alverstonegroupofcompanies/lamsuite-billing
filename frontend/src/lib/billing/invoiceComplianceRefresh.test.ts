import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { invoiceManagementService } from "./invoiceManagementService";

const cachedInvoice = {
  id: "inv_comp_1",
  store_id: "1",
  module_key: "invoice",
  invoice_number: "INV-2026-1001",
  invoice_date: "2026-11-17",
  customer_name: "QA Traders",
  customer_gstin: "32ABCDE1234F1Z5",
  subtotal: 10000,
  discount_total: 0,
  tax_total: 1800,
  round_off: 0,
  grand_total: 11800,
  paid_amount: 11800,
  payment_mode: "Cash",
  status: "issued",
  created_at: 1,
  updated_at: 1,
};

describe("Invoice compliance refresh", () => {
  beforeEach(async () => {
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.insertRecord("invoices", cachedInvoice.id, cachedInvoice);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("merges IRN and e-way bill registry fields onto the cached invoice", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          id: 42,
          invoice_number: "INV-2026-1001",
          irn: "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90",
          irn_ack_no: "112233445566",
          irn_ack_date: "2026-11-17T02:21:37.000000Z",
          irn_status: "generated",
          irn_status_effective: "generated",
          irn_applicable: true,
          ewb_number: "123456789012",
          ewb_status: "active",
          ewb_valid_until: "2026-11-18T02:22:35.000000Z",
          ewb_applicable: true,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const compliance = await invoiceManagementService.refreshCompliance("INV-2026-1001");

    expect(compliance?.irn).toBe(
      "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90"
    );
    expect(compliance?.ewb_number).toBe("123456789012");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/invoices/INV-2026-1001"),
      expect.objectContaining({ headers: expect.any(Object) })
    );

    const updated = await sqliteStorage.findById<any>("invoices", cachedInvoice.id);
    expect(updated?.irn_status).toBe("generated");
    expect(updated?.ewb_valid_until).toBe("2026-11-18T02:22:35.000000Z");
    expect(updated?.invoice_number).toBe("INV-2026-1001");
  });

  it("returns null without throwing when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));

    const compliance = await invoiceManagementService.refreshCompliance("INV-2026-1001");

    expect(compliance).toBeNull();
    const untouched = await sqliteStorage.findById<any>("invoices", cachedInvoice.id);
    expect(untouched?.irn).toBeUndefined();
  });
});
