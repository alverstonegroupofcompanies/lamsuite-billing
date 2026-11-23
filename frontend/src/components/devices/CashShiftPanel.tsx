import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Lock, RefreshCw, Wallet } from "lucide-react";
import { cashShiftService, type CashShift } from "../../lib/billing/cashShiftService";
import { storeDeviceService } from "../../lib/auth/storeDeviceService";

const money = (value: number | null | undefined): string =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CashShiftPanel: React.FC = () => {
  // B8b: the shift belongs to the counter this till claimed, not to a person.
  const [counter, setCounter] = useState<{ id: string; name: string }>({ id: "", name: "" });
  const [activeShift, setActiveShift] = useState<CashShift | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [movementType, setMovementType] = useState<"cash_in" | "cash_out">("cash_in");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    storeDeviceService
      .getDeviceProfile()
      .then((profile) => {
        if (cancelled || !profile) return;
        setCounter({
          id: profile.counter_id,
          name: profile.counter_name || profile.counter_code || profile.counter_id,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const counterId = counter.id;
  const counterName = counter.name;

  const refresh = useCallback(async () => {
    if (!counterId) {
      setActiveShift(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const shift = await cashShiftService.getActiveShift(counterId);
      setActiveShift(shift);
    } catch (err: any) {
      setError(err?.message || "Unable to load the active shift.");
    } finally {
      setIsLoading(false);
    }
  }, [counterId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const expected = useMemo(() => {
    if (!activeShift) return 0;
    return (
      Number(activeShift.opening_cash || 0) +
      Number(activeShift.cash_in || 0) -
      Number(activeShift.cash_out || 0) +
      Number(activeShift.payment_totals?.Cash || 0)
    );
  }, [activeShift]);

  const variance = useMemo(() => {
    if (countedCash.trim() === "") return null;
    const counted = Number(countedCash);
    if (Number.isNaN(counted)) return null;
    return Math.round((counted - expected) * 100) / 100;
  }, [countedCash, expected]);

  const handleOpenShift = async () => {
    if (!counterId) return;
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const shift = await cashShiftService.openShift(
        counterId,
        counterName,
        counterId,
        counterName,
        Number(openingCash || 0)
      );
      setActiveShift(shift);
      setOpeningCash("");
      setNotice(`Shift opened with ${money(shift.opening_cash)} float.`);
    } catch (err: any) {
      setError(err?.message || "Failed to open shift.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;
    if (countedCash.trim() === "" || Number.isNaN(Number(countedCash))) {
      setError("Enter the cash counted in the drawer.");
      return;
    }
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await cashShiftService.closeShift(
        activeShift.id,
        Number(countedCash),
        closeNotes.trim() || undefined
      );
      setActiveShift(null);
      setCountedCash("");
      setCloseNotes("");
      setNotice(
        `Shift closed. Expected ${money(result.shift.expected_cash)} · Variance ${money(result.variance)}.`
      );
    } catch (err: any) {
      setError(err?.message || "Failed to close shift.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleMovement = async () => {
    if (!activeShift) return;
    const amount = Number(movementAmount);
    if (!amount || amount <= 0) {
      setError("Enter a cash amount greater than zero.");
      return;
    }
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      await cashShiftService.recordCashMovement(
        activeShift.id,
        movementType,
        amount,
        movementReason.trim() || (movementType === "cash_in" ? "Cash float in" : "Cash drop")
      );
      setMovementAmount("");
      setMovementReason("");
      await refresh();
      setNotice(
        `${movementType === "cash_in" ? "Cash in" : "Cash drop"} of ${money(amount)} recorded.`
      );
    } catch (err: any) {
      setError(err?.message || "Failed to record cash movement.");
    } finally {
      setIsBusy(false);
    }
  };

  const card = "rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs";

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" />
            Cash Shift · {counterName || "No counter"}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Opening float, drawer movement and end-of-shift cash count for this counter.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {notice}
        </div>
      )}

      {!counterId ? (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          This terminal is not claimed to a counter yet. Claim a counter to open and close cash shifts.
        </p>
      ) : isLoading && !activeShift ? (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">Loading shift…</p>
      ) : !activeShift ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            Opening float (cash in drawer)
            <input
              type="number"
              min="0"
              step="0.01"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="0.00"
              className="mt-1 block w-40 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </label>
          <button
            onClick={handleOpenShift}
            disabled={isBusy}
            className="rounded-[10px] bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {isBusy ? "Opening…" : "Open Shift"}
          </button>
        </div>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Opened</div>
                <div className="font-semibold text-[var(--color-text)]">
                  {new Date(activeShift.opened_at).toLocaleString("en-IN")}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Opening Float</div>
                <div className="font-semibold text-[var(--color-text)]">{money(activeShift.opening_cash)}</div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Cash Sales</div>
                <div className="font-semibold text-[var(--color-text)]">
                  {money(activeShift.payment_totals?.Cash || 0)}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Expected Drawer</div>
                <div className="font-bold text-emerald-700">{money(expected)}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--color-border)] p-2.5">
              <div className="text-[11px] font-medium text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1">
                  {movementType === "cash_in" ? (
                    <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <ArrowDownCircle className="w-3.5 h-3.5 text-rose-600" />
                  )}
                  Cash movement
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as "cash_in" | "cash_out")}
                    className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                  >
                    <option value="cash_in">Cash in</option>
                    <option value="cash_out">Cash drop</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(e.target.value)}
                    placeholder="Amount"
                    className="w-24 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                  />
                  <input
                    type="text"
                    value={movementReason}
                    onChange={(e) => setMovementReason(e.target.value)}
                    placeholder="Reason"
                    className="w-32 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text)]"
                  />
                  <button
                    onClick={handleMovement}
                    disabled={isBusy}
                    className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 cursor-pointer"
                  >
                    Record
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-2.5">
            <div className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              Close Shift
            </div>
            <label className="block text-[11px] font-medium text-[var(--color-text-muted)]">
              Cash counted in drawer
              <input
                type="number"
                min="0"
                step="0.01"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                placeholder="0.00"
                className="mt-1 block w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
            </label>
            <label className="block text-[11px] font-medium text-[var(--color-text-muted)]">
              Notes
              <input
                type="text"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="Handover / denomination notes"
                className="mt-1 block w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)]"
              />
            </label>
            {variance !== null && (
              <div
                className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                  Math.abs(variance) < 0.01
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                <span>{variance < 0 ? "Short by" : variance > 0 ? "Over by" : "Balanced"}</span>
                <span>{money(Math.abs(variance))}</span>
              </div>
            )}
            <button
              onClick={handleCloseShift}
              disabled={isBusy || countedCash.trim() === ""}
              className="w-full rounded-[10px] bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isBusy ? "Closing…" : "Close Shift & Record Variance"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
