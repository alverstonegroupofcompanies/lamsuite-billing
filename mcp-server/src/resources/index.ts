import type { LamSuiteApiClient } from "../client/apiClient.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (client: LamSuiteApiClient) => Promise<string>;
}

export const STORE_RESOURCES: ResourceDefinition[] = [
  {
    uri: "lamsuite://store/profile",
    name: "LamSuite Store Profile & Settings",
    description: "Store name, GSTIN, drug licenses, address, and billing tax preferences.",
    mimeType: "application/json",
    handler: async (client) => {
      const store = await client.getStore();
      return JSON.stringify(store, null, 2);
    },
  },
  {
    uri: "lamsuite://tax/hsn-master",
    name: "GST & HSN Master Classification",
    description: "Standard Indian GST tax slabs and pharmaceutical HSN/SAC codes.",
    mimeType: "application/json",
    handler: async () => {
      return JSON.stringify(
        {
          tax_slabs: [
            { rate: 0, description: "Exempt goods (e.g. life saving human blood)" },
            { rate: 5, description: "Essential life-saving formulations, vaccines, oral rehydration" },
            { rate: 12, description: "Standard pharmaceutical medicines, antibiotics, analgesics" },
            { rate: 18, description: "Disinfectants, medicated shampoos, health supplements" },
            { rate: 28, description: "Luxury goods, certain cosmetics" },
          ],
          pharma_hsn_codes: [
            { hsn: "3004", description: "Medicaments consisting of mixed or unmixed products for therapeutic use" },
            { hsn: "30049099", description: "Other allopathic medicaments and tablets" },
            { hsn: "3006", description: "Pharmaceutical goods like sterile surgical catgut" },
            { hsn: "9018", description: "Medical, surgical, dental instruments" },
          ],
        },
        null,
        2
      );
    },
  },
  {
    uri: "lamsuite://payment-modes",
    name: "Payment Modes & Tenders",
    description: "Active tender modes for POS billing and reconciliation.",
    mimeType: "application/json",
    handler: async () => {
      return JSON.stringify(
        {
          supported_modes: [
            { code: "Cash", name: "Physical Cash", requires_tender_entry: true },
            { code: "UPI", name: "Unified Payments Interface (QR / VPA)", digital: true },
            { code: "Card", name: "Credit / Debit POS Card Terminal", digital: true },
            { code: "Credit", name: "Customer Credit Ledger", requires_registered_customer: true },
            { code: "Bank Transfer", name: "NEFT / RTGS / IMPS", for_b2b: true },
            { code: "Cheque", name: "Bank Cheque", clearing_required: true },
          ],
        },
        null,
        2
      );
    },
  },
  {
    uri: "lamsuite://sequences",
    name: "Document Number Sequences",
    description: "Configured document numbering prefixes and current counters.",
    mimeType: "application/json",
    handler: async (client) => {
      const store = await client.getStore();
      return JSON.stringify(
        {
          store_code: store.code,
          invoice_prefix: store.invoice_prefix || "INV",
          sales_return_prefix: "CN",
          purchase_return_prefix: "DN",
          purchase_order_prefix: "PO",
        },
        null,
        2
      );
    },
  },
];
