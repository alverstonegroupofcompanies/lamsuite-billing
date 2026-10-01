import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Store, UserRole } from "../types";
import { api, ApiError } from "../services/api";

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  stores: Store[];
  activeStore: Store | null;
  setActiveStore: (store: Store) => void;
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [activeStore, setActiveStoreState] = useState<Store | null>(null);
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
        is_impersonated: boolean;
        impersonated_by: string | null;
      }>("/admin/me");

      setUser(res.user);
      setStores(res.stores || []);
      setIsImpersonating(res.is_impersonated || false);
      setImpersonatedBy(res.impersonated_by || null);

      // Select active store
      const savedStoreId = localStorage.getItem("admin_store_id");
      const found = res.stores?.find((s) => String(s.id) === savedStoreId) || res.store || res.stores?.[0] || null;
      if (found) {
        setActiveStoreState(found);
        localStorage.setItem("admin_store_id", String(found.id));
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

  const setActiveStore = (store: Store) => {
    setActiveStoreState(store);
    localStorage.setItem("admin_store_id", String(store.id));
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
    setToken(null);
    setUser(null);
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
    }
    setToken(res.token);
    setUser(res.user);
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

    if (user.role === "support") {
      return action === "view" || action === "export";
    }

    if (user.role === "accountant") {
      if (module === "reports" || module === "gst" || module === "dashboard") {
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
