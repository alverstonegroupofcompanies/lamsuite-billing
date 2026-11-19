import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, Copy, History, RefreshCw, RotateCcw, Search, Store as StoreIcon, Trash2, X } from "lucide-react";
import { api } from "../../services/api";
import type { Product } from "../../types";

interface StoreOption {
  id: number;
  name: string;
  code?: string;
}

interface PreviewRow {
  source_product_id: number;
  name: string;
  barcode: string | null;
  status: "new" | "conflict" | string;
  conflict_with: string | null;
}

interface CopyRun {
  id: number;
  copied_count: number;
  skipped_count: number;
  created_at: string;
  reversed_at: string | null;
  target_store?: { name: string; code?: string };
}

interface CopyProductsModalProps {
  initialProducts: Product[];
  onClose: () => void;
  onCopied?: () => void;
}

const REVERT_WINDOW_DAYS = 7;

const currentStoreId = (): number | null => {
  const raw = localStorage.getItem("admin_store_id");
  return raw && raw !== "all" ? Number(raw) : null;
};

export const CopyProductsModal: React.FC<CopyProductsModalProps> = ({ initialProducts, onClose, onCopied }) => {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [targetStoreId, setTargetStoreId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [copiedRun, setCopiedRun] = useState<CopyRun | null>(null);
  const [runs, setRuns] = useState<CopyRun[]>([]);
  const [revertingRunId, setRevertingRunId] = useState<number | null>(null);
  const [confirmingRunId, setConfirmingRunId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRuns = async () => {
    try {
      const res = await api.get<{ data?: CopyRun[] }>("/admin/catalog/copy-runs");
      setRuns(res.data ?? []);
    } catch {
      setRuns([]);
    }
  };

  useEffect(() => {
    void fetchRuns();
    api
      .get<{ data?: StoreOption[] | { data: StoreOption[] } }>("/admin/stores", { per_page: 100 })
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : ((res.data as any)?.data ?? []);
        setStores((list as StoreOption[]).filter((s) => s.id !== currentStoreId()));
      })
      .catch((err: any) => setNotice({ type: "error", message: err?.message || "Failed to load stores." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ data?: { data?: Product[] } | Product[] }>("/admin/products", {
          search: search.trim(),
          per_page: 10,
        });
        const rows = (Array.isArray(res.data) ? res.data : (res.data as any)?.data ?? []) as Product[];
        setSearchResults(rows);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const addProduct = (p: Product) => {
    if (!products.some((x) => x.id === p.id)) {
      setProducts((prev) => [...prev, p]);
      setPreview(null);
    }
    setSearch("");
    setSearchResults([]);
  };

  const removeProduct = (id: number) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setPreview(null);
  };

  const handlePreview = async () => {
    if (!targetStoreId || products.length === 0) return;
    setNotice(null);
    try {
      const res = await api.post<{ preview: { products: PreviewRow[] } }>("/admin/catalog/copy", {
        target_store_id: targetStoreId,
        product_ids: products.map((p) => p.id),
        preview: true,
      });
      setPreview(res.preview?.products ?? []);
    } catch (err: any) {
      setNotice({ type: "error", message: err?.message || "Preview failed." });
    }
  };

  const handleCopy = async () => {
    if (!targetStoreId || products.length === 0) return;
    setIsCopying(true);
    setNotice(null);
    try {
      const res = await api.post<{ run: CopyRun }>("/admin/catalog/copy", {
        target_store_id: targetStoreId,
        product_ids: products.map((p) => p.id),
      });
      setCopiedRun(res.run);
      setPreview(null);
      onCopied?.();
      void fetchRuns();
    } catch (err: any) {
      setNotice({ type: "error", message: err?.message || "Copy failed." });
    } finally {
      setIsCopying(false);
    }
  };

  const handleRevert = async (runId: number) => {
    setRevertingRunId(runId);
    setNotice(null);
    try {
      const res = await api.post<{ deleted: number; archived: number }>(`/admin/catalog/copy-runs/${runId}/revert`);
      setNotice({
        type: "success",
        message: `Run reverted: ${res.deleted} copy(ies) deleted, ${res.archived} archived (still referenced).`,
      });
      onCopied?.();
      void fetchRuns();
    } catch (err: any) {
      setNotice({ type: "error", message: err?.message || "Revert failed." });
    } finally {
      setRevertingRunId(null);
    }
  };

  const isRevertible = (run: CopyRun): boolean =>
    !run.reversed_at && Date.now() - new Date(run.created_at).getTime() < REVERT_WINDOW_DAYS * 86_400_000;

  const targetStore = useMemo(() => stores.find((s) => s.id === targetStoreId), [stores, targetStoreId]);
  const canAct = targetStoreId !== null && products.length > 0 && !copiedRun;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-500/10 text-brand-600">
              <Copy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100">Copy products to another store</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                One-time copy. Rates and master fields travel; stock, batches and history stay behind.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {notice && (
            <div
              className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2 border ${
                notice.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300"
                  : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300"
              }`}
            >
              {notice.type === "success" ? (
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{notice.message}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Target store
            </label>
            <div className="mt-1 relative">
              <StoreIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={targetStoreId ?? ""}
                onChange={(e) => {
                  setTargetStoreId(e.target.value ? Number(e.target.value) : null);
                  setPreview(null);
                }}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
              >
                <option value="">Select target store…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.code ? `(${s.code})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!copiedRun && (
            <div className="relative">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Products to copy ({products.length})
              </label>
              <div className="mt-1 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search current-store products to add…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                />
                {searching && (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>
              {searchResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-100">{p.name}</span>
                      <span className="font-mono text-[10px] text-slate-400">{p.barcode || "—"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 uppercase text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Barcode</th>
                  <th className="px-3 py-2">Preview</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      Add at least one product.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => {
                    const row = preview?.find((r) => r.source_product_id === p.id);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{p.name}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{p.barcode || "—"}</td>
                        <td className="px-3 py-2">
                          {row ? (
                            row.status === "conflict" ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                Conflict · {row.conflict_with}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                New
                              </span>
                            )
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!copiedRun && (
                            <button
                              onClick={() => removeProduct(p.id)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded"
                              title="Remove from selection"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {copiedRun && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
              Copied {copiedRun.copied_count} product{copiedRun.copied_count === 1 ? "" : "s"}
              {copiedRun.skipped_count > 0
                ? `, skipped ${copiedRun.skipped_count} (a product with the same barcode already exists in the target)`
                : ""}
              . Reversible for 7 days from the run list below.
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              <History className="w-3.5 h-3.5" />
              Recent copy runs (this store)
            </div>
            {runs.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">No copy runs yet.</p>
            ) : (
              <div className="mt-1 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 uppercase text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Run</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Copied</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {runs.slice(0, 5).map((run) => (
                      <tr key={run.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2">
                          <span className="font-mono text-[10px] text-slate-400">#{run.id}</span>
                          <div className="text-[10px] text-slate-400">{new Date(run.created_at).toLocaleString()}</div>
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                          {run.target_store?.name ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {run.copied_count}
                          {run.skipped_count > 0 && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400"> · {run.skipped_count} skipped</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {run.reversed_at ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                              Reversed
                            </span>
                          ) : isRevertible(run) ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              Reversible
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              Window closed
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!run.reversed_at && isRevertible(run) && confirmingRunId !== run.id && (
                            <button
                              onClick={() => setConfirmingRunId(run.id)}
                              disabled={revertingRunId !== null}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300"
                              title="Revert this copy run"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Revert
                            </button>
                          )}
                          {!run.reversed_at && isRevertible(run) && confirmingRunId === run.id && (
                            <span className="inline-flex items-center gap-1">
                              <button
                                onClick={() => handleRevert(run.id)}
                                disabled={revertingRunId === run.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                              >
                                {revertingRunId === run.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  "Confirm revert"
                                )}
                              </button>
                              <button
                                onClick={() => setConfirmingRunId(null)}
                                className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300"
                              >
                                Keep
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          {preview && !copiedRun && (
            <span className="mr-auto text-[10px] text-slate-400">
              Preview: {preview.filter((r) => r.status === "conflict").length} conflict(s) against{" "}
              {targetStore?.name ?? "target"}
            </span>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Close
          </button>
          {!copiedRun && (
            <>
              <button
                onClick={handlePreview}
                disabled={!canAct || isCopying}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:text-slate-200"
              >
                Preview
              </button>
              <button
                onClick={handleCopy}
                disabled={!canAct || isCopying}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCopying ? "Copying…" : "Copy now"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
