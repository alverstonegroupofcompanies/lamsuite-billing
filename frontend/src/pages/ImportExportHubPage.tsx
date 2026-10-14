import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Upload,
  Download,
  History,
  FileSpreadsheet,
  FileText,
  Package,
  Users,
  Building,
  Truck,
  CreditCard,
  Layers,
  ArrowRight,
  ShieldCheck,
  CheckCircle,
  FileCheck,
  Sparkles,
} from "lucide-react";
import { entityRegistry } from "../lib/data-exchange/registry/entityRegistry";
import type { EntityCategory } from "../lib/data-exchange/registry/types";
import { ImportWizardModal } from "../lib/data-exchange/ui/ImportWizardModal";
import { ExportDialogModal } from "../lib/data-exchange/ui/ExportDialogModal";
import { ImportHistoryModal } from "../lib/data-exchange/ui/ImportHistoryModal";
import { gstStatutoryExporter } from "../lib/data-exchange/engine/gstExporter";

export const ImportExportHubPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const typeParam = searchParams.get("type");
  const wizardParam = searchParams.get("wizard");

  const [activeCategory, setActiveCategory] = useState<EntityCategory | "all">("all");
  const [importEntityId, setImportEntityId] = useState<string | null>(
    typeParam || (wizardParam ? "items" : null)
  );
  const [exportEntityId, setExportEntityId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isExportingGst, setIsExportingGst] = useState(false);
  const [hubNotice, setHubNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeParam) {
      setImportEntityId(typeParam);
    } else if (wizardParam) {
      setImportEntityId("items");
    }
  }, [typeParam, wizardParam]);

  const categories: Array<{ id: EntityCategory | "all"; label: string; icon: any }> = [
    { id: "all", label: "All Data Types", icon: Layers },
    { id: "masters", label: "Catalog & Masters", icon: Package },
    { id: "transactions", label: "Invoices & Purchases", icon: FileText },
    { id: "finance", label: "Accounts & Balances", icon: CreditCard },
    { id: "stock", label: "Inventory Movements", icon: Truck },
    { id: "clinical", label: "Doctors & Patients", icon: Users },
  ];

  const entities =
    activeCategory === "all"
      ? entityRegistry.getAll()
      : entityRegistry.getByCategory(activeCategory);

  const handleExportGstr1 = async () => {
    setIsExportingGst(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const startOfMonth = `${today.slice(0, 7)}-01`;
      await gstStatutoryExporter.exportGstr1(startOfMonth, today, "excel");
    } catch (err: any) {
      alert(`GSTR-1 export error: ${err?.message || err}`);
    } finally {
      setIsExportingGst(false);
    }
  };

  const handleExportPurchaseRegister = async () => {
    setIsExportingGst(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const startOfMonth = `${today.slice(0, 7)}-01`;
      await gstStatutoryExporter.exportPurchaseRegister(startOfMonth, today, "excel");
    } catch (err: any) {
      alert(`Purchase register error: ${err?.message || err}`);
    } finally {
      setIsExportingGst(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 bg-slate-50 min-h-screen overflow-auto">
      {hubNotice && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{hubNotice}</span>
          </div>
          <button
            onClick={() => setHubNotice(null)}
            className="text-emerald-700 hover:underline text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2.5">
            <Layers className="h-6 w-6 text-blue-600" />
            <span>Universal Import & Export Hub</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Pluggable data exchange with 100% offline support, atomic rollback, and GST statutory exports
          </p>
        </div>

        <div className="flex gap-2.5">
          <button
            onClick={() => setImportEntityId("items")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-sm transition-colors cursor-pointer"
          >
            <Upload className="h-4 w-4" />
            <span>Launch Import Wizard</span>
          </button>

          <a
            href="/migration"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
          >
            <Sparkles className="h-4 w-4" />
            <span>Store Data Migration Wizard</span>
          </a>

          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer"
          >
            <History className="h-4 w-4 text-slate-500" />
            <span>Import History & Rollback</span>
          </button>
        </div>
      </div>

      {/* Statutory GST Quick Actions Banner */}
      <div className="mt-5 p-4 rounded-2xl bg-gradient-to-r from-blue-900 to-indigo-900 text-white shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/30 text-blue-200 uppercase tracking-wide">
              Statutory GST Compliance
            </span>
            <span className="text-xs font-bold">One-Click Government Filing Reports</span>
          </div>
          <p className="text-xs text-blue-100 mt-1">
            Export GSTR-1, HSN Outward Supply Summary, and GSTR-2 Purchase Registers in statutory Excel format.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExportGstr1}
            disabled={isExportingGst}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
            <span>Export GSTR-1</span>
          </button>
          <button
            onClick={handleExportPurchaseRegister}
            disabled={isExportingGst}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-colors"
          >
            <FileCheck className="h-4 w-4 text-blue-300" />
            <span>Purchase Register</span>
          </button>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex gap-2 mt-6 overflow-x-auto pb-1">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap border ${
                isActive
                  ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Grid of Pluggable Entity Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        {entities.map((def) => {
          const fieldCount = Object.keys(def.fields).length;
          return (
            <div
              key={def.id}
              className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:shadow-xs transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {def.category}
                    </span>
                    <h3 className="text-sm font-bold text-slate-800 mt-1.5">{def.label}</h3>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {fieldCount} fields
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  {def.description}
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => setExportEntityId(def.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors"
                >
                  <Download className="h-3.5 w-3.5 text-blue-600" />
                  <span>Export</span>
                </button>

                {def.category !== "reports" && (
                  <button
                    onClick={() => setImportEntityId(def.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-2xs"
                  >
                    <Upload className="h-3.5 w-3.5 text-white" />
                    <span>Import Wizard</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {importEntityId && (
        <ImportWizardModal
          isOpen={Boolean(importEntityId)}
          initialEntityId={importEntityId}
          onClose={() => {
            setImportEntityId(null);
            setSearchParams({});
          }}
          onSuccess={() => {
            const label = entityRegistry.get(importEntityId)?.label || importEntityId;
            setHubNotice(`Import completed successfully for ${label}.`);
            setTimeout(() => setHubNotice(null), 6000);
            setImportEntityId(null);
            setSearchParams({});
          }}
        />
      )}

      {exportEntityId && (
        <ExportDialogModal
          isOpen={Boolean(exportEntityId)}
          initialEntityId={exportEntityId}
          onClose={() => setExportEntityId(null)}
        />
      )}

      {isHistoryOpen && (
        <ImportHistoryModal
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}
    </div>
  );
};
