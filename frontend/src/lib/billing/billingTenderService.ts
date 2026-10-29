import { sqliteStorage } from "../db/sqliteStorage";
import type { PaymentSettingsConfig, PaymentModeConfig } from "../settings/companySettingsService";

export interface PaymentTenderLine {
  id?: string;
  mode: "Cash" | "UPI" | "Card" | "Bank Transfer" | "Cheque" | "Wallet" | "Gift Voucher" | "Credit" | string;
  amount: number;
  reference_no?: string;
  reference?: string;
  status?: "received" | "pending_clearance" | "cleared" | "bounced" | "refunded";
  card_last_four?: string;
  card_network?: string;
  bank_name?: string;
  cheque_date?: string;
  payer_vpa?: string;
  notes?: string;
  extra_fields?: {
    card_last_four?: string;
    card_network?: string;
    bank_name?: string;
    cheque_date?: string;
    payer_vpa?: string;
    notes?: string;
  };
}

export interface InvoicePaymentRecord {
  id: string;
  invoice_id: string;
  store_id?: string;
  counter_id?: string;
  counter_code?: string;
  shift_id?: string;
  payment_mode: string;
  amount: number;
  reference_no?: string;
  status: "received" | "pending_clearance" | "cleared" | "bounced" | "refunded";
  extra_fields?: string; // JSON
  notes?: string;
  received_by?: string;
  created_at: number;
  updated_at: number;
}

export interface HeldBill {
  id: string;
  sequence: number;
  customer_name?: string;
  items_count: number;
  grand_total: number;
  held_at: number;
  cart_payload: Record<string, unknown>;
}

export interface TenderCalculationResult {
  totalPaid: number;
  totalTendered: number;
  cashAmount: number;
  nonCashAmount: number;
  creditAmount: number;
  balanceDue: number;
  balanceRemaining: number;
  changeDue: number;
  isFullyPaid: boolean;
  hasNonCashOverpayment: boolean;
  nonCashOverpaid: boolean;
  statusBadge: {
    text: string;
    type: "fully_paid" | "remaining" | "change" | "error";
  };
}

let holdCounter = 0;

export class BillingTenderService {
  private heldBills = new Map<string, HeldBill>();

