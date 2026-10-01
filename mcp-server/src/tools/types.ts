import type { z, ZodTypeAny } from "zod";
import type { Permission } from "../security/roles.js";
import type { LamSuiteApiClient } from "../client/apiClient.js";
import type { ServerConfig } from "../config.js";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

export interface ToolContext {
  client: LamSuiteApiClient;
  config: ServerConfig;
}

export interface ToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TSchema;
  annotations: ToolAnnotations;
  requiredPermission: Permission;
  isWriteTool: boolean;
  handler: (args: z.infer<TSchema>, ctx: ToolContext) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: any;
    isError?: boolean;
  }>;
}
