import { sqliteStorage } from "../db/sqliteStorage";

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
  }> {
    const existing = await sqliteStorage.findById<DocumentLockRecord>("document_locks", documentId);
    const now = Date.now();

    if (existing) {
      // Check if lock has expired
      if (now < existing.expires_at && existing.locked_by_counter_id !== counterId) {
        return {
          acquired: false,
          lockedBy: {
            counterId: existing.locked_by_counter_id,
            userName: existing.locked_by_user_name,
            expiresAt: existing.expires_at,
          },
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
    const existing = await sqliteStorage.findById<DocumentLockRecord>("document_locks", documentId);
    if (!existing) return true;

    if (counterId && existing.locked_by_counter_id !== counterId) {
      return false; // Cannot release another counter's active lock
    }

    return await sqliteStorage.deleteRecord("document_locks", documentId);
  }

  async isLocked(documentId: string): Promise<{
    isLocked: boolean;
    lockedBy?: { counterId: string; userName: string; expiresAt: number };
  }> {
    const existing = await sqliteStorage.findById<DocumentLockRecord>("document_locks", documentId);
    if (!existing) return { isLocked: false };

    if (Date.now() >= existing.expires_at) {
      await sqliteStorage.deleteRecord("document_locks", documentId);
      return { isLocked: false };
    }

    return {
      isLocked: true,
      lockedBy: {
        counterId: existing.locked_by_counter_id,
        userName: existing.locked_by_user_name,
        expiresAt: existing.expires_at,
      },
    };
  }
}

export const documentLockService = new DocumentLockService();
