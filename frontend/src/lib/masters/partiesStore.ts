import { sqliteStorage } from "../db/sqliteStorage";
import { syncQueueService } from "../sync/syncQueueService";
import { getResolvedApiBaseUrl } from "../../config/env";

export interface Customer {
  id: string;
  customer_code?: string;
  name: string;
  phone: string;
  phones?: string[];
  gstin?: string;
  address?: string;
  place_of_supply?: string;
  price_list?: string;
  default_discount_percent?: number;
  outstanding_balance?: number;
  current_balance?: number;
  credit_limit?: number;
  credit_days?: number;
  email?: string;
  is_active: boolean;
  created_at?: number;
  updated_at?: number;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  gstin?: string;
  address?: string;
  credit_period_days?: number;
  opening_balance?: number;
  is_active: boolean;
}

export interface Doctor {
  id: string;
  name: string;
  medical_reg_no: string;
  clinic_name?: string;
  phone?: string;
}

export interface Patient {
  id: string;
  name: string;
  age?: number | string;
  gender?: "Male" | "Female" | "Other";
  phone?: string;
}

export interface PartyMaster {
  id: string;
  type: "customer" | "supplier" | "doctor" | "patient";
  name: string;
  phone?: string;
  phones?: string[];
  gstin?: string;
  address?: string;
  place_of_supply?: string;
  outstanding_balance?: number;
  credit_limit?: number;
  credit_period_days?: number;
  opening_balance?: number;
  is_active?: boolean;
  medical_reg_no?: string;
  clinic_name?: string;
  age?: number | string;
  gender?: "Male" | "Female" | "Other";
}

/** Validate standard 15-character Indian GSTIN */
export function isValidGstin(gstin: string): boolean {
  const clean = gstin.trim().toUpperCase();
  if (clean.length !== 15) return false;
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(clean);
}

/** Normalize Indian phone numbers (stripping +91 or leading 0) */
export function normalizeIndianPhone(phone: string): string {
  let clean = phone.replace(/\D/g, "");
  if (clean.length === 12 && clean.startsWith("91")) {
    clean = clean.slice(2);
  } else if (clean.length === 11 && clean.startsWith("0")) {
    clean = clean.slice(1);
  }
  return clean;
}

/** Validate standard 10-digit Indian Mobile Phone Number */
export function isValidIndianPhone(phone: string): boolean {
  const clean = normalizeIndianPhone(phone);
  return /^[6-9]\d{9}$/.test(clean);
}

export class PartiesStore {
  async upsertCustomer(customer: Customer): Promise<void> {
    await sqliteStorage.insertRecord("customers", customer.id, customer as unknown as Record<string, unknown>);
  }

  async getCustomerById(id: string): Promise<Customer | null> {
    if (!id) return null;
    const direct = await sqliteStorage.findById<Customer>("customers", id);
    if (direct) return direct;
    const all = await this.getAllCustomers();
    const strId = String(id);
    return all.find((c) => String(c.id) === strId || String((c as any).server_id) === strId || String((c as any).external_id) === strId) || null;
  }

  async getAllCustomers(): Promise<Customer[]> {
    return await sqliteStorage.findAll<Customer>("customers");
  }

  async findCustomerByPhone(phone: string): Promise<Customer | null> {
    const target = normalizeIndianPhone(phone);
    if (!target) return null;

    const customers = await this.getAllCustomers();

    for (const c of customers) {
      if (normalizeIndianPhone(c.phone) === target) return c;
      if (c.phones) {
        for (const p of c.phones) {
          if (normalizeIndianPhone(p) === target) return c;
        }
      }
    }
    return null;
  }

