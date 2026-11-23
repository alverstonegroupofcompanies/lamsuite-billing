import { beforeEach, describe, expect, it } from "vitest";
import { suppliersDefinition } from "./parties";
import { companySettingsService } from "../../../settings/companySettingsService";
import { getMockDatabase, sqliteStorage } from "../../../db/sqliteStorage";

/** MST-01: an imported supplier's state comes from its GSTIN, else the store — never a Kerala default. */
describe("Supplier import state code", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    await companySettingsService.saveLocalSettings({ state_code: "29" });
  });

  const transform = (raw: Record<string, unknown>) =>
    suppliersDefinition.transformRow!(raw as any) as Record<string, unknown>;

  it("takes the state from the GSTIN prefix", () => {
    expect(transform({ name: "MH Wholesale", gstin: "27AAACQ5678B1Z2", state_code: "29" }).state_code).toBe("27");
  });

  it("keeps a valid two-digit state given without a GSTIN", () => {
    expect(transform({ name: "TN Wholesale", state_code: "33" }).state_code).toBe("33");
  });

  it("falls back to the store's state, not Kerala", () => {
    expect(transform({ name: "Local Wholesale" }).state_code).toBe("29");
    expect(transform({ name: "Typo Wholesale", state_code: "3232" }).state_code).toBe("29");
  });
});
