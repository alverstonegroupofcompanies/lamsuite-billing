import React, { useEffect, useMemo, useState } from "react";
import { X, RefreshCw, Search, ClipboardList, ArrowRight, AlertCircle } from "lucide-react";
import { ModalLayer } from "../lib/modal/CentralModalManager";
import {
  salesOrderService,
  type SalesOrderSummary,
  type SalesOrderDetail,
} from "../lib/sales/salesOrderService";

interface SalesOrderRecallModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Return false to keep the dialog open (e.g. the user cancelled a cart replacement). */
  onLoad: (order: SalesOrderDetail) => void | boolean | Promise<void | boolean>;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-surface-subtle text-text-muted border-border-main",
  confirmed: "bg-accent-soft text-accent border-transparent",
  partially_fulfilled: "bg-warning-bg text-warning-text border-warning-border",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  partially_fulfilled: "Partially fulfilled",
};

function formatAmount(value: number): string {
  return `₹${(Number(value) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const SalesOrderRecallModal: React.FC<SalesOrderRecallModalProps> = ({
  isOpen,
  onClose,
  onLoad,
}) => {
  const [orders, setOrders] = useState<SalesOrderSummary[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setOrders(await salesOrderService.listOpenOrders());
    } catch (err: any) {
      setOrders([]);
      setError(err?.message || "Could not load sales orders. Open orders need a cloud connection.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      void loadOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.order_number, o.customer_name, o.customer_id].some((v) =>
        String(v ?? "").toLowerCase().includes(q)
      )
    );
  }, [orders, query]);

  const handleLoad = async (order: SalesOrderSummary) => {
    if (loadingId !== null) return;
    setLoadingId(order.id);
    setError(null);
    try {
      const detail = await salesOrderService.getOrder(order.id);
      if (!detail) {
        setError(`Sales order ${order.order_number} could not be loaded.`);
        return;
      }
      const result = await onLoad(detail);
      if (result === false) return;
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to load sales order.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <ModalLayer
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Recall Sales Orders"
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4 select-none z-[60]"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-border-main bg-surface shadow-modal">
        <div className="flex items-center justify-between gap-3 border-b border-border-main bg-canvas px-4 py-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-accent" />
            <h3 className="text-xs font-bold text-text-main">Recall Sales Orders</h3>
            <span className="text-[10px] text-text-muted">Open orders from this store</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void loadOrders()}
              disabled={isLoading}
              title="Refresh open orders"
              className="rounded-btn p-1 text-text-muted hover:bg-surface hover:text-text-main disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sales order dialog"
              className="rounded-btn p-1 text-text-muted hover:bg-surface hover:text-text-main cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="border-b border-border-main px-4 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by order number or customer"
              className="w-full rounded-btn border border-border-main bg-surface py-1.5 pl-8 pr-3 text-xs text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 border-b border-warning-border bg-warning-bg px-4 py-2 text-[11px] text-warning-text">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border-main">
          {isLoading ? (
            <div className="py-10 text-center text-xs text-text-muted">Loading open orders…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-text-muted">
              {orders.length === 0
                ? "No open sales orders. Save a cart as an order to see it here."
                : "No orders match your search."}
            </div>
          ) : (
            filtered.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs hover:bg-surface-hover transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-text-main">{order.order_number}</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        STATUS_STYLES[order.status] || STATUS_STYLES.draft
                      }`}
                    >
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-text-muted">
                    {order.customer_name || "Walk-in Customer"} · {order.order_date} · {order.items_count} item
                    {order.items_count === 1 ? "" : "s"} · {formatAmount(order.grand_total)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleLoad(order)}
                  disabled={loadingId !== null}
                  className="flex items-center gap-1 rounded-btn bg-accent px-2.5 py-1 text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loadingId === order.id ? "Loading…" : "Open in Cart"}
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border-main bg-canvas px-4 py-2 text-[10px] text-text-muted">
          Loading an order only fills the cart. Fulfil or cancel the order in the Admin panel after billing.
        </div>
      </div>
    </ModalLayer>
  );
};
