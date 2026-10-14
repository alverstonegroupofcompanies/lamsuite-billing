import { sqliteStorage } from "../db/sqliteStorage";

export interface CashShift {
  id: string;
  counter_id: string;
  counter_name: string;
  user_id: string;
  user_name: string;
  shift_date: string; // YYYY-MM-DD
  opened_at: number;
  closed_at: number | null;
  opening_cash: number;
  cash_in: number;
  cash_out: number;
  closing_cash_counted: number | null;
  expected_cash: number | null;
  cash_variance: number | null;
  status: "open" | "closed";
  payment_totals: Record<string, number>;
  notes?: string;
  sync_state: "pending" | "synced";
}

export interface StoreDayClose {
  id: string; // `${store_id}_${date}`
  store_id: string;
  close_date: string;
  closed_by_user_id: string;
  closed_by_user_name: string;
  counters_included: string[];
  consolidated_sales: number;
  consolidated_returns: number;
  consolidated_net: number;
  consolidated_by_tender: Record<string, number>;
  total_cash_variance: number;
  closed_at: number;
  sync_state: "pending" | "synced";
}

export class CashShiftService {
  async openShift(
    counterId: string,
    counterName: string,
    userId: string,
    userName: string,
    openingCash: number,
    notes?: string,
    customDate?: string
  ): Promise<CashShift> {
    const shiftDate = customDate || new Date().toISOString().slice(0, 10);
    const existing = await this.getActiveShift(counterId);
    if (existing) {
      return existing; // Shift already open
    }

    const shiftId = `shift_${Date.now()}_${counterId}`;
    const shift: CashShift = {
      id: shiftId,
      counter_id: counterId,
      counter_name: counterName,
      user_id: userId,
      user_name: userName,
      shift_date: shiftDate,
      opened_at: Date.now(),
      closed_at: null,
      opening_cash: openingCash,
      cash_in: 0,
      cash_out: 0,
      closing_cash_counted: null,
      expected_cash: openingCash,
      cash_variance: null,
      status: "open",
      payment_totals: { Cash: 0, UPI: 0, Card: 0, Credit: 0, Cheque: 0 },
      notes,
      sync_state: "pending",
    };

    await sqliteStorage.insertRecord("cash_shifts", shiftId, {
      ...shift,
      payment_totals_json: JSON.stringify(shift.payment_totals),
    });

    return shift;
  }

  async getActiveShift(counterId: string): Promise<CashShift | null> {
    const all = await sqliteStorage.findAll<any>("cash_shifts");
    const found = (all || []).find((s) => s.counter_id === counterId && s.status === "open");
    if (!found) return null;

    return {
      id: found.id,
      counter_id: found.counter_id,
      counter_name: found.counter_name,
      user_id: found.user_id,
      user_name: found.user_name,
      shift_date: found.shift_date,
      opened_at: Number(found.opened_at),
      closed_at: found.closed_at ? Number(found.closed_at) : null,
      opening_cash: Number(found.opening_cash || 0),
      cash_in: Number(found.cash_in || 0),
      cash_out: Number(found.cash_out || 0),
      closing_cash_counted: found.closing_cash_counted !== null ? Number(found.closing_cash_counted) : null,
      expected_cash: found.expected_cash !== null ? Number(found.expected_cash) : null,
      cash_variance: found.cash_variance !== null ? Number(found.cash_variance) : null,
      status: found.status,
      payment_totals: typeof found.payment_totals_json === "string" ? JSON.parse(found.payment_totals_json) : found.payment_totals || {},
      notes: found.notes,
      sync_state: found.sync_state || "pending",
    };
  }

  async recordSaleTender(counterId: string, paymentMode: string, amount: number): Promise<void> {
    const shift = await this.getActiveShift(counterId);
    if (!shift) return;

    const upper = (paymentMode || "").trim().toUpperCase();
    const normalizedMode =
      upper === "UPI" ? "UPI" :
      upper === "CASH" ? "Cash" :
      upper === "CARD" ? "Card" :
      upper === "CREDIT" ? "Credit" :
      upper === "CHEQUE" ? "Cheque" :
      paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1).toLowerCase();

    shift.payment_totals[normalizedMode] = (shift.payment_totals[normalizedMode] || 0) + Number(amount);

    if (normalizedMode === "Cash") {
      shift.expected_cash = (shift.expected_cash || shift.opening_cash) + Number(amount);
    }

