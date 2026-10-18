import { sqliteStorage } from "../../db/sqliteStorage";
import { partiesStore } from "../../masters/partiesStore";
import { syncQueueService } from "../../sync/syncQueueService";

export interface CustomerPaymentRecord {
  id: string;
  payment_number: string;
  customer_id: string;
  customer_name: string;
  amount: number;
  payment_mode: "Cash" | "UPI" | "Bank Transfer" | "Cheque";
  reference_no?: string;
  notes?: string;
  payment_date: string;
  created_at: number;
}

export class CustomerCreditService {
  async generatePaymentNumber(): Promise<string> {
    const payments = await sqliteStorage.findAll<CustomerPaymentRecord>("customer_payments");
    const count = payments.length + 1;
    return `RCP-CUST-${String(count).padStart(5, "0")}`;
  }

  async recordCustomerPayment(input: {
    customer_id: string;
    customer_name: string;
    amount: number;
    payment_mode?: "Cash" | "UPI" | "Bank Transfer" | "Cheque";
    reference_no?: string;
    notes?: string;
    payment_date?: string;
  }): Promise<CustomerPaymentRecord> {
    const amount = Number(input.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }

    const now = Date.now();
    const id = `cpay_${now}_${Math.random().toString(16).slice(2, 6)}`;
    const paymentNumber = await this.generatePaymentNumber();

    const record: CustomerPaymentRecord = {
      id,
      payment_number: paymentNumber,
      customer_id: input.customer_id,
      customer_name: input.customer_name,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      payment_mode: input.payment_mode || "Cash",
      reference_no: input.reference_no?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      payment_date: input.payment_date || new Date().toISOString().slice(0, 10),
      created_at: now,
    };

    await sqliteStorage.insertRecord("customer_payments", id, record as unknown as Record<string, unknown>);

    // Update customer outstanding balance in partiesStore
    try {
      const cust = await partiesStore.getCustomerById(input.customer_id);
      if (cust) {
        const currentBal = Number(cust.outstanding_balance) || 0;
        const newBal = Math.max(0, Math.round((currentBal - amount) * 100) / 100);
        cust.outstanding_balance = newBal;
        cust.updated_at = now;
        await partiesStore.upsertCustomer(cust);
      }
    } catch (_) {}

    try {
      await syncQueueService.enqueue("customer_payment", id, "create", record);
    } catch (_) {}

    return record;
  }

  async getCustomerPayments(customerId?: string): Promise<CustomerPaymentRecord[]> {
    const all = await sqliteStorage.findAll<CustomerPaymentRecord>("customer_payments");
    return all
      .filter((p) => !customerId || p.customer_id === customerId)
      .sort((a, b) => b.created_at - a.created_at);
  }
}

export const customerCreditService = new CustomerCreditService();
