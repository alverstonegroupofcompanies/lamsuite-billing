import React, { useEffect, useState } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { ToggleLeft, Check, Sparkles, Sliders, RefreshCw } from "lucide-react";

interface FeaturePayload {
  store_id: number;
  store_name: string;
  all_available_menus: Array<{ id: string; name: string; description: string }>;
  enabled_menu_items: string[];
  feature_flags: Record<string, boolean>;
  version: number;
}

interface FlagSpec {
  key: string;
  title: string;
  desc: string;
}

/**
 * The switches this branch may hold. The server answers for a store that never saved
 * one, so every key here is present in the payload as a real boolean — the page never
 * has to guess whether a missing row means off or unchosen.
 */
const FLAG_GROUPS: Array<{ heading: string; flags: FlagSpec[] }> = [
  {
    heading: "Sales & POS Checkout",
    flags: [
      {
        key: "allow_offline_billing",
        title: "Offline Local SQLite Billing",
        desc: "Allow operators to issue bills when internet connectivity is down",
      },
      {
        key: "allow_custom_discounts",
        title: "Cashier Custom Line Discounts",
        desc: "Allow billing operators to apply on-the-fly manual line discounts",
      },
      {
        key: "auto_print_thermal",
        title: "Instant Thermal Print on Bill Finalize",
        desc: "Automatically print 80mm receipt without opening OS print dialog",
      },
    ],
  },
  {
    heading: "Pharmacy Compliance & Inventory",
    flags: [
      {
        key: "require_doctor_on_schedule_h",
        title: "Schedule H / H1 Doctor Prescription Mandatory",
        desc: "Block checkout of Schedule H medicines without registered doctor details",
      },
      {
        key: "enforce_mrp_capping",
        title: "Strict MRP Ceiling Protection",
        desc: "Prohibit selling rate from exceeding government statutory MRP",
      },
    ],
  },
  {
    heading: "Finance & Customer Ledger",
    flags: [
      {
        key: "enable_wallet_credit",
        title: "Customer Credit & Ledger Wallet",
        desc: "Permit credit payment mode for approved patient accounts",
      },
    ],
  },
  {
    heading: "Branch Data Ownership",
    flags: [
      {
        key: "allow_data_migration",
        title: "Legacy Data Migration",
        desc:
          "Let this branch's workstations run the Store Data Migration wizard. Off stops imports; past runs stay listed and rollback stays available.",
      },
    ],
  },
];

const FlagToggle: React.FC<{
  flag: FlagSpec;
  checked: boolean;
  onToggle: (key: string) => void;
}> = ({ flag, checked, onToggle }) => (
  <div
    onClick={() => onToggle(flag.key)}
    className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
      checked
        ? "bg-purple-50/40 dark:bg-slate-800/80 border-purple-200 dark:border-purple-800/60"
        : "bg-slate-50/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60"
    }`}
  >
    <div>
      <div className="font-bold text-slate-800 dark:text-slate-100 text-xs">{flag.title}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{flag.desc}</div>
    </div>
    <div
      className={`w-11 h-6 flex items-center rounded-full p-1 duration-200 ease-in-out shrink-0 ml-3 ${
        checked ? "bg-purple-600 justify-end" : "bg-slate-300 dark:bg-slate-700 justify-start"
      }`}
    >
      <div className="bg-white w-4 h-4 rounded-full shadow-md transform" />
    </div>
  </div>
);

export const FeaturesPage: React.FC = () => {
  const { activeStore } = useAuth();
  const [data, setData] = useState<FeaturePayload | null>(null);
  const [enabledMenus, setEnabledMenus] = useState<string[]>([]);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const fetchFeatures = async () => {
    if (!activeStore) return;
    try {
      const res = await api.get<FeaturePayload>(`/admin/stores/${activeStore.id}/features`);
      setData(res);
      setEnabledMenus(res.enabled_menu_items || []);
      setFeatureFlags(res.feature_flags || {});
    } catch (err) {
      console.error("Failed to load feature flags:", err);
    }
  };

  useEffect(() => {
    fetchFeatures();
  }, [activeStore]);

  const toggleMenu = (menuId: string) => {
    setEnabledMenus((prev) =>
      prev.includes(menuId) ? prev.filter((m) => m !== menuId) : [...prev, menuId]
    );
  };

  const toggleFlag = (flagKey: string) => {
    setFeatureFlags((prev) => ({
      ...prev,
      [flagKey]: !prev[flagKey],
    }));
  };

  const handleSave = async () => {
    if (!activeStore) return;
    setIsSaving(true);
    setSavedSuccess(false);

    try {
      await api.put(`/admin/stores/${activeStore.id}/features`, {
        enabled_menu_items: enabledMenus,
        feature_flags: featureFlags,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      await fetchFeatures();
    } catch (err: any) {
      alert(err?.message || "Failed to update feature control.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-brand-600" />
        Loading menu & feature switches...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title & Save Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Menu & Feature Control ({data.store_name})
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Dynamically enable or restrict module visibility and operational rules for this branch's workstations live.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {savedSuccess && (
            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
              <Check className="w-4 h-4" />
              <span>Applied live to workstations!</span>
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50"
          >
            {isSaving ? "Saving Switches..." : "Apply Feature Config"}
          </button>
        </div>
      </div>

      {/* Grid: Menu Items Switches (Left) & Feature Flags (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module Menu Visibility */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Sliders className="w-4 h-4 text-brand-600" />
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Desktop Navigation Modules
              </h3>
              <p className="text-[11px] text-slate-400">
                Turning off any module (e.g. Reports) removes it from the workstation navigation bar without reinstallation.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {data.all_available_menus.map((m) => {
              const isEnabled = enabledMenus.includes(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => toggleMenu(m.id)}
                  className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                    isEnabled
                      ? "bg-brand-50/40 dark:bg-slate-800/80 border-brand-200 dark:border-brand-800/60"
                      : "bg-slate-50/60 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60"
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-100 text-xs">{m.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{m.description}</div>
                  </div>
                  <div
                    className={`w-11 h-6 flex items-center rounded-full p-1 duration-200 ease-in-out ${
                      isEnabled ? "bg-brand-600 justify-end" : "bg-slate-300 dark:bg-slate-700 justify-start"
                    }`}
                  >
                    <div className="bg-white w-4 h-4 rounded-full shadow-md transform" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Feature Flags */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Policy & Compliance Feature Flags
              </h3>
              <p className="text-[11px] text-slate-400">
                Statutory pharmacy protocols, discount capping, and thermal receipt defaults.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {FLAG_GROUPS.map((group) => (
              <div key={group.heading}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400 mb-2">
                  {group.heading}
                </div>
                <div className="space-y-2">
                  {group.flags.map((flag) => (
                    <FlagToggle
                      key={flag.key}
                      flag={flag}
                      checked={Boolean(featureFlags[flag.key])}
                      onToggle={toggleFlag}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