  async searchCustomers(query: string, limit = 50): Promise<Customer[]> {
    const rawTerm = query.trim().toLowerCase();
    const cleanPhoneQuery = rawTerm.replace(/\D/g, "");

    const customers = await this.getAllCustomers();

    if (!rawTerm) {
      return this.getRecentOrFrequentCustomers(limit);
    }

    const scored: { customer: Customer; score: number }[] = [];

    for (const c of customers) {
      if (!c.is_active) continue;

      const nameLower = (c.name || "").toLowerCase();
      const codeLower = (c.customer_code || "").toLowerCase();
      const gstinLower = (c.gstin || "").toLowerCase();
      const phoneClean = normalizeIndianPhone(c.phone || "");
      const secondaryPhones = (c.phones || []).map((p) => normalizeIndianPhone(p));

      let score = 0;

      // 1. Exact or prefix match on phone
      if (cleanPhoneQuery.length >= 3) {
        if (phoneClean === cleanPhoneQuery || secondaryPhones.includes(cleanPhoneQuery)) {
          score += 1000;
        } else if (phoneClean.startsWith(cleanPhoneQuery) || secondaryPhones.some((p) => p.startsWith(cleanPhoneQuery))) {
          score += 500;
        } else if (phoneClean.includes(cleanPhoneQuery) || secondaryPhones.some((p) => p.includes(cleanPhoneQuery))) {
          score += 200;
        }
      }

      // 2. Name matches
      if (nameLower === rawTerm) {
        score += 800;
      } else if (nameLower.startsWith(rawTerm)) {
        score += 400;
      } else if (nameLower.includes(rawTerm)) {
        score += 150;
      }

      // 3. Customer code & GSTIN matches
      if (codeLower === rawTerm) {
        score += 600;
      } else if (codeLower.includes(rawTerm)) {
        score += 250;
      }

      if (gstinLower.includes(rawTerm)) {
        score += 300;
      }

      if (score > 0) {
        scored.push({ customer: c, score });
      }
    }

    // Sort descending by score, then alphabetically by name
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.customer.name.localeCompare(b.customer.name);
    });

    return scored.slice(0, limit).map((item) => item.customer);
  }

  async getRecentOrFrequentCustomers(limit = 10): Promise<Customer[]> {
    const all = await this.getAllCustomers();
    if (all.length === 0) {
      return [];
    }

    try {
      // Look up recent customer IDs from invoices
      const invoices = await sqliteStorage.findAll<{ customer_id?: string; customer_name?: string }>("invoices");
      const frequencyMap = new Map<string, number>();
      for (const inv of invoices) {
        if (inv.customer_id) {
          frequencyMap.set(inv.customer_id, (frequencyMap.get(inv.customer_id) || 0) + 1);
        }
      }

      const activeCustomers = all.filter((c) => c.is_active);
      activeCustomers.sort((a, b) => {
        const freqA = frequencyMap.get(a.id) || 0;
        const freqB = frequencyMap.get(b.id) || 0;
        if (freqB !== freqA) return freqB - freqA;
        return a.name.localeCompare(b.name);
      });

      return activeCustomers.slice(0, limit);
    } catch {
      return all.filter((c) => c.is_active).slice(0, limit);
    }
  }

  async quickCreateCustomer(data: {
    name: string;
    phone?: string;
    gstin?: string;
    address?: string;
    credit_limit?: number;
    default_discount_percent?: number;
  }): Promise<Customer> {
    const name = data.name.trim();
    if (!name) {
      throw new Error("Customer name is required");
    }

    const cleanPhone = data.phone ? normalizeIndianPhone(data.phone) : "";

    // Prevent duplicates if phone is provided
    if (cleanPhone) {
      const existing = await this.findCustomerByPhone(cleanPhone);
      if (existing) {
        return existing;
      }
    }

    const id = `cust_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const customerCode = `CUST-${Date.now().toString().slice(-4)}`;
    const now = Date.now();

    const newCustomer: Customer = {
      id,
      customer_code: customerCode,
      name,
      phone: cleanPhone || (data.phone ? data.phone.trim() : ""),
      gstin: data.gstin ? data.gstin.trim().toUpperCase() : undefined,
      address: data.address ? data.address.trim() : undefined,
      credit_limit: data.credit_limit !== undefined ? Number(data.credit_limit) : undefined,
      default_discount_percent: data.default_discount_percent !== undefined ? Number(data.default_discount_percent) : undefined,
      outstanding_balance: 0,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    await this.upsertCustomer(newCustomer);

    // Queue for sync and attempt live write to backend API
    try {
      await syncQueueService.enqueue("customer", id, "create", newCustomer as unknown as Record<string, unknown>);
      const baseUrl = getResolvedApiBaseUrl();
      fetch(`${baseUrl}/api/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: newCustomer.name,
          phone: newCustomer.phone,
          gstin: newCustomer.gstin,
          address: newCustomer.address,
        }),
      }).then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          if (json.customer?.id) {
            newCustomer.id = String(json.customer.id);
            await this.upsertCustomer(newCustomer);
          }
        }
      }).catch(() => {});
    } catch {
      // Sync enqueue silent fallback if queue not ready
    }

    return newCustomer;
  }

  /**
   * Pulls real customers and parties from backend database into local SQLite cache.
   * Purges hardcoded mock/sample customer records if real data is available.
   */
  async ensurePartiesPopulated(force = false): Promise<{ count: number; source: string }> {
    try {
      const baseUrl = getResolvedApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/customers?limit=200`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        const rawList = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
        if (rawList.length > 0) {
          // Remove legacy mock sample records
          const existing = await sqliteStorage.findAll<Customer>("customers");
          for (const old of existing) {
            if (old.id === "cust_1" || old.id === "cust_2" || old.id === "cust_3" || old.id === "cust_4" || old.id === "cust_5" || old.id === "cust_seed_1") {
              await sqliteStorage.deleteRecord("customers", old.id).catch(() => {});
            }
          }

          let savedCount = 0;
          for (const c of rawList) {
            const cust: Customer = {
              id: String(c.id),
              customer_code: c.reg_no || c.customer_code || `CUST-${c.id}`,
              name: c.name,
              phone: c.phone || "",
              gstin: c.gstin || undefined,
              address: c.address || undefined,
              place_of_supply: c.state_code ? `${c.state_code}-State` : undefined,
              outstanding_balance: c.current_balance !== undefined ? Number(c.current_balance) : (c.outstanding_balance !== undefined ? Number(c.outstanding_balance) : 0),
              credit_limit: c.credit_limit !== undefined ? Number(c.credit_limit) : 0,
              is_active: Boolean(c.is_active !== false),
              created_at: c.created_at ? new Date(c.created_at).getTime() : Date.now(),
              updated_at: c.updated_at ? new Date(c.updated_at).getTime() : Date.now(),
            };
            await sqliteStorage.insertRecord("customers", cust.id, cust as unknown as Record<string, unknown>);
            savedCount++;
          }
          return { count: savedCount, source: "backend_db" };
        }
      }
    } catch (_) {}

    // Fallback: check sync delta pull
    try {
      const baseUrl = getResolvedApiBaseUrl();
      const deltaRes = await fetch(`${baseUrl}/api/sync/pull/deltas?since_watermark=0`);
      if (deltaRes.ok) {
        const delta = await deltaRes.json();
        if (Array.isArray(delta.parties) && delta.parties.length > 0) {
          for (const party of delta.parties) {
            const normalizedParty: PartyMaster = {
              ...party,
              id: String(party.id),
              is_active: Boolean(party.is_active !== false),
              credit_limit: party.credit_limit !== undefined ? Number(party.credit_limit) : undefined,
              outstanding_balance: party.current_balance !== undefined ? Number(party.current_balance) : (party.outstanding_balance !== undefined ? Number(party.outstanding_balance) : 0),
            };
            await this.upsertParty(normalizedParty);
          }
          return { count: delta.parties.length, source: "sync_deltas" };
        }
      }
    } catch (_) {}

    const local = await sqliteStorage.findAll<Customer>("customers");
    return { count: local.length, source: "sqlite_cache" };
  }

  async seedSampleCustomersIfEmpty(): Promise<void> {
    const existing = await sqliteStorage.findAll<Customer>("customers");
    if (existing && existing.length > 0) {
      return;
    }

    const sampleCustomers: Customer[] = [
      {
        id: "cust_1",
        customer_code: "CUST-1001",
        name: "Ravi Kumar",
        phone: "9876543210",
        phones: ["9876543211"],
        gstin: "32AABCU9603R1ZM",
        address: "12/4 Cross Road, Palakkad",
        place_of_supply: "32-Kerala",
        outstanding_balance: 1250,
        credit_limit: 5000,
        default_discount_percent: 5,
        is_active: true,
      },
      {
        id: "cust_2",
        customer_code: "CUST-1002",
        name: "Priya Menon",
        phone: "9847012345",
        address: "Green Valley Apartments, Fort Road, Palakkad",
        outstanding_balance: 0,
        credit_limit: 2000,
        is_active: true,
      },
      {
        id: "cust_3",
        customer_code: "CUST-1003",
        name: "Dr. Ananya Sharma",
        phone: "9447123456",
        gstin: "32AAAAA0000A1Z5",
        address: "City Clinic, Main Junction, Palakkad",
        outstanding_balance: 6200,
        credit_limit: 5000, // Exceeds limit
        default_discount_percent: 10,
        is_active: true,
      },
      {
        id: "cust_4",
        customer_code: "CUST-1004",
        name: "Suresh Pillai",
        phone: "9745678901",
        address: "Kallekkad, Palakkad",
        outstanding_balance: 450,
        credit_limit: 3000,
        is_active: true,
      },
      {
        id: "cust_5",
        customer_code: "CUST-1005",
        name: "City Medicals & Healthcare",
        phone: "9895112233",
        gstin: "32AAACB2212Q1ZX",
        address: "Market Road, Palakkad",
        place_of_supply: "32-Kerala",
        outstanding_balance: 15400,
        credit_limit: 50000,
        default_discount_percent: 12,
        is_active: true,
      },
    ];

    for (const c of sampleCustomers) {
      await this.upsertCustomer(c);
    }
  }

  async upsertSupplier(supplier: Supplier): Promise<void> {
    await sqliteStorage.insertRecord("suppliers", supplier.id, supplier as unknown as Record<string, unknown>);
  }

  async getSupplierById(id: string): Promise<Supplier | null> {
    return await sqliteStorage.findById<Supplier>("suppliers", id);
  }

  async upsertDoctor(doctor: Doctor): Promise<void> {
    await sqliteStorage.insertRecord("doctors", doctor.id, doctor as unknown as Record<string, unknown>);
  }

  async getDoctorById(id: string): Promise<Doctor | null> {
    return await sqliteStorage.findById<Doctor>("doctors", id);
  }

  async upsertPatient(patient: Patient): Promise<void> {
    await sqliteStorage.insertRecord("patients", patient.id, patient as unknown as Record<string, unknown>);
  }

  async getPatientById(id: string): Promise<Patient | null> {
    return await sqliteStorage.findById<Patient>("patients", id);
  }

  async upsertParty(party: PartyMaster): Promise<void> {
    if (party.type === "supplier") {
      await this.upsertSupplier({
        id: party.id,
        name: party.name,
        phone: party.phone,
        gstin: party.gstin,
        address: party.address,
        credit_period_days: party.credit_period_days,
        opening_balance: party.opening_balance,
        is_active: party.is_active ?? true,
      });
    } else if (party.type === "doctor") {
      await this.upsertDoctor({
        id: party.id,
        name: party.name,
        medical_reg_no: party.medical_reg_no || "",
        clinic_name: party.clinic_name,
        phone: party.phone,
      });
    } else if (party.type === "patient") {
      await this.upsertPatient({
        id: party.id,
        name: party.name,
        age: party.age,
        gender: party.gender,
        phone: party.phone,
      });
    } else {
      await this.upsertCustomer({
        id: party.id,
        name: party.name,
        phone: party.phone || "",
        phones: party.phones,
        gstin: party.gstin,
        address: party.address,
        outstanding_balance: party.outstanding_balance,
        credit_limit: party.credit_limit,
        is_active: party.is_active ?? true,
      });
    }

    try {
      await syncQueueService.enqueue("party", party.id, "update", party as unknown as Record<string, unknown>);
    } catch (_) {}
  }

  async deleteParty(id: string, type: "customer" | "supplier" | "doctor" | "patient" = "customer"): Promise<boolean> {
    const table = type === "customer" ? "customers" : type === "supplier" ? "suppliers" : type === "doctor" ? "doctors" : "patients";
    const res = await sqliteStorage.deleteRecord(table, id);
    try {
      await syncQueueService.enqueue("party", id, "delete", { id, type });
    } catch (_) {}
    return res;
  }

  async getAllParties(): Promise<PartyMaster[]> {
    const customers = await sqliteStorage.findAll<Customer>("customers");
    const suppliers = await sqliteStorage.findAll<Supplier>("suppliers");
    const doctors = await sqliteStorage.findAll<Doctor>("doctors");
    const patients = await sqliteStorage.findAll<Patient>("patients");

    return [
      ...customers.map((c) => ({ ...c, type: "customer" as const })),
      ...suppliers.map((s) => ({ ...s, type: "supplier" as const })),
      ...doctors.map((d) => ({ ...d, type: "doctor" as const })),
      ...patients.map((p) => ({ ...p, type: "patient" as const })),
    ];
  }
}

export const partiesStore = new PartiesStore();
