import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Store } from "../types";
import {
  Bell,
  Moon,
  Sun,
  Store as StoreIcon,
  ChevronDown,
  LogOut,
  User as UserIcon,
  Shield,
  Menu,
} from "lucide-react";
import { NotificationDrawer } from "./NotificationDrawer";

interface HeaderProps {
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { user, stores, activeStore, setActiveStore, logout, isImpersonating } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(2);

  return (
    <>
      <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        {/* Left Section: Mobile Toggle & Store Switcher */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="md:hidden text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 p-1.5 rounded-lg"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Store Switcher */}
          <div className="relative">
            <button
              onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80 text-xs font-semibold transition-all shadow-2xs"
            >
              <div className="w-5 h-5 rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-400 flex items-center justify-center">
                <StoreIcon className="w-3.5 h-3.5" />
              </div>
              <div className="text-left leading-tight hidden sm:block">
                <div className="font-bold text-slate-800 dark:text-slate-100 truncate max-w-[160px]">
                  {activeStore ? activeStore.name : "Select Store"}
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {activeStore ? activeStore.code : "No Store Selected"}
                </div>
              </div>
              {stores.length > 1 && <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />}
            </button>

            {/* Store Dropdown Menu */}
            {isStoreMenuOpen && stores.length > 1 && (
              <div
                className="absolute left-0 mt-1 w-64 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                onMouseLeave={() => setIsStoreMenuOpen(false)}
              >
                <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Switch Active Store
                </div>
                {stores.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setActiveStore(s);
                      setIsStoreMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${
                      activeStore?.id === s.id
                        ? "bg-brand-50/50 dark:bg-brand-950/20 text-brand-600 dark:text-brand-400 font-semibold"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div>
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{s.code}</div>
                    </div>
                    {!s.is_active && (
                      <span className="text-[9px] bg-red-100 dark:bg-red-950 text-red-600 px-1.5 py-0.5 rounded font-mono">
                        Disabled
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Section: Theme Toggle, Notifications, User Pill */}
        <div className="flex items-center gap-3">
          {/* Dark / Light Toggle */}
          <button
            onClick={toggleTheme}
            title={`Switch to ${theme === "light" ? "Dark" : "Light"} Mode`}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-amber-400" />}
          </button>

          {/* Notifications Trigger */}
          <button
            onClick={() => setIsNotificationOpen(true)}
            className="relative p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
            )}
          </button>

          {/* User Profile Pill */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-xs border border-slate-200 dark:border-slate-700">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : <UserIcon className="w-4 h-4" />}
            </div>
            <div className="hidden sm:block text-left text-xs leading-tight">
              <div className="font-bold text-slate-800 dark:text-slate-100">{user?.name}</div>
              <div className="text-[10px] text-slate-400 capitalize flex items-center gap-1">
                <Shield className="w-2.5 h-2.5 text-brand-500" />
                <span>{user?.role.replace("_", " ")}</span>
              </div>
            </div>

            <button
              onClick={logout}
              title="Sign Out"
              className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-1"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Flyout Notification Drawer */}
      <NotificationDrawer
        isOpen={isNotificationOpen}
        onClose={() => setIsNotificationOpen(false)}
        onCountChange={(cnt) => setUnreadCount(cnt)}
      />
    </>
  );
};
