import React, { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  Plus,
  Users2,
  Pencil,
  Trash2,
  RefreshCw,
  KeyRound,
  AlertTriangle,
  Stethoscope,
  Check,
  X,
} from "lucide-react";

/**
 * GAP-01 / SPR-001..005 — the salespeople a store's bills may name.
 *
 * A person is born in exactly one store, their code never repeats inside it,
 * and the counters they may sell at is a restriction the till obeys and the
 * server re-checks. Anyone who has already sold something is archived rather
 * than deleted, because the bills that name them are the record of their work.
 */

export interface AdminSalesperson {
  id: number;
  store_id: number;
  name: string;
  code: string;
  phone: string | null;
  counter_ids: number[] | null;
  is_active: boolean;
  archived_at: string | null;
  version: number;
  has_pin?: boolean;
  is_pharmacist?: boolean;
  reg_no?: string | null;
  reg_valid_from?: string | null;
  reg_valid_until?: string | null;
}

interface CounterRow {
  id: number;
  store_id: number;
  counter_code: string;
  counter_name: string;
}

const inputClass =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white";
const labelClass = "block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

/**
 * The salesperson credential is judged in the browser exactly as PinPolicy
 * judges it on the server: six digits, no repeated digit, no whole-length run.
 * A PIN that fails here is never sent anywhere.
 */
function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "PIN must be 6 numeric digits.";
  if (/^(.)\1+$/.test(pin)) return "PIN cannot consist of repeated digits (e.g. 1111).";

  const digits = pin.split("").map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) return "Trivial sequential PINs are not allowed for security reasons.";

  return null;
}

const emptyForm = {
  store_id: "",
  name: "",
  code: "",
  phone: "",
  pin: "",
  counter_mode: "all" as "all" | "some",
  counter_ids: [] as number[],
  is_active: true,
  remove_pin: false,
  is_pharmacist: false,
  reg_no: "",
  reg_valid_from: "",
  reg_valid_until: "",
};

/** PHR-003: a registration that has run out cannot confirm a bill. */
function registrationExpired(person: AdminSalesperson): boolean {
  if (!person.reg_valid_until) return false;
  return new Date(`${person.reg_valid_until}T23:59:59`).getTime() < Date.now();
}

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? (
    <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-300">
      {message}
    </p>
  ) : null;

