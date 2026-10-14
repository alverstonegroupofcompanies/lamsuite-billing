import { describe, it, expect } from "vitest";
import { ToolRegistry, ALL_WRITE_TOOLS } from "../../src/tools/registry.js";
import { loadConfig } from "../../src/config.js";
import { LamSuiteApiClient } from "../../src/client/apiClient.js";

describe("Read-Only Mode Enforcement", () => {
  it("in read-only mode, NO write tool is listed", () => {
    const registry = new ToolRegistry();
    registry.init(true); // readOnly = true

    const listed = registry.listTools();
    const writeToolNames = ALL_WRITE_TOOLS.map((t) => t.name);

    for (const tool of listed) {
      expect(writeToolNames).not.toContain(tool.name);
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
    expect(listed.length).toBe(25); // All 25 read tools
  });

  it("in read-only mode, calling a write tool is safely rejected", async () => {
    const config = loadConfig({ readOnly: true });
    const client = new LamSuiteApiClient(config);
    const registry = new ToolRegistry();
    registry.init(true);

    const res = await registry.executeTool(
      "lamsuite_create_invoice",
      {
        customer_name: "Walk-in",
        items: [{ product_id: "prod_dolo650", qty: 2 }],
      },
      { client, config }
    );

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("READ-ONLY mode");
  });

  it("with write mode on (readOnly = false), write tools are registered and listed", () => {
    const registry = new ToolRegistry();
    registry.init(false); // readOnly = false

    const listed = registry.listTools();
    expect(listed.length).toBe(37); // 25 read + 12 write = 37 tools

    const createInvoice = listed.find((t) => t.name === "lamsuite_create_invoice");
    expect(createInvoice).toBeDefined();
    expect(createInvoice?.annotations.readOnlyHint).toBe(false);

    const cancelInvoice = listed.find((t) => t.name === "lamsuite_cancel_invoice");
    expect(cancelInvoice).toBeDefined();
    expect(cancelInvoice?.annotations.destructiveHint).toBe(true);
  });
});
