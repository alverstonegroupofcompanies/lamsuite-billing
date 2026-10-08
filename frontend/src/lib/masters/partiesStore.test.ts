import { describe, it, expect, beforeEach } from "vitest";
import {
  partiesStore,
  isValidGstin,
  isValidIndianPhone,
  type Customer,
  type Supplier,
  type Doctor,
} from "./partiesStore";
import { getMockDatabase, sqliteStorage } from "../db/sqliteStorage";

describe("PartiesStore & Statutory Validators (MST-003, MST-004, MST-005)", () => {
  beforeEach(async () => {
    getMockDatabase().reset();
    await sqliteStorage.initDatabase();
  });

  describe("Indian Statutory Format Validators", () => {
    it("validates 15-character Indian GSTIN", () => {
      // Valid sample Indian GSTIN (State 29: Karnataka, 32: Kerala)
      expect(isValidGstin("32AABCU9603R1ZM")).toBe(true);
      expect(isValidGstin("29AAACH7409R1ZZ")).toBe(true);

      // Invalid GSTINs
      expect(isValidGstin("INVALID_GST")).toBe(false);
      expect(isValidGstin("32AABCU9603R1Z")).toBe(false); // 14 chars
      expect(isValidGstin("32AABCU9603R1ZMA")).toBe(false); // 16 chars
      expect(isValidGstin("32AABCU9603R!ZM")).toBe(false); // special char
    });

    it("validates 10-digit Indian Mobile Phone Numbers", () => {
      expect(isValidIndianPhone("9876543210")).toBe(true);
      expect(isValidIndianPhone("+91 98765 43210")).toBe(true);
      expect(isValidIndianPhone("8123456789")).toBe(true);
      expect(isValidIndianPhone("7012345678")).toBe(true);
      expect(isValidIndianPhone("6234567890")).toBe(true);

      // Invalid phones
      expect(isValidIndianPhone("1234567890")).toBe(false); // starts with 1
      expect(isValidIndianPhone("98765")).toBe(false); // too short
    });
  });

  describe("Parties CRUD & Lookup", () => {
    it("finds customer by primary or secondary phone", async () => {
      const customer: Customer = {
        id: "cust_ravi",
        name: "Ravi Kumar",
        phone: "9876543210",
        phones: ["9123456780"],
        gstin: "32AABCU9603R1ZM",
        is_active: true,
      };

      await partiesStore.upsertCustomer(customer);

      const byPrimary = await partiesStore.findCustomerByPhone("9876543210");
      expect(byPrimary?.id).toBe("cust_ravi");

      const bySecondary = await partiesStore.findCustomerByPhone("+91 91234-56780");
      expect(bySecondary?.id).toBe("cust_ravi");
    });

    it("persists doctor with Medical Registration Number", async () => {
      const doctor: Doctor = {
        id: "doc_menon",
        name: "Dr. K. Menon",
        medical_reg_no: "KMC-48291",
        clinic_name: "City Health Care",
        phone: "9447123456",
      };

      await partiesStore.upsertDoctor(doctor);

      const retrieved = await partiesStore.getDoctorById("doc_menon");
      expect(retrieved?.medical_reg_no).toBe("KMC-48291");
      expect(retrieved?.clinic_name).toBe("City Health Care");
    });

    it("persists supplier with payment credit terms", async () => {
      const supplier: Supplier = {
        id: "sup_apex",
        name: "Apex Healthcare Distributors",
        phone: "9847012345",
        gstin: "32AAACA1234B1Z5",
        credit_period_days: 21,
        is_active: true,
      };

      await partiesStore.upsertSupplier(supplier);

      const retrieved = await partiesStore.getSupplierById("sup_apex");
      expect(retrieved?.credit_period_days).toBe(21);
      expect(retrieved?.name).toBe("Apex Healthcare Distributors");
    });

    it("searches customers by name, phone, customer code, and gstin with ranking", async () => {
      await partiesStore.seedSampleCustomersIfEmpty();

      // Search by name "ravi"
      const nameMatches = await partiesStore.searchCustomers("ravi");
      expect(nameMatches.length).toBeGreaterThan(0);
      expect(nameMatches[0].name).toBe("Ravi Kumar");

      // Search by phone "98470"
      const phoneMatches = await partiesStore.searchCustomers("98470");
      expect(phoneMatches.length).toBeGreaterThan(0);
      expect(phoneMatches[0].name).toBe("Priya Menon");

      // Search by GSTIN snippet "AAACB"
      const gstinMatches = await partiesStore.searchCustomers("AAACB");
      expect(gstinMatches.length).toBeGreaterThan(0);
      expect(gstinMatches[0].name).toBe("City Medicals & Healthcare");

      // Search by customer code "CUST-1003"
      const codeMatches = await partiesStore.searchCustomers("CUST-1003");
      expect(codeMatches.length).toBeGreaterThan(0);
      expect(codeMatches[0].name).toBe("Dr. Ananya Sharma");
    });

    it("creates new customer with quickCreateCustomer and prevents phone duplicate", async () => {
      const newCust = await partiesStore.quickCreateCustomer({
        name: "Anoop Varma",
        phone: "9895001122",
        gstin: "32AABCA1234A1Z1",
        credit_limit: 10000,
      });

      expect(newCust.id).toBeDefined();
      expect(newCust.name).toBe("Anoop Varma");
      expect(newCust.phone).toBe("9895001122");

      // If called again with the same phone, returns the existing record
      const duplicate = await partiesStore.quickCreateCustomer({
        name: "Anoop Varma (Duplicate Attempt)",
        phone: "9895001122",
      });

      expect(duplicate.id).toBe(newCust.id);
      expect(duplicate.name).toBe("Anoop Varma");
    });
  });
});
