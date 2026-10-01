import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MockLamSuiteBackend } from "../../src/mock/mockBackend.js";
import { loadConfig } from "../../src/config.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { LamSuiteApiClient } from "../../src/client/apiClient.js";

describe("Read Tools Integration with Backend", () => {
  let mockBackend: MockLamSuiteBackend;
  let backendUrl: string;
  const testPort = 8089;

  beforeAll(async () => {
    mockBackend = new MockLamSuiteBackend({ port: testPort });
    backendUrl = await mockBackend.start();
  });

  afterAll(async () => {
    await mockBackend.stop();
  });

  it("Acceptance Criterion: 'Show today's sales and the 5 items running low' returns correct data from backend", async () => {
    const config = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: true,
      role: "admin",
    });
    const client = new LamSuiteApiClient(config);
    const registry = new ToolRegistry();
    registry.init(true);

    // 1. Query today's sales
    const salesRes = await registry.executeTool(
      "lamsuite_sales_summary",
      { period: "today" },
      { client, config }
    );
    expect(salesRes.isError).toBeFalsy();
    expect(salesRes.structuredContent.gross_sales).toBe(150.0);
    expect(salesRes.structuredContent.currency).toBe("INR");
    expect(salesRes.content[0].text).toContain("Sales Summary");
    expect(salesRes.content[0].text).toContain("₹150.00");

    // 2. Query low stock items (should return 5 items running low)
    const lowStockRes = await registry.executeTool(
      "lamsuite_low_stock",
      { limit: 5 },
      { client, config }
    );
    expect(lowStockRes.isError).toBeFalsy();
    const lowStockItems = lowStockRes.structuredContent.low_stock_items;
    expect(lowStockItems.length).toBe(5);
    expect(lowStockRes.content[0].text).toContain("Low Stock Alert (5 items)");
    // Should contain low stock items like Azithromycin, Pan 40, etc.
    const names = lowStockItems.map((i: any) => i.name);
    expect(names).toContain("Azithromycin 500mg Tablet");
    expect(names).toContain("Pan 40 Tablet");
  });

  it("queries get_item with batches and rates", async () => {
    const config = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: true,
      role: "admin",
    });
    const client = new LamSuiteApiClient(config);
    const registry = new ToolRegistry();
    registry.init(true);

    const res = await registry.executeTool(
      "lamsuite_get_item",
      { barcode: "8901234567890" }, // Dolo 650
      { client, config }
    );

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.item.name).toBe("Dolo 650 Tablet");
    expect(res.structuredContent.batches.length).toBe(3);
    expect(res.content[0].text).toContain("DL099");
    expect(res.content[0].text).toContain("₹30.00");
  });

  it("queries near_expiry batches", async () => {
    const config = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: true,
      role: "admin",
    });
    const client = new LamSuiteApiClient(config);
    const registry = new ToolRegistry();
    registry.init(true);

    const res = await registry.executeTool(
      "lamsuite_near_expiry",
      { threshold_days: 90 },
      { client, config }
    );

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.near_expiry_batches.length).toBeGreaterThan(0);
    expect(res.content[0].text).toContain("Near Expiry Batches");
  });

  it("queries customer details and masks phone number for cashier", async () => {
    const cashierConfig = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: true,
      role: "cashier",
    });
    const client = new LamSuiteApiClient(cashierConfig);
    const registry = new ToolRegistry();
    registry.init(true);

    const res = await registry.executeTool(
      "lamsuite_get_customer",
      { customer_id: "cust_1" },
      { client, config: cashierConfig }
    );

    expect(res.isError).toBeFalsy();
    // Phone must be masked for cashier
    expect(res.structuredContent.customer.phone).toBe("98****2345");
    expect(res.content[0].text).toContain("98****2345");
  });

  it("queries daily summary report", async () => {
    const config = loadConfig({
      apiUrl: `${backendUrl}`,
      readOnly: true,
      role: "admin",
    });
    const client = new LamSuiteApiClient(config);
    const registry = new ToolRegistry();
    registry.init(true);

    const res = await registry.executeTool(
      "lamsuite_daily_summary",
      {},
      { client, config }
    );

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.daily_summary.total_sales).toBe(150.0);
    expect(res.content[0].text).toContain("Store Daily Closing Summary");
  });
});
