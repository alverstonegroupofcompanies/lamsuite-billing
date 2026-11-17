import { describe, expect, it } from "vitest";
import { isOpenSalesOrderStatus, OPEN_SALES_ORDER_STATUSES } from "./salesOrderService";

describe("sales order recall helpers", () => {
  it("treats draft, confirmed and partially fulfilled orders as open", () => {
    for (const status of OPEN_SALES_ORDER_STATUSES) {
      expect(isOpenSalesOrderStatus(status)).toBe(true);
    }
  });

  it("excludes fulfilled and cancelled orders", () => {
    expect(isOpenSalesOrderStatus("fulfilled")).toBe(false);
    expect(isOpenSalesOrderStatus("cancelled")).toBe(false);
    expect(isOpenSalesOrderStatus("")).toBe(false);
  });

  it("is case sensitive so unknown values stay closed", () => {
    expect(isOpenSalesOrderStatus("Draft")).toBe(false);
  });
});
