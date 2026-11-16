import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LamSuiteApiClient } from "../../src/client/apiClient.js";
import { loadConfig } from "../../src/config.js";
import { ToolRegistry, ALL_READ_TOOLS, ALL_WRITE_TOOLS } from "../../src/tools/registry.js";
import { listCountersTool, getNegativeStockReportTool } from "../../src/tools/read/counters.js";
import { listStockAdjustmentsTool, getStockAdjustmentTool } from "../../src/tools/read/stockAdjustments.js";
import { getAdminDashboardTool, getDashboardMetricsTool } from "../../src/tools/read/dashboard.js";
import { listDeviceSessionsTool } from "../../src/tools/read/deviceSessions.js";
import { deviceSessionActionTool } from "../../src/tools/write/deviceSessions.js";
import {
  approveStockAdjustmentTool,
  rejectStockAdjustmentTool,
  updateStockAdjustmentPolicyTool,
} from "../../src/tools/write/stockAdjustments.js";
import { createInvoiceTool } from "../../src/tools/write/invoice.js";

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listTsFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

function makeConfig() {
  return loadConfig({
    apiUrl: "http://127.0.0.1:9/api",
    readOnly: false,
    role: "admin",
    apiToken: "test-token",
  });
}

type RecordedCall = { path: string; method: string; storeId?: number };

/** Patches the transport so we can assert exact endpoints without a server. */
function recordingClient() {
  const client = new LamSuiteApiClient(makeConfig());
  const calls: RecordedCall[] = [];

  (client as any).request = async (path: string, options: any = {}) => {
    calls.push({ path, method: (options.method || "GET").toUpperCase(), storeId: options.storeId });
    if (path.startsWith("/admin/parties")) return { data: [{ id: 1, name: "Supplier One" }], total: 1 };
    if (path.endsWith("/ledger")) return { supplier: { id: 5, name: "Supplier Five" }, current_balance: 123 };
    if (path.startsWith("/reports/stock-ledger")) return { total: 0, entries: [] };
    if (path.startsWith("/admin/inventory/batches")) return { data: [] };
    if (path.startsWith("/admin/returns") || path.startsWith("/admin/purchase-returns")) return { data: [] };
    if (path.startsWith("/device-sessions")) {
      return { id: "sess_1", success: true, message: `ok`, sessions: [] };
    }
    if (path.startsWith("/admin/stock-adjustments")) {
      return { data: [], policy: {}, document: { document_id: "doc_1", status: "posted" }, success: true };
    }
    if (path.startsWith("/admin/dashboard")) {
      return { timezone: "Asia/Kolkata", sales: {}, purchases: {}, receivables: {}, alerts: {} };
    }
    if (path.startsWith("/reports/dashboard/metrics")) {
      return { timezone: "Asia/Kolkata", date_range: {}, payments: {}, gst: { slabs: [] } };
    }
    if (path.startsWith("/admin/counters")) return { success: true, counters: [] };
    if (path.startsWith("/inventory/negative-stock-report")) return { negative_batches: [] };
    return {};
  };

  return { client, calls };
}

function ctx(client: any) {
  return { client, config: makeConfig() };
}

