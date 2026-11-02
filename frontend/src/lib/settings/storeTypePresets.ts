/**
 * LamSuite Store Type Presets & Feature Scoping Engine
 * 
 * Configures sensible defaults for different retail/wholesale domains.
 * Clinical fields (Doctor, Patient, Prescription, Schedule H) are strictly
 * scoped to 'pharmacy' only.
 */

export type StoreType =
  | "pharmacy"
  | "cosmetics"
  | "kirana_general"
  | "clothing"
  | "electronics"
  | "stationery"
  | "wholesale"
  | "restaurant"
  | "other";

export interface StoreTypePreset {
  id: StoreType;
  label: string;
  description: string;
  productTerm: string; // e.g. "Medicine" for pharmacy, "Product" or "Item" for others
  customerTerm: string; // "Patient / Customer" vs "Customer"
  supportsBatches: boolean;
  supportsExpiry: boolean;
  supportsSerialNumbers: boolean;
  supportsSizesColors: boolean;
  supportsPackLoose: boolean;
  supportsTradeRates: boolean; // PTR, PTS, PTSS
  supportsClinical: boolean; // Doctor, Patient, Schedule H (STRICTLY pharmacy only)
  defaultTaxMode: "inclusive" | "exclusive";
  defaultColumns: string[];
  defaultTerms: string;
}

