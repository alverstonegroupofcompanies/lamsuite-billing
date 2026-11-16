import { describe, it, expect, beforeEach } from "vitest";
import { posCartService } from "./posCartService";
import { productsStore } from "../masters/productsStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";
import { onlineTransactionService } from "../sync/onlineTransactionService";

describe("POS price list negotiation", () => {
  beforeEach(async () => {
    (onlineTransactionService as any).connectionState = "offline";
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
    posCartService.resetCart();

    await productsStore.upsertProduct({
      id: "prod_dolo",
      name: "Dolo 650",
      barcode: "8902222",
      hsn_sac_code: "3004",
      mrp: 32,
      sel_rate: 28,
      gst_percent: 12,
      units_per_pack: 10,
      is_active: true,
    });

    await productsStore.upsertBatch({
      id: "batch_dolo",
      product_id: "prod_dolo",
      batch_no: "D-001",
      expiry_date: "2027-12-31",
      stock_qty: 1000,
    });
  });

  const seed = async (qty: number) => {
    const product = (await productsStore.getProductById("prod_dolo"))!;
    const batch = (await productsStore.getEarliestExpiringBatch("prod_dolo"))!;
    return posCartService.addProductToCart(product, batch, qty, 0).line;
  };

  it("applies negotiated rate and discount once the minimum quantity is met", async () => {
    posCartService.setPriceListPricing("VIP Hospitals", [
      { product_id: "prod_dolo", rate: 20, discount_percent: 2, min_qty: 5 },
    ]);

    const line = await seed(5);

    expect(line.unit_price).toBe(20);
    expect(line.discount_percent).toBe(2);
    expect(line.price_list_applied).toBe(true);
    expect(line.price_list_name).toBe("VIP Hospitals");
  });

  it("keeps the base selling rate below the minimum quantity", async () => {
    posCartService.setPriceListPricing("VIP Hospitals", [
      { product_id: "prod_dolo", rate: 20, discount_percent: 2, min_qty: 5 },
    ]);

    const line = await seed(2);

    expect(line.unit_price).toBe(28);
    expect(line.discount_percent).toBe(0);
    expect(line.price_list_applied).toBeUndefined();
  });

  it("reprices crossing the threshold in both directions as quantity changes", async () => {
    posCartService.setPriceListPricing("Bulk 10+", [
      { product_id: "prod_dolo", rate: 18, discount_percent: 0, min_qty: 10 },
    ]);

    const line = await seed(2);
    expect(line.unit_price).toBe(28);

    posCartService.updateLineQuantity(line.id, 12);
    let current = posCartService.getLines()[0];
    expect(current.unit_price).toBe(18);
    expect(current.price_list_applied).toBe(true);

    posCartService.updateLineQuantity(line.id, 3);
    current = posCartService.getLines()[0];
    expect(current.unit_price).toBe(28);
    expect(current.price_list_applied).toBeUndefined();
  });

  it("never overwrites a cashier's manual price override", async () => {
    posCartService.setPriceListPricing("VIP", [
      { product_id: "prod_dolo", rate: 20, discount_percent: 0, min_qty: 1 },
    ]);

    const line = await seed(6);
    expect(line.unit_price).toBe(20);

    posCartService.updateLinePrice(line.id, 24);
    posCartService.setPriceListPricing("VIP", [
      { product_id: "prod_dolo", rate: 19, discount_percent: 0, min_qty: 1 },
    ]);

    const current = posCartService.getLines()[0];
    expect(current.unit_price).toBe(24);
    expect(current.price_list_applied).toBe(false);
  });

  it("reverts applied rates when the customer is cleared", async () => {
    posCartService.setCustomer("cust_vip", "Apollo", "", "", "");
    posCartService.setPriceListPricing("VIP", [
      { product_id: "prod_dolo", rate: 20, discount_percent: 0, min_qty: 1 },
    ]);

    const line = await seed(6);
    expect(line.unit_price).toBe(20);

    posCartService.setCustomer("", "Walk-in Customer", "", "", "");

    const current = posCartService.getLines()[0];
    expect(current.unit_price).toBe(28);
    expect(current.price_list_applied).toBeUndefined();
    expect(posCartService.getPriceListContext().name).toBeNull();
  });

  it("does not leak one customer's rates into the next customer's cart", async () => {
    posCartService.setCustomer("cust_a", "A", "", "", "");
    posCartService.setPriceListPricing("Rate A", [
      { product_id: "prod_dolo", rate: 20, discount_percent: 0, min_qty: 1 },
    ]);
    await seed(6);
    expect(posCartService.getLines()[0].unit_price).toBe(20);

    posCartService.setCustomer("cust_b", "B", "", "", "");

    expect(posCartService.getLines()[0].unit_price).toBe(28);
    expect(posCartService.getPriceListContext().name).toBeNull();
  });
});
