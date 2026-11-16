import { describe, it, expect, beforeEach } from "vitest";
import { backupService, type BackupPackage } from "./backupService";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

function makeSnapshot(overrides: Partial<BackupPackage> = {}): BackupPackage {
  return {
    backup_id: "backup_test_1",
    app_version: "2.0.0",
    schema_version: 1,
    created_at: Date.now(),
    created_at_iso: new Date().toISOString(),
    manifest: [{ table_name: "products", record_count: 1 }],
    data: {
      products: [{ id: "prod_backup_1", name: "Restored Tablet", mrp: 20, sel_rate: 18 }],
    },
    ...overrides,
  };
}

describe("BackupService restore", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  it("restores supported tables and skips unknown tables from a tampered package", async () => {
    const snapshot = makeSnapshot({
      data: {
        products: [{ id: "prod_backup_1", name: "Restored Tablet", mrp: 20, sel_rate: 18 }],
        some_unknown_table: [{ id: "x", payload: "ignored" }],
      },
    });

    const res = await backupService.restoreFromSnapshot(snapshot);

    expect(res.success).toBe(true);
    expect(res.restoredTables).toEqual(["products"]);
    expect(res.skippedTables).toEqual(["some_unknown_table"]);
    expect(res.totalRecordsRestored).toBe(1);

    const restored = await sqliteStorage.findById<{ name: string }>("products", "prod_backup_1");
    expect(restored?.name).toBe("Restored Tablet");
  });

  it("rejects packages whose only tables are unknown", async () => {
    const snapshot = makeSnapshot({
      data: { some_unknown_table: [{ id: "x" }] },
      manifest: [{ table_name: "some_unknown_table", record_count: 1 }],
    });

    await expect(backupService.restoreFromSnapshot(snapshot)).rejects.toThrow(/no restorable tables/i);
  });

  it("rejects a backup with a newer schema version", async () => {
    const currentVersion = await sqliteStorage.getDatabaseVersion();
    const snapshot = makeSnapshot({ schema_version: currentVersion + 1 });

    await expect(backupService.restoreFromSnapshot(snapshot)).rejects.toThrow(/newer than current database version/i);
  });

  it("rejects malformed records instead of writing them", async () => {
    const snapshot = makeSnapshot({
      data: { products: ["not-an-object"] as unknown as Record<string, unknown>[] },
    });

    await expect(backupService.restoreFromSnapshot(snapshot)).rejects.toThrow(/Invalid backup record/i);
  });
});