export const STORE_TYPE_PRESETS: Record<StoreType, StoreTypePreset> = {
  pharmacy: {
    id: "pharmacy",
    label: "Pharmacy & Chemists",
    description: "Retail pharmacy with batch/expiry tracking, FEFO dispensing, prescription management, and statutory Schedule H registers.",
    productTerm: "Medicine",
    customerTerm: "Customer",
    supportsBatches: true,
    supportsExpiry: true,
    supportsSerialNumbers: false,
    supportsSizesColors: false,
    supportsPackLoose: true,
    supportsTradeRates: true,
    supportsClinical: true, // Only pharmacy
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "batch_no", "expiry_date", "pack_qty", "loose_qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Goods once sold will be taken back only within 7 days with cash memo.\n2. Refrigerated medicines are strictly non-returnable.\n3. Prescriptions are mandatory for Schedule H & H1 drugs.",
  },
  cosmetics: {
    id: "cosmetics",
    label: "Cosmetics & Beauty",
    description: "Beauty stores, cosmetics, skincare and perfumes with batch/shade tracking and expiry management.",
    productTerm: "Product",
    customerTerm: "Customer",
    supportsBatches: true,
    supportsExpiry: true,
    supportsSerialNumbers: false,
    supportsSizesColors: true,
    supportsPackLoose: false,
    supportsTradeRates: false,
    supportsClinical: false,
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "batch_no", "expiry_date", "qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Unopened cosmetics can be returned within 3 days with original bill.\n2. Testers and sampled items are non-returnable.",
  },
  kirana_general: {
    id: "kirana_general",
    label: "General Store / Kirana / Supermarket",
    description: "Grocery, supermarket, and daily essentials retail with quick barcode checkout and multi-unit loose sales.",
    productTerm: "Item",
    customerTerm: "Customer",
    supportsBatches: false,
    supportsExpiry: false,
    supportsSerialNumbers: false,
    supportsSizesColors: false,
    supportsPackLoose: true,
    supportsTradeRates: false,
    supportsClinical: false,
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "barcode", "qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Please check goods at the counter.\n2. Perishables cannot be returned.\n3. Keep cash memo for warranty and returns.",
  },
  clothing: {
    id: "clothing",
    label: "Clothing & Footwear",
    description: "Apparel, garments, and shoe stores with matrix sizing (S/M/L/XL), color variations, and seasonal collections.",
    productTerm: "Item",
    customerTerm: "Customer",
    supportsBatches: false,
    supportsExpiry: false,
    supportsSerialNumbers: false,
    supportsSizesColors: true,
    supportsPackLoose: false,
    supportsTradeRates: false,
    supportsClinical: false,
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "size", "color", "qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Exchange allowed within 7 days with price tag and original invoice intact.\n2. No cash refunds.",
  },
  electronics: {
    id: "electronics",
    label: "Electronics & Mobile Store",
    description: "Consumer electronics, smartphones, and IT accessories with IMEI/serial number tracking and warranty cards.",
    productTerm: "Item",
    customerTerm: "Customer",
    supportsBatches: false,
    supportsExpiry: false,
    supportsSerialNumbers: true,
    supportsSizesColors: false,
    supportsPackLoose: false,
    supportsTradeRates: false,
    supportsClinical: false,
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "serial_number", "qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Manufacturer warranty applies as per brand policy.\n2. Physical or water damage voids warranty.\n3. Goods sold are non-refundable.",
  },
  stationery: {
    id: "stationery",
    label: "Stationery & Books",
    description: "Bookstores, office supplies, school stationery, and printing services.",
    productTerm: "Item",
    customerTerm: "Customer",
    supportsBatches: false,
    supportsExpiry: false,
    supportsSerialNumbers: false,
    supportsSizesColors: false,
    supportsPackLoose: true,
    supportsTradeRates: false,
    supportsClinical: false,
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Books and stationery items once sold cannot be returned without prior authorization.\n2. Photocopies and printouts are non-refundable.",
  },
  wholesale: {
    id: "wholesale",
    label: "Wholesale & Distributor",
    description: "B2B trading, bulk supply, case packing, trade margins (PTR/PTS), and GST B2B e-invoicing.",
    productTerm: "Product",
    customerTerm: "Buyer / Trade Client",
    supportsBatches: true,
    supportsExpiry: true,
    supportsSerialNumbers: false,
    supportsSizesColors: false,
    supportsPackLoose: true,
    supportsTradeRates: true,
    supportsClinical: false,
    defaultTaxMode: "exclusive",
    defaultColumns: ["product_name", "hsn_code", "batch_no", "expiry_date", "pack_qty", "free_qty", "unit_price", "ptr", "pts", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Payment due within agreed credit period.\n2. Interest @ 18% p.a. charged on overdue bills.\n3. Subject to local jurisdiction only.",
  },
  restaurant: {
    id: "restaurant",
    label: "Restaurant, Cafe & Bakery",
    description: "Food and beverage retail with table/takeaway billing, fresh batches, and kitchen order ticketing.",
    productTerm: "Item",
    customerTerm: "Customer",
    supportsBatches: false,
    supportsExpiry: true,
    supportsSerialNumbers: false,
    supportsSizesColors: false,
    supportsPackLoose: false,
    supportsTradeRates: false,
    supportsClinical: false,
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Food once prepared and delivered cannot be cancelled or returned.\n2. Please notify staff of food allergies before ordering.",
  },
  other: {
    id: "other",
    label: "General Retail / Other",
    description: "Standard retail business with standard GST billing and customer accounts.",
    productTerm: "Product",
    customerTerm: "Customer",
    supportsBatches: false,
    supportsExpiry: false,
    supportsSerialNumbers: false,
    supportsSizesColors: false,
    supportsPackLoose: true,
    supportsTradeRates: false,
    supportsClinical: false,
    defaultTaxMode: "inclusive",
    defaultColumns: ["product_name", "qty", "unit_price", "discount_percent", "gst_percent", "total_amount"],
    defaultTerms: "1. Thank you for shopping with us.\n2. Please retain bill for future correspondence.",
  },
};

/**
 * Returns whether clinical fields (doctor, patient, prescription, schedule H)
 * should be displayed for the given store type.
 * Rule: STRICTLY pharmacy only. No manual override toggle.
 */
export function isClinicalSupported(storeType?: string | null): boolean {
  if (!storeType) return true; // Default fallback to existing pharmacy behavior
  const clean = String(storeType).trim().toLowerCase();
  return clean === "pharmacy";
}

/**
 * Retrieve preset configuration by store type with safe fallback
 */
export function getStoreTypePreset(storeType?: string | null): StoreTypePreset {
  if (!storeType) return STORE_TYPE_PRESETS.pharmacy;
  const key = String(storeType).trim().toLowerCase() as StoreType;
  return STORE_TYPE_PRESETS[key] || STORE_TYPE_PRESETS.other;
}
