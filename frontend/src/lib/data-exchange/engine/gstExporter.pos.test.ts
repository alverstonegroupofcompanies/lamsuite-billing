import { describe, it, expect } from "vitest";
import { gstr1PlaceOfSupply } from "./gstExporter";

/** TAX-03 in the till's GSTR-1 export: the home state is the store's, not Kerala's. */
describe("gstr1PlaceOfSupply", () => {
  it("files a Karnataka store's walk-in sale as intra-state B2C in Karnataka", () => {
    expect(gstr1PlaceOfSupply({ place_of_supply: "29-Karnataka", store_state_code: "29" }, "29")).toEqual({
      pos: "29-Karnataka",
      isInterState: false,
    });
  });

  it("treats a Kerala buyer of a Karnataka store as inter-state", () => {
    expect(gstr1PlaceOfSupply({ place_of_supply: "32-Kerala", store_state_code: "29" }, "29").isInterState).toBe(true);
  });

  it("fills a missing place of supply from the buyer's GSTIN, else the store's state", () => {
    expect(gstr1PlaceOfSupply({ customer_gstin: "33AAACQ1234F1Z1", store_state_code: "29" }, "29").pos).toBe("33-Tamil Nadu");
    expect(gstr1PlaceOfSupply({ store_state_code: "29" }, "32")).toEqual({ pos: "29-Karnataka", isInterState: false });
  });
});