  /**
   * Precise tender calculation adhering to Indian Retail & Cash Drawer Rules:
   * 1. Payment lines are exact to the paisa.
   * 2. Cash tendered can exceed the amount due, producing Change Due.
   * 3. Change is calculated strictly from the Cash line. Non-cash lines (UPI, Card, Bank)
   *    can never produce change or exceed what is due.
   */
  calculateTenderBalance(grandTotal: number, payments: PaymentTenderLine[]): TenderCalculationResult {
    const roundedGrandTotal = Math.round(((Number(grandTotal) || 0) + Number.EPSILON) * 100) / 100;

    let totalTendered = 0;
    let cashAmount = 0;
    let nonCashAmount = 0;
    let creditAmount = 0;

    for (const p of payments) {
      const amt = Math.round(((Number(p.amount) || 0) + Number.EPSILON) * 100) / 100;
      if (amt <= 0) continue;
      totalTendered += amt;

      const upper = (p.mode || "").trim().toUpperCase();
      if (upper === "CASH") {
        cashAmount += amt;
      } else if (upper === "CREDIT" || upper === "UDHARI") {
        creditAmount += amt;
      } else {
        nonCashAmount += amt;
      }
    }

    totalTendered = Math.round((totalTendered + Number.EPSILON) * 100) / 100;
    cashAmount = Math.round((cashAmount + Number.EPSILON) * 100) / 100;
    nonCashAmount = Math.round((nonCashAmount + Number.EPSILON) * 100) / 100;
    creditAmount = Math.round((creditAmount + Number.EPSILON) * 100) / 100;

    // Check non-cash overpayment rule: Non-cash lines alone or combined must not exceed total due
    const nonCashTotal = Math.round((nonCashAmount + creditAmount + Number.EPSILON) * 100) / 100;
    const hasNonCashOverpayment = nonCashTotal > roundedGrandTotal;

    let changeDue = 0;
    if (totalTendered > roundedGrandTotal) {
      const excess = Math.round((totalTendered - roundedGrandTotal + Number.EPSILON) * 100) / 100;
      if (excess <= cashAmount) {
        changeDue = excess;
      } else {
        // Cash didn't cover the entire excess -> non-cash overpayment
        changeDue = cashAmount;
      }
    }

    const effectivePaid = Math.round((totalTendered - changeDue + Number.EPSILON) * 100) / 100;
    const balanceDue = Math.max(0, Math.round((roundedGrandTotal - effectivePaid + Number.EPSILON) * 100) / 100);
    const isFullyPaid = balanceDue <= 0.001 && !hasNonCashOverpayment;

    let statusBadge: TenderCalculationResult["statusBadge"] = {
      text: `${balanceDue.toFixed(2)} remaining`,
      type: "remaining",
    };

    if (hasNonCashOverpayment) {
      statusBadge = {
        text: "Non-cash tender exceeds bill amount",
        type: "error",
      };
    } else if (isFullyPaid && changeDue > 0) {
      statusBadge = {
        text: `Change due ₹${changeDue.toFixed(2)}`,
        type: "change",
      };
    } else if (isFullyPaid) {
      statusBadge = {
        text: "Fully paid",
        type: "fully_paid",
      };
    } else {
      statusBadge = {
        text: `₹${balanceDue.toFixed(2)} remaining`,
        type: "remaining",
      };
    }

    return {
      totalPaid: effectivePaid,
      totalTendered,
      cashAmount,
      nonCashAmount,
      creditAmount,
      balanceDue,
      balanceRemaining: balanceDue,
      changeDue,
      isFullyPaid,
      hasNonCashOverpayment,
      nonCashOverpaid: hasNonCashOverpayment,
      statusBadge,
    };
  }

  /**
   * Auto-fill the remaining balance into a payment line or calculate what remains.
   */
  calculateRemainderForLine(grandTotal: number, payments: PaymentTenderLine[], lineIndex: number): number {
    const roundedGrandTotal = Math.round(((Number(grandTotal) || 0) + Number.EPSILON) * 100) / 100;
    let sumOthers = 0;

    payments.forEach((p, idx) => {
      if (idx !== lineIndex) {
        sumOthers += Math.round(((Number(p.amount) || 0) + Number.EPSILON) * 100) / 100;
      }
    });

    const remainder = Math.max(0, Math.round((roundedGrandTotal - sumOthers + Number.EPSILON) * 100) / 100);
    return remainder;
  }

  /**
   * Split the bill evenly across multiple modes (e.g. 50/50 split).
   * Allocates any odd paisa to the first line so sum strictly equals grandTotal.
   */
  splitEvenly(grandTotal: number, modes: string[] = ["Cash", "UPI"]): PaymentTenderLine[] {
    const totalPaisa = Math.round(((Number(grandTotal) || 0) + Number.EPSILON) * 100);
    const count = Math.max(1, modes.length);
    const basePaisa = Math.floor(totalPaisa / count);
    const remainderPaisa = totalPaisa % count;

    return modes.map((mode, idx) => {
      const linePaisa = basePaisa + (idx === 0 ? remainderPaisa : 0);
      return {
        id: `pay_${Date.now()}_${idx}`,
        mode,
        amount: Math.round(linePaisa) / 100,
        status: "received",
      };
    });
  }

