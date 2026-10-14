import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  FileBarChart,
  Search,
  Star,
  Clock,
  X,
  Plus,
  Receipt,
  Building,
  Package,
  Truck,
  Users,
  ShieldAlert,
  ChevronRight,
  Shield,
  Layers,
  ArrowRight,
  Briefcase,
  TrendingUp,
} from "lucide-react";
import { reportRegistry, REPORT_CATEGORIES } from "../registry";
import type { ReportModule, ReportCategory } from "../types";
import { ReportViewContainer } from "./ReportViewContainer";
import { operatorAuthService } from "../../lib/auth/operatorAuthService";
import { companySettingsService } from "../../lib/settings/companySettingsService";

export const ReportsHub: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Active category filter on the left sidebar
  const [selectedCategory, setSelectedCategory] = useState<ReportCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Role and Menu settings
  const [userRole, setUserRole] = useState<string>("admin");
  const [enabledMenus, setEnabledMenus] = useState<string[]>(["reports"]);

  // Open tabs
  const [openTabIds, setOpenTabIds] = useState<string[]>(["daily-collection"]);
  const [activeTabId, setActiveTabId] = useState<string>("daily-collection");

  // Favorites & Recents in localStorage
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("lamsuite_report_favorites");
      return saved ? JSON.parse(saved) : ["daily-collection", "sales-register", "gstr1-summary"];
    } catch {
      return ["daily-collection", "sales-register"];
    }
  });

  const [recents, setRecents] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("lamsuite_report_recents");
      return saved ? JSON.parse(saved) : ["daily-collection"];
    } catch {
      return ["daily-collection"];
    }
  });

  // Load user role & store menu configuration
  useEffect(() => {
    const session = operatorAuthService.getSession();
    if (session?.user?.role) {
      setUserRole(session.user.role);
    }

    companySettingsService.loadSettings().then((cfg) => {
      if (cfg?.enabled_menu_items) {
        setEnabledMenus(cfg.enabled_menu_items);
      }
    });
  }, []);

  // Sync URL ?report=xxx parameter
  useEffect(() => {
    const reportParam = searchParams.get("report") || searchParams.get("tab");
    if (reportParam) {
      openReport(reportParam);
    }
  }, [searchParams]);

  // Compute accessible reports
  const accessibleReports = useMemo(() => {
    return reportRegistry.getAccessibleReports(userRole, enabledMenus);
  }, [userRole, enabledMenus]);

  // Filter reports by category and search
  const displayedReports = useMemo(() => {
    let list = accessibleReports;
    if (selectedCategory !== "all") {
      list = list.filter((r) => r.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          (r.keywords && r.keywords.some((k) => k.toLowerCase().includes(q)))
      );
    }
    return list;
  }, [accessibleReports, selectedCategory, searchQuery]);

  const toggleFavorite = (reportId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let next: string[];
    if (favorites.includes(reportId)) {
      next = favorites.filter((id) => id !== reportId);
    } else {
      next = [...favorites, reportId];
    }
    setFavorites(next);
    try {
      localStorage.setItem("lamsuite_report_favorites", JSON.stringify(next));
    } catch {}
  };

  const openReport = (reportId: string) => {
    const report = reportRegistry.get(reportId);
    if (!report) return;

    // Verify permission
    const isAllowed = accessibleReports.some((r) => r.id === reportId);
    if (!isAllowed) {
      alert(`Access Restricted: Report '${report.title}' is not permitted for role '${userRole}' or is disabled in store settings.`);
      return;
    }

    if (!openTabIds.includes(reportId)) {
      setOpenTabIds((prev) => [...prev, reportId]);
    }
    setActiveTabId(reportId);

    // Track recents
    const nextRecents = [reportId, ...recents.filter((id) => id !== reportId)].slice(0, 5);
    setRecents(nextRecents);
    try {
      localStorage.setItem("lamsuite_report_recents", JSON.stringify(nextRecents));
    } catch {}

    setSearchParams({ report: reportId });
  };

  const closeTab = (reportId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const remaining = openTabIds.filter((id) => id !== reportId);
    setOpenTabIds(remaining);

    if (activeTabId === reportId) {
      const nextActive = remaining[remaining.length - 1] || "";
      setActiveTabId(nextActive);
      if (nextActive) {
        setSearchParams({ report: nextActive });
      } else {
        setSearchParams({});
      }
    }
  };

  // Keyboard shortcut listener (Ctrl+W, Ctrl+Tab)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w" && activeTabId) {
        e.preventDefault();
        closeTab(activeTabId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTabId, openTabIds]);

  const activeReport = useMemo(() => {
    return reportRegistry.get(activeTabId);
  }, [activeTabId]);

  const getCategoryIcon = (catId: string) => {
    switch (catId) {
      case "sales": return <Receipt className="w-4 h-4 text-blue-600" />;
      case "gst": return <Building className="w-4 h-4 text-indigo-600" />;
      case "inventory": return <Package className="w-4 h-4 text-amber-600" />;
      case "purchase": return <Truck className="w-4 h-4 text-emerald-600" />;
      case "supplier": return <Briefcase className="w-4 h-4 text-purple-600" />;
      case "customer": return <Users className="w-4 h-4 text-cyan-600" />;
      case "profit": return <TrendingUp className="w-4 h-4 text-teal-600" />;
      case "pharmacy": return <ShieldAlert className="w-4 h-4 text-rose-600" />;
      default: return <FileBarChart className="w-4 h-4 text-gray-600" />;
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-gray-100 overflow-hidden select-none font-sans">
      {/* Left Sidebar: Categories & Navigation */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-gray-200 bg-gray-50/60">
          <div className="flex items-center gap-2">
            <FileBarChart className="w-5 h-5 text-blue-600" />
            <div>
              <h1 className="font-bold text-gray-900 text-sm">Reports & Analytics</h1>
              <p className="text-[11px] text-gray-500">LamSuite Pluggable Intelligence</p>
            </div>
          </div>

          {/* Quick Search */}
          <div className="mt-3 relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search reports (Ctrl+K)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 text-gray-900"
            />
          </div>
        </div>

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              selectedCategory === "all"
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-gray-500" />
              <span>All Reports</span>
            </div>
            <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
              {accessibleReports.length}
            </span>
          </button>

          <div className="pt-2 pb-1 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            Categories
          </div>

          {REPORT_CATEGORIES.map((cat) => {
            const count = accessibleReports.filter((r) => r.category === cat.id).length;
            if (count === 0) return null; // hide empty categories

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  selectedCategory === cat.id
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {getCategoryIcon(cat.id)}
                  <span>{cat.label}</span>
                </div>
                <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Security / RBAC Badge */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-[11px] text-gray-500">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-blue-600" />
            <span>Role: <strong className="text-gray-800 uppercase">{userRole}</strong></span>
          </div>
          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-medium">
            Zero Drift
          </span>
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab Header Bar */}
        <div className="bg-white border-b border-gray-200 flex items-center justify-between px-2 pt-1.5 shrink-0 shadow-2xs">
          <div className="flex items-center gap-1 overflow-x-auto flex-1 no-scrollbar">
            {openTabIds.map((tabId) => {
              const rep = reportRegistry.get(tabId);
              if (!rep) return null;
              const isActive = activeTabId === tabId;

              return (
                <div
                  key={tabId}
                  onClick={() => {
                    setActiveTabId(tabId);
                    setSearchParams({ report: tabId });
                  }}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs font-medium cursor-pointer border-t-2 transition-all ${
                    isActive
                      ? "bg-gray-50 border-blue-600 text-blue-900 shadow-xs"
                      : "bg-transparent border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  }`}
                >
                  {getCategoryIcon(rep.category)}
                  <span className="truncate max-w-[150px]">{rep.title}</span>
                  <button
                    type="button"
                    onClick={(e) => closeTab(tabId, e)}
                    className="p-0.5 rounded hover:bg-gray-200 text-gray-400 group-hover:text-gray-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            {/* Quick Add Tab / Open Report Browser */}
            <button
              type="button"
              onClick={() => {
                setActiveTabId("");
                setSearchParams({});
              }}
              title="Browse all available reports"
              className={`p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors ml-1 ${
                activeTabId === "" ? "bg-blue-50 text-blue-600" : ""
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Recents / Favorites Chips */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1">
            <span className="text-[11px] text-gray-400 font-medium flex items-center gap-1">
              <Star className="w-3 h-3 text-amber-500 fill-amber-500" /> Pinned:
            </span>
            {favorites.slice(0, 3).map((fId) => {
              const rep = reportRegistry.get(fId);
              if (!rep) return null;
              return (
                <button
                  key={fId}
                  type="button"
                  onClick={() => openReport(fId)}
                  className="text-[11px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded transition-colors truncate max-w-[120px]"
                >
                  {rep.title.split("(")[0].trim()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Workspace Content: Active Report OR Report Browser Catalog */}
        <div className="flex-1 overflow-hidden bg-gray-50 flex flex-col">
          {activeReport ? (
            <ReportViewContainer key={activeReport.id} report={activeReport} />
          ) : (
            /* Catalog / Reports Directory when no tab or '+' clicked */
            <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full">
              <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">Reports Directory</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Select a report to open it in a dedicated tab. All calculations are synchronized with your store dashboard.
                </p>
              </div>

              {/* Grid of Report Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedReports.map((rep) => {
                  const isFav = favorites.includes(rep.id);
                  return (
                    <div
                      key={rep.id}
                      onClick={() => openReport(rep.id)}
                      className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs hover:shadow-md hover:border-blue-400 cursor-pointer transition-all flex flex-col justify-between group"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="p-2 bg-gray-50 rounded-lg group-hover:bg-blue-50 transition-colors">
                            {getCategoryIcon(rep.category)}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => toggleFavorite(rep.id, e)}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                isFav ? "text-amber-500 fill-amber-500" : "text-gray-300 hover:text-amber-400"
                              }`}
                            />
                          </button>
                        </div>

                        <h3 className="font-semibold text-gray-900 text-sm group-hover:text-blue-600 transition-colors">
                          {rep.title}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {rep.description}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                        <span className="capitalize text-[11px] font-medium bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                          {rep.category}
                        </span>
                        <span className="flex items-center gap-1 text-blue-600 font-semibold group-hover:translate-x-1 transition-transform">
                          Open <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
