import { sqliteStorage } from "../db/sqliteStorage";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  phones?: string[];
  gstin?: string;
  address?: string;
  outstanding_balance?: number;
  credit_limit?: number;
  is_active: boolean;
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
    return await sqliteStorage.findById<Customer>("customers", id);
  }

  async findCustomerByPhone(phone: string): Promise<Customer | null> {
    const target = normalizeIndianPhone(phone);
    if (!target) return null;

    const all = await sqliteStorage.findAll<Customer>("customers");
    for (const c of all) {
      if (normalizeIndianPhone(c.phone) === target) return c;
      if (c.phones) {
        for (const p of c.phones) {
          if (normalizeIndianPhone(p) === target) return c;
        }
      }
    }
    return null;
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
