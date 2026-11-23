import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PlusCircle, ReceiptText, Search } from "lucide-react";
import { expenseService, type ExpenseRecord } from "../lib/data-layer/financials/expenseService";
import {
  companySettingsService,
  type PaymentModeConfig,
} from "../lib/settings/companySettingsService";
import { storeToday } from "../lib/dateTimeUtils";

/**
 * EXP-01 — the counter's own expense book.
 *
 * A cash expense is money out of the drawer, so it is stamped with this
 * counter and reaches the shift and day-close tallies through sync. The
 * reference rule shown here is the store's own payment policy, the same one
 * the server enforces.
 */
export const ExpensesPage: React.FC = () => {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [heads, setHeads] = useState<string[]>([]);
  const [modes, setModes] = useState<PaymentModeConfig[]>([]);
  const [fromDate, setFromDate] = useState(() => storeToday(companySettingsService.getSettings()));
  const [toDate, setToDate] = useState(() => storeToday(companySettingsService.getSettings()));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [form, setForm] = useState({
    expense_head: "",
    amount: "",
    payment_mode: "Cash",
    reference_no: "",
    notes: "",
    expense_date: storeToday(companySettingsService.getSettings()),
  });

  const load = useCallback(async () => {
    const [rows, headsList] = await Promise.all([
      expenseService.getAllExpenses(fromDate, toDate),
      expenseService.getExpenseHeads(),
    ]);
    setExpenses(rows);
    setHeads(headsList.map((head) => head.name));
  }, [fromDate, toDate]);

  useEffect(() => {
    load().catch(() => setExpenses([]));
  }, [load]);

  useEffect(() => {
    const settings = companySettingsService.getSettings();
    setModes((settings?.payments?.modes || []).filter((mode) => mode.enabled !== false));
  }, []);

  const modeConfig = useMemo(
    () => modes.find((mode) => mode.id === form.payment_mode.toLowerCase().replace(/\s+/g, "_")),
    [modes, form.payment_mode]
  );

  const summary = useMemo(() => {
    let total = 0;
    let cash = 0;
    for (const expense of expenses) {
      total += expense.amount;
      if (expense.payment_mode === "Cash") cash += expense.amount;
    }
    return {
      total: Math.round(total * 100) / 100,
      cash: Math.round(cash * 100) / 100,
      other: Math.round((total - cash) * 100) / 100,
    };
  }, [expenses]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return expenses;
    return expenses.filter((expense) =>
      [expense.expense_head, expense.notes, expense.reference_no]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [expenses, search]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);

    const amount = Number(form.amount);
    if (!form.expense_head.trim()) {
      setNotice({ type: "error", text: "Choose or type an expense head." });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: "error", text: "Amount must be greater than zero." });
      return;
    }

    const reference = form.reference_no.trim();
    if (modeConfig?.referenceRequirement === "required" && !reference) {
      setNotice({
        type: "error",
        text: `${modeConfig.referenceLabel || "Reference"} is required for ${modeConfig.name}.`,
      });
      return;
    }
    if (reference && modeConfig?.referenceMinLength && reference.length < modeConfig.referenceMinLength) {
      setNotice({ type: "error", text: `Reference must be at least ${modeConfig.referenceMinLength} characters.` });
      return;
    }
    if (reference && modeConfig?.referenceRegex) {
      try {
        if (!new RegExp(modeConfig.referenceRegex).test(reference)) {
          setNotice({ type: "error", text: `Invalid format for ${modeConfig.referenceLabel || "reference"}.` });
          return;
        }
      } catch (_) {
        // A malformed store regex must not block the expense book.
      }
    }

    setBusy(true);
    try {
      await expenseService.recordExpense({
        expense_head: form.expense_head,
        amount,
        payment_mode: form.payment_mode as ExpenseRecord["payment_mode"],
        reference_no: reference || undefined,
        notes: form.notes.trim() || undefined,
        expense_date: form.expense_date,
      });
      setForm((current) => ({
        ...current,
        amount: "",
        reference_no: "",
        notes: "",
      }));
      setNotice({ type: "success", text: "Expense recorded and queued for sync." });
      await load();
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Expense could not be recorded.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)] flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-emerald-600" />
            <span>Expenses</span>
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Money paid out of this counter. Cash expenses reduce the drawer at shift close.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Total</span>
          <span className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-bold font-mono text-[var(--color-text)]">
            ₹{summary.total.toFixed(2)}
          </span>
          <span className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700">
            Cash ₹{summary.cash.toFixed(2)}
          </span>
          <span className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-semibold text-[var(--color-text-muted)]">
            Other ₹{summary.other.toFixed(2)}
          </span>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.type === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-rose-300 bg-rose-50 text-rose-800"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              From
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs text-[var(--color-text)]"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              To
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs text-[var(--color-text)]"
              />
            </label>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Head, note or reference"
                className="w-56 rounded-lg border border-[var(--color-border)] bg-transparent py-1.5 pl-7 pr-2 text-xs text-[var(--color-text)]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--color-text-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-4 py-2 font-semibold">Head</th>
                  <th className="px-4 py-2 font-semibold">Mode</th>
                  <th className="px-4 py-2 font-semibold">Reference</th>
                  <th className="px-4 py-2 font-semibold">Notes</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-muted)]">
                      No expenses in this range.
                    </td>
                  </tr>
                )}
                {visible.map((expense) => (
                  <tr key={expense.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 font-mono">{expense.expense_date}</td>
                    <td className="px-4 py-2 font-semibold text-[var(--color-text)]">{expense.expense_head}</td>
                    <td className="px-4 py-2">{expense.payment_mode}</td>
                    <td className="px-4 py-2 font-mono text-[var(--color-text-muted)]">{expense.reference_no || "—"}</td>
                    <td className="max-w-[220px] truncate px-4 py-2 text-[var(--color-text-muted)]">{expense.notes || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-[var(--color-text)]">
                      ₹{expense.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="h-fit space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]">
            <PlusCircle className="h-4 w-4 text-emerald-600" />
            Record an expense
          </h3>

          <label className="block text-xs text-[var(--color-text-muted)]">
            Expense head
            <input
              list="expense-heads"
              value={form.expense_head}
              onChange={(event) => setForm({ ...form, expense_head: event.target.value })}
              placeholder="e.g. Tea & supplies"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]"
            />
            <datalist id="expense-heads">
              {heads.map((head) => (
                <option key={head} value={head} />
              ))}
            </datalist>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-[var(--color-text-muted)]">
              Amount
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm font-mono text-[var(--color-text)]"
              />
            </label>
            <label className="block text-xs text-[var(--color-text-muted)]">
              Date
              <input
                type="date"
                value={form.expense_date}
                onChange={(event) => setForm({ ...form, expense_date: event.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]"
              />
            </label>
          </div>

          <label className="block text-xs text-[var(--color-text-muted)]">
            Paid by
            <select
              value={form.payment_mode}
              onChange={(event) => setForm({ ...form, payment_mode: event.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
            >
              {(modes.length ? modes : [{ id: "cash", name: "Cash" } as PaymentModeConfig]).map((mode) => (
                <option key={mode.id} value={mode.name}>
                  {mode.name}
                </option>
              ))}
            </select>
          </label>

          {modeConfig?.referenceRequirement !== "off" && (
            <label className="block text-xs text-[var(--color-text-muted)]">
              {modeConfig?.referenceLabel || "Reference"}
              {modeConfig?.referenceRequirement === "required" && (
                <span className="ml-1 text-rose-600">*</span>
              )}
              <input
                value={form.reference_no}
                onChange={(event) => setForm({ ...form, reference_no: event.target.value })}
                placeholder={modeConfig?.referencePlaceholder || ""}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]"
              />
            </label>
          )}

          <label className="block text-xs text-[var(--color-text-muted)]">
            Notes
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              rows={2}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Record expense"}
          </button>
        </form>
      </div>
    </div>
  );
};
