import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";
import { round2 } from "../billing/billingCalculations";

export interface SupplierMaster {
  id: string;
  name: string;
  phone?: string;
  gstin?: string;
  address?: string;
  state_code?: string;
  place_of_supply?: string;
  credit_period_days?: number;
  opening_balance?: number;
  outstanding_balance?: number;
  is_active: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface SupplierLedgerEntry {
  id: string;
  party_id: string;
  party_type: "supplier" | "customer";
  entry_date: string;
  reference_type: "PURCHASE_BILL" | "PURCHASE_RETURN" | "SUPPLIER_PAYMENT" | "OPENING_BAL" | "JOURNAL";
  reference_id: string;
  reference_number: string;
  debit_amount: number; // Reduces liability (payments, returns)
  credit_amount: number; // Increases liability (purchases)
  running_balance: number;
  payment_mode?: string;
  notes?: string;
  created_at: number;
}

export interface SupplierPaymentRecord {
  id: string;
  payment_number: string;
  supplier_id: string;
  supplier_name: string;
  payment_date: string;
  amount: number;
  payment_mode: "Cash" | "Bank Transfer" | "Cheque" | "UPI";
  reference_no?: string;
  purchase_id?: string;
  notes?: string;
  sync_state?: string;
  created_at: number;
}

export interface SupplierAgeingSummary {
  supplier_id: string;
  supplier_name: string;
  phone?: string;
  gstin?: string;
  credit_period_days: number;
  total_outstanding: number;
  current: number; // 0 - credit_period
  days_1_30: number; // 1-30 days past due
  days_31_60: number; // 31-60 days past due
  days_61_90: number; // 61-90 days past due
  days_90_plus: number; // >90 days past due
}

export class SupplierLedgerService {
  async getAllSuppliers(): Promise<SupplierMaster[]> {
    const records = await sqliteStorage.findAll<SupplierMaster>("suppliers");
    return records.filter((s) => s.is_active !== false).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSupplierById(id: string): Promise<SupplierMaster | null> {
    return await sqliteStorage.findById<SupplierMaster>("suppliers", id);
  }

  async upsertSupplier(supplier: SupplierMaster): Promise<void> {
    const now = Date.now();
    const existing = await this.getSupplierById(supplier.id);
    const updated: SupplierMaster = {
      ...supplier,
      is_active: supplier.is_active !== undefined ? supplier.is_active : true,
      created_at: existing?.created_at || supplier.created_at || now,
      updated_at: now,
    };
    await sqliteStorage.insertRecord("suppliers", supplier.id, updated as unknown as Record<string, unknown>);
  }

  async recordPurchaseCredit(entry: {
    supplier_id: string;
    supplier_name: string;
    purchase_id: string;
    purchase_number: string;
    purchase_date: string;
    amount: number;
    notes?: string;
  }): Promise<SupplierLedgerEntry> {
    const now = Date.now();
    const entryId = `ledg_${now}_${Math.random().toString(16).slice(2, 6)}`;

    // 1. Get current supplier
    const supplier = await this.getSupplierById(entry.supplier_id);
    const prevBalance = supplier?.outstanding_balance || 0;
    const newBalance = round2(prevBalance + entry.amount);

    if (supplier) {
      supplier.outstanding_balance = newBalance;
      await this.upsertSupplier(supplier);
    }

    const ledgerRow: SupplierLedgerEntry = {
      id: entryId,
      party_id: entry.supplier_id,
      party_type: "supplier",
      entry_date: entry.purchase_date,
      reference_type: "PURCHASE_BILL",
      reference_id: entry.purchase_id,
      reference_number: entry.purchase_number,
      debit_amount: 0,
      credit_amount: round2(entry.amount),
      running_balance: newBalance,
      notes: entry.notes || `Purchase Bill: ${entry.purchase_number}`,
      created_at: now,
    };

    await sqliteStorage.insertRecord("party_ledger_entries", entryId, ledgerRow as unknown as Record<string, unknown>);
    return ledgerRow;
  }

  async recordReturnDebit(entry: {
    supplier_id: string;
    return_id: string;
    return_number: string;
    return_date: string;
    amount: number;
    notes?: string;
  }): Promise<SupplierLedgerEntry> {
    const now = Date.now();
    const entryId = `ledg_${now}_${Math.random().toString(16).slice(2, 6)}`;

    const supplier = await this.getSupplierById(entry.supplier_id);
    const prevBalance = supplier?.outstanding_balance || 0;
    const newBalance = round2(prevBalance - entry.amount);

    if (supplier) {
      supplier.outstanding_balance = newBalance;
      await this.upsertSupplier(supplier);
    }

    const ledgerRow: SupplierLedgerEntry = {
      id: entryId,
      party_id: entry.supplier_id,
      party_type: "supplier",
      entry_date: entry.return_date,
      reference_type: "PURCHASE_RETURN",
      reference_id: entry.return_id,
      reference_number: entry.return_number,
      debit_amount: round2(entry.amount),
      credit_amount: 0,
      running_balance: newBalance,
      notes: entry.notes || `Debit Note / Return: ${entry.return_number}`,
      created_at: now,
    };

    await sqliteStorage.insertRecord("party_ledger_entries", entryId, ledgerRow as unknown as Record<string, unknown>);
    return ledgerRow;
  }

  async recordSupplierPayment(input: {
    supplier_id: string;
    supplier_name: string;
    payment_date: string;
    amount: number;
    payment_mode: "Cash" | "Bank Transfer" | "Cheque" | "UPI";
    reference_no?: string;
    purchase_id?: string;
    notes?: string;
  }): Promise<{ success: boolean; paymentId: string; ledgerEntryId: string }> {
    if (input.amount <= 0) throw new Error("Payment amount must be greater than 0");

    const now = Date.now();
    const paymentId = `spay_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const paymentNumber = `PAY-SUP-${now.toString().slice(-6)}`;

    const supplier = await this.getSupplierById(input.supplier_id);
    const prevBalance = supplier?.outstanding_balance || 0;
    const newBalance = round2(prevBalance - input.amount);

    if (supplier) {
      supplier.outstanding_balance = newBalance;
      await this.upsertSupplier(supplier);
    }

    // 1. Insert supplier payment row
    const paymentRecord: SupplierPaymentRecord = {
      id: paymentId,
      payment_number: paymentNumber,
      supplier_id: input.supplier_id,
      supplier_name: input.supplier_name,
      payment_date: input.payment_date,
      amount: round2(input.amount),
      payment_mode: input.payment_mode,
      reference_no: input.reference_no,
      purchase_id: input.purchase_id,
      notes: input.notes,
      sync_state: "pending",
      created_at: now,
    };
    await sqliteStorage.insertRecord("supplier_payments", paymentId, paymentRecord as unknown as Record<string, unknown>);

    // 2. Insert party ledger entry (Debit reduces liability)
    const ledgerEntryId = `ledg_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const ledgerRow: SupplierLedgerEntry = {
      id: ledgerEntryId,
      party_id: input.supplier_id,
      party_type: "supplier",
      entry_date: input.payment_date,
      reference_type: "SUPPLIER_PAYMENT",
      reference_id: paymentId,
      reference_number: paymentNumber,
      debit_amount: round2(input.amount),
      credit_amount: 0,
      running_balance: newBalance,
      payment_mode: input.payment_mode,
      notes: input.notes || `Payment made via ${input.payment_mode}${input.reference_no ? ` (${input.reference_no})` : ""}`,
      created_at: now,
    };
    await sqliteStorage.insertRecord("party_ledger_entries", ledgerEntryId, ledgerRow as unknown as Record<string, unknown>);

    // 3. If linked to a specific purchase_id, update paid_amount and payment_status
    if (input.purchase_id) {
      const doc = await sqliteStorage.findById<any>("purchase_documents", input.purchase_id);
      if (doc) {
        const newPaid = round2((doc.paid_amount || 0) + input.amount);
        doc.paid_amount = newPaid;
        doc.payment_status = newPaid >= (doc.grand_total || 0) ? "paid" : newPaid > 0 ? "partial" : "unpaid";
        await sqliteStorage.insertRecord("purchase_documents", doc.id, doc);
      }
    }

    // 4. Enqueue sync
    await syncQueueService.enqueue("payment", paymentId, "create", paymentRecord);

    return { success: true, paymentId, ledgerEntryId };
  }

  async getSupplierStatement(
    supplierId: string,
    startDate?: string,
    endDate?: string
  ): Promise<{
    supplier: SupplierMaster | null;
    entries: SupplierLedgerEntry[];
    summary: {
      openingBalance: number;
      totalPurchases: number;
      totalPayments: number;
      totalReturns: number;
      closingBalance: number;
    };
  }> {
    const supplier = await this.getSupplierById(supplierId);
    const allEntries = await sqliteStorage.findAll<SupplierLedgerEntry>("party_ledger_entries");

    const supplierEntries = allEntries
      .filter((e) => e.party_id === supplierId)
      .sort((a, b) => {
        const dateDiff = a.entry_date.localeCompare(b.entry_date);
        return dateDiff !== 0 ? dateDiff : a.created_at - b.created_at;
      });

    let running = supplier?.opening_balance || 0;
    let openingForPeriod = running;
    let totalPurchases = 0;
    let totalPayments = 0;
    let totalReturns = 0;

    const computedEntries: SupplierLedgerEntry[] = [];

    for (const entry of supplierEntries) {
      if (entry.reference_type === "PURCHASE_BILL") {
        running = round2(running + entry.credit_amount);
      } else {
        running = round2(running - entry.debit_amount);
      }
      const entryWithBal = { ...entry, running_balance: running };

      const isBeforeStart = startDate && entry.entry_date < startDate;
      const isAfterEnd = endDate && entry.entry_date > endDate;

      if (isBeforeStart) {
        openingForPeriod = running;
      } else if (!isAfterEnd) {
        if (entry.reference_type === "PURCHASE_BILL") totalPurchases += entry.credit_amount;
        if (entry.reference_type === "SUPPLIER_PAYMENT") totalPayments += entry.debit_amount;
        if (entry.reference_type === "PURCHASE_RETURN") totalReturns += entry.debit_amount;
        computedEntries.push(entryWithBal);
      }
    }

    return {
      supplier,
      entries: computedEntries,
      summary: {
        openingBalance: round2(openingForPeriod),
        totalPurchases: round2(totalPurchases),
        totalPayments: round2(totalPayments),
        totalReturns: round2(totalReturns),
        closingBalance: round2(running),
      },
    };
  }

  async getSupplierAgeingAnalysis(asOfDate?: string): Promise<SupplierAgeingSummary[]> {
    const targetDate = asOfDate || new Date().toISOString().slice(0, 10);
    const suppliers = await this.getAllSuppliers();
    const purchases = await sqliteStorage.findAll<any>("purchase_documents");

    const result: SupplierAgeingSummary[] = [];

    for (const sup of suppliers) {
      const supPurchases = purchases.filter(
        (p) => p.supplier_id === sup.id && p.status !== "cancelled" && (p.payment_status !== "paid" || (p.grand_total || 0) > (p.paid_amount || 0))
      );

      let current = 0;
      let days1_30 = 0;
      let days31_60 = 0;
      let days61_90 = 0;
      let days90Plus = 0;

      const creditDays = sup.credit_period_days || 30;

      for (const p of supPurchases) {
        const unpaid = Math.max(0, (p.grand_total || 0) - (p.paid_amount || 0));
        if (unpaid <= 0) continue;

        // Calculate days overdue
        const invDate = new Date(p.purchase_date);
        const refDate = new Date(targetDate);
        const ageInDays = Math.floor((refDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
        const overdueDays = ageInDays - creditDays;

        if (overdueDays <= 0) {
          current += unpaid;
        } else if (overdueDays <= 30) {
          days1_30 += unpaid;
        } else if (overdueDays <= 60) {
          days31_60 += unpaid;
        } else if (overdueDays <= 90) {
          days61_90 += unpaid;
        } else {
          days90Plus += unpaid;
        }
      }

      const totalOut = round2(current + days1_30 + days31_60 + days61_90 + days90Plus);

      result.push({
        supplier_id: sup.id,
        supplier_name: sup.name,
        phone: sup.phone,
        gstin: sup.gstin,
        credit_period_days: creditDays,
        total_outstanding: totalOut || round2(sup.outstanding_balance || 0),
        current: round2(current),
        days_1_30: round2(days1_30),
        days_31_60: round2(days31_60),
        days_61_90: round2(days61_90),
        days_90_plus: round2(days90Plus),
      });
    }

    return result.sort((a, b) => b.total_outstanding - a.total_outstanding);
  }
}

export const supplierLedgerService = new SupplierLedgerService();
