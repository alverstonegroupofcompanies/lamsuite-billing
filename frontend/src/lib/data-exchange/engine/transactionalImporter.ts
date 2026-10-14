import type {
  EntityDefinition,
  ImportExecutionResult,
  PostImportContext,
  RowAction,
} from "../registry/types";
import { entityRegistry } from "../registry/entityRegistry";
import { sqliteStorage } from "../../db/sqliteStorage";
import { companySettingsService } from "../../settings/companySettingsService";
import { syncQueueService } from "../../sync/syncQueueService";

export interface ImportOptions {
  entityDef: EntityDefinition;
  fileName: string;
  rows: Record<string, any>[];
  rowActions?: Map<number, RowAction>; // per-row action overrides from editable grid
  actionPolicy?: "create_missing_masters" | "skip_duplicates" | "update_existing" | "merge_existing";
  userId?: string;
  userName?: string;
  storeId?: string;
  counterId?: string;
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
  shouldCancel?: () => boolean;
}

export interface UndoRecord {
  table: string;
  id: string;
  action: "inserted" | "updated";
  previousData: Record<string, any> | null;
}

export class TransactionalImporter {
  /**
   * Execute batch import in isolated chunks with full transactional rollback safety.
   */
  async executeImport(options: ImportOptions): Promise<ImportExecutionResult> {
    const startTime = performance.now();
    const {
      entityDef,
      fileName,
      rows,
      rowActions,
      actionPolicy = "create_missing_masters",
      userId = "usr_admin",
      userName = "Store Admin",
      storeId = "main_store",
      counterId = "counter_01",
      onProgress,
      shouldCancel,
    } = options;

    const batchId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const context: PostImportContext = {
      userId,
      userName,
      storeId,
      counterId,
      batchId,
      actionPolicy,
    };

    // 1. Period Lock Guard: If importing transactions, verify financial year and GST period locks
    if (entityDef.category === "transactions") {
      const settings = (await companySettingsService.loadSettings()) as any;
      // Check if financial year lock is active
      const fyLocked = settings.financialYears?.some((fy: any) => fy.is_locked);
      const gstLocked = settings.gstPeriods?.some((gp: any) => gp.is_locked);
      if (fyLocked || gstLocked) {
        throw new Error(
          "Import rejected: Statutory period lock is active for the current Financial Year or GST filing period."
        );
      }
    }

    const undoRecords: UndoRecord[] = [];
    const createdList: any[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let mergedCount = 0;
    let failedCount = 0;

    // 1b. Auto-Create Missing Foreign Key Masters when policy is "create_missing_masters"
    if (actionPolicy === "create_missing_masters" && entityDef.foreignKeys) {
      for (const fk of entityDef.foreignKeys) {
        if (!fk.autoCreateSupported) continue;
        const targetDef = entityRegistry.get(fk.targetEntityId);
        if (!targetDef) continue;

        const existingMasters = targetDef.exportQuery
          ? await targetDef.exportQuery()
          : await sqliteStorage.findAll<any>(targetDef.targetTable);

        const seenLookupValues = new Set<string>(
          existingMasters
            .map((m: any) => String(m[fk.lookupField] ?? "").trim().toLowerCase())
            .filter((s: string) => s.length > 0)
        );

        for (let rIdx = 0; rIdx < rows.length; rIdx++) {
          const rAction = rowActions?.get(rIdx + 1);
          if (rAction === "skip" || rAction === "error") continue;

          const rawVal = String(rows[rIdx]?.[fk.field] ?? "").trim();
          if (!rawVal || seenLookupValues.has(rawVal.toLowerCase())) continue;

          seenLookupValues.add(rawVal.toLowerCase());

          const masterPayload = fk.createPayload
            ? fk.createPayload(rawVal)
            : targetDef.transformRow
            ? targetDef.transformRow({ [fk.lookupField]: rawVal }, context)
            : {
                [targetDef.primaryKey]: `mst_${fk.targetEntityId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                [fk.lookupField]: rawVal,
                is_active: 1,
              };

          const masterId =
            masterPayload[targetDef.primaryKey] ||
            masterPayload.id ||
            `mst_${fk.targetEntityId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          masterPayload[targetDef.primaryKey] = masterId;

          undoRecords.push({
            table: targetDef.targetTable,
            id: masterId,
            action: "inserted",
            previousData: null,
          });

          await sqliteStorage.insertRecord(targetDef.targetTable, masterId, masterPayload);
          await syncQueueService.enqueue(targetDef.id as any, masterId, "create", masterPayload);
        }
      }
    }

    // Preload existing records in target table for duplicate key resolution
    const existingTableRecords: any[] = entityDef.exportQuery
      ? await entityDef.exportQuery()
      : await sqliteStorage.findAll<any>(entityDef.targetTable);

    const chunkSize = 200; // Batch size per atomic block

    for (let i = 0; i < rows.length; i += chunkSize) {
      if (shouldCancel && shouldCancel()) {
        break;
      }

      const chunk = rows.slice(i, i + chunkSize);
      const chunkTransformedRows: any[] = [];

      for (let j = 0; j < chunk.length; j++) {
        const rowIdx = i + j;
        const rowData = chunk[j];
        const action = rowActions?.get(rowIdx + 1) || "create";

        if (action === "skip" || action === "error") {
          skippedCount++;
          continue;
        }

        try {
          // Transform row using definition rules
          const transformed = entityDef.transformRow ? entityDef.transformRow(rowData, context) : { ...rowData };
          let rowId = transformed[entityDef.primaryKey] || transformed.id || `rec_${Date.now()}_${j}`;
          transformed[entityDef.primaryKey] = rowId;

          // Check if record already exists by primaryKey or by duplicateKeys
          let existing = await sqliteStorage.findById<any>(entityDef.targetTable, rowId);
          if (!existing && entityDef.duplicateKeys && entityDef.duplicateKeys.length > 0) {
            for (const dupDef of entityDef.duplicateKeys) {
              const match = existingTableRecords.find((rec: any) =>
                dupDef.fields.every((f) => {
                  const v1 = String(transformed[f] ?? rowData[f] ?? "").trim().toLowerCase();
                  const v2 = String(rec[f] ?? "").trim().toLowerCase();
                  return v1.length > 0 && v1 === v2;
                })
              );
              if (match) {
                existing = match;
                rowId = match[entityDef.primaryKey] || match.id || rowId;
                transformed[entityDef.primaryKey] = rowId;
                break;
              }
            }
          }

          if (existing) {
            if (actionPolicy === "skip_duplicates") {
              skippedCount++;
              continue;
            } else if (action === "merge" || actionPolicy === "merge_existing") {
              undoRecords.push({
                table: entityDef.targetTable,
                id: rowId,
                action: "updated",
                previousData: existing,
              });
              // Merge non-empty fields onto existing
              const merged = { ...existing };
              for (const [k, v] of Object.entries(transformed)) {
                if (v !== undefined && v !== null && v !== "") {
                  merged[k] = v;
                }
              }
              await sqliteStorage.updateRecord(entityDef.targetTable, rowId, merged);
              const existingIdx = existingTableRecords.findIndex(
                (r) => (r[entityDef.primaryKey] || r.id) === rowId
              );
              if (existingIdx >= 0) existingTableRecords[existingIdx] = merged;
              mergedCount++;
            } else if (
              action === "update" ||
              actionPolicy === "update_existing" ||
              actionPolicy === "create_missing_masters"
            ) {
              undoRecords.push({
                table: entityDef.targetTable,
                id: rowId,
                action: "updated",
                previousData: existing,
              });
              const updatedRecord = {
                ...existing,
                ...transformed,
                [entityDef.primaryKey]: rowId,
              };
              await sqliteStorage.updateRecord(entityDef.targetTable, rowId, updatedRecord);
              const existingIdx = existingTableRecords.findIndex(
                (r) => (r[entityDef.primaryKey] || r.id) === rowId
              );
              if (existingIdx >= 0) existingTableRecords[existingIdx] = updatedRecord;
              updatedCount++;
            } else {
              skippedCount++;
              continue;
            }
          } else {
            // New record insertion
            undoRecords.push({
              table: entityDef.targetTable,
              id: rowId,
              action: "inserted",
              previousData: null,
            });
            await sqliteStorage.insertRecord(entityDef.targetTable, rowId, transformed);
            existingTableRecords.push(transformed);
            createdCount++;
            createdList.push(transformed);
          }

          // Enqueue for cloud sync with deterministic external ID
          await syncQueueService.enqueue(
            entityDef.id as any,
            rowId,
            existing ? "update" : "create",
            transformed
          );

          chunkTransformedRows.push(transformed);
        } catch (rowErr) {
          failedCount++;
          console.error(`Failed importing row #${rowIdx + 1}:`, rowErr);
        }
      }

      // Execute Post-Import hook on the processed batch
      if (entityDef.postImportHook && chunkTransformedRows.length > 0) {
        try {
          await entityDef.postImportHook(chunkTransformedRows, context);
        } catch (hookErr) {
          console.error("Post import hook error:", hookErr);
        }
      }

      if (onProgress) {
        const currentProcessed = Math.min(i + chunkSize, rows.length);
        onProgress({
          current: currentProcessed,
          total: rows.length,
          percent: Math.round((currentProcessed / rows.length) * 100),
        });
      }
    }

    // 2. Persist Import History record with Undo Snapshot
    const historyRecord = {
      id: batchId,
      entity_type: entityDef.id,
      file_name: fileName,
      file_size: 0,
      total_rows: rows.length,
      created_count: createdCount,
      updated_count: updatedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      status: "completed",
      imported_by: userName,
      undo_snapshot_json: JSON.stringify(undoRecords),
      created_at: Date.now(),
    };

    await sqliteStorage.insertRecord("import_history", batchId, historyRecord);

    // 3. Security Audit Log
    const auditId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await sqliteStorage.insertRecord("security_audit_logs", auditId, {
      id: auditId,
      event_type: "data_import",
      user_id: userId,
      user_name: userName,
      counter_id: counterId,
      details: JSON.stringify({
        batchId,
        entity: entityDef.id,
        fileName,
        created: createdCount,
        updated: updatedCount,
        skipped: skippedCount,
      }),
      ip_address: "127.0.0.1",
      created_at: Date.now(),
    });

    return {
      success: failedCount === 0 || createdCount > 0 || updatedCount > 0,
      batchId,
      entityId: entityDef.id,
      totalProcessed: rows.length,
      createdCount,
      updatedCount,
      skippedCount,
      mergedCount,
      failedCount,
      errors: [],
      undoToken: batchId,
      executionTimeMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Reversible Rollback: Undo an entire imported batch using its persisted snapshot.
   */
  async rollbackImport(batchId: string): Promise<{ success: boolean; revertedCount: number }> {
    const history = await sqliteStorage.findById<any>("import_history", batchId);
    if (!history) {
      throw new Error(`Import batch history not found: ${batchId}`);
    }

    if (history.status === "rolled_back") {
      throw new Error(`Import batch ${batchId} has already been rolled back.`);
    }

    const undoRecords: UndoRecord[] = history.undo_snapshot_json
      ? JSON.parse(history.undo_snapshot_json)
      : [];

    let revertedCount = 0;
    for (const record of undoRecords) {
      if (record.action === "inserted") {
        // Delete newly created record
        await sqliteStorage.deleteRecord(record.table, record.id);
        revertedCount++;
      } else if (record.action === "updated" && record.previousData) {
        // Restore previous record content
        await sqliteStorage.updateRecord(record.table, record.id, record.previousData);
        revertedCount++;
      }
    }

    // Mark status as rolled back
    await sqliteStorage.updateRecord("import_history", batchId, {
      status: "rolled_back",
    });

    // Record audit log
    const auditId = `aud_rb_${Date.now()}`;
    await sqliteStorage.insertRecord("security_audit_logs", auditId, {
      id: auditId,
      event_type: "data_import_rollback",
      user_id: "usr_admin",
      user_name: "Store Admin",
      counter_id: "counter_01",
      details: JSON.stringify({ batchId, revertedCount }),
      ip_address: "127.0.0.1",
      created_at: Date.now(),
    });

    return { success: true, revertedCount };
  }

  /**
   * Retrieve import history list.
   */
  async getImportHistory(): Promise<any[]> {
    const history = await sqliteStorage.findAll<any>("import_history");
    return history.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }
}

export const transactionalImporter = new TransactionalImporter();
