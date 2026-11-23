import { beforeEach, describe, expect, it } from "vitest";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import { getMockDatabase } from "../../../lib/db/sqliteStorage";
import { scheduleHReport, type ScheduleHRow } from "./index";

/**
 * GAP-02 / PHR-007 — the register a till keeps beside the counter.
 *
 * The old reading was every line of every bill in the window, which is a sales
 * list with a statutory title. A prescription register holds the scheduled
 * packs only, and since the whole point of the rule is who vouched, each entry
 * names the pharmacist and the registration on the bill.
 */

type Params = Parameters<typeof scheduleHReport.runQuery>[0];

const wideWindow = (): Params =>
  ({
    filters: { startDate: "2020-01-01", endDate: "2030-12-31" },
    searchQuery: "",
  }) as unknown as Params;

async function rows(): Promise<ScheduleHRow[]> {
  const result = await scheduleHReport.runQuery(wideWindow());
  return result.rows as ScheduleHRow[];
}

async function product(id: string, name: string, fields: Record<string, unknown> = {}) {
  await sqliteStorage.insertRecord("products", id, {
    id,
    store_id: "1",
    name,
    mrp: 200,
    sel_rate: 100,
    gst_percent: 0,
    units_per_pack: 1,
    is_active: true,
    ...fields,
  });
}

async function invoice(id: string, fields: Record<string, unknown> = {}) {
  await sqliteStorage.insertRecord("invoices", id, {
    id,
    store_id: "1",
    module_key: "invoice",
    invoice_number: `C01-INV-${id}`,
    invoice_date: "2026-11-10",
    customer_name: "Walk-in Customer",
    status: "issued",
    grand_total: 100,
    ...fields,
  });
}

async function item(
  id: string,
  invoiceId: string,
  productId: string,
  productName: string,
  fields: Record<string, unknown> = {}
) {
  await sqliteStorage.insertRecord("invoice_items", id, {
    id,
    invoice_id: invoiceId,
    product_id: productId,
    product_name: productName,
    batch_no: "BCH-ALP",
    qty: 1,
    unit_price: 100,
    total_amount: 100,
    ...fields,
  });
}

describe("Schedule H & H1 register (till)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();

    await product("prod_alp", "Alprazolam 0.25 Strip", { schedule_code: "H1" });
    await product("prod_para", "Paracetamol 650", {});
    await product("prod_xan", "Diazepam 5mg", { schedule_type: "H" });
    await product("prod_otc", "Antacid Syrup", { schedule_code: "G" });
  });

  it("keeps the scheduled lines and drops the rest of the bill", async () => {
    await invoice("inv_1");
    await item("it_1", "inv_1", "prod_alp", "Alprazolam 0.25 Strip");
    await item("it_2", "inv_1", "prod_para", "Paracetamol 650");

    const entries = await rows();

    expect(entries.map((row) => row.product_name)).toEqual(["Alprazolam 0.25 Strip"]);
    expect(entries[0].schedule_code).toBe("H1");
  });

  /** A shelf cached before the schedule stamp still reads as what it is. */
  it("reads a legacy schedule_type as well as the stamp", async () => {
    await invoice("inv_2");
    await item("it_3", "inv_2", "prod_xan", "Diazepam 5mg");
    await item("it_4", "inv_2", "prod_otc", "Antacid Syrup");

    const entries = await rows();

    expect(entries.map((row) => row.product_name)).toEqual(["Diazepam 5mg"]);
    expect(entries[0].schedule_code).toBe("H");
  });

  it("does not write a cancelled bill into the book", async () => {
    await invoice("inv_3", { status: "cancelled" });
    await item("it_5", "inv_3", "prod_alp", "Alprazolam 0.25 Strip");

    expect(await rows()).toEqual([]);
  });

  it("names the pharmacist and the registration on the entry", async () => {
    await invoice("inv_4", {
      pharmacist_id: "11",
      pharmacist_name: "Dr. Firoza Ali",
      pharmacist_reg_no: "KPK-2019-45512",
    });
    await item("it_6", "inv_4", "prod_alp", "Alprazolam 0.25 Strip", {
      batch_no: "BCH-DIA",
      qty: 2,
      total_amount: 200,
    });

    const [entry] = await rows();

    expect(entry.pharmacist_name).toBe("Dr. Firoza Ali");
    expect(entry.pharmacist_reg_no).toBe("KPK-2019-45512");
    expect(entry.batch_no).toBe("BCH-DIA");
    expect(entry.qty).toBe(2);
    expect(entry.total_amount).toBe(200);
  });

  /** A pack that never had a pharmacist is the entry an owner must see. */
  it("leaves an unsupervised line in the book with the pharmacist blank", async () => {
    await invoice("inv_5");
    await item("it_7", "inv_5", "prod_alp", "Alprazolam 0.25 Strip");

    const [entry] = await rows();

    expect(entry.pharmacist_name).toBe("");
    expect(entry.unconfirmed).toBe(true);
  });

  it("reverses a return so the book adds up the way the drawer does", async () => {
    await invoice("inv_6");
    await item("it_8", "inv_6", "prod_alp", "Alprazolam 0.25 Strip", { qty: 3, total_amount: 300 });
    await invoice("inv_7", { module_key: "credit_note" });
    await item("it_9", "inv_7", "prod_alp", "Alprazolam 0.25 Strip");

    const entries = await rows();

    expect(entries.map((row) => row.qty)).toEqual([3, -1]);
    expect(entries[1].is_return).toBe(true);
    expect(entries.reduce((sum, row) => sum + row.total_amount, 0)).toBe(200);
  });

  it("respects the window the cashier picks", async () => {
    await invoice("inv_8", { invoice_date: "2026-11-10" });
    await item("it_10", "inv_8", "prod_alp", "Alprazolam 0.25 Strip");

    const result = await scheduleHReport.runQuery({
      filters: { startDate: "2026-11-11", endDate: "2026-11-30" },
      searchQuery: "",
    } as unknown as Params);

    expect(result.rows).toEqual([]);
  });
});
