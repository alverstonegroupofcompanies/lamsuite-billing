import React from "react";
import { useAuth } from "../context/AuthContext";
import { AlertCircle, LogOut } from "lucide-react";

export const ImpersonationBanner: React.FC = () => {
  const { isImpersonating, user, impersonatedBy, stopImpersonation, activeStore } = useAuth();

  if (!isImpersonating) return null;

  return (
    <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-md border-b border-amber-600 sticky top-0 z-50 animate-pulse">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-slate-950 shrink-0" />
        <span>
          <strong>IMPERSONATION ACTIVE:</strong> Logged in as{" "}
          <span className="underline decoration-slate-900">{user?.name}</span> ({user?.role}) at{" "}
          <span className="underline decoration-slate-900">{activeStore?.name || "Global Store"}</span>.
          (Triggered by: {impersonatedBy || "Super Admin"})
        </span>
      </div>
      <button
        onClick={stopImpersonation}
        className="bg-slate-950 text-amber-400 hover:bg-slate-900 px-3 py-1 rounded font-bold flex items-center gap-1.5 transition-colors shadow-sm"
      >
        <LogOut className="w-3.5 h-3.5" />
        <span>Exit Impersonation</span>
      </button>
    </div>
  );
};
