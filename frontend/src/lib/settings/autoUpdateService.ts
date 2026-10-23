import { checkUpdate, installUpdate, onUpdaterEvent, type UpdateStatusResult } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";

export interface UpdateInfo {
  shouldUpdate: boolean;
  manifest?: {
    version: string;
    date?: string;
    body?: string;
  };
}

export type UpdateProgressCallback = (status: UpdateStatusResult) => void;

class AutoUpdateService {
  private isChecking: boolean = false;
  private isDownloading: boolean = false;
  private unlistenStatus: (() => void) | null = null;

  /**
   * Check if running in a Tauri desktop environment
   */
  public isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_IPC__" in window;
  }

  /**
   * Check if a new version is available from the API server
   */
  public async checkForUpdates(): Promise<UpdateInfo> {
    if (!this.isTauri()) {
      return { shouldUpdate: false };
    }

    if (this.isChecking) {
      return { shouldUpdate: false };
    }

    this.isChecking = true;
    try {
      const updateResult = await checkUpdate();
      return {
        shouldUpdate: updateResult.shouldUpdate,
        manifest: updateResult.manifest
          ? {
              version: updateResult.manifest.version,
              date: updateResult.manifest.date,
              body: updateResult.manifest.body,
            }
          : undefined,
      };
    } catch (err) {
      console.warn("[AutoUpdate] Check failed:", err);
      throw err;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Download and install the update, then relaunch the application
   */
  public async installAndRestart(onProgress?: UpdateProgressCallback): Promise<void> {
    if (!this.isTauri()) {
      throw new Error("Updates can only be installed in desktop environment");
    }

    if (this.isDownloading) {
      return;
    }

    this.isDownloading = true;

    try {
      if (onProgress) {
        if (this.unlistenStatus) {
          this.unlistenStatus();
        }
        this.unlistenStatus = await onUpdaterEvent((status) => {
          onProgress(status);
        });
      }

      await installUpdate();

      // Relaunch the app to apply the installed update
      await relaunch();
    } catch (err) {
      console.error("[AutoUpdate] Installation failed:", err);
      throw err;
    } finally {
      this.isDownloading = false;
      if (this.unlistenStatus) {
        this.unlistenStatus();
        this.unlistenStatus = null;
      }
    }
  }
}

export const autoUpdateService = new AutoUpdateService();
