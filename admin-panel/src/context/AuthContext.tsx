import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Store, UserRole } from "../types";
import { api, ApiError } from "../services/api";

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  stores: Store[];
  activeStore: Store | null;
  isAllStores: boolean;
  canViewAllStores: boolean;
  setActiveStore: (store: Store | null) => void;
  token: string | null;
  isLoading: boolean;
  isImpersonating: boolean;
  impersonatedBy: string | null;
  login: (credentials: { email: string; password: string; totp_code?: string }) => Promise<{ requires_2fa?: boolean }>;
  logout: () => Promise<void>;
  startImpersonation: (targetUserId: number, reason: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  hasPermission: (module: string, action?: string) => boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// P-STORE-SCOPE: the selected store lives in the URL (?store=<id|all>) so a
// shared or refreshed link restores exactly that scope. AuthProvider sits
// outside <BrowserRouter>, so the window.history API is used.
const syncStoreUrlParam = (value: string | null) => {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set("store", value);
  else url.searchParams.delete("store");
  window.history.replaceState({}, "", url.toString());
};

const storeUrlParam = (): string | null =>
  new URL(window.location.href).searchParams.get("store");

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStore, setActiveStoreState] = useState<Store | null>(null);
  const [isAllStores, setIsAllStores] = useState<boolean>(false);
  const [canViewAllStores, setCanViewAllStores] = useState<boolean>(false);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("admin_token"));
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isImpersonating, setIsImpersonating] = useState<boolean>(false);
  const [impersonatedBy, setImpersonatedBy] = useState<string | null>(null);

  const fetchProfile = async () => {
    if (!localStorage.getItem("admin_token")) {
      setIsLoading(false);
      return;
    }

    try {
      const res = await api.get<{
        user: User;
        store: Store | null;
        stores: Store[];
        can_view_all_stores: boolean;
        is_impersonated: boolean;
        impersonated_by: string | null;
      }>("/admin/me");

      setUser(res.user);
      setStores(res.stores || []);
      setCanViewAllStores(res.can_view_all_stores || false);
      setIsImpersonating(res.is_impersonated || false);
      setImpersonatedBy(res.impersonated_by || null);

      // A valid store in the URL wins over the saved selection so a shared or
      // bookmarked link opens exactly the store it names.
      const urlStore = storeUrlParam();
      if (urlStore === "all") {
        if (res.can_view_all_stores) {
          setActiveStoreState(null);
          setIsAllStores(true);
          localStorage.setItem("admin_store_id", "all");
          return;
        }
        syncStoreUrlParam(null);
      } else if (urlStore) {
        const match = res.stores?.find((s) => String(s.id) === urlStore);
        if (match) {
          setActiveStoreState(match);
          setIsAllStores(false);
          localStorage.setItem("admin_store_id", String(match.id));
          return;
        }
        syncStoreUrlParam(null);
      }

      // Restore consolidated scope when it was explicitly selected and is still permitted
      const savedStoreId = localStorage.getItem("admin_store_id");
      if (savedStoreId === "all" && res.can_view_all_stores) {
        setActiveStoreState(null);
        setIsAllStores(true);
        syncStoreUrlParam("all");
        return;
      }

      // Select active store
      const found = res.stores?.find((s) => String(s.id) === savedStoreId) || res.store || res.stores?.[0] || null;
      if (found) {
        setActiveStoreState(found);
        setIsAllStores(false);
        localStorage.setItem("admin_store_id", String(found.id));
        syncStoreUrlParam(String(found.id));
      } else {
        syncStoreUrlParam(null);
      }
    } catch (err) {
      console.error("Failed to load user profile:", err);
      if (err instanceof ApiError && err.status === 401) {
        setToken(null);
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();

    const handleSessionExpired = () => {
      setToken(null);
      setUser(null);
      alert("Your session has timed out. Please sign in again.");
    };

    window.addEventListener("session_expired", handleSessionExpired);
    return () => window.removeEventListener("session_expired", handleSessionExpired);
  }, []);

  const setActiveStore = (store: Store | null) => {
    if (store) {
      setActiveStoreState(store);
      setIsAllStores(false);
      localStorage.setItem("admin_store_id", String(store.id));
    } else {
      setActiveStoreState(null);
      setIsAllStores(true);
      localStorage.setItem("admin_store_id", "all");
    }
    syncStoreUrlParam(store ? String(store.id) : "all");
    window.location.reload(); // Refresh views with new scoped store
  };

  const login = async (credentials: { email: string; password: string; totp_code?: string }) => {
    const res = await api.post<{
      requires_2fa?: boolean;
      token?: string;
      user?: User;
      store?: Store;
      all_stores?: Store[];
    }>("/auth/login", credentials);

    if (res.requires_2fa) {
      return { requires_2fa: true };
    }

    if (res.token) {
      localStorage.setItem("admin_token", res.token);
      setToken(res.token);
      setUser(res.user || null);
      if (res.store) {
        setActiveStoreState(res.store);
        setIsAllStores(false);
        localStorage.setItem("admin_store_id", String(res.store.id));
      }
      if (res.all_stores) {
        setStores(res.all_stores);
      }
      await fetchProfile();
    }

    return {};
  };

  const logout = async () => {
    try {
      await api.post("/admin/logout");
    } catch {}
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_store_id");
    localStorage.removeItem("impersonator_id");
    syncStoreUrlParam(null);
    setToken(null);
    setUser(null);
    setIsAllStores(false);
    setCanViewAllStores(false);
    setIsImpersonating(false);
    setImpersonatedBy(null);
  };

  const startImpersonation = async (targetUserId: number, reason: string) => {
    const res = await api.post<{
      token: string;
      user: User;
      store: Store | null;
      impersonated_by: string;
      impersonator_id: number;
    }>("/admin/impersonate", { user_id: targetUserId, reason });

    localStorage.setItem("admin_token", res.token);
    localStorage.setItem("impersonator_id", String(res.impersonator_id));
    if (res.store) {
      localStorage.setItem("admin_store_id", String(res.store.id));
      syncStoreUrlParam(String(res.store.id));
    } else {
      localStorage.removeItem("admin_store_id");
      syncStoreUrlParam(null);
    }
    setToken(res.token);
    setUser(res.user);
    setIsAllStores(false);
    setIsImpersonating(true);
    setImpersonatedBy(res.impersonated_by);
    window.location.reload();
  };

  const stopImpersonation = async () => {
    const impersonatorId = localStorage.getItem("impersonator_id");
    const res = await api.post<{ token: string; user: User }>("/admin/stop-impersonate", {
      impersonator_id: impersonatorId,
    });

    localStorage.setItem("admin_token", res.token);
    localStorage.removeItem("impersonator_id");
    setToken(res.token);
    setIsImpersonating(false);
    setImpersonatedBy(null);
    await fetchProfile();
    window.location.reload();
  };

  const hasPermission = (module: string, action: string = "view"): boolean => {
    if (!user) return false;
    if (user.role === "super_admin") return true;

    // Explicit per-user permissions override role defaults (matches backend User::hasPermission)
    const permissions = (user as any).permissions as
      | Record<string, string[] | boolean | string>
      | null
      | undefined;
    if (permissions && Object.prototype.hasOwnProperty.call(permissions, module)) {
      const value = permissions[module];
      if (value === true || value === "*") return true;
      if (value === false) return false;
      if (typeof value === "string") return value === "*" || value === action || value === `${module}.${action}`;
      if (Array.isArray(value)) {
        return value.includes("*") || value.includes(action) || value.includes(`${module}.${action}`);
      }
      return false;
    }

    if (user.role === "support") {
      return action === "view" || action === "export";
    }

    if (user.role === "accountant") {
      if (module === "reports" || module === "gst" || module === "dashboard" || module === "compliance") {
        return action === "view" || action === "export";
      }
      return false;
    }

    if (user.role === "store_owner") return true;

    if (user.role === "manager") {
      if (module === "stores" && (action === "delete" || action === "reset")) return false;
      return true;
    }

    return false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || null,
        stores,
        activeStore,
        isAllStores,
        canViewAllStores,
        setActiveStore,
        token,
        isLoading,
        isImpersonating,
        impersonatedBy,
        login,
        logout,
        startImpersonation,
        stopImpersonation,
        hasPermission,
        refreshProfile: fetchProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
