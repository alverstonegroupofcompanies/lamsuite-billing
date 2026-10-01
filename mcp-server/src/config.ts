import { z } from "zod";

export const ConfigSchema = z.object({
  apiUrl: z.string().url().default("http://localhost:8000/api"),
  apiToken: z.string().optional().default(""),
  email: z.string().optional().default(""),
  password: z.string().optional().default(""),
  storeCode: z.string().default("STORE-01"),
  storeId: z.number().int().positive().default(1),
  readOnly: z.boolean().default(true),
  role: z.enum(["admin", "manager", "cashier", "pharmacist", "auditor"]).default("admin"),
  timeoutMs: z.number().positive().default(15000),
  rateLimitRpm: z.number().positive().default(120),
  auditLogPath: z.string().default("./audit.log"),
  transport: z.enum(["stdio", "http"]).default("stdio"),
  httpPort: z.number().int().positive().default(3000),
  httpHost: z.string().default("0.0.0.0"),
});

export type ServerConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const readOnlyEnv = process.env.LAMSUITE_READ_ONLY;
  const readOnly =
    readOnlyEnv === undefined
      ? true
      : readOnlyEnv.toLowerCase() === "true" || readOnlyEnv === "1";

  // Parse command line arguments for flags like --transport=http or --port=3000
  const args = process.argv.slice(2);
  let cliTransport: "stdio" | "http" | undefined;
  let cliPort: number | undefined;

  for (const arg of args) {
    if (arg === "--http" || arg === "--transport=http") {
      cliTransport = "http";
    } else if (arg === "--stdio" || arg === "--transport=stdio") {
      cliTransport = "stdio";
    } else if (arg.startsWith("--port=")) {
      cliPort = parseInt(arg.split("=")[1], 10);
    }
  }

  const raw = {
    apiUrl: process.env.LAMSUITE_API_URL || "http://localhost:8000/api",
    apiToken: process.env.LAMSUITE_API_TOKEN || "",
    email: process.env.LAMSUITE_EMAIL || "",
    password: process.env.LAMSUITE_PASSWORD || "",
    storeCode: process.env.LAMSUITE_STORE_CODE || "STORE-01",
    storeId: process.env.LAMSUITE_STORE_ID ? Number(process.env.LAMSUITE_STORE_ID) : 1,
    readOnly,
    role: (process.env.LAMSUITE_API_ROLE as any) || "admin",
    timeoutMs: process.env.LAMSUITE_TIMEOUT_MS ? Number(process.env.LAMSUITE_TIMEOUT_MS) : 15000,
    rateLimitRpm: process.env.LAMSUITE_RATE_LIMIT ? Number(process.env.LAMSUITE_RATE_LIMIT) : 120,
    auditLogPath: process.env.LAMSUITE_AUDIT_LOG || "./audit.log",
    transport: cliTransport || (process.env.LAMSUITE_MCP_TRANSPORT as any) || "stdio",
    httpPort: cliPort || (process.env.PORT ? Number(process.env.PORT) : 3000),
    httpHost: process.env.LAMSUITE_MCP_HOST || "0.0.0.0",
    ...overrides,
  };

  return ConfigSchema.parse(raw);
}
