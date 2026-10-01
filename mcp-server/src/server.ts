import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

import type { ServerConfig } from "./config.js";
import { LamSuiteApiClient } from "./client/apiClient.js";
import { ToolRegistry } from "./tools/registry.js";
import { STORE_RESOURCES } from "./resources/index.js";
import { STORE_PROMPTS } from "./prompts/index.js";

export function createMcpServer(config: ServerConfig) {
  const client = new LamSuiteApiClient(config);
  const toolRegistry = new ToolRegistry(config.rateLimitRpm);

  // Initialize tool registry respecting readOnly mode
  toolRegistry.init(config.readOnly);

  const server = new Server(
    {
      name: "lamsuite-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    }
  );

  // 1. Tool Handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolRegistry.listTools(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    return await toolRegistry.executeTool(name, toolArgs, { client, config });
  });

  // 2. Resource Handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: STORE_RESOURCES.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = STORE_RESOURCES.find((r) => r.uri === request.params.uri);
    if (!resource) {
      throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${request.params.uri}`);
    }

    const text = await resource.handler(client);
    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text,
        },
      ],
    };
  });

  // 3. Prompt Handlers
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: STORE_PROMPTS.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = STORE_PROMPTS.find((p) => p.name === request.params.name);
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${request.params.name}`);
    }

    const args = (request.params.arguments || {}) as Record<string, string>;
    const res = prompt.template(args);
    return {
      description: res.description,
      messages: res.messages,
    };
  });

  return { server, client, toolRegistry, config };
}
