import { beforeEach, describe, expect, it } from "vitest";
import { sqliteStorage } from "../db/sqliteStorage";
import { salespersonStore, type SalespersonMaster } from "./salespersonStore";

const row = (overrides: Partial<SalespersonMaster> = {}): SalespersonMaster => ({
  id: "11",
  store_id: "4",
  name: "Dr. Firoza Ali",
  code: "SP-01",
  is_active: true,
  is_pharmacist: true,
  ...overrides,
});

describe("SalespersonStore.pharmacists", () => {
  beforeEach(async () => {
    await sqliteStorage.clearTable("salespeople");
  });

  it("keeps the registered pharmacists and drops the rest of the staff", async () => {
    await sqliteStorage.insertRecord("salespeople", "11", row({ reg_no: "KPK-2019-45512" }));
    await sqliteStorage.insertRecord(
      "salespeople",
      "12",
      row({
        id: "12",
        name: "Dr. Naseem Backer",
        registration_valid: false,
        registration_refusal: "Their registration expired on 2029-05-31.",
      })
    );
    await sqliteStorage.insertRecord("salespeople", "13", row({ id: "13", name: "Rithika", is_pharmacist: false }));
    await sqliteStorage.insertRecord("salespeople", "14", row({ id: "14", name: "Sameer", is_active: false }));
    await sqliteStorage.insertRecord(
      "salespeople",
      "15",
      row({ id: "15", name: "Haleema", archived_at: "2026-10-01 09:00:00" })
    );

    const mayConfirm = await salespersonStore.pharmacists();

    expect(mayConfirm.map((person) => person.name)).toEqual(["Dr. Firoza Ali"]);
  });

  /**
   * SPR-006 restricts who a counter may sell as; PHR-004 asks who may vouch,
   * and a registration belongs to the store, not to a counter.
   */
  it("does not limit a pharmacist to the counters they are listed to sell at", async () => {
    await sqliteStorage.insertRecord("salespeople", "21", row({ id: "21", counter_ids: [7] }));

    const mayConfirm = await salespersonStore.pharmacists();

    expect(mayConfirm.map((person) => person.id)).toEqual(["21"]);
  });

  it("sorts the list the way a cashier reads a queue", async () => {
    await sqliteStorage.insertRecord("salespeople", "31", row({ id: "31", name: "Dr. Yaseen Ali" }));
    await sqliteStorage.insertRecord("salespeople", "32", row({ id: "32", name: "Dr. Ashifa Rahman" }));

    const mayConfirm = await salespersonStore.pharmacists();

    expect(mayConfirm.map((person) => person.name)).toEqual(["Dr. Ashifa Rahman", "Dr. Yaseen Ali"]);
  });

  it("answers for a registration the cache knows nothing about", async () => {
    // A row cached before the pharmacist columns existed carries no verdict, so
    // the server's own refusal — not a stale local flag — is what decides.
    await sqliteStorage.insertRecord("salespeople", "41", row({ id: "41", is_pharmacist: true }));

    const mayConfirm = await salespersonStore.pharmacists();

    expect(mayConfirm.map((person) => person.id)).toEqual(["41"]);
  });
});