  /**
   * Validate payment lines before final checkout.
   */
  async validatePaymentLines(
    grandTotal: number,
    payments: PaymentTenderLine[],
    customer: { id?: string; name?: string; credit_limit?: number; current_balance?: number } | null,
    settings?: PaymentSettingsConfig
  ): Promise<{
    valid: boolean;
    error?: string;
    warning?: string;
    focusIndex?: number;
    focusField?: "amount" | "reference_no";
  }> {
    if (!payments || payments.length === 0) {
      return { valid: false, error: "At least one payment line is required." };
    }

    let warning: string | undefined;

    const calc = this.calculateTenderBalance(grandTotal, payments);

    if (calc.hasNonCashOverpayment) {
      return {
        valid: false,
        error: "Non-cash payments (UPI, Card, Bank) cannot exceed the amount due. Change can only be returned for Cash.",
      };
    }

    if (!calc.isFullyPaid) {
      return {
        valid: false,
        error: `Bill is not fully settled. ₹${calc.balanceDue.toFixed(2)} remaining. Add a payment line or allocate remainder to Credit.`,
      };
    }

    // Verify each line's amount and references
    for (let i = 0; i < payments.length; i++) {
      const line = payments[i];
      const amt = Number(line.amount) || 0;
      if (amt <= 0) {
        return {
          valid: false,
          error: `Line ${i + 1} (${line.mode}): Payment amount must be greater than zero.`,
          focusIndex: i,
          focusField: "amount",
        };
      }

      const upperMode = (line.mode || "").trim().toUpperCase();

      // Credit Rules
      if (upperMode === "CREDIT" || upperMode === "UDHARI") {
        const isWalkIn = !customer?.id || !customer?.name || customer.name.toLowerCase().includes("walk-in");
        if (isWalkIn) {
          return {
            valid: false,
            error: "Credit (Udhari) sale is not allowed for Walk-in Customers. Please select a registered customer.",
            focusIndex: i,
          };
        }

        const creditLimit = Number(customer?.credit_limit) || 0;
        if (creditLimit > 0) {
          const currentBal = Number(customer?.current_balance) || 0;
          const newBal = currentBal + amt;
          if (newBal > creditLimit) {
            const msg = `Credit limit exceeded! Customer's limit is ₹${creditLimit.toFixed(2)}, new balance would be ₹${newBal.toFixed(2)}.`;
            if (settings?.creditPolicy === "block_on_exceed" || (settings?.creditPolicy as string) === "block") {
              return { valid: false, error: msg, focusIndex: i };
            } else {
              warning = msg;
            }
          }
        }
      }

      // Mode configuration & Reference rules
      if (settings?.modes) {
        const modeKey = line.mode.toLowerCase().replace(/[^a-z0-9]/g, "_");
        const cfg = settings.modes.find((m) => m.id === modeKey || m.name.toLowerCase() === line.mode.toLowerCase());

        if (cfg) {
          const ref = (line.reference_no || "").trim();

          if (cfg.referenceRequirement === "required" && !ref) {
            return {
              valid: false,
              error: `${cfg.referenceLabel || line.mode + " Reference"} is required for ${line.mode}.`,
              focusIndex: i,
              focusField: "reference_no",
            };
          }

          if (ref) {
            if (cfg.referenceMinLength && ref.length < cfg.referenceMinLength) {
              return {
                valid: false,
                error: `${cfg.referenceLabel || "Reference"} must be at least ${cfg.referenceMinLength} characters.`,
                focusIndex: i,
                focusField: "reference_no",
              };
            }
            if (cfg.referenceMaxLength && ref.length > cfg.referenceMaxLength) {
              return {
                valid: false,
                error: `${cfg.referenceLabel || "Reference"} cannot exceed ${cfg.referenceMaxLength} characters.`,
                focusIndex: i,
                focusField: "reference_no",
              };
            }
            if (cfg.referenceRegex) {
              try {
                const reg = new RegExp(cfg.referenceRegex);
                if (!reg.test(ref)) {
                  return {
                    valid: false,
                    error: `Invalid format for ${cfg.referenceLabel || "Reference"}.`,
                    focusIndex: i,
                    focusField: "reference_no",
                  };
                }
              } catch {
                // Ignore regex parse errors
              }
            }

            // Duplicate check
            if (cfg.duplicateCheck && cfg.duplicateCheck !== "off") {
              const allExistingPayments = await sqliteStorage.findAll<InvoicePaymentRecord>("invoice_payments").catch(() => []);
              const dup = allExistingPayments.find(
                (ep) => ep.reference_no && ep.reference_no.trim() === ref && ep.status !== "refunded"
              );
              if (dup) {
                const dupMsg = `Duplicate reference '${ref}' was already used on invoice payment #${dup.invoice_id}.`;
                if (cfg.duplicateCheck === "block") {
                  return { valid: false, error: dupMsg, focusIndex: i, focusField: "reference_no" };
                } else if (cfg.duplicateCheck === "warn") {
                  warning = dupMsg;
                }
              }
            }
          }
        }
      }
    }

    return { valid: true, warning };
  }

