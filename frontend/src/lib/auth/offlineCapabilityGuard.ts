import { onlineTransactionService } from "../sync/onlineTransactionService";
import { companySettingsService } from "../settings/companySettingsService";

export type OfflineOperation =
  | "create_sale"
  | "hold_bill"
  | "sales_return"
  | "create_quotation"
  | "receive_payment"
  | "print_receipt"
  | "cancel_synced_bill"
  | "edit_synced_bill"
  | "stock_adjustment"
  | "stock_transfer"
  | "purchase_entry"
  | "master_edit"
  | "live_reports";

export interface OperationGuardResult {
  allowed: boolean;
  isOffline: boolean;
  reason?: string;
  isWatermarked?: boolean;
}

const DEFAULT_OFFLINE_ALLOWED: Set<OfflineOperation> = new Set([
  "create_sale",
  "hold_bill",
  "sales_return",
  "create_quotation",
  "receive_payment",
  "print_receipt",
  "live_reports", // Allowed with cached watermark
]);

export class OfflineCapabilityGuard {
  isOperationAllowed(operation: OfflineOperation, userRole = "cashier"): OperationGuardResult {
    const health = onlineTransactionService.getHealthSnapshot();
    // Synchronously check state
    const isOffline = (onlineTransactionService as any).connectionState === "offline";

    if (!isOffline) {
      return { allowed: true, isOffline: false };
    }

    // Check custom store settings permissions if configured
    try {
      const settings = companySettingsService.getSettings();
      const customAllowed = (settings as any)?.offline_permissions?.[userRole];
      if (Array.isArray(customAllowed)) {
        if (customAllowed.includes(operation)) {
          return {
            allowed: true,
            isOffline: true,
            isWatermarked: operation === "live_reports",
          };
        }
      }
    } catch {
      // Use defaults
    }

    if (DEFAULT_OFFLINE_ALLOWED.has(operation)) {
      return {
        allowed: true,
        isOffline: true,
        isWatermarked: operation === "live_reports",
      };
    }

    // Operation is blocked while offline
    const reasons: Record<string, string> = {
      cancel_synced_bill: "Cancelling synced invoices requires a live cloud connection to maintain store ledger integrity.",
      edit_synced_bill: "Editing historical invoices requires live document locking across all counters.",
      stock_adjustment: "Manual stock adjustments are disabled in offline mode to prevent reconciliation conflicts.",
      stock_transfer: "Inter-store transfers require live cloud connection with the destination branch.",
      purchase_entry: "Posting purchases and updating supplier balances requires live cloud validation.",
      master_edit: "Editing products, batches, or selling rates while offline is disabled to prevent data drift.",
    };

    return {
      allowed: false,
      isOffline: true,
      reason: reasons[operation] || "This operation is restricted while running in offline fallback mode.",
    };
  }
}

export const offlineCapabilityGuard = new OfflineCapabilityGuard();
