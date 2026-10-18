import { sqliteStorage } from "../../db/sqliteStorage";
import { syncQueueService } from "../../sync/syncQueueService";

export interface ExpenseRecord {
  id: string;
  expense_number: string;
  expense_head: string;
  amount: number;
  payment_mode: "Cash" | "Bank Transfer" | "UPI" | "Cheque";
  reference_no?: string;
  notes?: string;
  expense_date: string;
  created_by?: string;
  created_at: number;
}

export interface ExpenseHeadRecord {
  id: string;
  name: string;
  category: string;
  is_active: boolean;
}

export class ExpenseService {
  private defaultHeads: ExpenseHeadRecord[] = [
    { id: "eh_rent", name: "Shop Rent", category: "operational", is_active: true },
    { id: "eh_elec", name: "Electricity & Power", category: "utilities", is_active: true },
    { id: "eh_staff", name: "Staff Salary & Wages", category: "payroll", is_active: true },
    { id: "eh_freight", name: "Freight & Courier Inward", category: "logistics", is_active: true },
    { id: "eh_tea", name: "Refreshments & Tea", category: "petty_cash", is_active: true },
    { id: "eh_print", name: "Printing & Stationery", category: "office", is_active: true },
    { id: "eh_clean", name: "Housekeeping & Cleaning", category: "maintenance", is_active: true },
    { id: "eh_misc", name: "Miscellaneous Expenses", category: "petty_cash", is_active: true },
  ];

  async getExpenseHeads(): Promise<ExpenseHeadRecord[]> {
    const existing = await sqliteStorage.findAll<ExpenseHeadRecord>("expense_heads");
    if (existing.length === 0) {
      for (const h of this.defaultHeads) {
        await sqliteStorage.insertRecord("expense_heads", h.id, h as unknown as Record<string, unknown>);
      }
      return [...this.defaultHeads];
    }
    return existing.filter((h) => h.is_active);
  }

  async createExpenseHead(name: string, category = "operational"): Promise<ExpenseHeadRecord> {
    const id = `eh_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const head: ExpenseHeadRecord = {
      id,
      name: name.trim(),
      category: category.trim(),
      is_active: true,
    };
    await sqliteStorage.insertRecord("expense_heads", id, head as unknown as Record<string, unknown>);
    return head;
  }

  async generateExpenseNumber(): Promise<string> {
    const expenses = await sqliteStorage.findAll<ExpenseRecord>("expenses");
    const count = expenses.length + 1;
    return `EXP-${String(count).padStart(5, "0")}`;
  }

  async recordExpense(input: {
    expense_head: string;
    amount: number;
    payment_mode?: "Cash" | "Bank Transfer" | "UPI" | "Cheque";
    reference_no?: string;
    notes?: string;
    expense_date?: string;
    created_by?: string;
  }): Promise<ExpenseRecord> {
    if (!input.expense_head.trim()) {
      throw new Error("Expense head is required");
    }
    const amount = Number(input.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new Error("Expense amount must be greater than zero");
    }

    const now = Date.now();
    const id = `exp_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const expenseNumber = await this.generateExpenseNumber();

    const record: ExpenseRecord = {
      id,
      expense_number: expenseNumber,
      expense_head: input.expense_head.trim(),
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      payment_mode: input.payment_mode || "Cash",
      reference_no: input.reference_no?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      expense_date: input.expense_date || new Date().toISOString().slice(0, 10),
      created_by: input.created_by,
      created_at: now,
    };

    await sqliteStorage.insertRecord("expenses", id, record as unknown as Record<string, unknown>);

    // If Cash expense, it automatically reduces Cash Drawer / Day summary
    try {
      await syncQueueService.enqueue("expense", id, "create", record);
    } catch (_) {}

    return record;
  }

  async getAllExpenses(startDate?: string, endDate?: string): Promise<ExpenseRecord[]> {
    const all = await sqliteStorage.findAll<ExpenseRecord>("expenses");
    return all
      .filter((e) => {
        if (startDate && e.expense_date < startDate) return false;
        if (endDate && e.expense_date > endDate) return false;
        return true;
      })
      .sort((a, b) => b.created_at - a.created_at);
  }

  async getExpenseSummary(startDate?: string, endDate?: string): Promise<{
    totalAmount: number;
    cashTotal: number;
    onlineTotal: number;
    headBreakdown: Record<string, number>;
  }> {
    const expenses = await this.getAllExpenses(startDate, endDate);
    let totalAmount = 0;
    let cashTotal = 0;
    let onlineTotal = 0;
    const headBreakdown: Record<string, number> = {};

    for (const exp of expenses) {
      totalAmount = Math.round((totalAmount + exp.amount) * 100) / 100;
      if (exp.payment_mode === "Cash") {
        cashTotal = Math.round((cashTotal + exp.amount) * 100) / 100;
      } else {
        onlineTotal = Math.round((onlineTotal + exp.amount) * 100) / 100;
      }
      headBreakdown[exp.expense_head] = Math.round(((headBreakdown[exp.expense_head] || 0) + exp.amount) * 100) / 100;
    }

    return { totalAmount, cashTotal, onlineTotal, headBreakdown };
  }
}

export const expenseService = new ExpenseService();