describe("API parity: no duplicated /api prefix in tool paths", () => {
  it("never embeds /api/ inside tool or client endpoint paths", () => {
    const offenders: string[] = [];
    for (const file of [...listTsFiles(join(SRC_ROOT, "tools")), join(SRC_ROOT, "client", "apiClient.ts")]) {
      const source = readFileSync(file, "utf8");
      if (/["'`]\/api\//.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("routes counter and negative-stock reads without /api and without a hardcoded store 1", async () => {
    const { client, calls } = recordingClient();

    await listCountersTool.handler({}, ctx(client));
    await getNegativeStockReportTool.handler({}, ctx(client));

    for (const call of calls) {
      expect(call.path).not.toContain("/api/api/");
      expect(call.path).not.toContain("store_id=1");
    }
    expect(calls[0].path).toBe("/admin/counters");
    expect(calls[0].storeId).toBeUndefined();
    expect(calls[1].path).toBe("/inventory/negative-stock-report");

    calls.length = 0;
    await listCountersTool.handler({ store_id: 7 }, ctx(client));
    expect(calls[0].path).toBe("/admin/counters");
    expect(calls[0].storeId).toBe(7);
  });

  it("stock-adjustment tools hit the admin inventory routes only", async () => {
    const { client, calls } = recordingClient();

    await listStockAdjustmentsTool.handler({ page: 1, per_page: 20 }, ctx(client));
    await getStockAdjustmentTool.handler({ document_id: "doc 1" }, ctx(client));
    await approveStockAdjustmentTool.handler({ document_id: "doc_1" }, ctx(client));
    await rejectStockAdjustmentTool.handler({ document_id: "doc_1", reason: "wrong" }, ctx(client));
    await updateStockAdjustmentPolicyTool.handler({ policy: { allow_negative_stock: false } }, ctx(client));

    expect(calls.map((c) => c.path)).toEqual([
      "/admin/stock-adjustments?per_page=20&page=1",
      "/admin/stock-adjustments/doc%201",
      "/admin/stock-adjustments/doc_1/approve",
      "/admin/stock-adjustments/doc_1/reject",
      "/admin/stock-adjustments/policy",
    ]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST", "POST", "PUT"]);
    for (const call of calls) expect(call.path).not.toContain("/api/api/");
  });
});

describe("API parity: corrected backend endpoints", () => {
  it("suppliers use /admin/parties and /suppliers/{id}/ledger", async () => {
    const { client, calls } = recordingClient();

    const list = await client.getSuppliers({ query: "Med", limit: 10 });
    expect(calls[0].path).toContain("/admin/parties?");
    expect(calls[0].path).toContain("type=supplier");
    expect(calls[0].path).toContain("search=Med");
    expect(list.data[0].id).toBe("1");

    const supplier = await client.getSupplier("5");
    expect(calls[1].path).toBe("/admin/suppliers/5/ledger");
    expect(supplier.outstanding_balance).toBe(123);
  });

  it("returns use /admin/returns and /admin/purchase-returns for lists, POST /returns/purchase for create", async () => {
    const { client, calls } = recordingClient();

    await client.getReturns({ type: "sales_return" });
    await client.getReturns({ type: "purchase_return" });
    await client.createPurchaseReturn({ supplier_id: "5", items: [] });

    expect(calls[0].path).toBe("/admin/returns");
    expect(calls[1].path).toBe("/admin/purchase-returns");
    expect(calls[2].path).toBe("/returns/purchase");
    expect(calls[2].method).toBe("POST");
    for (const call of calls) expect(call.path).not.toContain("/api/api/");
  });

  it("stock ledger and balance use the report and inventory routes", async () => {
    const { client, calls } = recordingClient();

    await client.getStockLedger("prod_1", undefined, "2026-11-01", "2026-11-30", 20);
    await client.getStockBalance("Dolo", undefined, undefined, 20);

    expect(calls[0].path).toContain("/reports/stock-ledger?");
    expect(calls[1].path).toContain("/admin/inventory/batches?");
    expect(calls[1].path).toContain("only_positive=true");
  });

  it("dashboard and device-session endpoints match routes/api.php", async () => {
    const { client, calls } = recordingClient();

    await getAdminDashboardTool.handler({}, ctx(client));
    await getDashboardMetricsTool.handler({ start_date: "2026-11-01", end_date: "2026-11-30" }, ctx(client));
    await listDeviceSessionsTool.handler({ store_id: 3 }, ctx(client));
    await deviceSessionActionTool.handler(
      { session_id: "sess_1", action: "force-logout", store_id: 3 },
      ctx(client)
    );

    expect(calls[0].path).toBe("/admin/dashboard");
    expect(calls[1].path).toBe("/reports/dashboard/metrics?start_date=2026-11-01&end_date=2026-11-30");
    expect(calls[2].path).toBe("/device-sessions");
    expect(calls[3].path).toBe("/device-sessions/sess_1/force-logout");
    expect(calls[3].method).toBe("POST");
    expect(calls[2].storeId).toBe(3);
  });
});

describe("API parity: store scoping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the per-call store id as the X-Store-Id header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "inv_1", invoice_number: "INV-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any
    );

    const client = new LamSuiteApiClient(makeConfig());
    await client.createInvoice({ customer_name: "Walk-in", lines: [] }, 9);

    const [, init] = fetchMock.mock.calls[0] as any[];
    expect((init.headers as Record<string, string>)["X-Store-Id"]).toBe("9");
  });

  it("invoice and purchase schemas accept an optional store_id", () => {
    const parsed = createInvoiceTool.inputSchema.parse({
      customer_name: "Rahul",
      items: [{ product_id: "prod_1", qty: 1 }],
      store_id: 4,
    });
    expect(parsed.store_id).toBe(4);

    const withoutStore = createInvoiceTool.inputSchema.parse({
      customer_name: "Rahul",
      items: [{ product_id: "prod_1", qty: 1 }],
    });
    expect(withoutStore.store_id).toBeUndefined();
  });

  it("create_invoice forwards store_id to the client", async () => {
    const createInvoice = vi.fn().mockResolvedValue({
      id: "inv_9",
      invoice_number: "INV-9",
      customer_name: "Walk-in Customer",
      grand_total: 33.6,
      payment_mode: "Cash",
      tax_total: 3.6,
      status: "issued",
    });
    const fakeClient: any = {
      getStore: async () => ({ state_code: "32", tax_mode: "inclusive" }),
      getProduct: async () => ({
        id: "prod_1",
        name: "Dolo 650",
        sel_rate: 30,
        gst_percent: 12,
        units_per_pack: 1,
        batches: [{ batch_no: "DL099", expiry_date: "2027-03-31", stock_qty: 10 }],
      }),
      createInvoice,
    };

    await createInvoiceTool.handler(
      {
        customer_name: "Walk-in Customer",
        items: [{ product_id: "prod_1", qty: 1, loose_qty: 0, discount_percent: 0 }],
        bill_discount_percent: 0,
        bill_discount_amount: 0,
        payment_mode: "Cash",
        dry_run: false,
        store_id: 6,
      } as any,
      { client: fakeClient, config: makeConfig() }
    );

    expect(createInvoice).toHaveBeenCalledTimes(1);
    expect(createInvoice.mock.calls[0][1]).toBe(6);
  });
});