    await sqliteStorage.insertRecord("cash_shifts", shift.id, {
      ...shift,
      payment_totals_json: JSON.stringify(shift.payment_totals),
    });
  }

  async recordCashMovement(
    shiftId: string,
    type: "cash_in" | "cash_out",
    amount: number,
    _reason: string
  ): Promise<void> {
    const raw = await sqliteStorage.findById<any>("cash_shifts", shiftId);
    if (!raw || raw.status !== "open") throw new Error("Active shift not found");

    if (type === "cash_in") {
      raw.cash_in = (Number(raw.cash_in) || 0) + Number(amount);
      raw.expected_cash = (Number(raw.expected_cash) || Number(raw.opening_cash)) + Number(amount);
    } else {
      raw.cash_out = (Number(raw.cash_out) || 0) + Number(amount);
      raw.expected_cash = (Number(raw.expected_cash) || Number(raw.opening_cash)) - Number(amount);
    }

    await sqliteStorage.insertRecord("cash_shifts", shiftId, raw);
  }

  async closeShift(
    shiftId: string,
    countedCash: number,
    notes?: string
  ): Promise<{ shift: CashShift; variance: number }> {
    const raw = await sqliteStorage.findById<any>("cash_shifts", shiftId);
    if (!raw) throw new Error("Shift not found");

    const opening = Number(raw.opening_cash || 0);
    const cashIn = Number(raw.cash_in || 0);
    const cashOut = Number(raw.cash_out || 0);
    const pTotals = typeof raw.payment_totals_json === "string" ? JSON.parse(raw.payment_totals_json) : raw.payment_totals || {};
    const cashSales = Number(pTotals.Cash || 0);

    const expectedCash = opening + cashSales + cashIn - cashOut;
    const variance = countedCash - expectedCash;

    raw.status = "closed";
    raw.closed_at = Date.now();
    raw.closing_cash_counted = countedCash;
    raw.expected_cash = expectedCash;
    raw.cash_variance = variance;
    if (notes) raw.notes = notes;

    await sqliteStorage.insertRecord("cash_shifts", shiftId, raw);

    return {
      shift: {
        ...raw,
        payment_totals: pTotals,
      },
      variance,
    };
  }

  async listShiftsForDate(date: string): Promise<CashShift[]> {
    const all = await sqliteStorage.findAll<any>("cash_shifts");
    return (all || [])
      .filter((s) => s.shift_date === date)
      .map((s) => ({
        id: s.id,
        counter_id: s.counter_id,
        counter_name: s.counter_name,
        user_id: s.user_id,
        user_name: s.user_name,
        shift_date: s.shift_date,
        opened_at: Number(s.opened_at),
        closed_at: s.closed_at ? Number(s.closed_at) : null,
        opening_cash: Number(s.opening_cash || 0),
        cash_in: Number(s.cash_in || 0),
        cash_out: Number(s.cash_out || 0),
        closing_cash_counted: s.closing_cash_counted !== null ? Number(s.closing_cash_counted) : null,
        expected_cash: s.expected_cash !== null ? Number(s.expected_cash) : null,
        cash_variance: s.cash_variance !== null ? Number(s.cash_variance) : null,
        status: s.status,
        payment_totals: typeof s.payment_totals_json === "string" ? JSON.parse(s.payment_totals_json) : s.payment_totals || {},
        notes: s.notes,
        sync_state: s.sync_state || "pending",
      }));
  }

  async generateStoreConsolidatedDayClose(
    storeId: string,
    date: string,
    closedByUserId: string,
    closedByUserName: string
  ): Promise<StoreDayClose> {
    const shifts = await this.listShiftsForDate(date);
    const countersIncluded = Array.from(new Set(shifts.map((s) => s.counter_id)));

    const consolidatedByTender: Record<string, number> = {
      Cash: 0,
      UPI: 0,
      Card: 0,
      Credit: 0,
      Cheque: 0,
    };

    let totalVariance = 0;

    for (const shift of shifts) {
      totalVariance += Number(shift.cash_variance || 0);
      for (const [mode, amt] of Object.entries(shift.payment_totals)) {
        consolidatedByTender[mode] = (consolidatedByTender[mode] || 0) + Number(amt);
      }
    }

    const grossSales = Object.values(consolidatedByTender).reduce((a, b) => a + b, 0);
    const dayCloseId = `close_${storeId}_${date}`;

    const record: StoreDayClose = {
      id: dayCloseId,
      store_id: storeId,
      close_date: date,
      closed_by_user_id: closedByUserId,
      closed_by_user_name: closedByUserName,
      counters_included: countersIncluded,
      consolidated_sales: grossSales,
      consolidated_returns: 0,
      consolidated_net: grossSales,
      consolidated_by_tender: consolidatedByTender,
      total_cash_variance: totalVariance,
      closed_at: Date.now(),
      sync_state: "pending",
    };

    await sqliteStorage.insertRecord("store_day_closes", dayCloseId, {
      ...record,
      counters_included_json: JSON.stringify(record.counters_included),
      consolidated_by_tender_json: JSON.stringify(record.consolidated_by_tender),
    });

    return record;
  }
}

export const cashShiftService = new CashShiftService();
