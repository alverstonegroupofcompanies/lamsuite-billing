import { describe, it, expect, beforeEach } from "vitest";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import {
  chargeHeadsStore,
  DEFAULT_CHARGE_HEADS,
  type ChargeHeadMaster,
} from "./chargeHeadsStore";

/**
 * CR-C rule R12: charge heads belong to exactly one store. The default set seeds
 * lazily, the set can be reset, and a head already used by a posted bill cannot be
 * deleted until those charge lines are reassigned — the units lifecycle applied to charges.
 */
describe("chargeHeadsStore store scoping, reset and delete guard (R12)", () => {
  beforeEach(() => {
    getMockDatabase().reset();
    window.localStorage.setItem("lamsuite_active_store_id", "store_A");
    getMockDatabase().setStore("store_A");
    sqliteStorage.getActiveStoreId();
  });

  const insertHead = async (
    id: string,
    name: string,
    code: string,
    storeId?: string,
    extra: Record<string, unknown> = {}
  ) => {
    await sqliteStorage.insertRecord("master_lookups", id, {
      id,
      type: "charge_head",
      name,
      code,
      is_active: 1,
      store_id: storeId,
      ...extra,
    });
  };

  const insertCharge = async (
    id: string,
    purchaseId: string,
    headCode: string,
    headName: string,
    total: number,
    storeId = "store_A"
  ) => {
    await sqliteStorage.insertRecord("purchase_charges", id, {
      id,
      external_id: `ext_${id}`,
      purchase_id: purchaseId,
      store_id: storeId,
      head_code: headCode,
      head_name: headName,
      amount: total,
      total_amount: total,
    });
  };

  it("seeds the default heads at app start and tags them with the active store", async () => {
    const seeded = await chargeHeadsStore.seedDefaultsIfEmpty();

    expect(seeded.map((h) => h.name).sort()).toEqual(
      DEFAULT_CHARGE_HEADS.map((h) => h.name).sort()
    );
    expect(seeded.every((h) => h.store_id === "store_A")).toBe(true);

    const row = await sqliteStorage.findById<any>("master_lookups", seeded[0].id);
    expect(row.store_id).toBe("store_A");
    expect(row.type).toBe("charge_head");
  });

  it("seeding is idempotent and auto-seeds on first read", async () => {
    const first = await chargeHeadsStore.getAllHeads(true);
    expect(first.length).toBe(DEFAULT_CHARGE_HEADS.length);

    const again = await chargeHeadsStore.seedDefaultsIfEmpty();
    expect(again.length).toBe(DEFAULT_CHARGE_HEADS.length);

    const rows = (await sqliteStorage.findAll<any>("master_lookups")).filter(
      (r: any) => r.type === "charge_head"
    );
    expect(rows.length).toBe(DEFAULT_CHARGE_HEADS.length);
  });

  it("seeded heads carry the presets the POS grid needs", async () => {
    const heads = await chargeHeadsStore.getAllHeads(true);
    const byName = (name: string) =>
      heads.find((h: ChargeHeadMaster) => h.name === name) as ChargeHeadMaster;

    expect(byName("Freight").sac_code).toBe("996731");
    expect(byName("Freight").default_treatment).toBe("add_to_cost");
    expect(byName("Freight").default_spread_method).toBe("value");
    expect(byName("Freight").allowed_sign).toBe("positive");
    expect(byName("Freight").seeded).toBe(true);

    expect(byName("Loading/Unloading").default_spread_method).toBe("quantity");
    expect(byName("Other").default_treatment).toBe("expense");
    expect(byName("Other").allowed_sign).toBe("both");
  });

  it("hides foreign-store heads and adopts legacy rows with no store_id", async () => {
    await insertHead("h_foreign", "Demurrage", "DEMUR", "store_B");
    await insertHead("h_legacy", "Cartage", "CART");

    const names = (await chargeHeadsStore.getAllHeads(false)).map((h) => h.name);

    expect(names).not.toContain("Demurrage");
    expect(names).toContain("Cartage");
  });

  it("resets: restores missing defaults, removes unused custom heads, keeps referenced ones", async () => {
    await chargeHeadsStore.seedDefaultsIfEmpty();

    const freight = (await chargeHeadsStore.getAllHeads(false)).find(
      (h) => h.name === "Freight"
    )!;
    await sqliteStorage.deleteRecord("master_lookups", freight.id);
    await chargeHeadsStore.upsertHead({ name: "Local Levies", code: "LEVY" });
    const cartage = await chargeHeadsStore.upsertHead({ name: "Cartage", code: "CART" });
    await insertCharge("c1", "pur_1", "CART", "Cartage", 120.5);

    const summary = await chargeHeadsStore.resetToDefaults();

    expect(summary.seeded).toContain("Freight");
    expect(summary.removed).toContain("Local Levies");
    expect(summary.kept).toContain("Cartage");

    const names = (await chargeHeadsStore.getAllHeads(false)).map((h) => h.name);
    expect(names).toContain("Freight");
    expect(names).not.toContain("Local Levies");
    expect(names).toContain("Cartage");
    expect(cartage).toBeTruthy();
  });

  it("finds referencing bills by head code and by head name, grouped per bill to the paisa", async () => {
    const freight = await chargeHeadsStore.upsertHead({
      name: "Freight",
      code: "FREIGHT",
    });
    await chargeHeadsStore.upsertHead({ name: "Insurance", code: "INSURANCE" });

    await insertCharge("c1", "pur_1", "FREIGHT", "Freight", 100.25);
    await insertCharge("c2", "pur_1", "freight", "FREIGHT", 0.01); // case-insensitive code
    await insertCharge("c3", "pur_2", "OTHER", " freight ", 49.75); // name match, stray spaces
    await insertCharge("c4", "pur_3", "INSURANCE", "Insurance", 10);
    await insertCharge("c5", "pur_4", "FREIGHT", "Freight", 5, "store_B"); // other store's bill

    const refs = await chargeHeadsStore.getHeadReferences(freight.id);
    const byBill = Object.fromEntries(refs.map((r) => [r.purchase_id, r]));

    expect(Object.keys(byBill).sort()).toEqual(["pur_1", "pur_2"]);
    expect(byBill["pur_1"].amount).toBe(100.26);
    expect(byBill["pur_2"].amount).toBe(49.75);
    expect(byBill["pur_1"].invoice_number).toBe("pur_1");
  });

  it("reassigns referencing charge lines to the replacement and deletes the source head", async () => {
    await chargeHeadsStore.seedDefaultsIfEmpty();
    const cartage = await chargeHeadsStore.upsertHead({ name: "Cartage", code: "CART" });
    const freight = (await chargeHeadsStore.getAllHeads(false)).find(
      (h) => h.name === "Freight"
    )!;
    await insertCharge("c1", "pur_1", "CART", "Cartage", 120.5);
    await insertCharge("c2", "pur_1", "cart", "CARTAGE", 7.25);

    const moved = await chargeHeadsStore.reassignHead(cartage.id, freight.id);

    expect(moved).toBe(2);
    expect(await chargeHeadsStore.getHeadById(cartage.id)).toBeNull();

    const c1 = await sqliteStorage.findById<any>("purchase_charges", "c1");
    const c2 = await sqliteStorage.findById<any>("purchase_charges", "c2");
    expect(c1.head_code).toBe("FREIGHT");
    expect(c1.head_name).toBe("Freight");
    expect(c2.head_code).toBe("FREIGHT");
    // Only the head identity moves — the posted money is untouched.
    expect(c1.total_amount).toBe(120.5);
    expect(c2.amount).toBe(7.25);
  });

  it("rejects reassignment to the same head or an unknown head", async () => {
    const cartage = await chargeHeadsStore.upsertHead({ name: "Cartage", code: "CART" });

    await expect(chargeHeadsStore.reassignHead(cartage.id, cartage.id)).rejects.toThrow(
      /different/i
    );
    await expect(chargeHeadsStore.reassignHead(cartage.id, "chg_missing")).rejects.toThrow(
      /not found/i
    );
  });

  it("refuses an invalid SAC or preset instead of storing a head the grid cannot use", async () => {
    await expect(
      chargeHeadsStore.upsertHead({ name: "Bad SAC", code: "SAC1", sac_code: "9967" })
    ).rejects.toThrow(/SAC/i);

    await expect(
      chargeHeadsStore.upsertHead({
        name: "Bad Treatment",
        code: "BAD",
        default_treatment: "capitalise" as any,
      })
    ).rejects.toThrow(/must be one of/i);
  });

  it("keeps a head's presets and seeded flag when it is edited", async () => {
    await chargeHeadsStore.seedDefaultsIfEmpty();

    const updated = await chargeHeadsStore.upsertHead({
      name: "Freight",
      code: "FREIGHT",
      default_itc_eligibility: "blocked",
    });

    expect(updated.id).toBeTruthy();
    expect(updated.sac_code).toBe("996731");
    expect(updated.default_treatment).toBe("add_to_cost");
    expect(updated.default_itc_eligibility).toBe("blocked");
    expect(updated.seeded).toBe(true);

    const count = (await chargeHeadsStore.getAllHeads(false)).length;
    expect(count).toBe(DEFAULT_CHARGE_HEADS.length);
  });

  it("queues a charge_head sync item carrying the server-shaped config", async () => {
    const head = await chargeHeadsStore.upsertHead({
      name: "Cold Chain",
      code: "COLD",
      sac_code: "996799",
      default_treatment: "expense",
      allowed_sign: "both",
    });

    const queued = (await sqliteStorage.findAll<any>("sync_queue")).filter(
      (i: any) => i.entity_type === "charge_head" && i.entity_id === head.id
    );
    expect(queued.length).toBe(1);

    const payload = JSON.parse(queued[0].payload_json);
    expect(payload.type).toBe("charge_head");
    expect(payload.store_id).toBe("store_A");
    expect(payload.config).toMatchObject({
      sac_code: "996799",
      default_treatment: "expense",
      default_spread_method: "value",
      default_itc_eligibility: "eligible",
      allowed_sign: "both",
      seeded: false,
    });

    await chargeHeadsStore.deleteHead(head.id);
    const deletion = (await sqliteStorage.findAll<any>("sync_queue")).filter(
      (i: any) => i.entity_type === "charge_head" && i.entity_id === head.id
    );
    expect(deletion.map((i: any) => i.action)).toContain("delete");
  });
});
