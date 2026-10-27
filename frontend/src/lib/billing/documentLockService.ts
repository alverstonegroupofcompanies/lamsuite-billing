import { sqliteStorage } from "../db/sqliteStorage";
import { getResolvedApiBaseUrl } from "../../config/env";

export interface DocumentLockRecord {
  document_id: string;
  document_type: string;
  locked_by_counter_id: string;
  locked_by_user_id: string;
  locked_by_user_name: string;
  locked_at: number;
  expires_at: number;
}

export class DocumentLockService {
  private getEffectiveBaseUrl(): string {
    return getResolvedApiBaseUrl();
  }

  async acquireLock(
    documentId: string,
    documentType: string,
    counterId: string,
    userId: string,
    userName: string,
    ttlSeconds = 300
  ): Promise<{
    acquired: boolean;
    lockedBy?: { counterId: string; userName: string; expiresAt: number };
    message?: string;
  }> {
    // 1. Live server lock attempt first (enforces cross-counter consistency)
    try {
      const res = await fetch(`${this.getEffectiveBaseUrl()}/api/invoices/${documentId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ counter_id: counterId, counter_code: counterId, user_name: userName }),
      });

      if (res.status === 423) {
        const data = await res.json();
        return {
          acquired: false,
          lockedBy: {
            counterId: data.locked_by_counter_id || "another_counter",
            userName: "Another Cashier",
            expiresAt: data.locked_until ? new Date(data.locked_until).getTime() : Date.now() + 300000,
          },
          message: data.message || "Document is locked by another counter.",
        };
      }
    } catch {
      // Degraded offline: use local lock check
    }

    const existing = await sqliteStorage.findById<DocumentLockRecord>("document_locks", documentId);
    const now = Date.now();

    if (existing) {
      if (now < existing.expires_at && existing.locked_by_counter_id !== counterId) {
        return {
          acquired: false,
          lockedBy: {
            counterId: existing.locked_by_counter_id,
            userName: existing.locked_by_user_name,
            expiresAt: existing.expires_at,
          },
          message: `Document locked by counter ${existing.locked_by_counter_id}.`,
        };
      }
    }

    const expiresAt = now + ttlSeconds * 1000;
    const lockRecord: DocumentLockRecord = {
      document_id: documentId,
      document_type: documentType,
      locked_by_counter_id: counterId,
      locked_by_user_id: userId,
      locked_by_user_name: userName,
      locked_at: now,
      expires_at: expiresAt,
    };

    await sqliteStorage.insertRecord("document_locks", documentId, lockRecord);
    return { acquired: true };
  }

  async releaseLock(documentId: string, counterId?: string): Promise<boolean> {
    try {
      await fetch(`${this.getEffectiveBaseUrl()}/api/invoices/${documentId}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ counter_id: counterId }),
      });
    } catch {}

    const existing = await sqliteStorage.findById<DocumentLockRecord>("document_locks", documentId);
    if (!existing) return true;

    if (counterId && existing.locked_by_counter_id !== counterId && Date.now() < existing.expires_at) {
      return false;
    }

    await sqliteStorage.insertRecord("document_locks", documentId, {
      ...existing,
      expires_at: 0,
    });
    return true;
  }
}

export const documentLockService = new DocumentLockService();
