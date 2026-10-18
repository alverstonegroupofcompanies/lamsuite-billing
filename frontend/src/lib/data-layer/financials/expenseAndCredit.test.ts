import { describe, it, expect, beforeEach } from "vitest";
import { expenseService } from "./expenseService";
import { customerCreditService } from "./customerCreditService";
import { partiesStore } from "../../masters/partiesStore";

describe("ExpenseService and CustomerCreditService", () => {
  beforeEach(async () => {
    // initialize
    await expenseService.getExpenseHeads();
  });

  it("records an operational expense correctly", async () => {
    const expense = await expenseService.recordExpense({
      expense_head: "Shop Rent",
      amount: 15000,
      payment_mode: "Bank Transfer",
      reference_no: "NEFT-12345",
      notes: "October rent payment",
    });

    expect(expense.id).toBeDefined();
    expect(expense.expense_number).toContain("EXP-");
    expect(expense.amount).toBe(15000);
    expect(expense.payment_mode).toBe("Bank Transfer");

    const all = await expenseService.getAllExpenses();
    expect(all.some((e) => e.id === expense.id)).toBe(true);

    const summary = await expenseService.getExpenseSummary();
    expect(summary.totalAmount).toBeGreaterThanOrEqual(15000);
    expect(summary.onlineTotal).toBeGreaterThanOrEqual(15000);
  });

  it("records customer credit payment and decreases outstanding balance", async () => {
    // Create customer with outstanding
    const customer = await partiesStore.quickCreateCustomer({
      name: "Ramesh Kumar",
      phone: "9876543210",
      credit_limit: 10000,
    });
    customer.outstanding_balance = 5000;
    await partiesStore.upsertCustomer(customer);

    const payment = await customerCreditService.recordCustomerPayment({
      customer_id: customer.id,
      customer_name: customer.name,
      amount: 2000,
      payment_mode: "UPI",
      reference_no: "UPI-998877",
      notes: "Part payment for credit purchases",
    });

    expect(payment.id).toBeDefined();
    expect(payment.payment_number).toContain("RCP-CUST-");
    expect(payment.amount).toBe(2000);

    const updatedCustomer = (await partiesStore.getAllParties()).find((p) => p.id === customer.id);
    expect(updatedCustomer?.outstanding_balance).toBe(3000);
  });
});
