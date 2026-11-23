import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { useAuth } from "../context/AuthContext";
import { Layers } from "lucide-react";

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { isAllStores, stores, setActiveStore } = useAuth();
  const navigate = useNavigate();

  // Keyboard navigation shortcuts (Alt+1 to Alt+9, Alt+S, Alt+C, Alt+A, Alt+G, Alt+R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.key === "1") {
          e.preventDefault();
          navigate("/");
        } else if (e.key === "2") {
          e.preventDefault();
          navigate("/stores");
        } else if (e.key === "3") {
          e.preventDefault();
          navigate("/devices");
        } else if (e.key === "4") {
          e.preventDefault();
          navigate("/features");
        } else if (e.key === "5") {
          e.preventDefault();
          navigate("/users");
        } else if (e.key === "6") {
          e.preventDefault();
          navigate("/masters");
        } else if (e.key === "7") {
          e.preventDefault();
          navigate("/transactions");
        } else if (e.key === "8") {
          e.preventDefault();
          navigate("/inventory");
        } else if (e.key === "9") {
          e.preventDefault();
          navigate("/reports");
        } else if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          navigate("/sync");
        } else if (e.key.toLowerCase() === "c") {
          e.preventDefault();
          navigate("/settings");
        } else if (e.key.toLowerCase() === "a") {
          e.preventDefault();
          navigate("/audit");
        } else if (e.key.toLowerCase() === "g") {
          e.preventDefault();
          navigate("/gift-cards");
        } else if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          navigate("/settlements");
        } else if (e.key.toLowerCase() === "d") {
          e.preventDefault();
          navigate("/day-close");
        } else if (e.key.toLowerCase() === "e") {
          e.preventDefault();
          navigate("/compliance");
        } else if (e.key.toLowerCase() === "p") {
          e.preventDefault();
          navigate("/price-lists");
        } else if (e.key.toLowerCase() === "o") {
          e.preventDefault();
          navigate("/sales-orders");
        } else if (e.key.toLowerCase() === "x") {
          e.preventDefault();
          navigate("/accounting-exports");
        } else if (e.key.toLowerCase() === "l") {
          e.preventDefault();
          navigate("/loyalty");
        } else if (e.key.toLowerCase() === "b") {
          e.preventDefault();
          navigate("/portal-access");
        } else if (e.key.toLowerCase() === "k") {
          e.preventDefault();
          navigate("/counters");
        } else if (e.key.toLowerCase() === "n") {
          e.preventDefault();
          navigate("/salespeople");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ImpersonationBanner />
        <Header onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

        {isAllStores && (
          <div className="flex items-center gap-2 px-4 py-2 text-[11px] bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>
              Consolidated view across {stores.length} stores. Reports are aggregated; switch to a
              specific store to create or edit records.
            </span>
            {stores[0] && (
              <button
                onClick={() => setActiveStore(stores[0])}
                className="ml-auto shrink-0 font-semibold underline hover:no-underline"
              >
                Switch to {stores[0].name}
              </button>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
