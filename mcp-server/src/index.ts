#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";
import { startStdioTransport } from "./transports/stdio.js";
import { startHttpTransport } from "./transports/http.js";
import { MockLamSuiteBackend } from "./mock/mockBackend.js";

async function main() {
  const config = loadConfig();

  // If mock mode is requested or in development without a live backend
  const useMock =
    process.argv.includes("--mock") ||
    process.env.LAMSUITE_USE_MOCK === "true";

  if (useMock) {
    const mockBackend = new MockLamSuiteBackend({ port: 8000 });
    await mockBackend.start();
    console.error("[LamSuite MCP] Started in-process mock LamSuite backend on port 8000.");
  }

  console.error(
    `[LamSuite MCP] Initializing server (Store ID: ${config.storeId}, Read-Only: ${config.readOnly}, Role: ${config.role}, Transport: ${config.transport})`
  );

  if (config.transport === "http") {
    await startHttpTransport(
      () => createMcpServer(config),
      config.httpPort,
      config.httpHost
    );
  } else {
    const { server } = createMcpServer(config);
    await startStdioTransport(server);
  }
}

main().catch((err) => {
  console.error("[LamSuite MCP] Fatal initialization error:", err);
  process.exit(1);
});
