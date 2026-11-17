import React from "react";
import { ShieldCheck } from "lucide-react";
import {
  PERMISSION_GROUPS,
  permissionCount,
  type UserPermissions,
} from "../lib/permissionModules";

interface PermissionMatrixProps {
  value: UserPermissions;
  onChange: (next: UserPermissions) => void;
}

const ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
};

/**
 * Tri-state permission editor:
 *  - override off  -> inherit the role baseline
 *  - override on   -> the checked actions are the complete allow-list
 *    (an empty allow-list explicitly denies the module)
 */
export const PermissionMatrix: React.FC<PermissionMatrixProps> = ({ value, onChange }) => {
  const setModule = (moduleId: string, actions: string[] | null) => {
    const next = { ...value };
    if (actions === null) {
      delete next[moduleId];
    } else {
      next[moduleId] = actions;
    }
    onChange(next);
  };

  const toggleAction = (moduleId: string, action: string, allowed: string[]) => {
    const current = value[moduleId] || [];
    const next = current.includes(action)
      ? current.filter((a) => a !== action)
      : [...current, action].sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b));
    setModule(moduleId, next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-[11px] text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Explicit permissions override the role baseline</p>
          <p className="mt-0.5">
            Leave a module on <strong>Inherit</strong> to use the role defaults. Enable
            <strong> Override</strong> to define the exact actions allowed; an override with no
            actions checked blocks the module entirely. These settings apply to both the POS
            desktop app and this admin panel.
          </p>
          <p className="mt-1 font-mono text-[10px] text-sky-700 dark:text-sky-300">
            {permissionCount(value)} module override(s)
          </p>
        </div>
      </div>

      {PERMISSION_GROUPS.map((group) => (
        <div key={group.id} className="rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{group.label}</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">{group.description}</div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {group.modules.map((module) => {
              const overridden = Object.prototype.hasOwnProperty.call(value, module.id);
              const current = value[module.id] || [];
              return (
                <div
                  key={module.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={overridden}
                        onChange={(e) =>
                          setModule(module.id, e.target.checked ? [...module.actions] : null)
                        }
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span className="truncate">{module.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                          overridden
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {overridden ? "Override" : "Inherit"}
                      </span>
                    </label>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-6">
                      {module.actions.map((action) => (
                        <label
                          key={action}
                          className={`flex items-center gap-1 text-[10px] ${
                            overridden
                              ? "text-slate-600 dark:text-slate-300"
                              : "text-slate-400 dark:text-slate-600"
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!overridden}
                            checked={overridden && current.includes(action)}
                            onChange={() => toggleAction(module.id, action, module.actions)}
                            className="rounded border-slate-300 text-blue-600 disabled:opacity-40"
                          />
                          {ACTION_LABELS[action] || action}
                        </label>
                      ))}
                      {overridden && current.length === 0 && (
                        <span className="text-[10px] font-semibold text-rose-600">
                          No actions = access denied
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={!overridden}
                      onClick={() => setModule(module.id, [...module.actions])}
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      disabled={!overridden}
                      onClick={() => setModule(module.id, [])}
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      None
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
