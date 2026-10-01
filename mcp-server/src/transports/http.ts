import express, { type Request, type Response } from "express";
import cors from "cors";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ServerConfig } from "../config.js";

export function createHttpServer(
  serverFactory: () => { server: Server; config: ServerConfig }
) {
  const app = express();
  app.use(cors());

  // Store active SSE sessions
  const sessions = new Map<string, { transport: SSEServerTransport; server: Server }>();

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    const { config } = serverFactory();
    res.json({
      status: "healthy",
      service: "lamsuite-mcp-server",
      transport: "http-sse",
      read_only: config.readOnly,
      store_id: config.storeId,
      active_sessions: sessions.size,
    });
  });

  // SSE stream endpoint
  app.get("/sse", async (req: Request, res: Response) => {
    const { server } = serverFactory();
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;

    sessions.set(sessionId, { transport, server });

    transport.onclose = () => {
      sessions.delete(sessionId);
    };

    await server.connect(transport);
  });

  // Message POST endpoint for SSE sessions
  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      res.status(400).send("Missing sessionId query parameter");
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).send(`Session not found: ${sessionId}`);
      return;
    }

    await session.transport.handlePostMessage(req, res);
  });

  return app;
}

export async function startHttpTransport(
  serverFactory: () => { server: Server; config: ServerConfig },
  port: number,
  host: string = "0.0.0.0"
): Promise<void> {
  const app = createHttpServer(serverFactory);
  return new Promise((resolve) => {
    app.listen(port, host, () => {
      console.error(
        `[LamSuite MCP] Streamable HTTP server listening on http://${host}:${port} (SSE: /sse, Health: /health)`
      );
      resolve();
    });
  });
}
