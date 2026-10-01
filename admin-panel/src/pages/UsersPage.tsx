import React, { useEffect, useState } from "react";
import { User, UserRole } from "../types";
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
} from "lucide-react";

export const UsersPage: React.FC = () => {
  const { user: currentUser, startImpersonation, hasPermission } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUser, setNewUser] = useState<Partial<User> & { password?: string }>({
    name: "",
    email: "",
    password: "password123",
    role: "manager",
    idle_timeout_minutes: 15,
    max_failed_logins: 5,
  });

  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

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

  useEffect(() => {
    fetchUsers();
  }, [search, roleFilter]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/admin/users", newUser);
      setIsCreateModalOpen(false);
      setNewUser({
        name: "",
        email: "",
        password: "password123",
        role: "manager",
        idle_timeout_minutes: 15,
        max_failed_logins: 5,
      });
      await fetchUsers();
    } catch (err: any) {
      alert(err?.message || "Failed to create user.");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordResetUser) return;
    try {
      await api.post("/admin/password-reset", {
        user_id: passwordResetUser.id,
        new_password: newPassword,
      });
      alert(`Password for '${passwordResetUser.name}' reset successfully.`);
      setPasswordResetUser(null);
      setNewPassword("");
    } catch (err: any) {
      alert(err?.message || "Failed to reset password.");
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
            Staff directory, security policies, idle session timeouts, and Super Admin impersonation.
          </p>
        </div>

        {hasPermission("users", "create") && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Create Staff Account</span>
          </button>
        )}
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
            <option value="accountant">Accountant</option>
            <option value="support">Support</option>
          </select>

          <button
            onClick={fetchUsers}
            className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
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
                      <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                          u.role === "super_admin"
                            ? "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400"
                            : u.role === "accountant"
                            ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400"
                            : u.role === "support"
                            ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        <Shield className="w-2.5 h-2.5" />
                        <span>{u.role.replace("_", " ")}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {u.store ? u.store.name : <span className="text-purple-500 font-semibold">Global (All Stores)</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2 text-[11px]">
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
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Impersonation action for Super Admin */}
                        {currentUser?.role === "super_admin" && u.id !== currentUser.id && (
                          <button
                            onClick={() => {
                              setImpersonateTarget(u);
                              setImpersonateReason("");
                            }}
                            title="Impersonate (Login as store user with visible audit banner)"
                            className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold rounded-lg text-[10px] flex items-center gap-1 transition-colors"
                          >
                            <UserCheck className="w-3 h-3" />
                            <span>Impersonate</span>
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setPasswordResetUser(u);
                            setNewPassword("");
                          }}
                          title="Reset Password"
                          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleForceLogout(u)}
                          title="Force Logout / Revoke Active Sessions"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                        </button>
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
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-amber-500/40 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 text-amber-500">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <UserCheck className="w-4 h-4" />
                <span>Impersonate: {impersonateTarget.name}</span>
              </h3>
              <button
                onClick={() => setImpersonateTarget(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleStartImpersonate} className="space-y-4 text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                You will temporarily browse and perform actions as{" "}
                <strong>{impersonateTarget.name}</strong> ({impersonateTarget.role}). A persistent top banner will be shown, and all actions will log both your Super Admin identity and the target user.
              </p>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reason for Impersonation <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={impersonateReason}
                  onChange={(e) => setImpersonateReason(e.target.value)}
                  placeholder="e.g. Investigating store sync conflict or billing discrepancy..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setImpersonateTarget(null)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Start Impersonation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {passwordResetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Reset Password: {passwordResetUser.name}
              </h3>
              <button
                onClick={() => setPasswordResetUser(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPasswordResetUser(null)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Confirm Reset
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
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
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
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
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
                    <option value="manager">Manager</option>
                    <option value="store_owner">Store Owner</option>
                    <option value="accountant">Accountant (Reports only)</option>
                    <option value="support">Support (Read-only)</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>

                <div>
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
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
