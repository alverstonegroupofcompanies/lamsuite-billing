import React, { useEffect, useState } from "react";
import { NotificationItem } from "../types";
import { api } from "../services/api";
import { formatDateTime } from "../utils/formatters";
import { Bell, Check, Clock, AlertTriangle, ShieldAlert, WifiOff, X, RefreshCw } from "lucide-react";

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  onCountChange,
}) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [filterType, setFilterType] = useState<string>("all");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ unread_count: number; notifications: { data: NotificationItem[] } }>(
        "/admin/notifications",
        filterType !== "all" ? { type: filterType } : undefined
      );
      setNotifications(res.notifications?.data || []);
      setUnreadCount(res.unread_count || 0);
      onCountChange?.(res.unread_count || 0);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, filterType]);

  const markAsRead = async (id: number) => {
    try {
      await api.post(`/admin/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      onCountChange?.(Math.max(0, unreadCount - 1));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await api.post("/admin/notifications/mark-all-read");
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      onCountChange?.(0);
    } catch {}
  };

  const triggerAlertCheck = async () => {
    try {
      await api.post("/admin/notifications/check-alerts");
      await fetchNotifications();
    } catch {}
  };

  const getAlertIcon = (type: NotificationItem["type"]) => {
    switch (type) {
      case "stock_low":
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case "expiry":
        return <Clock className="w-4 h-4 text-red-500" />;
      case "store_offline":
        return <WifiOff className="w-4 h-4 text-rose-500" />;
      case "sync_failure":
        return <ShieldAlert className="w-4 h-4 text-purple-500" />;
      default:
        return <Bell className="w-4 h-4 text-brand-500" />;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="absolute inset-y-0 right-0 max-w-md w-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-brand-600" />
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">System Alerts & Notifications</h3>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerAlertCheck}
              title="Evaluate rules & scan alerts"
              className="text-slate-400 hover:text-brand-600 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="p-2.5 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <div className="flex gap-1 overflow-x-auto py-0.5">
            {["all", "stock_low", "expiry", "store_offline", "sync_failure"].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-2 py-1 rounded text-[11px] font-medium capitalize whitespace-nowrap transition-colors ${
                  filterType === type
                    ? "bg-brand-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {type.replace("_", " ")}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-brand-600 dark:text-brand-400 hover:underline shrink-0 ml-2"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Alerts List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading alerts...</div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-60" />
              All systems healthy. No unread alerts.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-3 rounded-xl border transition-all text-xs ${
                  n.is_read
                    ? "bg-white dark:bg-slate-900 border-slate-150 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    : "bg-blue-50/50 dark:bg-slate-800/80 border-blue-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 shadow-xs"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold">
                    {getAlertIcon(n.type)}
                    <span>{n.title}</span>
                  </div>
                  {!n.is_read && (
                    <button
                      onClick={() => markAsRead(n.id)}
                      title="Mark as read"
                      className="text-slate-400 hover:text-emerald-500 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-slate-500 dark:text-slate-400 leading-relaxed">{n.message}</p>
                <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
                  <span>{formatDateTime(n.created_at)}</span>
                  <span className="capitalize font-mono">{n.type.replace("_", " ")}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
