import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/server.js";
import { loadConfig } from "../../src/config.js";
import { MockLamSuiteBackend } from "../../src/mock/mockBackend.js";

describe("MCP Inspector & Official Protocol Handshake", () => {
  let mockBackend: MockLamSuiteBackend;
  let backendUrl: string;
  let client: Client;
  const testPort = 8093;

  beforeAll(async () => {
    mockBackend = new MockLamSuiteBackend({ port: testPort });
    backendUrl = await mockBackend.start();

    const config = loadConfig({
      apiUrl: backendUrl,
      readOnly: false,
      role: "admin",
    });

    const { server } = createMcpServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      {
        name: "test-mcp-inspector",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await mockBackend.stop();
  });

  it("handshakes protocol and lists all 34 registered tools with schemas", async () => {
    const toolsResult = await client.listTools();
    expect(toolsResult.tools.length).toBe(34);

    const searchTool = toolsResult.tools.find((t) => t.name === "lamsuite_search_items");
    expect(searchTool).toBeDefined();
    expect(searchTool?.description).toContain("Search catalog items");
    expect(searchTool?.inputSchema.type).toBe("object");

    const createInvoiceTool = toolsResult.tools.find((t) => t.name === "lamsuite_create_invoice");
    expect(createInvoiceTool).toBeDefined();
  });

  it("executes tool call via official client protocol", async () => {
    const callResult = await client.callTool({
      name: "lamsuite_search_items",
      arguments: {
        query: "Dolo",
      },
    });

    expect(callResult.isError).toBeFalsy();
    const content = callResult.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Dolo 650 Tablet");
    expect(content[0].text).toContain("8901234567890");
  });

  it("lists and reads MCP resources", async () => {
    const resourcesList = await client.listResources();
    expect(resourcesList.resources.length).toBe(4);

    const storeResource = resourcesList.resources.find((r) => r.uri === "lamsuite://store/profile");
    expect(storeResource).toBeDefined();

    const readResult = await client.readResource({
      uri: "lamsuite://store/profile",
    });

    expect(readResult.contents.length).toBe(1);
    const profile = JSON.parse(readResult.contents[0].text as string);
    expect(profile.name).toBe("LamStone Pharmacy & Retail");
    expect(profile.state_code).toBe("32");
  });

  it("lists and gets MCP prompts", async () => {
    const promptsList = await client.listPrompts();
    expect(promptsList.prompts.length).toBe(4);

    const dailyClosing = promptsList.prompts.find((p) => p.name === "daily_closing_report");
    expect(dailyClosing).toBeDefined();

    const promptResult = await client.getPrompt({
      name: "daily_closing_report",
      arguments: {
        date: "2026-10-01",
      },
    });

    expect(promptResult.messages.length).toBe(1);
    expect(promptResult.messages[0].content.text).toContain("Daily Closing Audit Report");
    expect(promptResult.messages[0].content.text).toContain("2026-10-01");
  });
});