describe("API parity: new tools are registered", () => {
  const newReadTools = [
    "lamsuite_admin_dashboard",
    "lamsuite_dashboard_metrics",
    "lamsuite_get_stock_adjustment",
    "lamsuite_list_device_sessions",
  ];
  const newWriteTools = [
    "lamsuite_approve_stock_adjustment",
    "lamsuite_reject_stock_adjustment",
    "lamsuite_update_stock_adjustment_policy",
    "lamsuite_device_session_action",
  ];

  it("registers every new tool in write mode", () => {
    const registry = new ToolRegistry();
    registry.init(false);
    const names = registry.listTools().map((t: any) => t.name);

    for (const name of [...newReadTools, ...newWriteTools]) {
      expect(names).toContain(name);
    }
    expect(ALL_READ_TOOLS.length).toBe(36);
    expect(ALL_WRITE_TOOLS.length).toBe(24);
    expect(names.length).toBe(60);
  });

  it("hides the new write tools in read-only mode", () => {
    const registry = new ToolRegistry();
    registry.init(true);
    const names = registry.listTools().map((t: any) => t.name);

    for (const name of newReadTools) expect(names).toContain(name);
    for (const name of newWriteTools) expect(names).not.toContain(name);
  });

  it("exposes no duplicate tool names", () => {
    const names = [...ALL_READ_TOOLS, ...ALL_WRITE_TOOLS].map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
