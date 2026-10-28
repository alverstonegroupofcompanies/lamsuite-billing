import React, { useEffect, useState } from "react";
import { User, UserRole, Store } from "../types";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  Users,
  Plus,
  Search,
  KeyRound,
  Fingerprint,
  LogOut,
  UserCheck,
  Shield,
  X,
  RefreshCw,
  Pencil,
  Trash2,
  Building2,
  Lock,
  LockOpen,
  ShieldCheck,
  ShieldAlert,
  Eye,
  EyeOff,
} from "lucide-react";

export const UsersPage: React.FC = () => {
  const { user: currentUser, startImpersonation, hasPermission } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  // Create User Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUser, setNewUser] = useState<{
    name: string;
    username: string;
    email: string;
    password: string;
    pin: string;
    role: UserRole;
    store_id: string;
    idle_timeout_minutes: number;
    max_failed_logins: number;
  }>({
    name: "",
    username: "",
    email: "",
    password: "password123",
    pin: "",
    role: "manager",
    store_id: "",
    idle_timeout_minutes: 15,
    max_failed_logins: 5,
  });

  // Edit User Modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editFormData, setEditFormData] = useState<{
    name: string;
    username: string;
    email: string;
    role: UserRole;
    store_id: string;
    idle_timeout_minutes: number;
    password?: string;
    pin?: string;
  }>({
    name: "",
    username: "",
    email: "",
    role: "manager",
    store_id: "",
    idle_timeout_minutes: 15,
    password: "",
    pin: "",
  });

  // Reset Credentials Modal state
  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [showNewPin, setShowNewPin] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Diagnostics state
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsLogs, setDiagnosticsLogs] = useState<any[]>([]);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);

  const fetchDiagnostics = async () => {
    setIsLoadingDiagnostics(true);
    try {
      const res = await api.get<{ success: boolean; diagnostics: any[] }>("/admin/users/login-diagnostics");
      setDiagnosticsLogs(res.diagnostics || []);
    } catch (err: any) {
      alert(err?.message || "Failed to fetch login diagnostics.");
    } finally {
      setIsLoadingDiagnostics(false);
    }
  };

  // Impersonation state
  const [impersonateTarget, setImpersonateTarget] = useState<User | null>(null);
  const [impersonateReason, setImpersonateReason] = useState("");

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ data: User[] }>("/admin/users", {
        search,
        role: roleFilter,
      });
      setUsers(res.data || []);
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStores = async () => {
    try {
      const res = await api.get<{ data: Store[] }>("/admin/stores");
      setStores(res.data || []);
    } catch (err) {
      console.error("Failed to load stores:", err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [search, roleFilter]);

  useEffect(() => {
    fetchStores();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: newUser.name,
        email: newUser.email,
        username: newUser.username || undefined,
        password: newUser.password,
        role: newUser.role,
        store_id: newUser.store_id ? Number(newUser.store_id) : null,
        idle_timeout_minutes: newUser.idle_timeout_minutes,
        max_failed_logins: newUser.max_failed_logins,
      };
      if (newUser.pin && newUser.pin.trim()) {
        const trimmed = newUser.pin.trim();
        if (trimmed.length < 4 || trimmed.length > 6) {
          alert("Quick PIN must be between 4 and 6 numeric digits.");
          return;
        }
        payload.pin = trimmed;
      }

      await api.post("/admin/users", payload);
      setIsCreateModalOpen(false);
      setNewUser({
        name: "",
        username: "",
        email: "",
        password: "password123",
        pin: "",
        role: "manager",
        store_id: "",
        idle_timeout_minutes: 15,
        max_failed_logins: 5,
      });
      await fetchUsers();
      alert(`Staff account '${payload.name}' created successfully.`);
    } catch (err: any) {
      alert(err?.message || "Failed to create user.");
    }
  };

  const handleOpenEdit = (u: User) => {
    setEditingUser(u);
    setEditFormData({
      name: u.name,
      username: u.username || "",
      email: u.email,
      role: u.role,
      store_id: u.store_id ? String(u.store_id) : "",
      idle_timeout_minutes: u.idle_timeout_minutes || 15,
      password: "",
      pin: "",
    });
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const payload: any = {
        name: editFormData.name,
        email: editFormData.email,
        username: editFormData.username || undefined,
        role: editFormData.role,
        store_id: editFormData.store_id ? Number(editFormData.store_id) : null,
        idle_timeout_minutes: editFormData.idle_timeout_minutes,
      };
      if (editFormData.password && editFormData.password.trim()) {
        payload.password = editFormData.password.trim();
      }
      if (editFormData.pin && editFormData.pin.trim()) {
        const trimmedPin = editFormData.pin.trim();
        if (!/^\d{4,6}$/.test(trimmedPin)) {
          alert("Quick PIN must be between 4 and 6 numeric digits.");
          return;
        }
        if (/^(.)\1+$/.test(trimmedPin)) {
          alert("PIN cannot consist of repeated digits (e.g. 1111). Choose a stronger PIN.");
          return;
        }
        if (['1234', '4321', '0123', '3210', '12345', '54321', '123456', '654321'].includes(trimmedPin)) {
          alert("Trivial sequential PINs are not allowed for security reasons.");
          return;
        }
        payload.pin = trimmedPin;
      }

      await api.put(`/admin/users/${editingUser.id}`, payload);
      setEditingUser(null);
      await fetchUsers();
      alert(`User '${editFormData.name}' updated successfully.`);
    } catch (err: any) {
      alert(err?.message || "Failed to update user.");
    }
  };

  const handleDeleteUser = async (u: User) => {
    if (currentUser?.id === u.id) {
      alert("You cannot delete your own logged-in account.");
      return;
    }
    if (
      !confirm(
        `Are you sure you want to permanently delete user '${u.name}' (${u.email})?\nThis cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await api.delete(`/admin/users/${u.id}`);
      alert(`User '${u.name}' deleted successfully.`);
      await fetchUsers();
    } catch (err: any) {
      alert(err?.message || "Failed to delete user.");
    }
  };

  const handleResetCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordResetUser) return;
    if (!newPassword.trim() && !newPin.trim()) {
      alert("Please provide at least a new password or a new PIN.");
      return;
    }
    const cleanPin = newPin.trim();
    if (cleanPin) {
      if (!/^\d{4,6}$/.test(cleanPin)) {
        alert("Quick PIN must be between 4 and 6 numeric digits.");
        return;
      }
      if (/^(.)\1+$/.test(cleanPin)) {
        alert("PIN cannot consist of repeated digits (e.g. 1111). Choose a stronger PIN.");
        return;
      }
      if (['1234', '4321', '0123', '3210', '12345', '54321', '123456', '654321'].includes(cleanPin)) {
        alert("Trivial sequential PINs are not allowed for security reasons.");
        return;
      }
    }
    try {
      await api.post("/admin/password-reset", {
        user_id: passwordResetUser.id,
        new_password: newPassword.trim() || undefined,
        new_pin: cleanPin || undefined,
      });
      alert(`Credentials for '${passwordResetUser.name}' updated successfully.`);
      setPasswordResetUser(null);
      setNewPassword("");
      setNewPin("");
      await fetchUsers();
    } catch (err: any) {
      alert(err?.message || "Failed to reset credentials.");
    }
  };

  const handleToggleBiometric = async (u: User) => {
    try {
      await api.post(`/admin/users/${u.id}/toggle-biometric`);
      await fetchUsers();
    } catch (err: any) {
      alert(err?.message || "Failed to toggle biometric setting.");
    }
  };

  const handleLockUser = async (u: User) => {
    if (!confirm(`Are you sure you want to lock the account for ${u.name}? Login will be blocked until unlocked.`)) return;
    try {
      await api.post(`/admin/users/${u.id}/lock`);
      alert(`User account '${u.name}' has been LOCKED.`);
      await fetchUsers();
      if (passwordResetUser && passwordResetUser.id === u.id) {
        setPasswordResetUser({ ...passwordResetUser, is_locked: true });
      }
    } catch (err: any) {
      alert(err?.message || "Failed to lock user account.");
    }
  };

  const handleUnlockUser = async (u: User) => {
    try {
      await api.post(`/admin/users/${u.id}/unlock`);
      alert(`User account '${u.name}' unlocked successfully. PIN/Password login is now active.`);
      await fetchUsers();
      if (passwordResetUser && passwordResetUser.id === u.id) {
        setPasswordResetUser({ ...passwordResetUser, is_locked: false, locked_until: null });
      }
    } catch (err: any) {
      alert(err?.message || "Failed to unlock user account.");
    }
  };

  const handleForceLogout = async (u: User) => {
    if (!confirm(`Are you sure you want to terminate all active sessions for ${u.name}?`)) return;
    try {
      await api.post(`/admin/users/${u.id}/force-logout`);
      alert(`All sessions for ${u.name} terminated.`);
      await fetchUsers();
    } catch (err: any) {
      alert(err?.message || "Failed to force logout user.");
    }
  };

  const handleStartImpersonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!impersonateTarget || !impersonateReason.trim()) return;
    try {
      await startImpersonation(impersonateTarget.id, impersonateReason);
    } catch (err: any) {
      alert(err?.message || "Impersonation failed.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Users & Role-Based Access Control
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Staff directory, branch assignment, security policies, and credentials management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchDiagnostics();
              setShowDiagnostics(true);
            }}
            title="View why login attempts failed (diagnostic audit reasons)"
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 transition-all cursor-pointer shadow-2xs"
          >
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            <span>Login Diagnostics</span>
          </button>

          {hasPermission("users", "create") && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Staff Account</span>
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or role..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-xs px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-700 dark:text-slate-300 focus:outline-hidden"
          >
            <option value="">All Roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="store_owner">Store Owner</option>
            <option value="manager">Manager</option>
            <option value="cashier">Cashier</option>
            <option value="operator">Operator</option>
            <option value="pharmacist">Pharmacist</option>
            <option value="accountant">Accountant</option>
            <option value="support">Support</option>
          </select>

          <button
            onClick={fetchUsers}
            className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">User & Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Assigned Branch</th>
                <th className="px-4 py-3 text-center">Security Settings</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No users matching criteria.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{u.name}</span>
                        {currentUser?.id === u.id && (
                          <span className="text-[9px] bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300 px-1.5 py-0.5 rounded font-mono">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                        <span>{u.email}</span>
                        {u.username && (
                          <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                            @{u.username}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                          u.role === "super_admin"
                            ? "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400"
                            : u.role === "store_owner"
                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                            : u.role === "accountant"
                            ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400"
                            : u.role === "cashier" || u.role === "operator"
                            ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400"
                            : u.role === "support"
                            ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        <Shield className="w-2.5 h-2.5" />
                        <span>{u.role.replace("_", " ")}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {u.store ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          <span>{u.store.name}</span>
                          <span className="font-mono text-[10px] text-slate-400">({u.store.code})</span>
                        </div>
                      ) : (
                        <span className="text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1">
                          <span>Global (All Stores)</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2 text-[11px]">
                        {u.has_pin ? (
                          <span
                            title="Quick PIN is configured (Hashed securely, never readable)"
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                          >
                            <KeyRound className="w-2.5 h-2.5" />
                            <span>PIN Configured</span>
                          </span>
                        ) : (
                          <span
                            title="No Quick PIN configured (Login requires Password)"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                          >
                            <KeyRound className="w-2.5 h-2.5" />
                            <span>No PIN Set</span>
                          </span>
                        )}
                        <span title="Idle timeout">⏱️ {u.idle_timeout_minutes}m</span>
                        <span
                          title={u.is_biometric_enabled ? "Biometric enabled" : "Biometric disabled"}
                          className={`cursor-pointer ${
                            u.is_biometric_enabled ? "text-emerald-500" : "text-slate-400"
                          }`}
                          onClick={() => handleToggleBiometric(u)}
                        >
                          <Fingerprint className="w-4 h-4 inline" />
                        </span>
                        {u.totp_enabled && (
                          <span title="2FA TOTP Active" className="text-brand-500">
                            🔒 2FA
                          </span>
                        )}
                        {u.is_locked ? (
                          <span
                            title={`Account is LOCKED until ${u.locked_until ? new Date(u.locked_until).toLocaleTimeString() : 'admin unlock'}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 animate-pulse border border-rose-300 dark:border-rose-800"
                          >
                            <Lock className="w-2.5 h-2.5" />
                            <span>Locked</span>
                          </span>
                        ) : (
                          <span
                            title="Account access: Active & Unlocked"
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                          >
                            <ShieldCheck className="w-2.5 h-2.5" />
                            <span>Active</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Lock / Unlock Account Button */}
                        {u.is_locked ? (
                          <button
                            onClick={() => handleUnlockUser(u)}
                            title="Account is LOCKED! Click to unlock immediately"
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[10px] flex items-center gap-1 cursor-pointer shadow-xs transition-colors"
                          >
                            <LockOpen className="w-3 h-3" />
                            <span>Unlock</span>
                          </button>
                        ) : (
                          currentUser?.id !== u.id && (
                            <button
                              onClick={() => handleLockUser(u)}
                              title="Lock Account (Block Login)"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg cursor-pointer transition-colors"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}

                        {/* Impersonation action for Super Admin */}
                        {currentUser?.role === "super_admin" && u.id !== currentUser.id && (
                          <button
                            onClick={() => {
                              setImpersonateTarget(u);
                              setImpersonateReason("");
                            }}
                            title="Impersonate (Login as store user with visible audit banner)"
                            className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold rounded-lg text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <UserCheck className="w-3 h-3" />
                            <span>Impersonate</span>
                          </button>
                        )}

                        {/* Edit User Button */}
                        <button
                          onClick={() => handleOpenEdit(u)}
                          title="Edit User Details & Store Assignment"
                          className="p-1.5 text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg cursor-pointer transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {/* Reset Password / PIN Button */}
                        <button
                          onClick={() => {
                            setPasswordResetUser(u);
                            setNewPassword("");
                            setNewPin("");
                          }}
                          title="Reset Password or Quick PIN"
                          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>

                        {/* Force Logout Button */}
                        <button
                          onClick={() => handleForceLogout(u)}
                          title="Force Logout / Revoke Active Sessions"
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg cursor-pointer transition-colors"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete User Button */}
                        {currentUser?.id !== u.id && (
                          <button
                            onClick={() => handleDeleteUser(u)}
                            title="Permanently Delete User"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Impersonate Confirmation Modal */}
      {impersonateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Confirm Super Admin Impersonation
              </h3>
              <button
                onClick={() => setImpersonateTarget(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              You are about to log in as{" "}
              <strong className="text-slate-900 dark:text-white">{impersonateTarget.name}</strong> (
              {impersonateTarget.email}). All actions will be logged in the immutable audit trail under your
              Super Admin identity.
            </p>

            <form onSubmit={handleStartImpersonate} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reason for Impersonation (Required for Audit Log) *
                </label>
                <textarea
                  required
                  rows={3}
                  value={impersonateReason}
                  onChange={(e) => setImpersonateReason(e.target.value)}
                  placeholder="e.g. Troubleshooting store billing mismatch reported in ticket #1029..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white placeholder-slate-400"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setImpersonateTarget(null)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg shadow-sm cursor-pointer"
                >
                  Start Impersonation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password & Quick PIN Reset Modal */}
      {passwordResetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Reset Credentials: {passwordResetUser.name}
              </h3>
              <button
                onClick={() => setPasswordResetUser(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetCredentials} className="space-y-4 text-xs">
              <div className="text-[11px] px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <span className="text-slate-500 font-medium">Quick PIN Status:</span>
                <span className={passwordResetUser.has_pin ? "font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1" : "font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1"}>
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{passwordResetUser.has_pin ? "Configured (Salted Hash)" : "None (Password Only)"}</span>
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {passwordResetUser.is_locked ? (
                    <>
                      <Lock className="w-4 h-4 text-rose-600 shrink-0" />
                      <div>
                        <span className="font-bold text-rose-600 block">Account Status: Locked</span>
                        <span className="text-[10px] text-slate-500">Logins blocked due to failed attempts</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div>
                        <span className="font-bold text-emerald-600 block">Account Status: Active & Unlocked</span>
                        <span className="text-[10px] text-slate-500">Normal login access is enabled</span>
                      </div>
                    </>
                  )}
                </div>
                {passwordResetUser.is_locked ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await handleUnlockUser(passwordResetUser);
                      setPasswordResetUser({ ...passwordResetUser, is_locked: false, locked_until: null });
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg cursor-pointer text-xs flex items-center gap-1 shadow-sm"
                  >
                    <LockOpen className="w-3.5 h-3.5" />
                    <span>Unlock Account</span>
                  </button>
                ) : (
                  currentUser?.id !== passwordResetUser.id && (
                    <button
                      type="button"
                      onClick={async () => {
                        await handleLockUser(passwordResetUser);
                        setPasswordResetUser({ ...passwordResetUser, is_locked: true });
                      }}
                      className="px-3 py-1.5 bg-slate-200 hover:bg-rose-100 text-slate-700 hover:text-rose-700 dark:bg-slate-700 dark:hover:bg-rose-950 font-bold rounded-lg cursor-pointer text-xs flex items-center gap-1 transition-colors"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Lock Account</span>
                    </button>
                  )
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Password (Optional if PIN provided)
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? "text" : "password"}
                    minLength={6}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Leave blank to keep unchanged (Min 6 chars)"
                    className="w-full px-3 py-2 pr-10 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Quick PIN for POS Terminal (4-6 Digits)
                </label>
                <div className="relative">
                  <input
                    type={showNewPin ? "text" : "password"}
                    maxLength={6}
                    pattern="[0-9]{4,6}"
                    autoComplete="off"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="e.g. 5000 (Used on terminal numpad)"
                    className="w-full px-3 py-2 pr-10 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPin(!showNewPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showNewPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Quick PIN allows instant login from the terminal numpad without typing full password.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPasswordResetUser(null)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-sm cursor-pointer"
                >
                  Confirm Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Edit Staff Account: {editingUser.name}
              </h3>
              <button
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Staff Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={editFormData.email}
                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Username (Terminal Login)
                  </label>
                  <input
                    type="text"
                    value={editFormData.username}
                    onChange={(e) => setEditFormData({ ...editFormData, username: e.target.value })}
                    placeholder="e.g. cashier1"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Role *
                  </label>
                  <select
                    value={editFormData.role}
                    onChange={(e) => setEditFormData({ ...editFormData, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="store_owner">Store Owner</option>
                    <option value="manager">Manager</option>
                    <option value="cashier">Cashier / Billing Counter</option>
                    <option value="operator">Operator</option>
                    <option value="pharmacist">Pharmacist</option>
                    <option value="accountant">Accountant (Reports only)</option>
                    <option value="support">Support (Read-only)</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Assigned Store / Branch *
                  </label>
                  <select
                    value={editFormData.store_id}
                    onChange={(e) => setEditFormData({ ...editFormData, store_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Global / Unassigned (Super Admin)</option>
                    {stores.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Change Password (Optional)
                  </label>
                  <input
                    type="password"
                    minLength={6}
                    autoComplete="new-password"
                    value={editFormData.password || ""}
                    onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                    placeholder="Leave empty to keep current"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Change Quick PIN (Optional, 4-6 Digits)
                    </label>
                    <span className={`text-[10px] font-bold ${editingUser.has_pin ? 'text-emerald-600 dark:text-emerald-400 font-mono' : 'text-slate-400'}`}>
                      {editingUser.has_pin ? '✓ Current PIN Active (Hashed)' : 'No PIN Set'}
                    </span>
                  </div>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]{4,6}"
                    autoComplete="off"
                    value={editFormData.pin || ""}
                    onChange={(e) => setEditFormData({ ...editFormData, pin: e.target.value.replace(/\D/g, "") })}
                    placeholder="Leave blank to keep unchanged (e.g. 5678)"
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Idle Timeout (Minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={editFormData.idle_timeout_minutes}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, idle_timeout_minutes: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Create New Staff Account
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Staff Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    placeholder="e.g. rahul@lamstone.in"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Username (Terminal Login)
                  </label>
                  <input
                    type="text"
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder="e.g. cashier1"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Initial Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Min 6 characters"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Quick PIN (POS Terminal)
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]{4,6}"
                    autoComplete="off"
                    value={newUser.pin}
                    onChange={(e) => setNewUser({ ...newUser, pin: e.target.value.replace(/\D/g, "") })}
                    placeholder="e.g. 1234 (4-6 digits)"
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Role *
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="store_owner">Store Owner</option>
                    <option value="manager">Manager</option>
                    <option value="cashier">Cashier / Billing Counter</option>
                    <option value="operator">Operator</option>
                    <option value="pharmacist">Pharmacist</option>
                    <option value="accountant">Accountant (Reports only)</option>
                    <option value="support">Support (Read-only)</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Assign to Store / Branch *
                  </label>
                  <select
                    value={newUser.store_id}
                    onChange={(e) => setNewUser({ ...newUser, store_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">Global / Unassigned (Super Admin)</option>
                    {stores.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Idle Timeout (Minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={newUser.idle_timeout_minutes}
                    onChange={(e) => setNewUser({ ...newUser, idle_timeout_minutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm cursor-pointer"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Login Diagnostics Modal */}
      {showDiagnostics && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    Why Did My Login Fail? (Staff Login Diagnostics)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Live security audit logs showing recent terminal login attempts and exact diagnostic reasons.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchDiagnostics}
                  disabled={isLoadingDiagnostics}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  title="Refresh Diagnostics"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingDiagnostics ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowDiagnostics(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 pr-1 space-y-2">
              {isLoadingDiagnostics ? (
                <div className="py-12 text-center text-xs text-slate-400">Loading diagnostic events...</div>
              ) : diagnosticsLogs.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No failed login attempts recorded in recent audit history.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 text-[10px] uppercase font-semibold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-3 py-2">Time</th>
                        <th className="px-3 py-2">User / Target</th>
                        <th className="px-3 py-2">Store & Counter</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Diagnostic Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                      {diagnosticsLogs.map((log) => {
                        const isSuccess = log.action === "staff_login_success";
                        const isLocked = log.action === "staff_account_locked";
                        return (
                          <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2 text-slate-400 text-[10px] whitespace-nowrap">
                              {log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "-"}
                            </td>
                            <td className="px-3 py-2">
                              {log.user ? (
                                <div>
                                  <span className="font-semibold text-slate-900 dark:text-white block">{log.user.name}</span>
                                  <span className="text-[10px] text-slate-400 font-mono">@{log.user.username} (ID: {log.user.id})</span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">Unknown Identifier</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                              <div>{log.store?.code || "STORE-01"}</div>
                              <div className="text-[10px] text-slate-400">{log.counter || "Station"}</div>
                            </td>
                            <td className="px-3 py-2">
                              {isSuccess ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                                  SUCCESS
                                </span>
                              ) : isLocked ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">
                                  LOCKED
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                                  FAILED
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-mono text-[10px] font-bold text-slate-800 dark:text-slate-200">
                                {log.reason === "wrong_pin"
                                  ? "❌ Incorrect PIN"
                                  : log.reason === "no_pin_configured"
                                  ? "⚠️ No PIN Set for Account (Password Required)"
                                  : log.reason === "wrong_store"
                                  ? "🚫 Staff not assigned to this store"
                                  : log.reason === "counter_not_allowed"
                                  ? "🚫 Counter access restricted"
                                  : log.reason === "account_locked"
                                  ? "🔒 Blocked: Account Locked (Exceeded failed attempts)"
                                  : log.reason === "max_failed_attempts_exceeded"
                                  ? "🔒 Locked out: 5 consecutive failed attempts"
                                  : log.reason || "Authentication failed"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <span className="text-[11px] text-slate-400">
                Audit logs are immutable and traceable to the exact user ID and IP address.
              </span>
              <button
                type="button"
                onClick={() => setShowDiagnostics(false)}
                className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-xl cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
