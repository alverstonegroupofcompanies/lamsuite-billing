import { backupService } from "./backupService";
import { sqliteStorage } from "../db/sqliteStorage";

const LAST_AUTO_BACKUP_KEY = "lamsuite_last_auto_backup_date";

export class DailyAutoBackupService {
  /**
   * Run daily automatic backup if not yet executed today
   */
  async runDailyBackupCheck(): Promise<{ executed: boolean; backupId?: string }> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const lastBackupDate = localStorage.getItem(LAST_AUTO_BACKUP_KEY);

      if (lastBackupDate === today) {
        return { executed: false };
      }

      // Check if there are any invoices or products before creating snapshot
      const invoicesCount = await sqliteStorage.count("invoices");
      const productsCount = await sqliteStorage.count("products");

      if (invoicesCount === 0 && productsCount === 0) {
        return { executed: false };
      }

      const snapshot = await backupService.createBackupSnapshot();
      localStorage.setItem(LAST_AUTO_BACKUP_KEY, today);
      console.log(`[AutoBackup] Daily automated snapshot created: ${snapshot.backup_id}`);

      return { executed: true, backupId: snapshot.backup_id };
    } catch (err) {
      console.warn("[AutoBackup] Daily backup check failed:", err);
      return { executed: false };
    }
  }
}

export const dailyAutoBackupService = new DailyAutoBackupService();