export const SalespeoplePage: React.FC = () => {
  const { hasPermission, isAllStores, stores, activeStore, setActiveStore } = useAuth();
  const canEdit = hasPermission("masters", "edit");
  const canCreate = hasPermission("masters", "create");
  const canDelete = hasPermission("masters", "delete");

  // PHR-011: a registration only means something where drugs are sold, so a
  // store that is not a pharmacy is not even offered the question.
  const isPharmacy = Boolean(activeStore && (activeStore.store_type || "pharmacy") === "pharmacy");

  const [people, setPeople] = useState<AdminSalesperson[]>([]);
  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; person?: AdminSalesperson } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [confirming, setConfirming] = useState<AdminSalesperson | null>(null);

  const fetchPeople = useCallback(async () => {
    if (isAllStores || !activeStore) {
      setPeople([]);
      setIsLoading(false);
      return;
    }
    try {
      const res = await api.get<{ success: boolean; salespeople: AdminSalesperson[] }>("/admin/salespeople", {
        q: search.trim() || undefined,
        include_archived: includeArchived ? 1 : undefined,
      });
      setPeople(res.salespeople || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "The salespeople could not be read.");
    } finally {
      setIsLoading(false);
    }
  }, [activeStore, isAllStores, search, includeArchived]);

  const fetchCounters = useCallback(async () => {
    if (isAllStores || !activeStore) {
      setCounters([]);
      return;
    }
    try {
      const res = await api.get<{ success: boolean; counters: CounterRow[] }>("/admin/counters");
      setCounters(res.counters || []);
    } catch {
      // The counter list only narrows the tick-boxes; a failure is not fatal.
      setCounters([]);
    }
  }, [activeStore, isAllStores]);

  useEffect(() => {
    void fetchPeople();
  }, [fetchPeople]);

  useEffect(() => {
    void fetchCounters();
  }, [fetchCounters]);

  const openCreate = () => {
    setForm({ ...emptyForm, store_id: activeStore ? String(activeStore.id) : "" });
    setFieldErrors({});
    setConflict(null);
    setNotice(null);
    setDialog({ mode: "create" });
  };

  const openEdit = (person: AdminSalesperson) => {
    setForm({
      store_id: String(person.store_id),
      name: person.name,
      code: person.code || "",
      phone: person.phone || "",
      pin: "",
      counter_mode: person.counter_ids && person.counter_ids.length > 0 ? "some" : "all",
      counter_ids: person.counter_ids || [],
      is_active: Boolean(person.is_active) && !person.archived_at,
      remove_pin: false,
      is_pharmacist: Boolean(person.is_pharmacist),
      reg_no: person.reg_no || "",
      reg_valid_from: person.reg_valid_from || "",
      reg_valid_until: person.reg_valid_until || "",
    });
    setFieldErrors({});
    setConflict(null);
    setNotice(null);
    setDialog({ mode: "edit", person });
  };

  /**
   * A person belongs to one store, so choosing another store in the dialog
   * moves the panel's own scope there: the counters offered and the header the
   * save carries are then unmistakably that store's.
   */
  const pickStore = (storeId: string) => {
    const target = stores.find((s: any) => String(s.id) === storeId);
    if (target && String(activeStore?.id) !== String(target.id)) setActiveStore(target);
    setForm((prev) => ({ ...prev, store_id: storeId, counter_ids: [], counter_mode: "all" }));
    void fetchCounters();
  };

  const toggleCounter = (counterId: number) => {
    setForm((prev) => {
      const next = prev.counter_ids.includes(counterId)
        ? prev.counter_ids.filter((id) => id !== counterId)
        : [...prev.counter_ids, counterId];
      return { ...prev, counter_ids: next, counter_mode: next.length > 0 ? "some" : "all" };
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dialog) return;

    const errors: Record<string, string> = {};
    const name = form.name.trim();
    if (!name) errors.name = "A salesperson needs a name.";

    const pin = form.pin.trim();
    if (pin) {
      const refusal = pinProblem(pin);
      if (refusal) errors.pin = refusal;
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const code = form.code.trim().toUpperCase();
    const payload: Record<string, any> = {
      name,
      phone: form.phone.trim() || null,
      counter_ids: form.counter_mode === "all" ? null : form.counter_ids,
      is_active: form.is_active,
    };
    if (code) payload.code = code;
    if (pin) payload.pin = pin;
    if (isPharmacy) {
      payload.is_pharmacist = form.is_pharmacist;
      if (form.is_pharmacist) {
        payload.reg_no = form.reg_no.trim() || null;
        payload.reg_valid_from = form.reg_valid_from || null;
        payload.reg_valid_until = form.reg_valid_until || null;
      }
    }
    // An empty PIN box in the edit dialog means "leave it alone"; clearing a
    // stored PIN is a deliberate tick the owner has to make.
    if (dialog.mode === "edit" && form.remove_pin) payload.pin = "";

    setIsSaving(true);
    setConflict(null);
    setError(null);
    try {
      if (dialog.mode === "create") {
        await api.post("/admin/salespeople", payload);
        setNotice(`${name} added.`);
      } else if (dialog.person) {
        await api.put(`/admin/salespeople/${dialog.person.id}`, {
          ...payload,
          version: dialog.person.version,
        });
        setNotice(`${name} updated.`);
      }
      setDialog(null);
      await fetchPeople();
    } catch (err: any) {
      if (err?.status === 409 && err?.data?.code === "salesperson_version_conflict") {
        setConflict(err.message);
        await fetchPeople();
      } else if (err?.status === 422 && err?.data?.errors) {
        const flat: Record<string, string> = {};
        for (const [field, messages] of Object.entries(err.data.errors as Record<string, string[]>)) {
          flat[field] = Array.isArray(messages) ? String(messages[0]) : String(messages);
        }
        setFieldErrors((prev) => ({ ...prev, ...flat }));
      } else {
        setError(err?.message || "The salesperson could not be saved.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (person: AdminSalesperson) => {
    setConfirming(null);
    setError(null);
    try {
      const reply = await api.delete<{
        success: boolean;
        archived?: boolean;
        deleted?: boolean;
        bills?: number;
        message?: string;
      }>(`/admin/salespeople/${person.id}`);
      setNotice(reply.message || `${person.name} removed from this store.`);
      await fetchPeople();
    } catch (err: any) {
      setError(err?.message || "The salesperson could not be removed.");
    }
  };

  const storeCounters = counters.filter((c) => String(c.store_id) === String(form.store_id));

  const countersLabel = (person: AdminSalesperson): string => {
    if (!person.counter_ids || person.counter_ids.length === 0) return "Every counter";
    return person.counter_ids
      .map((id) => counters.find((c) => String(c.id) === String(id))?.counter_name || `Counter ${id}`)
      .join(", ");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Users2 className="w-6 h-6 text-emerald-600" />
            <span>Salespeople</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The people a bill may name as the seller — required on every new bill until this store switches it off.
          </p>
        </div>
        {canCreate && !isAllStores && activeStore && (
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add salesperson
          </button>
        )}
      </div>

      {isAllStores && (
        <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
          Select one store to add or change its salespeople.
        </p>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="relative block w-full sm:w-80">
          <span className="sr-only">Search salespeople</span>
          <input
            aria-label="Search salespeople"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="rounded text-emerald-600"
          />
          <span>Include archived</span>
        </label>
        <button
          type="button"
          onClick={() => void fetchPeople()}
          title="Refresh the list"
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading salespeople...
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {people.map((person) => (
            <div
              key={person.id}
              role="group"
              aria-label={person.name}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-900 dark:text-white">{person.name}</p>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{person.code}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{person.phone || "No phone"}</p>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    person.archived_at
                      ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                      : person.is_active
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {person.archived_at ? "Archived" : person.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              <dl className="text-[11px] space-y-1 text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-1.5">
                  <Users2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>{countersLabel(person)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  <span>{person.has_pin ? "PIN set" : "No PIN"}</span>
                </div>
                {isPharmacy && person.is_pharmacist && person.reg_no && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Stethoscope className="w-3.5 h-3.5 text-slate-400" />
                    <span>{person.reg_no}</span>
                    {registrationExpired(person) && (
                      <span className="font-bold text-rose-700 dark:text-rose-300">
                        Registration expired {person.reg_valid_until}
                      </span>
                    )}
                  </div>
                )}
              </dl>

              {canEdit && !isAllStores && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    aria-label={`Edit ${person.name}`}
                    onClick={() => openEdit(person)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      aria-label={`Remove ${person.name}`}
                      onClick={() => setConfirming(person)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {people.length === 0 && !isLoading && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No salespeople yet in this store. Add one and the bill header can name who sold.
        </p>
      )}

      {dialog && (
        <div
          role="dialog"
          aria-label={dialog.mode === "create" ? "Add Salesperson" : `Edit ${dialog.person?.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <form
            onSubmit={submit}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="space-y-1">
              <label htmlFor="salesperson-store" className={labelClass}>
                Store
              </label>
              <select
                id="salesperson-store"
                value={form.store_id}
                onChange={(e) => pickStore(e.target.value)}
                className={inputClass}
              >
                <option value="">Select a store</option>
                {stores.map((store: any) => (
                  <option key={store.id} value={String(store.id)}>
                    {store.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                The salesperson belongs to this store and its counters only.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="salesperson-name" className={labelClass}>
                Name
              </label>
              <input
                id="salesperson-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="As printed on the bill"
                className={inputClass}
              />
              <FieldError message={fieldErrors.name} />
            </div>

            <div className="space-y-1">
              <label htmlFor="salesperson-code" className={labelClass}>
                Code
              </label>
              <input
                id="salesperson-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder={dialog.mode === "create" ? "Leave blank to number this store" : undefined}
                className={inputClass}
              />
              <FieldError message={fieldErrors.code} />
            </div>

            <div className="space-y-1">
              <label htmlFor="salesperson-phone" className={labelClass}>
                Phone
              </label>
              <input
                id="salesperson-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputClass}
              />
              <FieldError message={fieldErrors.phone} />
            </div>

            <div className="space-y-1">
              <label htmlFor="salesperson-pin" className={labelClass}>
                Personal PIN
              </label>
              <input
                id="salesperson-pin"
                type="password"
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value })}
                placeholder={dialog.mode === "edit" ? "Unchanged unless typed" : "6 digits, optional"}
                className={inputClass}
              />
              {dialog.mode === "edit" && dialog.person?.has_pin && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  PIN already set on this record — it is never shown again.
                </p>
              )}
              {dialog.mode === "edit" && dialog.person?.has_pin && (
                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.remove_pin}
                    onChange={(e) => setForm({ ...form, remove_pin: e.target.checked })}
                    className="rounded text-emerald-600"
                  />
                  <span>Remove stored PIN</span>
                </label>
              )}
              <FieldError message={fieldErrors.pin} />
            </div>

            {isPharmacy && (
              <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.is_pharmacist}
                    onChange={(e) => setForm({ ...form, is_pharmacist: e.target.checked })}
                    className="rounded text-emerald-600"
                  />
                  <span>Registered pharmacist</span>
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  A pharmacist confirms the bills that carry restricted drugs, with their own PIN. This is not a
                  login — it is the council registration the store recorded.
                </p>
                <FieldError message={fieldErrors.is_pharmacist} />

                {form.is_pharmacist && (
                  <div className="space-y-2 pt-1">
                    <div className="space-y-1">
                      <label htmlFor="salesperson-reg-no" className={labelClass}>
                        Registration number
                      </label>
                      <input
                        id="salesperson-reg-no"
                        value={form.reg_no}
                        onChange={(e) => setForm({ ...form, reg_no: e.target.value })}
                        placeholder="As printed on the council certificate"
                        className={inputClass}
                      />
                      <FieldError message={fieldErrors.reg_no} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label htmlFor="salesperson-reg-from" className={labelClass}>
                          Valid from
                        </label>
                        <input
                          id="salesperson-reg-from"
                          type="date"
                          value={form.reg_valid_from}
                          onChange={(e) => setForm({ ...form, reg_valid_from: e.target.value })}
                          className={inputClass}
                        />
                        <FieldError message={fieldErrors.reg_valid_from} />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="salesperson-reg-until" className={labelClass}>
                          Valid until
                        </label>
                        <input
                          id="salesperson-reg-until"
                          type="date"
                          value={form.reg_valid_until}
                          onChange={(e) => setForm({ ...form, reg_valid_until: e.target.value })}
                          className={inputClass}
                        />
                        <FieldError message={fieldErrors.reg_valid_until} />
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Outside these dates the person cannot confirm a bill, even while they stay on the staff list.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <p className={labelClass}>Allowed counters</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {form.counter_mode === "all"
                  ? "Every counter of this store may put this person on a bill."
                  : "Only the ticked counters may name this person."}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {storeCounters.map((counter) => (
                  <label
                    key={counter.id}
                    className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={form.counter_ids.includes(counter.id)}
                      onChange={() => toggleCounter(counter.id)}
                      className="rounded text-emerald-600"
                    />
                    <span>
                      {counter.counter_name} ({counter.counter_code})
                    </span>
                  </label>
                ))}
                {storeCounters.length === 0 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    This store has no counters yet, so every bill may name this person.
                  </p>
                )}
              </div>
              <FieldError message={fieldErrors.counter_ids} />
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="rounded text-emerald-600"
              />
              <span>Available on bills</span>
            </label>

            {conflict && (
              <div
                role="alert"
                className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:text-amber-200"
              >
                <p>{conflict}</p>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await api.get<{ success: boolean; salespeople: AdminSalesperson[] }>(
                      "/admin/salespeople",
                      { include_archived: 1 }
                    );
                    const fresh = (res.salespeople || []).find((row) => row.id === dialog.person?.id);
                    if (fresh) openEdit(fresh);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-bold"
                >
                  Reload this record
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || !form.store_id}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-label={`Remove ${confirming.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 space-y-4 shadow-2xl">
            <p className="text-sm font-black text-slate-900 dark:text-white">Remove {confirming.name}?</p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              A salesperson who has already sold something is archived instead of deleted, so the bills naming
              them stay intact. Archived people disappear from the till but remain in your reports.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void remove(confirming)}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white"
              >
                Confirm removal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalespeoplePage;
