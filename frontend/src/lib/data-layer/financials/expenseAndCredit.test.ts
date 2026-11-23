import { describe, it, expect, beforeEach } from "vitest";
import { expenseService } from "./expenseService";
import { customerCreditService } from "./customerCreditService";
import { partiesStore } from "../../masters/partiesStore";
import { cashShiftService } from "../../billing/cashShiftService";

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

  it("takes a cash expense out of the drawer the counter is standing on", async () => {
    // No device profile in the test harness, so this is the counter the till charges.
    await cashShiftService.openShift("Counter 01", "Counter 01", "staff_exp", "Counter 01", 1000);

    await expenseService.recordExpense({
      expense_head: "Refreshments & Tea",
      amount: 50,
      payment_mode: "Cash",
    });

    const afterCash = await cashShiftService.getActiveShift("Counter 01");
    expect(afterCash?.cash_out).toBe(50);
    expect(afterCash?.expected_cash).toBe(950);

    // Money that did not leave the drawer is not the drawer's business.
    await expenseService.recordExpense({
      expense_head: "Shop Rent",
      amount: 500,
      payment_mode: "Bank Transfer",
      reference_no: "NEFT-EXP-1",
    });

    const afterBank = await cashShiftService.getActiveShift("Counter 01");
    expect(afterBank?.cash_out).toBe(50);
    expect(afterBank?.expected_cash).toBe(950);
  });
});
