import type { EntityDefinition } from "../types";
import { sqliteStorage } from "../../../db/sqliteStorage";
import { normalizeIndianPhone } from "../../../masters/partiesStore";

export const customerOpeningBalancesDefinition: EntityDefinition = {
  id: "customer_opening_balances",
  label: "Customer Opening Balances",
  singularLabel: "Customer Balance",
  category: "finance",
  description: "Initial receivables owed by customers to migrate past udhari khata balances.",
  targetTable: "party_ledger_entries",
  primaryKey: "id",
  requiredPermission: "masters:create",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "cust_phone", label: "Customer Mobile", fields: ["phone"], exactMatch: true },
  ],
  foreignKeys: [
    {
      field: "phone",
      targetEntityId: "customers",
      lookupField: "phone",
      autoCreateSupported: true,
      createPayload: (phone) => ({
        id: `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `Customer (${phone})`,
        phone,
        is_active: 1,
        created_at: Date.now(),
      }),
    },
  ],
  fields: {
    customer_name: {
      key: "customer_name",
      label: "Customer Name",
      type: "string",
      required: true,
      example: "Vinod Nair",
      description: "Customer account name",
      aliases: ["customer", "party_name", "name"],
    },
    phone: {
      key: "phone",
      label: "Mobile Number (10 Digits)",
      type: "string",
      required: true,
      example: "9847123456",
      description: "10-digit Indian mobile number",
      aliases: ["phone", "mobile", "contact"],
    },
    opening_balance: {
      key: "opening_balance",
      label: "Opening Debit Balance Owed (₹)",
      type: "currency",
      required: true,
      example: 3500.0,
      description: "Amount customer owes the store",
      aliases: ["balance", "amount", "debit_balance", "opening_balance", "due"],
      min: 0,
    },
    as_of_date: {
      key: "as_of_date",
      label: "As of Date (DD-MM-YYYY)",
      type: "date",
      required: false,
      example: "01-04-2026",
      description: "Opening balance effective financial year date",
      aliases: ["date", "as_of_date"],
    },
  },
  sampleRows: [
    {
      customer_name: "Vinod Nair",
      phone: "9847123456",
      opening_balance: 3500.0,
      as_of_date: "01-04-2026",
    },
  ],
  postImportHook: async (records) => {
    const now = Date.now();
    for (const rec of records) {
      const cust = await sqliteStorage.findByField<any>("customers", "phone", rec.phone);
      if (cust) {
        // Update customer outstanding balance
        await sqliteStorage.updateRecord("customers", cust.id, {
          outstanding_balance: Number(rec.opening_balance || 0),
        });

        // Insert ledger record
        const ledgerId = `ple_op_${now}_${Math.random().toString(36).slice(2, 6)}`;
        await sqliteStorage.insertRecord("party_ledger_entries", ledgerId, {
          id: ledgerId,
          party_id: cust.id,
          party_type: "customer",
          entry_date: rec.as_of_date || new Date().toISOString().slice(0, 10),
          reference_type: "opening_balance",
          reference_id: cust.id,
          reference_number: "OPENING-BAL",
          debit_amount: Number(rec.opening_balance || 0),
          credit_amount: 0,
          running_balance: Number(rec.opening_balance || 0),
          notes: "Imported Opening Receivables Balance",
          created_at: now,
        });
      }
    }
  },
  transformRow: (raw) => ({
    id: raw.id || `cob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    customer_name: String(raw.customer_name || "").trim(),
    phone: normalizeIndianPhone(String(raw.phone || "")),
    opening_balance: Number(raw.opening_balance || 0),
    as_of_date: String(raw.as_of_date || "").trim(),
  }),
  exportQuery: async () => {
    const customers = await sqliteStorage.findAll<any>("customers");
    return customers
      .filter((c) => Number(c.outstanding_balance || 0) > 0)
      .map((c) => ({
        customer_name: c.name,
        phone: c.phone,
        opening_balance: c.outstanding_balance,
      }));
  },
};

export const supplierOpeningBalancesDefinition: EntityDefinition = {
  id: "supplier_opening_balances",
  label: "Supplier Opening Balances",
  singularLabel: "Supplier Balance",
  category: "finance",
  description: "Initial payables owed to vendors to establish procurement credit balances.",
  targetTable: "party_ledger_entries",
  primaryKey: "id",
  requiredPermission: "masters:create",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "supp_name", label: "Supplier Name", fields: ["supplier_name"], exactMatch: false },
  ],
  fields: {
    supplier_name: {
      key: "supplier_name",
      label: "Supplier Name",
      type: "string",
      required: true,
      example: "Apex Pharma Distributors",
      description: "Vendor entity name",
      aliases: ["supplier", "party_name", "vendor"],
    },
    gstin: {
      key: "gstin",
      label: "Supplier GSTIN",
      type: "string",
      required: false,
      example: "32ABCDE9999Z1Z4",
      description: "15-digit GSTIN",
      aliases: ["gstin", "gst_no"],
    },
    opening_balance: {
      key: "opening_balance",
      label: "Opening Balance Payable (₹)",
      type: "currency",
      required: true,
      example: 45000.0,
      description: "Credit amount owed to supplier",
      aliases: ["balance", "amount", "payable", "opening_balance"],
      min: 0,
    },
    as_of_date: {
      key: "as_of_date",
      label: "As of Date (DD-MM-YYYY)",
      type: "date",
      required: false,
      example: "01-04-2026",
      description: "Opening balance effective date",
      aliases: ["date", "as_of_date"],
    },
  },
  sampleRows: [
    {
      supplier_name: "Apex Pharma Distributors",
      gstin: "32ABCDE9999Z1Z4",
      opening_balance: 45000.0,
      as_of_date: "01-04-2026",
    },
  ],
  postImportHook: async (records) => {
    const now = Date.now();
    for (const rec of records) {
      const supp = await sqliteStorage.findByField<any>("suppliers", "name", rec.supplier_name);
      if (supp) {
        await sqliteStorage.updateRecord("suppliers", supp.id, {
          opening_balance: Number(rec.opening_balance || 0),
          outstanding_balance: Number(rec.opening_balance || 0),
        });

        const ledgerId = `ple_sup_op_${now}_${Math.random().toString(36).slice(2, 6)}`;
        await sqliteStorage.insertRecord("party_ledger_entries", ledgerId, {
          id: ledgerId,
          party_id: supp.id,
          party_type: "supplier",
          entry_date: rec.as_of_date || new Date().toISOString().slice(0, 10),
          reference_type: "opening_balance",
          reference_id: supp.id,
          reference_number: "OPENING-PAYABLE",
          debit_amount: 0,
          credit_amount: Number(rec.opening_balance || 0),
          running_balance: Number(rec.opening_balance || 0),
          notes: "Imported Opening Payables Balance",
          created_at: now,
        });
      }
    }
  },
  transformRow: (raw) => ({
    id: raw.id || `sob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    supplier_name: String(raw.supplier_name || "").trim(),
    gstin: raw.gstin ? String(raw.gstin).trim().toUpperCase() : undefined,
    opening_balance: Number(raw.opening_balance || 0),
    as_of_date: String(raw.as_of_date || "").trim(),
  }),
  exportQuery: async () => {
    const suppliers = await sqliteStorage.findAll<any>("suppliers");
    return suppliers
      .filter((s) => Number(s.outstanding_balance || s.opening_balance || 0) > 0)
      .map((s) => ({
        supplier_name: s.name,
        gstin: s.gstin,
        opening_balance: s.outstanding_balance || s.opening_balance,
      }));
  },
};
