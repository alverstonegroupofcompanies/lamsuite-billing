import fs from "fs";
import path from "path";
import { redactSecrets } from "./mask.js";
import { sanitizeUntrustedPayload } from "./sanitizer.js";
import type { UserRole } from "./roles.js";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  tool: string;
  args: Record<string, any>;
  user: {
    id?: number | string;
    role: UserRole;
    storeId: number;
  };
  result: "success" | "error";
  durationMs: number;
  errorMessage?: string;
}

export class AuditLogger {
  private logFilePath: string;
  private memoryLogs: AuditLogEntry[] = [];
  private maxMemoryEntries: number;

  constructor(logFilePath: string = "./audit.log", maxMemoryEntries: number = 200) {
    this.logFilePath = logFilePath;
    this.maxMemoryEntries = maxMemoryEntries;
  }

  log(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      args: sanitizeUntrustedPayload(redactSecrets(entry.args)),
      user: entry.user,
      result: entry.result,
      durationMs: entry.durationMs,
      errorMessage: entry.errorMessage,
    };

    // Store in memory ring buffer
    this.memoryLogs.push(fullEntry);
    if (this.memoryLogs.length > this.maxMemoryEntries) {
      this.memoryLogs.shift();
    }

    // Append to file asynchronously
    try {
      const line = JSON.stringify(fullEntry) + "\n";
      const dir = path.dirname(path.resolve(this.logFilePath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.logFilePath, line, "utf8");
    } catch (err) {
      // Don't crash server if audit log writing fails, log to stderr
      console.error("[AuditLogger] Failed to write to audit log file:", err);
    }

    return fullEntry;
  }

  getRecentLogs(limit: number = 50): AuditLogEntry[] {
    return this.memoryLogs.slice(-limit);
  }

  clearMemoryLogs(): void {
    this.memoryLogs = [];
  }
}

export const auditLogger = new AuditLogger();