  /**
   * Migrate existing legacy invoices into separate invoice_payments records.
   * Preserves historical totals to the paisa and sets derived payment_status.
   */
  async migrateLegacyInvoices(): Promise<{ migratedCount: number }> {
    const allInvoices = await sqliteStorage.findAll<any>("invoices").catch(() => []);
    const existingPayments = await sqliteStorage.findAll<InvoicePaymentRecord>("invoice_payments").catch(() => []);

    const existingPaymentInvoiceIds = new Set(existingPayments.map((p) => p.invoice_id));
    let migratedCount = 0;

    for (const inv of allInvoices) {
      if (!existingPaymentInvoiceIds.has(inv.id)) {
        const grandTotal = Number(inv.grand_total) || 0;
        const paidAmount = inv.paid_amount !== undefined && inv.paid_amount !== null ? Number(inv.paid_amount) : grandTotal;
        const mode = inv.payment_mode || "Cash";

        let status: "paid" | "partially_paid" | "unpaid" = "paid";
        if (paidAmount <= 0.001) {
          status = "unpaid";
        } else if (paidAmount < grandTotal - 0.01) {
          status = "partially_paid";
        }

        // Update invoice payment_status
        await sqliteStorage.insertRecord("invoices", inv.id, {
          ...inv,
          payment_status: status,
        });

        if (paidAmount > 0) {
          const paymentId = `mig_pay_${inv.id}_${Date.now()}`;
          const paymentRec: InvoicePaymentRecord = {
            id: paymentId,
            invoice_id: inv.id,
            payment_mode: mode,
            amount: paidAmount,
            status: "received",
            notes: "Migrated from legacy single-mode invoice record",
            received_by: "Migration Engine",
            created_at: inv.created_at || Date.now(),
            updated_at: inv.updated_at || Date.now(),
          };
          await sqliteStorage.insertRecord("invoice_payments", paymentId, paymentRec as unknown as Record<string, unknown>);
          migratedCount++;
        }
      }
    }

    return { migratedCount };
  }

  // --- Held Bills Feature ---
  holdBill(cartPayload: Record<string, unknown>, itemsCount: number, grandTotal: number, customerName?: string): string {
    holdCounter += 1;
    const holdId = `hold_${Date.now()}_${holdCounter}_${Math.random().toString(16).slice(2, 6)}`;
    const heldBill: HeldBill = {
      id: holdId,
      sequence: holdCounter,
      customer_name: customerName || "Walk-in Customer",
      items_count: itemsCount,
      grand_total: grandTotal,
      held_at: Date.now(),
      cart_payload: { ...cartPayload },
    };
    this.heldBills.set(holdId, heldBill);
    return holdId;
  }

  listHeldBills(): HeldBill[] {
    return Array.from(this.heldBills.values()).sort((a, b) => b.sequence - a.sequence);
  }

  recallBill(holdId: string): HeldBill | null {
    const bill = this.heldBills.get(holdId);
    if (bill) {
      this.heldBills.delete(holdId);
      return bill;
    }
    return null;
  }

  clearHeldBills(): void {
    this.heldBills.clear();
  }
}

export const billingTenderService = new BillingTenderService();
