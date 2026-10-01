import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ImpersonationBanner } from "./ImpersonationBanner";

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const navigate = useNavigate();

  // Keyboard navigation shortcuts (Alt+1 to Alt+9, Alt+S, Alt+C, Alt+A)
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

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
