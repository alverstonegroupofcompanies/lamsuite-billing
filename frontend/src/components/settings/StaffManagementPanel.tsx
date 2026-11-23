import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Unlock, X } from "lucide-react";
import {
  staffAuthService,
  type ManageableStaffInput,
  type ManageableStaffUser,
} from "../../lib/auth/staffAuthService";
import { storeDeviceService } from "../../lib/auth/storeDeviceService";
import { counterSessionService } from "../../lib/auth/counterSessionService";

const ROLE_OPTIONS = [
  { value: "cashier", label: "Cashier" },
  { value: "operator", label: "Operator" },
  { value: "pharmacist", label: "Pharmacist" },
  { value: "manager", label: "Manager" },
  { value: "accountant", label: "Accountant" },
  { value: "support", label: "Support" },
  { value: "store_owner", label: "Store Owner" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

interface StaffFormState {
  name: string;
  email: string;
  username: string;
  password: string;
  pin: string;
  role: string;
}

const EMPTY_FORM: StaffFormState = {
  name: "",
  email: "",
  username: "",
  password: "",
  pin: "",
  role: "cashier",
};

function isLocked(user: ManageableStaffUser): boolean {
  if (!user.locked_until) return false;
  const ts = new Date(user.locked_until).getTime();
  return Number.isFinite(ts) && ts > Date.now();
}

export function StaffManagementPanel() {
  const [staff, setStaff] = useState<ManageableStaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [usingOfflineCache, setUsingOfflineCache] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [terminalStoreName, setTerminalStoreName] = useState("");

  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingUser, setEditingUser] = useState<ManageableStaffUser | null>(null);
  const [form, setForm] = useState<StaffFormState>(EMPTY_FORM);

  const [resetPinUser, setResetPinUser] = useState<ManageableStaffUser | null>(null);
  const [newPin, setNewPin] = useState("");

  // PRF-001: this counter's document, not a person's role, decides the panel.
  const authorised = counterSessionService.allowsModule("settings");
  const canView = authorised;
  const canCreate = authorised;
  const canEdit = authorised;
  const canDelete = authorised;

  // A till never hands out the platform's own top role.
  const roleOptions = useMemo(() => ROLE_OPTIONS.filter((r) => r.value !== "super_admin"), []);

  const flashSuccess = (message: string) => {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const loadStaff = useCallback(async () => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMsg("");
    try {
      const list = await staffAuthService.listManageableStaff();
      setStaff(list);
      setUsingOfflineCache(false);
    } catch (err: any) {
      // Server unreachable or offline: fall back to the read-only cached
      // directory so the terminal still shows who can sign in locally.
      try {
        const cached = await staffAuthService.listStaffDirectory();
        setStaff(
          cached.map((u) => ({
            id: u.id,
            name: u.full_name,
            email: "",
            username: u.username,
            role: u.role,
            store_id: null,
            permissions: null,
            locked_until: u.locked_until ? new Date(u.locked_until).toISOString() : null,
          }))
        );
        setUsingOfflineCache(true);
        setErrorMsg(err?.message || "Showing the cached staff directory. Connect to the server to make changes.");
      } catch {
        setStaff([]);
        setErrorMsg(err?.message || "Could not load staff accounts.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    storeDeviceService
      .getDeviceProfile()
      .then((p) => setTerminalStoreName(p?.store_name || ""))
      .catch(() => setTerminalStoreName(""));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((u) =>
      [u.name, u.email, u.username || "", u.role, u.store?.name || ""].some((v) =>
        String(v || "").toLowerCase().includes(q)
      )
    );
  }, [staff, query]);

  const openCreate = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setFormMode("create");
    setErrorMsg("");
  };

  const openEdit = (user: ManageableStaffUser) => {
    setEditingUser(user);
    setForm({
      name: user.name || "",
      email: user.email || "",
      username: user.username || "",
      password: "",
      pin: "",
      role: user.role || "cashier",
    });
    setFormMode("edit");
    setErrorMsg("");
  };

  const closeForm = () => {
    setFormMode(null);
    setEditingUser(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name) return setErrorMsg("Full name is required.");
    if (!email) return setErrorMsg("Email is required.");
    if (form.pin && !/^\d{4,6}$/.test(form.pin)) {
      return setErrorMsg("PIN must be 4 to 6 digits.");
    }

    const payload: ManageableStaffInput = {
      name,
      email,
      username: form.username.trim() || null,
      role: form.role,
    };
    if (form.password.trim()) payload.password = form.password.trim();
    if (form.pin) payload.pin = form.pin;

    if (formMode === "create") {
      if (!payload.password) return setErrorMsg("An initial password (min 8 characters) is required.");
      if (String(payload.password).length < 8) {
        return setErrorMsg("Password must be at least 8 characters.");
      }
    }

    setIsSaving(true);
    setErrorMsg("");
    try {
      if (formMode === "create") {
        await staffAuthService.createStaff(payload);
        flashSuccess(`Staff account "${name}" created.`);
      } else if (editingUser) {
        await staffAuthService.updateStaff(editingUser.id, payload);
        flashSuccess(`Staff account "${name}" updated.`);
      }
      closeForm();
      await loadStaff();
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not save the staff account.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (user: ManageableStaffUser) => {
    if (
      !window.confirm(
        `Delete the staff account "${user.name}" permanently?\n\nThis removes their sign-in access and cannot be undone.`
      )
    ) {
      return;
    }
    setActiveId(user.id);
    setErrorMsg("");
    try {
      await staffAuthService.deleteStaff(user.id);
      flashSuccess(`Staff account "${user.name}" deleted.`);
      await loadStaff();
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not delete the staff account.");
    } finally {
      setActiveId(null);
    }
  };

  const handleUnlock = async (user: ManageableStaffUser) => {
    setActiveId(user.id);
    setErrorMsg("");
    try {
      await staffAuthService.unlockStaff(user.id);
      flashSuccess(`Staff account "${user.name}" unlocked.`);
      await loadStaff();
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not unlock the staff account.");
    } finally {
      setActiveId(null);
    }
  };

  const handleResetPin = async () => {
    if (!resetPinUser) return;
    if (!/^\d{4,6}$/.test(newPin)) {
      setErrorMsg("PIN must be 4 to 6 digits.");
      return;
    }
    setIsSaving(true);
    setErrorMsg("");
    try {
      await staffAuthService.resetStaffPin(resetPinUser.id, newPin);
      flashSuccess(`PIN reset for "${resetPinUser.name}".`);
      setResetPinUser(null);
      setNewPin("");
      await loadStaff();
    } catch (err: any) {
      setErrorMsg(err?.message || "Could not reset the PIN.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-bold text-slate-800">Staff &amp; Access</div>
        <p className="mt-1 text-[10px] text-slate-500">
          This counter's permission profile does not include Settings, so staff accounts cannot be managed here. The store owner sets what this counter may open in Admin Panel → Counters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Staff &amp; Access{terminalStoreName ? ` — ${terminalStoreName}` : " (This Store)"}
          </div>
          <p className="text-[10px] text-slate-500">
            Create operator accounts, set roles and PINs, unlock lockouts, or remove access. Every account here
            belongs to this branch only; multi-branch and global accounts are managed in the admin panel.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={loadStaff}
            disabled={isLoading}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Staff
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
          {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">{errorMsg}</div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by name, username, email or role"
        className="w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
      />

      {isLoading && staff.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">Loading staff accounts...</p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          {query ? "No staff accounts match the filter." : "No staff accounts yet. Use Add Staff to create one."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((user) => {
                const locked = isLocked(user);
                const busy = activeId === user.id;
                return (
                  <tr key={user.id} className="text-slate-700">
                    <td className="px-3 py-2">
                      <div className="font-semibold">{user.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {user.email || "—"}
                        {user.username ? ` • @${user.username}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[10px] font-bold uppercase text-slate-500">
                      {String(user.role || "").replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-slate-500">
                      {user.store?.name || (user.store_id ? `Store ${user.store_id}` : "All stores (global)")}
                    </td>
                    <td className="px-3 py-2">
                      {locked ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                          Locked
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {locked && canEdit && (
                          <button
                            type="button"
                            onClick={() => handleUnlock(user)}
                            disabled={busy}
                            title="Unlock account"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-50"
                          >
                            <Unlock className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setResetPinUser(user);
                              setNewPin("");
                            }}
                            disabled={busy}
                            title="Reset PIN"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEdit(user)}
                            disabled={busy}
                            title="Edit staff account"
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(user)}
                            disabled={busy}
                            title="Delete staff account"
                            className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {usingOfflineCache && (
        <p className="text-[10px] text-amber-700">
          Showing cached accounts only. Reconnect to the server to create, edit or delete staff.
        </p>
      )}

      {formMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  {formMode === "create" ? "Add Staff Account" : `Edit ${editingUser?.name || "Staff"}`}
                </h3>
                <p className="text-[10px] text-slate-500">
                  {formMode === "create"
                    ? "The account is created on the server and added to this terminal's offline cache."
                    : "Leave password and PIN blank to keep the current credentials."}
                </p>
              </div>
              <button type="button" onClick={closeForm} className="rounded p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold uppercase text-slate-600">Full Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-semibold uppercase text-slate-600">Email (login id)</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-600">Username (optional)</label>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-600">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                >
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-[10px] font-semibold uppercase text-slate-600">
                  Assigned Store (fixed to this terminal)
                </label>
                <div className="mt-1 flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="font-semibold">{terminalStoreName || "This branch"}</span>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-600">
                  {formMode === "create" ? "Password" : "New Password (optional)"}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={formMode === "edit" ? "Leave blank to keep" : "Min 8 characters"}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-600">
                  {formMode === "create" ? "Quick PIN (4-6 digits)" : "New PIN (optional)"}
                </label>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeForm}
                className="rounded border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded bg-blue-600 px-3.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : formMode === "create" ? "Create Staff" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetPinUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Reset PIN</h3>
              <p className="text-[10px] text-slate-500">
                Set a new quick PIN for <strong>{resetPinUser.name}</strong>. The PIN is never shown again.
              </p>
            </div>
            <input
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              placeholder="4-6 digit PIN"
              className="w-full rounded border border-slate-300 p-2 text-xs tracking-widest focus:border-blue-500 focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setResetPinUser(null);
                  setNewPin("");
                }}
                className="rounded border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPin}
                disabled={isSaving || newPin.length < 4}
                className="rounded bg-blue-600 px-3.5 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Reset PIN"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
