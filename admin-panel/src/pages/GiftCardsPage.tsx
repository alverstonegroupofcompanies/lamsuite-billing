import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  Plus,
  RefreshCw,
  Search,
  X,
  Wallet,
  Ban,
  CheckCircle2,
  SlidersHorizontal,
  History,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateTime, formatINR } from "../utils/formatters";

interface GiftCard {
  id: number;
  code: string;
  initial_balance: number;
  balance: number;
  status: "active" | "disabled" | "exhausted" | "expired";
  issued_to_name: string | null;
  issued_to_phone: string | null;
  customer: { id: number; name: string; phone?: string } | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string | null;
}

interface GiftCardTxn {
  id: number;
  type: string;
  amount: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: string | null;
  invoice_id: number | null;
  notes: string | null;
  created_at: string | null;
}

interface GiftCardSummary {
  active: number;
  exhausted: number;
  disabled: number;
  outstanding_balance: number;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  exhausted: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600",
  disabled: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  expired: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
};

export const GiftCardsPage: React.FC = () => {
  const { activeStore } = useAuth();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [summary, setSummary] = useState<GiftCardSummary>({
    active: 0,
    exhausted: 0,
    disabled: 0,
    outstanding_balance: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [showIssue, setShowIssue] = useState(false);
  const [issueForm, setIssueForm] = useState({
    initial_balance: "",
    code: "",
    issued_to_name: "",
    issued_to_phone: "",
    expires_at: "",
    notes: "",
  });
  const [isIssuing, setIsIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [selected, setSelected] = useState<GiftCard | null>(null);
  const [transactions, setTransactions] = useState<GiftCardTxn[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ amount: "", direction: "credit", notes: "" });
  const [isAdjusting, setIsAdjusting] = useState(false);

  const fetchCards = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (activeStore) params.active_store_id = String(activeStore.id);

      const res = await api.get<{ summary: GiftCardSummary; cards: GiftCard[] }>(
        "/admin/gift-cards",
        params
      );
      setCards(res.cards || []);
      setSummary(res.summary);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to load gift cards");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchTerm, activeStore]);

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const openDetail = async (card: GiftCard) => {
    setSelected(card);
    setTransactions([]);
    setAdjustForm({ amount: "", direction: "credit", notes: "" });
    setIsLoadingDetail(true);
    try {
      const res = await api.get<{ gift_card: GiftCard; transactions: GiftCardTxn[] }>(
        `/admin/gift-cards/${card.id}`
      );
      setSelected(res.gift_card);
      setTransactions(res.transactions || []);
    } catch (err: unknown) {
      alert((err as Error).message || "Failed to load gift card ledger");
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssueError(null);
    setIsIssuing(true);
    try {
      await api.post("/admin/gift-cards", {
        initial_balance: Number(issueForm.initial_balance),
        code: issueForm.code.trim() || undefined,
        issued_to_name: issueForm.issued_to_name.trim() || undefined,
        issued_to_phone: issueForm.issued_to_phone.trim() || undefined,
        expires_at: issueForm.expires_at || undefined,
        notes: issueForm.notes.trim() || undefined,
      });
      setShowIssue(false);
      setIssueForm({ initial_balance: "", code: "", issued_to_name: "", issued_to_phone: "", expires_at: "", notes: "" });
      await fetchCards();
    } catch (err: unknown) {
      setIssueError((err as Error).message || "Failed to issue gift card");
    } finally {
      setIsIssuing(false);
    }
  };

  const handleToggleStatus = async (card: GiftCard) => {
    const next = card.status === "disabled" ? "active" : "disabled";
    try {
      const res = await api.post<{ gift_card: GiftCard }>(`/admin/gift-cards/${card.id}/status`, {
        status: next,
      });
      setCards((prev) => prev.map((c) => (c.id === res.gift_card.id ? res.gift_card : c)));
      if (selected?.id === res.gift_card.id) setSelected(res.gift_card);
      await fetchCards();
    } catch (err: unknown) {
      alert((err as Error).message || "Failed to update gift card status");
    }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setIsAdjusting(true);
    try {
      await api.post(`/admin/gift-cards/${selected.id}/adjust`, {
        amount: Number(adjustForm.amount),
        direction: adjustForm.direction,
        notes: adjustForm.notes.trim() || undefined,
      });
      setAdjustForm({ amount: "", direction: "credit", notes: "" });
      await fetchCards();
      const res = await api.get<{ gift_card: GiftCard; transactions: GiftCardTxn[] }>(
        `/admin/gift-cards/${selected.id}`
      );
      setSelected(res.gift_card);
      setTransactions(res.transactions || []);
    } catch (err: unknown) {
      alert((err as Error).message || "Failed to adjust balance");
    } finally {
      setIsAdjusting(false);
    }
  };

  const summaryCards = useMemo(
    () => [
      { label: "Active Cards", value: String(summary.active), icon: CheckCircle2, tone: "text-emerald-600" },
      { label: "Outstanding Balance", value: formatINR(summary.outstanding_balance), icon: Wallet, tone: "text-indigo-600" },
      { label: "Exhausted", value: String(summary.exhausted), icon: CreditCard, tone: "text-slate-500" },
      { label: "Disabled", value: String(summary.disabled), icon: Ban, tone: "text-rose-600" },
    ],
    [summary]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Gift Cards & Store Credit</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Issue prepaid cards, track redemption ledger, and adjust balances. Cards are redeemable at POS checkout.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchCards()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => {
              setIssueError(null);
              setShowIssue(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Issue Gift Card
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</span>
                <Icon className={`w-4 h-4 ${item.tone}`} />
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{item.value}</div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-200 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearchTerm(search);
            }}
            className="relative flex-1"
          >
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search code, name, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </form>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="exhausted">Exhausted</option>
            <option value="disabled">Disabled</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/80 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3">Card Code</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Initial</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Issued To</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Issued On</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading gift cards...
                  </td>
                </tr>
              ) : cards.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    <CreditCard className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    No gift cards match this filter.
                  </td>
                </tr>
              ) : (
                cards.map((card) => (
                  <tr key={card.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-white">{card.code}</td>
                    <td className="px-4 py-3 font-semibold">{formatINR(card.balance)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatINR(card.initial_balance)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${STATUS_STYLES[card.status] || STATUS_STYLES.exhausted}`}>
                        {card.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800 dark:text-slate-200">
                        {card.issued_to_name || card.customer?.name || "—"}
                      </div>
                      {(card.issued_to_phone || card.customer?.phone) && (
                        <div className="text-xs text-slate-400">{card.issued_to_phone || card.customer?.phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(card.expires_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(card.created_at)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => openDetail(card)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition mr-1.5"
                      >
                        <History className="w-3.5 h-3.5 text-brand-600" />
                        Ledger
                      </button>
                      {(card.status === "active" || card.status === "disabled") && (
                        <button
                          onClick={() => handleToggleStatus(card)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border transition ${
                            card.status === "disabled"
                              ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                              : "border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/30"
                          }`}
                        >
                          {card.status === "disabled" ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" /> Enable
                            </>
                          ) : (
                            <>
                              <Ban className="w-3.5 h-3.5" /> Disable
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <form
            onSubmit={handleIssue}
            className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full"
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Issue Gift Card</h3>
              <button type="button" onClick={() => setShowIssue(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              {issueError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">{issueError}</div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Amount (₹) *</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={issueForm.initial_balance}
                  onChange={(e) => setIssueForm((f) => ({ ...f, initial_balance: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Card Code (optional)
                </label>
                <input
                  type="text"
                  placeholder="Leave blank to auto-generate"
                  value={issueForm.code}
                  onChange={(e) => setIssueForm((f) => ({ ...f, code: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Issued To Name</label>
                  <input
                    type="text"
                    value={issueForm.issued_to_name}
                    onChange={(e) => setIssueForm((f) => ({ ...f, issued_to_name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Phone</label>
                  <input
                    type="text"
                    value={issueForm.issued_to_phone}
                    onChange={(e) => setIssueForm((f) => ({ ...f, issued_to_phone: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={issueForm.expires_at}
                  onChange={(e) => setIssueForm((f) => ({ ...f, expires_at: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={issueForm.notes}
                  onChange={(e) => setIssueForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowIssue(false)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isIssuing}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white shadow-sm transition disabled:opacity-50"
              >
                {isIssuing ? "Issuing..." : "Issue Card"}
              </button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white font-mono">{selected.code}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Balance {formatINR(selected.balance)} of {formatINR(selected.initial_balance)} ·{" "}
                  <span className={`inline-flex px-1.5 py-0.2 rounded border text-[10px] font-semibold ${STATUS_STYLES[selected.status] || STATUS_STYLES.exhausted}`}>
                    {selected.status}
                  </span>
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <form onSubmit={handleAdjust} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-brand-600" />
                  Manual Balance Adjustment
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="Amount"
                    value={adjustForm.amount}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <select
                    value={adjustForm.direction}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, direction: e.target.value }))}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="credit">Credit</option>
                    <option value="debit">Debit</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    value={adjustForm.notes}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, notes: e.target.value }))}
                    className="sm:col-span-2 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isAdjusting || !adjustForm.amount}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
                  >
                    {isAdjusting ? "Applying..." : "Apply Adjustment"}
                  </button>
                </div>
              </form>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Redemption Ledger</h4>
                {isLoadingDetail ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading ledger...
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs">No transactions recorded yet.</div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-3 py-2">When</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                          <th className="px-3 py-2 text-right">Balance After</th>
                          <th className="px-3 py-2">Reference</th>
                          <th className="px-3 py-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {transactions.map((txn) => (
                          <tr key={txn.id}>
                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDateTime(txn.created_at)}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                  txn.type === "redeem" || txn.type === "debit"
                                    ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800"
                                }`}
                              >
                                {txn.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{formatINR(txn.amount)}</td>
                            <td className="px-3 py-2 text-right">{formatINR(txn.balance_after)}</td>
                            <td className="px-3 py-2 text-slate-500">
                              {txn.invoice_id ? `Invoice #${txn.invoice_id}` : txn.reference_type ? `${txn.reference_type} ${txn.reference_id || ""}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-500">{txn.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex justify-between items-center">
              <span className="text-[11px] text-slate-500">
                Issued {formatDate(selected.created_at)}
                {selected.issued_to_name ? ` to ${selected.issued_to_name}` : ""}
              </span>
              <button
                onClick={() => setSelected(null)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
