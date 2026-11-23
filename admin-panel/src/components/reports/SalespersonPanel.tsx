import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api";
import { formatINR } from "../../utils/formatters";
import { useAuth } from "../../context/AuthContext";
import { AlertCircle, RefreshCw, Users2 } from "lucide-react";

/**
 * GAP-01 / SPR-015 — the salesperson register.
 *
 * One row per person for the window the page was handed, plus the money nobody
 * was named on: an owner reading this must be able to add the column back to
 * the store's own sales summary, so the unattributed figure is shown rather
 * than dropped, and a person who has left the master keeps the name printed on
 * their bills instead of disappearing from the window.
 */

interface SalespersonRow {
  salesperson_id: number | null;
  name: string;
  code?: string | null;
  store_id?: number | null;
  store_name?: string;
  archived?: boolean;
  bills: number;
  returns: number;
  gross_sales: number;
  returns_value: number;
  net_sales: number;
  discounts: number;
  net_taxable_value: number;
  average_bill: number;
  items?: Array<{ product_id: number | null; product_name: string; qty: number; net_value: number }>;
}

interface Register {
  date_range?: { start_date: string; end_date: string };
  salespeople: SalespersonRow[];
  unattributed?: SalespersonRow;
  totals?: SalespersonRow;
}

interface Props {
  startDate: string;
  endDate: string;
}

const Money: React.FC<{ value: number }> = ({ value }) => <span>{formatINR(value)}</span>;

export const SalespersonPanel: React.FC<Props> = ({ startDate, endDate }) => {
  const { isAllStores } = useAuth();
  const [register, setRegister] = useState<Register | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<Register>("/admin/reports/salesperson", {
        start_date: startDate,
        end_date: endDate,
      });
      setRegister(res);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "The salesperson register could not be read.");
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const headCell = "px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500";
  const bodyCell = "px-3 py-2 text-xs text-slate-700 dark:text-slate-200 whitespace-nowrap";
  const moneyCell = `${bodyCell} text-right font-mono`;

  const personLine = (row: SalespersonRow, key: string) => (
    <React.Fragment key={key}>
      <tr>
        <td className={bodyCell}>
          <span className="font-bold">{row.name}</span>
          {row.archived ? (
            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
              Archived
            </span>
          ) : null}
        </td>
        <td className={`${bodyCell} font-mono`}>{row.code || "—"}</td>
        {isAllStores && <td className={bodyCell}>{row.store_name || "—"}</td>}
        <td className={`${bodyCell} text-right font-mono`}>{row.bills ?? 0}</td>
        <td className={`${bodyCell} text-right font-mono`}>{row.returns ?? 0}</td>
        <td className={moneyCell}>
          <Money value={row.gross_sales ?? 0} />
        </td>
        <td className={moneyCell}>
          <Money value={row.net_sales ?? 0} />
        </td>
        <td className={moneyCell}>
          <Money value={row.discounts ?? 0} />
        </td>
        <td className={moneyCell}>
          <Money value={row.net_taxable_value ?? 0} />
        </td>
        <td className={moneyCell}>
          <Money value={row.average_bill ?? 0} />
        </td>
      </tr>
      {row.items && row.items.length > 0 && (
        <tr>
          <td colSpan={isAllStores ? 10 : 9} className="px-3 pb-3 text-[11px] text-slate-500 dark:text-slate-400">
            {row.items.map((item, index) => (
              <div key={`${item.product_id ?? item.product_name}-${index}`}>
                <span className="font-bold text-slate-700 dark:text-slate-200">{item.product_name}</span>
                <span className="font-mono"> · {item.qty} units · {formatINR(item.net_value)}</span>
              </div>
            ))}
          </td>
        </tr>
      )}
    </React.Fragment>
  );

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-emerald-600" />
        Compiling the salesperson register...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"
      >
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  const people = register?.salespeople || [];

  if (people.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
        <Users2 className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
        <span>
          This store has no salespeople on the master yet. Add them under Identity &amp; Staff → Salespeople and
          every bill they sell starts naming who sold.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {register?.date_range
            ? `${register.date_range.start_date} to ${register.date_range.end_date}`
            : `${startDate} to ${endDate}`}
          {isAllStores ? " · every store" : ""}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          title="Refresh the register"
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={headCell} scope="col">
                Salesperson
              </th>
              <th className={headCell} scope="col">
                Code
              </th>
              {isAllStores && (
                <th className={headCell} scope="col">
                  Store
                </th>
              )}
              <th className={headCell} scope="col">
                Bills
              </th>
              <th className={headCell} scope="col">
                Returns
              </th>
              <th className={headCell} scope="col">
                Gross sales
              </th>
              <th className={headCell} scope="col">
                Net sales
              </th>
              <th className={headCell} scope="col">
                Discounts
              </th>
              <th className={headCell} scope="col">
                Net taxable
              </th>
              <th className={headCell} scope="col">
                Average bill
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((row) => personLine(row, `person-${row.salesperson_id ?? "x"}-${row.name}`))}
            {register?.unattributed && (
              <React.Fragment>
                {personLine(
                  {
                    ...register.unattributed,
                    name: "Unattributed",
                    code: register.unattributed.code || null,
                    archived: false,
                    items: [],
                  },
                  "unattributed"
                )}
              </React.Fragment>
            )}
          </tbody>
          {register?.totals && (
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40">
                <td className={`${bodyCell} font-black`}>All salespeople</td>
                <td className={bodyCell} />
                {isAllStores && <td className={bodyCell} />}
                <td className={`${bodyCell} text-right font-mono font-black`}>{register.totals.bills ?? 0}</td>
                <td className={`${bodyCell} text-right font-mono font-black`}>{register.totals.returns ?? 0}</td>
                <td className={`${moneyCell} font-black`}>
                  <Money value={register.totals.gross_sales ?? 0} />
                </td>
                <td className={`${moneyCell} font-black`}>
                  <Money value={register.totals.net_sales ?? 0} />
                </td>
                <td className={`${moneyCell} font-black`}>
                  <Money value={register.totals.discounts ?? 0} />
                </td>
                <td className={`${moneyCell} font-black`}>
                  <Money value={register.totals.net_taxable_value ?? 0} />
                </td>
                <td className={`${moneyCell} font-black`}>
                  <Money value={register.totals.average_bill ?? 0} />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Unattributed bills are kept in the window so the register adds back to the store's own sales summary —
        they are not a person and are never counted as one.
      </p>
    </div>
  );
};

export default SalespersonPanel;
