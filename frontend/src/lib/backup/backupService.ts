import { sqliteStorage } from "../db/sqliteStorage";
import { getIpcBridge } from "../ipc/ipcBridge";

export interface BackupManifest {
  table_name: string;
  record_count: number;
}

export interface BackupPackage {
  backup_id: string;
  app_version: string;
  schema_version: number;
  created_at: number;
  created_at_iso: string;
  manifest: BackupManifest[];
  data: Record<string, Record<string, unknown>[]>;
}

export class BackupService {
  private backupTables = [
    "invoices",
    "invoice_items",
    "products",
    "product_batches",
    "customers",
    "suppliers",
    "doctors",
    "patients",
    "stock_transactions",
    "sync_queue",
  ];

  async createBackupSnapshot(appVersion = "2.0.0"): Promise<BackupPackage> {
    const data: Record<string, Record<string, unknown>[]> = {};
    const manifest: BackupManifest[] = [];
    const schemaVersion = await sqliteStorage.getDatabaseVersion();

    for (const table of this.backupTables) {
      const records = await sqliteStorage.findAll<Record<string, unknown>>(table);
      data[table] = records;
      manifest.push({
        table_name: table,
        record_count: records.length,
      });
    }

    const now = Date.now();
    const backup: BackupPackage = {
      backup_id: `backup_${now}_${Math.random().toString(16).slice(2, 6)}`,
      app_version: appVersion,
      schema_version: schemaVersion,
      created_at: now,
      created_at_iso: new Date(now).toISOString(),
      manifest,
      data,
    };

    return backup;
  }

  async restoreFromSnapshot(snapshot: BackupPackage): Promise<{
    success: boolean;
    restoredTables: string[];
    totalRecordsRestored: number;
  }> {
    if (!snapshot || !snapshot.data || !Array.isArray(snapshot.manifest)) {
      throw new Error("Invalid backup format: missing manifest or data payload");
    }

    const currentVersion = await sqliteStorage.getDatabaseVersion();
    if (snapshot.schema_version > currentVersion) {
      throw new Error(
        `Backup schema version (${snapshot.schema_version}) is newer than current database version (${currentVersion})`
      );
    }

    const restoredTables: string[] = [];
    let totalRecordsRestored = 0;

    for (const [table, records] of Object.entries(snapshot.data)) {
      if (!Array.isArray(records)) continue;

      for (const rec of records) {
        const id = (rec.id as string) || (rec.code as string) || `rec_${Date.now()}`;
        await sqliteStorage.insertRecord(table, id, rec);
        totalRecordsRestored += 1;
      }

      restoredTables.push(table);
    }

    return {
      success: true,
      restoredTables,
      totalRecordsRestored,
    };
  }

  serializeBackup(backup: BackupPackage): string {
    return JSON.stringify(backup, null, 2);
  }

  deserializeBackup(jsonString: string): BackupPackage {
    return JSON.parse(jsonString) as BackupPackage;
  }
}

export const backupService = new BackupService();
