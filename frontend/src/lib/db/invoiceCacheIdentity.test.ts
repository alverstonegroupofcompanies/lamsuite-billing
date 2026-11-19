import { describe, it, expect, beforeEach } from "vitest";
import { sqliteStorage } from "./sqliteStorage";
import { canonicalizeInvoiceIdentity, clearInvoiceChildren } from "./invoiceCacheIdentity";

const row = (over: Record<string, unknown>) => ({
  id: "1",
  store_id: "4",
  invoice_number: "QAA-1001",
  grand_total: 612,
  taxable_subtotal: 540,
  status: "issued",
  sync_state: "synced",
  updated_at: 1000,
  ...over,
});

describe("Invoice cache identity (one bill, one row)", () => {
  beforeEach(async () => {
    await sqliteStorage.clearTable("invoices");
    await sqliteStorage.clearTable("invoice_items");
    await sqliteStorage.clearTable("invoice_payments");
  });

  it("folds the key the till minted into the server id and clears its children", async () => {
    await sqliteStorage.insertRecord("invoices", "ext_900_a", row({ id: "ext_900_a" }));
    await sqliteStorage.insertRecord("invoice_items", "item_local_1", {
      id: "item_local_1",
      invoice_id: "ext_900_a",
      product_name: "Syrup",
    });
    await sqliteStorage.insertRecord("invoice_payments", "pay_local_1", {
      id: "pay_local_1",
      invoice_id: "ext_900_a",
      amount: 612,
    });

    const identity = await canonicalizeInvoiceIdentity({
      id: 96,
      external_id: "ext_900_a",
      invoice_number: "QAA-1001",
      store_id: "4",
    });

    expect(identity.canonicalKey).toBe("96");
    expect(identity.external_id).toBe("ext_900_a");
    expect(identity.skip).toBe(false);
    expect(await sqliteStorage.findById("invoices", "ext_900_a")).toBeNull();
    expect(await sqliteStorage.findAll("invoice_items")).toEqual([]);
    expect(await sqliteStorage.findAll("invoice_payments")).toEqual([]);
  });

  it("leaves an unpushed edit alone instead of folding it under the server's older copy", async () => {
    await sqliteStorage.insertRecord("invoices", "ext_900_b", row({ id: "ext_900_b", sync_state: "pending", grand_total: 988 }));

    const identity = await canonicalizeInvoiceIdentity({
      id: 97,
      external_id: "ext_900_b",
      invoice_number: "QAA-1001",
      store_id: "4",
    });

    expect(identity.skip).toBe(true);
    const held = await sqliteStorage.findById<Record<string, unknown>>("invoices", "ext_900_b");
    expect(held?.grand_total).toBe(988);
  });

  it("keeps a summary broadcast with no server id on the row the till already holds", async () => {
    await sqliteStorage.insertRecord("invoices", "98", row({ id: "98", external_id: "ext_900_c", taxable_subtotal: 880 }));

    const identity = await canonicalizeInvoiceIdentity({
      external_id: "ext_900_c",
      invoice_number: "QAA-1001",
      store_id: "4",
    });

    expect(identity.canonicalKey).toBe("98");
    expect(identity.skip).toBe(false);
    expect(await sqliteStorage.findById("invoices", "98")).not.toBeNull();
  });

  it("does not fold a same-numbered bill belonging to another store", async () => {
    await sqliteStorage.insertRecord("invoices", "ext_other_store", row({ id: "ext_other_store", store_id: "5" }));

    const identity = await canonicalizeInvoiceIdentity({
      id: 12,
      invoice_number: "QAA-1001",
      store_id: "4",
    });

    expect(identity.canonicalKey).toBe("12");
    expect(await sqliteStorage.findById("invoices", "ext_other_store")).not.toBeNull();
  });

  it("clears every child row of a bill, including the register's prefixed keys", async () => {
    await sqliteStorage.insertRecord("invoice_items", "166", { id: "166", invoice_id: "98" });
    await sqliteStorage.insertRecord("invoice_items", "item_167", { id: "167", invoice_id: "98" });
    await sqliteStorage.insertRecord("invoice_items", "inv_item_900", { id: "inv_item_900", invoice_id: "98" });
    await sqliteStorage.insertRecord("invoice_items", "item_999", { id: "999", invoice_id: "99" });

    await clearInvoiceChildren("98");

    const left = await sqliteStorage.findAll<Record<string, unknown>>("invoice_items");
    expect(left.map((i) => i.invoice_id)).toEqual(["99"]);
  });
});
