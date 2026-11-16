import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, RefreshCw, Share2, Store as StoreIcon, X } from "lucide-react";
import { api } from "../../services/api";
import type { Product } from "../../types";

interface CatalogStoreState {
  store_id: number;
  store_name: string;
  store_code?: string;
  is_source: boolean;
  status: "published" | "unpublished" | "not_published" | string;
  target_product_id: number | null;
  published_at: string | null;
}

interface CatalogPublishModalProps {
  product: Product;
  onClose: () => void;
}

const statusBadgeClasses: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  unpublished: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  not_published: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export const CatalogPublishModal: React.FC<CatalogPublishModalProps> = ({ product, onClose }) => {
  const [stores, setStores] = useState<CatalogStoreState[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchState = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ stores: CatalogStoreState[] }>("/admin/catalog/publications", {
        product_id: product.id,
      });
      setStores(res.stores || []);
      setSelected([]);
    } catch (err: any) {
      setNotice({ type: "error", message: err?.message || "Failed to load publication status." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const targetStores = stores.filter((s) => !s.is_source);

  const handlePublish = async () => {
    if (selected.length === 0) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await api.post<{ results: { status: string; store_name?: string }[] }>("/admin/catalog/publish", {
        product_id: product.id,
        store_ids: selected,
      });
      const ok = (res.results || []).filter((r) => r.status === "published").length;
      setNotice({ type: "success", message: `Published to ${ok} store${ok === 1 ? "" : "s"}.` });
      await fetchState();
    } catch (err: any) {
      setNotice({ type: "error", message: err?.message || "Failed to publish product." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnpublish = async () => {
    const publishedTargets = targetStores.filter((s) => s.status === "published" && selected.includes(s.store_id));
    if (publishedTargets.length === 0) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await api.post<{ results: { status: string }[] }>("/admin/catalog/unpublish", {
        product_id: product.id,
        store_ids: publishedTargets.map((s) => s.store_id),
      });
      const ok = (res.results || []).filter((r) => r.status === "unpublished").length;
      setNotice({ type: "success", message: `Withdrawn from ${ok} store${ok === 1 ? "" : "s"}.` });
      await fetchState();
    } catch (err: any) {
      setNotice({ type: "error", message: err?.message || "Failed to withdraw product." });
    } finally {
      setIsSaving(false);
    }
  };

  const toggle = (storeId: number) => {
    setSelected((prev) => (prev.includes(storeId) ? prev.filter((id) => id !== storeId) : [...prev, storeId]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-brand-500/10 text-brand-600">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100">Publish to Stores</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {product.name} {product.product_family_id ? `· ${product.product_family_id}` : ""}
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

        <div className="p-4 space-y-3">
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

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Copies share price, tax and identity fields. Stock, rack/shelf locations and reorder levels stay local to
            each store. Republishing refreshes existing copies instead of creating duplicates.
          </p>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 uppercase text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 w-10"></th>
                  <th className="px-3 py-2">Store</th>
                  <th className="px-3 py-2">Publication</th>
                  <th className="px-3 py-2">Last published</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />
                      Loading stores...
                    </td>
                  </tr>
                ) : (
                  stores.map((store) => (
                    <tr key={store.store_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-center">
                        {store.is_source ? (
                          <span className="text-[10px] text-slate-400">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={selected.includes(store.store_id)}
                            onChange={() => toggle(store.store_id)}
                            aria-label={`Select ${store.store_name}`}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <StoreIcon className="w-3.5 h-3.5 text-slate-400" />
                          <div>
                            <span className="font-semibold text-slate-900 dark:text-white">{store.store_name}</span>
                            {store.is_source && (
                              <span className="ml-2 text-[10px] font-bold text-brand-600 uppercase">Source</span>
                            )}
                            <div className="text-[10px] text-slate-400 font-mono">{store.store_code || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            statusBadgeClasses[store.status] || statusBadgeClasses.not_published
                          }`}
                        >
                          {store.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                        {store.published_at ? new Date(store.published_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-end gap-2 p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Close
          </button>
          <button
            onClick={handleUnpublish}
            disabled={isSaving || selected.length === 0}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-amber-800 dark:text-amber-300"
          >
            Withdraw selected
          </button>
          <button
            onClick={handlePublish}
            disabled={isSaving || selected.length === 0}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving..." : "Publish selected"}
          </button>
        </div>
      </div>
    </div>
  );
};
