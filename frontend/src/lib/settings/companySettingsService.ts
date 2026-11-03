import { sqliteStorage } from "../db/sqliteStorage";

const memoryFallbackStorage = new Map<string, string>();

const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.getItem === "function") {
        return window.localStorage.getItem(key);
      }
      if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
        return localStorage.getItem(key);
      }
    } catch (_) {}
    return memoryFallbackStorage.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.setItem === "function") {
        window.localStorage.setItem(key, value);
        return;
      }
      if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
        localStorage.setItem(key, value);
        return;
      }
    } catch (_) {}
    memoryFallbackStorage.set(key, value);
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.removeItem === "function") {
        window.localStorage.removeItem(key);
        return;
      }
      if (typeof localStorage !== "undefined" && typeof localStorage.removeItem === "function") {
        localStorage.removeItem(key);
        return;
      }
    } catch (_) {}
    memoryFallbackStorage.delete(key);
  },
};

export interface ColumnSetting {
  id: string;
  label: string;
  visible: boolean;
  width?: number; // width in pixels or flex
  order: number;
  required?: boolean; // If true, cannot be hidden (e.g. product, qty, total)
}

export interface HeaderFieldSetting {
  id: string;
  label: string;
  visible: boolean;
  required?: boolean;
  order: number;
}

export interface BillingScreenPreset {
  id: string;
  name: string;
  description: string;
  isBuiltin?: boolean;
  columns: ColumnSetting[];
  headerFields: HeaderFieldSetting[];
}

export interface DocumentSequenceConfig {
  invoicePrefix: string;
  nextInvoiceNumber: number;
  returnPrefix: string;
  nextReturnNumber: number;
  purchaseReturnPrefix?: string;
  nextPurchaseReturnNumber?: number;
  purchasePrefix: string;
  nextPurchaseNumber: number;
  quotationPrefix: string;
  nextQuotationNumber: number;
  adjustmentPrefix: string;
  nextAdjustmentNumber: number;
  transferPrefix: string;
  nextTransferNumber: number;
}

export interface PrintingConfig {
  paperSize:
    | "thermal_80mm"
    | "thermal_58mm"
    | "a4"
    | "a5"
    | "half_a4"
    | "dot_matrix_6in"
    | "dot_matrix_10in"
    | "dot_matrix_80col"
    | "dot_matrix_12in"
    | "dot_matrix_120col"
    | "dot_matrix_15in"
    | "dot_matrix_132col";
  copies: number;
  activeTemplate: "thermal_standard" | "thermal_compact" | "a4_tax_invoice" | "hospital_detailed";
  footerNote: string;
  termsAndConditions: string;
  jurisdictionNote: string;
  brandByline: string;
  printDrugLicenses: boolean;
  printDoctorDetails: boolean;
  printPatientDetails: boolean;
  printUpiQrCode: boolean;
  printHsnSummary: boolean;
  printDiscountColumn: boolean;
  printMrp: boolean;
  previewMode: "always" | "skip_thermal" | "never";
  defaultCopyMarker?: string;
  silentPrinting: boolean;
  selectedPrinterName?: string;
  dotMatrixEndOfJob?: "stop_immediately" | "feed_tear_off" | "form_feed";
  dotMatrixTearOffFeedLines?: number;
  dotMatrixPageLength?: 66 | 72 | 33 | "continuous";
  dotMatrixCommandSet?: "esc_p" | "tvs_native" | "plain_ascii";
  dotMatrixDefaultPaperWidth?: "6in" | "10in" | "12in" | "15in";
  dotMatrixCarriageWidth?: 80 | 120 | 132 | 136;
  dotMatrixAutoCenter?: boolean;
}

export interface WorkspaceSettings {
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable";
  fontSize: "sm" | "base" | "lg";
  notificationsEnabled: boolean;
  autoUpdateCheck: boolean;
  wifiStrengthSimulator: number; // 0 - 100%
  defaultLandingPage?: "dashboard" | "pos" | "bills" | "stock" | "purchases";
}

export interface InventoryStockSettings {
  allowSellingOutOfStock: "always" | "ask" | "never";
  warnOnNegativeStock: boolean;
  requireManagerPinForNegativeStock: boolean;
  allowExpiredBatchSale: "warn_confirm" | "block";
}

export interface SecurityConfig {
  idleTimeoutMinutes: number;
  maxFailedLogins: number;
  allowBiometricSignIn: boolean;
  defaultRole: "cashier" | "pharmacist" | "store_manager" | "admin";
}

export interface WalletConfig {
  enabled: boolean;
  maxCreditLimit: number;
  referencePrefix: string;
}

export interface EmailSmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  encryption: "tls" | "ssl" | "none";
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  username?: string;
  password?: string;
}

export interface WhatsAppConfig {
  enabled: boolean;
  provider: "openwa" | "manual_link";
  apiUrl: string;            // Default: "https://wa-api.alverstone.in"
  apiKey: string;            // OpenWA API key
  sessionId: string;         // Default: "default"
  sendPdfInvoice: boolean;   // Attach generated PDF
  autoSendOnBillSave: boolean; // Auto-send when phone is entered
  customCaption?: string;
}

export interface BillingKeyboardSettings {
  enterAfterQty: "search" | "next_column" | "next_row";
  autoFocusQtyAfterAdd: boolean;
  selectAllOnFocus: boolean;
  quickDeleteWithoutConfirm: boolean;
  scannerSpeedThresholdMs: number;
  productEntryStyle?: "inline_row" | "search_bar";
  entryRowPosition?: "bottom" | "top";
  addLineMode?: "immediate" | "after_enter";
  keyBindings?: Record<string, string>;
}

export type ReferenceRequirement = "off" | "optional" | "required";

export interface PaymentModeConfig {
  id: string;
  name: string;
  enabled: boolean;
  referenceRequirement: ReferenceRequirement;
  referenceLabel: string;
  referencePlaceholder?: string;
  referenceRegex?: string;
  referenceMinLength?: number;
  referenceMaxLength?: number;
  duplicateCheck: "off" | "warn" | "block";
  extraFields: {
    payerVpa?: boolean;
    cardNetwork?: boolean;
    cardLastFour?: boolean;
    bankName?: boolean;
    chequeDate?: boolean;
    notes?: boolean;
  };
}

export interface StoreUpiAccount {
  id: string;
  upiId: string;
  payeeName: string;
  merchantCode?: string;
  qrSubtext?: string;
  isDefault: boolean;
  counterOverrides?: string[];
}

export interface UpiSettingsConfig {
  enabled: boolean;
  showInSettlement: boolean;
  showOnPrintedBills: boolean;
  qrSubtext: string;
  accounts: StoreUpiAccount[];
  defaultUpiId?: string;
  defaultPayeeName?: string;
}

export function validateUpiId(vpa: string): boolean {
  if (!vpa || typeof vpa !== "string") return false;
  const clean = vpa.trim();
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(clean);
}

export interface PaymentSettingsConfig {
  modes: PaymentModeConfig[];
  upiVpa?: string;
  upiPayeeName?: string;
  enableDynamicUpiQr: boolean;
  enableQuickDenominations: boolean;
  creditPolicy: "allow_with_limit" | "warn_on_exceed" | "block_on_exceed";
  printShowReferences: boolean;
  upi?: UpiSettingsConfig;
}

export interface CompanySettings {
  store_id: string;
  store_name: string;
  display_name?: string;
  phone: string;
  email?: string;
  address: string;
  state_code: string;
  gstin?: string;
  drug_license_numbers?: string[];
  fssai_no?: string;
  currency_symbol: string;

  // Store & Tax Configuration
  store_type?: "pharmacy" | "cosmetics" | "kirana_general" | "clothing" | "electronics" | "stationery" | "wholesale" | "restaurant" | "other";
  gst_type: "regular" | "composition" | "no_tax";
  allow_tax_override_per_bill?: boolean;

  // Billing
  tax_mode: "inclusive" | "exclusive";
  purchase_tax_mode: "inclusive" | "exclusive";
  default_hsn_code: string;
  credit_period_days: number;
  default_discount_percent: number;
  default_payment_mode: "cash" | "upi" | "card" | "credit" | "split";
  round_off_enabled: boolean;
  default_rate_basis: "sel_rate" | "mrp" | "ptr" | "pts" | "ptss";

  // Sequences
  sequences: DocumentSequenceConfig;
  invoice_prefix: string; // legacy shortcut
  next_invoice_number: number; // legacy shortcut

  // Sub-configs
  printing: PrintingConfig;
  workspace: WorkspaceSettings;
  security: SecurityConfig;
  inventory: InventoryStockSettings;
  wallet: WalletConfig;
  smtp: EmailSmtpConfig;
  whatsapp: WhatsAppConfig;
  keyboard: BillingKeyboardSettings;
  payments: PaymentSettingsConfig;
  invoice_columns: ColumnSetting[];
  header_fields: HeaderFieldSetting[];
  active_billing_preset: string;
  saved_billing_presets: BillingScreenPreset[];

  // Purchase Inward screen columns & layouts
  enable_pts?: boolean;
  enable_ptss?: boolean;
  freight_is_taxable?: boolean;
  purchase_columns?: ColumnSetting[];
  purchase_header_fields?: HeaderFieldSetting[];
  active_purchase_preset?: string;
  saved_purchase_presets?: BillingScreenPreset[];

  enabled_menu_items: string[];
  is_active?: boolean;
}

export const DEFAULT_COLUMNS: ColumnSetting[] = [
  { id: "idx", label: "#", visible: true, width: 40, order: 1, required: true },
  { id: "product_name", label: "Product Name", visible: true, width: 260, order: 2, required: true },
  { id: "batch_no", label: "Batch", visible: true, width: 110, order: 3 },
  { id: "expiry_date", label: "Expiry", visible: true, width: 95, order: 4 },
  { id: "qty", label: "Quantity", visible: true, width: 175, order: 5, required: true },
  { id: "mrp", label: "MRP (₹)", visible: true, width: 85, order: 6 },
  { id: "rate", label: "Rate (₹)", visible: true, width: 85, order: 7 },
  { id: "discount", label: "Disc %", visible: true, width: 75, order: 8 },
  { id: "gst", label: "GST %", visible: true, width: 75, order: 9 },
  { id: "hsn", label: "HSN/SAC", visible: false, width: 90, order: 10 },
  { id: "free_qty", label: "Free Qty", visible: false, width: 75, order: 11 },
  { id: "rack_shelf", label: "Rack/Shelf", visible: false, width: 90, order: 12 },
  { id: "current_stock", label: "Stock", visible: false, width: 80, order: 13 },
  { id: "total", label: "Total (₹)", visible: true, width: 100, order: 14, required: true },
  { id: "actions", label: "Action", visible: true, width: 60, order: 15, required: true },
];

export const DEFAULT_HEADER_FIELDS: HeaderFieldSetting[] = [
  { id: "invoice_no", label: "Invoice No", visible: true, required: true, order: 1 },
  { id: "customer_name", label: "Customer Name", visible: true, required: true, order: 2 },
  { id: "customer_phone", label: "Mobile Number", visible: true, order: 3 },
  { id: "customer_gstin", label: "Customer GSTIN", visible: false, order: 4 },
  { id: "doctor", label: "Doctor Details", visible: true, order: 5 },
  { id: "patient", label: "Patient Details", visible: true, order: 6 },
  { id: "payment_mode", label: "Payment Mode", visible: true, order: 7 },
  { id: "salesman", label: "Salesman / Staff", visible: false, order: 8 },
  { id: "notes", label: "Bill Notes / Remarks", visible: false, order: 9 },
];

export const BUILTIN_BILLING_PRESETS: BillingScreenPreset[] = [
  {
    id: "pharmacy",
    name: "Pharmacy",
    description: "Complete clinical billing with Batch, Expiry, Pack+Loose units, Doctor, and Patient details.",
    isBuiltin: true,
    columns: DEFAULT_COLUMNS.map((c) => ({
      ...c,
      visible: ["idx", "product_name", "batch_no", "expiry_date", "qty", "mrp", "rate", "discount", "gst", "total", "actions"].includes(c.id),
    })),
    headerFields: DEFAULT_HEADER_FIELDS.map((h) => ({
      ...h,
      visible: ["invoice_no", "customer_name", "customer_phone", "doctor", "patient", "payment_mode"].includes(h.id),
    })),
  },
  {
    id: "retail",
    name: "Retail",
    description: "Standard retail counter layout with Product, Qty, MRP, Rate, Discount, and GST.",
    isBuiltin: true,
    columns: DEFAULT_COLUMNS.map((c) => ({
      ...c,
      visible: ["idx", "product_name", "qty", "mrp", "rate", "discount", "gst", "total", "actions"].includes(c.id),
    })),
    headerFields: DEFAULT_HEADER_FIELDS.map((h) => ({
      ...h,
      visible: ["invoice_no", "customer_name", "customer_phone", "payment_mode"].includes(h.id),
    })),
  },
  {
    id: "fast_counter",
    name: "Fast Counter (Minimal)",
    description: "Streamlined ultra-fast checkout showing only Product, Qty, Rate, and Net Total.",
    isBuiltin: true,
    columns: DEFAULT_COLUMNS.map((c) => ({
      ...c,
      visible: ["idx", "product_name", "qty", "rate", "total", "actions"].includes(c.id),
    })),
    headerFields: DEFAULT_HEADER_FIELDS.map((h) => ({
      ...h,
      visible: ["invoice_no", "customer_name", "payment_mode"].includes(h.id),
    })),
  },
];

export const DEFAULT_PURCHASE_COLUMNS: ColumnSetting[] = [
  { id: "idx", label: "#", visible: true, width: 40, order: 1, required: true },
  { id: "product_name", label: "Product", visible: true, width: 240, order: 2, required: true },
  { id: "batch_no", label: "Batch", visible: true, width: 105, order: 3, required: true },
  { id: "expiry_date", label: "Expiry (MM/YY)", visible: true, width: 95, order: 4, required: true },
  { id: "qty", label: "Quantity", visible: true, width: 140, order: 5, required: true },
  { id: "free_qty", label: "Free Qty", visible: true, width: 80, order: 6 },
  { id: "mrp", label: "MRP (₹)", visible: true, width: 85, order: 7 },
  { id: "ptr", label: "PTR (₹)", visible: false, width: 80, order: 8 },
  { id: "pts", label: "PTS (₹)", visible: false, width: 80, order: 9 },
  { id: "ptss", label: "PTSS (₹)", visible: false, width: 80, order: 10 },
  { id: "purchase_rate", label: "Pur. Rate (₹)", visible: true, width: 95, order: 11, required: true },
  { id: "discount", label: "Disc %", visible: true, width: 75, order: 12 },
  { id: "discount_amount", label: "Disc (₹)", visible: false, width: 75, order: 13 },
  { id: "scheme", label: "Scheme", visible: false, width: 75, order: 14 },
  { id: "gst", label: "GST %", visible: true, width: 70, order: 15 },
  { id: "hsn", label: "HSN", visible: false, width: 85, order: 16 },
  { id: "selling_rate", label: "Selling Rate (₹)", visible: true, width: 95, order: 17 },
  { id: "margin", label: "Margin %", visible: true, width: 80, order: 18 },
  { id: "taxable_value", label: "Taxable (₹)", visible: true, width: 90, order: 19 },
  { id: "tax", label: "Tax (₹)", visible: true, width: 85, order: 20 },
  { id: "total", label: "Total (₹)", visible: true, width: 100, order: 21, required: true },
  { id: "actions", label: "Action", visible: true, width: 60, order: 22, required: true },
];

export const DEFAULT_PURCHASE_HEADER_FIELDS: HeaderFieldSetting[] = [
  { id: "entry_no", label: "Entry No", visible: true, required: true, order: 1 },
  { id: "supplier", label: "Supplier", visible: true, required: true, order: 2 },
  { id: "supplier_bill_no", label: "Supplier Bill No", visible: true, required: true, order: 3 },
  { id: "bill_date", label: "Bill Date", visible: true, required: true, order: 4 },
  { id: "received_date", label: "Received Date", visible: true, order: 5 },
  { id: "purchase_type", label: "Purchase Type", visible: true, order: 6 },
  { id: "due_date", label: "Due Date", visible: true, order: 7 },
  { id: "place_of_supply", label: "Place of Supply / GST", visible: true, order: 8 },
  { id: "po_grn_link", label: "Link PO / GRN", visible: true, order: 9 },
  { id: "remarks", label: "Remarks", visible: true, order: 10 },
];

export const BUILTIN_PURCHASE_PRESETS: BillingScreenPreset[] = [
  {
    id: "pharmacy_inward",
    name: "Pharmacy Inward (Complete)",
    description: "Full clinical inward with Batch, Expiry, Pack/Loose, Free Qty, MRP, Purchase Rate, Margins & GST.",
    isBuiltin: true,
    columns: DEFAULT_PURCHASE_COLUMNS.map((c) => ({
      ...c,
      visible: ["idx", "product_name", "batch_no", "expiry_date", "qty", "free_qty", "mrp", "purchase_rate", "discount", "gst", "selling_rate", "margin", "taxable_value", "total", "actions"].includes(c.id),
    })),
    headerFields: DEFAULT_PURCHASE_HEADER_FIELDS.map((h) => ({ ...h, visible: true })),
  },
  {
    id: "standard_inward",
    name: "Standard Inward",
    description: "Standard inventory receiving layout with Product, Batch, Expiry, Qty, Rate, Tax & Totals.",
    isBuiltin: true,
    columns: DEFAULT_PURCHASE_COLUMNS.map((c) => ({
      ...c,
      visible: ["idx", "product_name", "batch_no", "expiry_date", "qty", "free_qty", "mrp", "purchase_rate", "discount", "gst", "taxable_value", "tax", "total", "actions"].includes(c.id),
    })),
    headerFields: DEFAULT_PURCHASE_HEADER_FIELDS.map((h) => ({
      ...h,
      visible: ["entry_no", "supplier", "supplier_bill_no", "bill_date", "purchase_type", "due_date", "place_of_supply"].includes(h.id),
    })),
  },
  {
    id: "price_margin",
    name: "Pricing & Trade Margin",
    description: "Focus on MRP, PTR, PTS, Purchase Rate, Selling Rate, and Margin analysis.",
    isBuiltin: true,
    columns: DEFAULT_PURCHASE_COLUMNS.map((c) => ({
      ...c,
      visible: ["idx", "product_name", "batch_no", "expiry_date", "qty", "mrp", "ptr", "pts", "purchase_rate", "selling_rate", "margin", "total", "actions"].includes(c.id),
    })),
    headerFields: DEFAULT_PURCHASE_HEADER_FIELDS.map((h) => ({ ...h, visible: true })),
  },
  {
    id: "fast_wholesale",
    name: "Fast Wholesale (Minimal)",
    description: "Minimalist ultra-fast receiving showing only Product, Batch, Expiry, Qty, Rate, and Net Total.",
    isBuiltin: true,
    columns: DEFAULT_PURCHASE_COLUMNS.map((c) => ({
      ...c,
      visible: ["idx", "product_name", "batch_no", "expiry_date", "qty", "purchase_rate", "gst", "total", "actions"].includes(c.id),
    })),
    headerFields: DEFAULT_PURCHASE_HEADER_FIELDS.map((h) => ({
      ...h,
      visible: ["entry_no", "supplier", "supplier_bill_no", "bill_date", "purchase_type"].includes(h.id),
    })),
  },
];

export const DEFAULT_PAYMENT_MODES: PaymentModeConfig[] = [
  {
    id: "cash",
    name: "Cash",
    enabled: true,
    referenceRequirement: "off",
    referenceLabel: "N/A",
    duplicateCheck: "off",
    extraFields: { notes: true },
  },
  {
    id: "upi",
    name: "UPI",
    enabled: true,
    referenceRequirement: "optional",
    referenceLabel: "UPI Transaction ID / UTR",
    referencePlaceholder: "12-digit UTR or txn ID",
    referenceRegex: "^[0-9A-Za-z_-]{6,35}$",
    referenceMinLength: 6,
    referenceMaxLength: 35,
    duplicateCheck: "warn",
    extraFields: { payerVpa: true, notes: true },
  },
  {
    id: "card",
    name: "Card",
    enabled: true,
    referenceRequirement: "optional",
    referenceLabel: "Card Approval Code / Auth Code",
    referencePlaceholder: "Approval code or last 4",
    duplicateCheck: "warn",
    extraFields: { cardLastFour: true, cardNetwork: true, notes: true },
  },
  {
    id: "bank_transfer",
    name: "Bank Transfer",
    enabled: true,
    referenceRequirement: "optional",
    referenceLabel: "Bank Reference / UTR",
    referencePlaceholder: "NEFT/RTGS/IMPS ref",
    duplicateCheck: "warn",
    extraFields: { bankName: true, notes: true },
  },
  {
    id: "cheque",
    name: "Cheque",
    enabled: true,
    referenceRequirement: "required",
    referenceLabel: "Cheque Number",
    referencePlaceholder: "6-digit cheque number",
    referenceMinLength: 6,
    referenceMaxLength: 20,
    duplicateCheck: "block",
    extraFields: { bankName: true, chequeDate: true, notes: true },
  },
  {
    id: "wallet",
    name: "Wallet / Store Credit",
    enabled: true,
    referenceRequirement: "optional",
    referenceLabel: "Wallet Ref / Mobile",
    duplicateCheck: "warn",
    extraFields: { notes: true },
  },
  {
    id: "gift_voucher",
    name: "Gift Voucher",
    enabled: true,
    referenceRequirement: "required",
    referenceLabel: "Voucher Code",
    duplicateCheck: "block",
    extraFields: { notes: true },
  },
  {
    id: "credit",
    name: "Credit (Udhari)",
    enabled: true,
    referenceRequirement: "off",
    referenceLabel: "Credit Agreement Ref",
    duplicateCheck: "off",
    extraFields: { notes: true },
  },
];

export const DEFAULT_UPI_SETTINGS: UpiSettingsConfig = {
  enabled: true,
  showInSettlement: true,
  showOnPrintedBills: true,
  qrSubtext: "Scan & Pay with any UPI app",
  accounts: [],
  defaultUpiId: "",
  defaultPayeeName: "",
};

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettingsConfig = {
  modes: [...DEFAULT_PAYMENT_MODES],
  upiVpa: "",
  upiPayeeName: "",
  enableDynamicUpiQr: true,
  enableQuickDenominations: true,
  creditPolicy: "warn_on_exceed",
  printShowReferences: false,
  upi: DEFAULT_UPI_SETTINGS,
};

export const DEFAULT_SETTINGS: CompanySettings = {
  store_id: "store_main",
  store_name: "Retail Store",
  display_name: "Retail Store",
  phone: "",
  email: "",
  address: "",
  state_code: "32",
  gstin: "",
  drug_license_numbers: [],
  fssai_no: "",
  currency_symbol: "₹",

  store_type: "pharmacy",
  gst_type: "regular",
  allow_tax_override_per_bill: false,

  tax_mode: "inclusive",
  purchase_tax_mode: "exclusive",
  default_hsn_code: "30049099",
  credit_period_days: 30,
  default_discount_percent: 0,
  default_payment_mode: "cash",
  round_off_enabled: true,
  default_rate_basis: "sel_rate",

  invoice_prefix: "INV",
  next_invoice_number: 1001,
  sequences: {
    invoicePrefix: "INV",
    nextInvoiceNumber: 1001,
    returnPrefix: "SR",
    nextReturnNumber: 1,
    purchaseReturnPrefix: "PR",
    nextPurchaseReturnNumber: 1,
    purchasePrefix: "PUR",
    nextPurchaseNumber: 201,
    quotationPrefix: "QUO",
    nextQuotationNumber: 301,
    adjustmentPrefix: "ADJ",
    nextAdjustmentNumber: 401,
    transferPrefix: "TRF",
    nextTransferNumber: 501,
  },

  printing: {
    paperSize: "thermal_80mm",
    copies: 1,
    activeTemplate: "thermal_standard",
    footerNote: "Thank you for shopping with us!",
    termsAndConditions: "Goods once sold cannot be returned without original cash memo.",
    jurisdictionNote: "Subject to Local Jurisdiction only.",
    brandByline: "LamSuite Billing",
    printDrugLicenses: true,
    printDoctorDetails: true,
    printPatientDetails: true,
    printUpiQrCode: true,
    printHsnSummary: true,
    printDiscountColumn: true,
    printMrp: true,
    previewMode: "always",
    defaultCopyMarker: "Original for Recipient",
    silentPrinting: true,
    selectedPrinterName: "Default System Thermal Printer",
    dotMatrixEndOfJob: "stop_immediately",
    dotMatrixTearOffFeedLines: 0,
    dotMatrixPageLength: 66,
    dotMatrixCommandSet: "esc_p",
    dotMatrixDefaultPaperWidth: "10in",
    dotMatrixCarriageWidth: 80,
    dotMatrixAutoCenter: true,
  },

  workspace: {
    theme: "light",
    density: "comfortable",
    fontSize: "base",
    notificationsEnabled: true,
    autoUpdateCheck: true,
    wifiStrengthSimulator: 95,
    defaultLandingPage: "dashboard",
  },

  security: {
    idleTimeoutMinutes: 15,
    maxFailedLogins: 5,
    allowBiometricSignIn: true,
    defaultRole: "cashier",
  },

  inventory: {
    allowSellingOutOfStock: "always",
    warnOnNegativeStock: true,
    requireManagerPinForNegativeStock: false,
    allowExpiredBatchSale: "warn_confirm",
  },

  wallet: {
    enabled: true,
    maxCreditLimit: 10000,
    referencePrefix: "WLT",
  },

  smtp: {
    enabled: false,
    host: "smtp.mailgun.org",
    port: 587,
    encryption: "tls",
    fromEmail: "invoices@lamstone.in",
    fromName: "LamStone Billing Desk",
    replyTo: "support@lamstone.in",
  },

  whatsapp: {
    enabled: true,
    provider: "openwa",
    apiUrl: "https://wa-api.alverstone.in",
    apiKey: "",
    sessionId: "default",
    sendPdfInvoice: true,
    autoSendOnBillSave: false,
    customCaption: "",
  },

  payments: { ...DEFAULT_PAYMENT_SETTINGS },

  keyboard: {
    enterAfterQty: "search",
    autoFocusQtyAfterAdd: true,
    selectAllOnFocus: true,
    quickDeleteWithoutConfirm: true,
    scannerSpeedThresholdMs: 45,
    productEntryStyle: "inline_row",
    entryRowPosition: "bottom",
    addLineMode: "immediate",
    keyBindings: {
      focusSearch: "F1",
      checkout: "F12",
      holdBill: "F8",
      recallBill: "F9",
      findBill: "F6",
      newBill: "Ctrl+N",
      clearBill: "Ctrl+Backspace",
      deleteLine: "Delete",
      undoDelete: "Ctrl+Z",
      changeBatch: "Ctrl+B",
      toggleUnitRate: "Ctrl+U",
      editConversion: "Ctrl+E",
      editDiscount: "F2",
      editRate: "F3",
      focusCustomer: "Alt+C",
      focusMobile: "Alt+M",
      focusDoctor: "Alt+D",
      focusPatient: "Alt+P",
      columnsConfig: "Ctrl+Shift+C",
      shortcutsHelp: "?",
    },
  },

  invoice_columns: [...DEFAULT_COLUMNS],
  header_fields: [...DEFAULT_HEADER_FIELDS],
  active_billing_preset: "pharmacy",
  saved_billing_presets: [...BUILTIN_BILLING_PRESETS],

  enable_pts: false,
  enable_ptss: false,
  freight_is_taxable: false,
  purchase_columns: [...DEFAULT_PURCHASE_COLUMNS],
  purchase_header_fields: [...DEFAULT_PURCHASE_HEADER_FIELDS],
  active_purchase_preset: "pharmacy_inward",
  saved_purchase_presets: [...BUILTIN_PURCHASE_PRESETS],
  enabled_menu_items: [
    "dashboard",
    "pos",
    "bills",
    "sales_returns",
    "customer_debit_notes",
    "purchases",
    "purchase_returns",
    "stock",
    "stock_transfers",
    "reports",
    "masters",
    "import_export",
    "settings",
    "counters",
  ],
};

export class CompanySettingsService {
  private currentSettings: CompanySettings = { ...DEFAULT_SETTINGS };

  async loadSettings(): Promise<CompanySettings> {
    const record = await sqliteStorage.findById<CompanySettings>("store_settings", "active_config");
    if (record) {
      this.currentSettings = {
        ...DEFAULT_SETTINGS,
        ...record,
        sequences: { ...DEFAULT_SETTINGS.sequences, ...(record.sequences || {}) },
        printing: { ...DEFAULT_SETTINGS.printing, ...(record.printing || {}) },
        workspace: { ...DEFAULT_SETTINGS.workspace, ...(record.workspace || {}) },
        security: { ...DEFAULT_SETTINGS.security, ...(record.security || {}) },
        inventory: { ...DEFAULT_SETTINGS.inventory, ...(record.inventory || {}) },
        wallet: { ...DEFAULT_SETTINGS.wallet, ...(record.wallet || {}) },
        smtp: { ...DEFAULT_SETTINGS.smtp, ...(record.smtp || {}) },
        whatsapp: { ...DEFAULT_SETTINGS.whatsapp, ...(record.whatsapp || {}) },
        keyboard: { ...DEFAULT_SETTINGS.keyboard, ...(record.keyboard || {}) },
        payments: {
          ...DEFAULT_SETTINGS.payments,
          ...(record.payments || {}),
          modes: record.payments?.modes?.length ? record.payments.modes : [...DEFAULT_PAYMENT_MODES],
        },
        invoice_columns: record.invoice_columns?.length ? record.invoice_columns : [...DEFAULT_COLUMNS],
        header_fields: record.header_fields?.length ? record.header_fields : [...DEFAULT_HEADER_FIELDS],
        active_billing_preset: record.active_billing_preset || "pharmacy",
        saved_billing_presets: record.saved_billing_presets?.length ? record.saved_billing_presets : [...BUILTIN_BILLING_PRESETS],
        purchase_columns: record.purchase_columns?.length ? record.purchase_columns : [...DEFAULT_PURCHASE_COLUMNS],
        purchase_header_fields: record.purchase_header_fields?.length ? record.purchase_header_fields : [...DEFAULT_PURCHASE_HEADER_FIELDS],
        active_purchase_preset: record.active_purchase_preset || "pharmacy_inward",
        saved_purchase_presets: record.saved_purchase_presets?.length ? record.saved_purchase_presets : [...BUILTIN_PURCHASE_PRESETS],
        enable_pts: record.enable_pts ?? DEFAULT_SETTINGS.enable_pts,
        enable_ptss: record.enable_ptss ?? DEFAULT_SETTINGS.enable_ptss,
        freight_is_taxable: record.freight_is_taxable ?? DEFAULT_SETTINGS.freight_is_taxable,
        enabled_menu_items: record.enabled_menu_items?.length
          ? (record.enabled_menu_items.includes("import_export")
              ? record.enabled_menu_items
              : [...record.enabled_menu_items, "import_export"])
          : [...DEFAULT_SETTINGS.enabled_menu_items],
      };
    }
    return { ...this.currentSettings };
  }

  /**
   * Resolves the authoritative UPI account for a given counter code or store default.
   */
  getActiveUpi(
    counterCodeOrSettings?: string | CompanySettings,
    explicitCounterCode?: string
  ): {
    vpa: string;
    payeeName: string;
    qrSubtext: string;
    merchantCode?: string;
    showInSettlement?: boolean;
    showOnPrintedBills?: boolean;
    enabled?: boolean;
  } | null {
    let s: CompanySettings;
    let counterCode: string | undefined;

    if (typeof counterCodeOrSettings === "string") {
      counterCode = counterCodeOrSettings;
      s = this.getSettings();
    } else if (counterCodeOrSettings && typeof counterCodeOrSettings === "object") {
      s = counterCodeOrSettings;
      counterCode = explicitCounterCode;
    } else {
      s = this.getSettings();
      counterCode = explicitCounterCode;
    }

    const upiConfig = s.payments?.upi || (s as any).paymentSettings?.upi;
    if (upiConfig && upiConfig.enabled === false) {
      return null;
    }

    if (upiConfig && upiConfig.accounts && upiConfig.accounts.length > 0) {
      if (counterCode) {
        const counterMatch = upiConfig.accounts.find((a: any) =>
          a.counterOverrides && a.counterOverrides.some((c: any) => c.toLowerCase() === counterCode!.toLowerCase())
        );
        if (counterMatch && counterMatch.upiId) {
          return {
            vpa: counterMatch.upiId,
            payeeName: counterMatch.payeeName || s.display_name || s.store_name,
            qrSubtext: counterMatch.qrSubtext || upiConfig.qrSubtext || "Scan with any UPI app to pay",
            merchantCode: counterMatch.merchantCode,
            showInSettlement: upiConfig.showInSettlement !== false,
            showOnPrintedBills: upiConfig.showOnPrintedBills !== false,
            enabled: upiConfig.enabled !== false,
          };
        }
      }

      const defaultAcc = upiConfig.accounts.find((a: any) => a.isDefault) || upiConfig.accounts[0];
      if (defaultAcc && defaultAcc.upiId) {
        return {
          vpa: defaultAcc.upiId,
          payeeName: defaultAcc.payeeName || s.display_name || s.store_name,
          qrSubtext: defaultAcc.qrSubtext || upiConfig.qrSubtext || "Scan with any UPI app to pay",
          merchantCode: defaultAcc.merchantCode,
          showInSettlement: upiConfig.showInSettlement !== false,
          showOnPrintedBills: upiConfig.showOnPrintedBills !== false,
          enabled: upiConfig.enabled !== false,
        };
      }
    }

    const legacyVpa = s.payments?.upiVpa || (s as any).paymentSettings?.upiVpa;
    if (legacyVpa && validateUpiId(legacyVpa)) {
      return {
        vpa: legacyVpa,
        payeeName: s.payments?.upiPayeeName || (s as any).paymentSettings?.upiPayeeName || s.display_name || s.store_name,
        qrSubtext: "Scan with any UPI app to pay",
        showInSettlement: true,
        showOnPrintedBills: true,
        enabled: true,
      };
    }

    return null;
  }

  getStorePrintHeader(): {
    store_name: string;
    display_name?: string;
    store_address?: string;
    store_phone?: string;
    store_email?: string;
    store_gstin?: string;
    store_type?: string;
    gst_type?: string;
    drug_license_numbers?: string[];
    fssai_no?: string;
    upi_vpa?: string;
    footer_text?: string;
    terms_and_conditions?: string;
    jurisdiction_note?: string;
  } {
    const s = this.getSettings();
    const upi = this.getActiveUpi();
    const name = s.display_name || s.store_name || "Store";

    return {
      store_name: name,
      display_name: s.display_name || name,
      store_address: s.address || "",
      store_phone: s.phone || "",
      store_email: s.email || "",
      store_gstin: s.gstin || "",
      store_type: s.store_type || "pharmacy",
      gst_type: s.gst_type || "regular",
      drug_license_numbers: s.drug_license_numbers || [],
      fssai_no: s.fssai_no || "",
      upi_vpa: upi?.vpa || s.payments?.upiVpa || "",
      footer_text: s.printing?.footerNote || "",
      terms_and_conditions: s.printing?.termsAndConditions || "",
      jurisdiction_note: s.printing?.jurisdictionNote || "",
    };
  }

  getSettings(): CompanySettings {
    return { ...this.currentSettings };
  }

  getBillingColumns(): ColumnSetting[] {
    const local = safeStorage.getItem("lamsuite_counter_columns");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    return this.currentSettings.invoice_columns?.length
      ? this.currentSettings.invoice_columns
      : [...DEFAULT_COLUMNS];
  }

  async setBillingColumns(columns: ColumnSetting[], persistStore = false): Promise<void> {
    safeStorage.setItem("lamsuite_counter_columns", JSON.stringify(columns));
    this.currentSettings.invoice_columns = [...columns];
    if (persistStore) {
      await this.updateSettings({ invoice_columns: columns });
    }
  }

  getHeaderFields(): HeaderFieldSetting[] {
    const local = safeStorage.getItem("lamsuite_counter_header_fields");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    return this.currentSettings.header_fields?.length
      ? this.currentSettings.header_fields
      : [...DEFAULT_HEADER_FIELDS];
  }

  async setHeaderFields(fields: HeaderFieldSetting[], persistStore = false): Promise<void> {
    safeStorage.setItem("lamsuite_counter_header_fields", JSON.stringify(fields));
    this.currentSettings.header_fields = [...fields];
    if (persistStore) {
      await this.updateSettings({ header_fields: fields });
    }
  }

  getBillingPresets(): BillingScreenPreset[] {
    const storePresets = this.currentSettings.saved_billing_presets || [];
    const map = new Map<string, BillingScreenPreset>();
    BUILTIN_BILLING_PRESETS.forEach((p) => map.set(p.id, p));
    storePresets.forEach((p) => map.set(p.id, p));
    return Array.from(map.values());
  }

  async applyBillingPreset(presetId: string, persistStore = false): Promise<{ columns: ColumnSetting[]; headerFields: HeaderFieldSetting[] }> {
    const presets = this.getBillingPresets();
    const preset = presets.find((p) => p.id === presetId) || BUILTIN_BILLING_PRESETS[0];

    const columns = [...preset.columns];
    const headerFields = [...preset.headerFields];

    await this.setBillingColumns(columns, persistStore);
    await this.setHeaderFields(headerFields, persistStore);
    this.currentSettings.active_billing_preset = preset.id;

    if (persistStore) {
      await this.updateSettings({
        active_billing_preset: preset.id,
        invoice_columns: columns,
        header_fields: headerFields,
      });
    }

    return { columns, headerFields };
  }

  async saveCustomBillingPreset(
    name: string,
    description: string,
    columns: ColumnSetting[],
    headerFields: HeaderFieldSetting[]
  ): Promise<BillingScreenPreset> {
    const newPreset: BillingScreenPreset = {
      id: `preset_custom_${Date.now()}`,
      name,
      description,
      isBuiltin: false,
      columns,
      headerFields,
    };

    const currentPresets = this.getBillingPresets().filter((p) => !p.isBuiltin);
    currentPresets.push(newPreset);

    await this.updateSettings({
      saved_billing_presets: [...BUILTIN_BILLING_PRESETS, ...currentPresets],
      active_billing_preset: newPreset.id,
    });

    return newPreset;
  }

  async deleteCustomBillingPreset(presetId: string): Promise<boolean> {
    const target = this.getBillingPresets().find((p) => p.id === presetId);
    if (!target || target.isBuiltin) return false;

    const remaining = (this.currentSettings.saved_billing_presets || []).filter((p) => p.id !== presetId);
    await this.updateSettings({
      saved_billing_presets: remaining,
      active_billing_preset: "pharmacy",
    });
    return true;
  }

  getPurchaseColumns(): ColumnSetting[] {
    const local = safeStorage.getItem("lamsuite_purchase_columns");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    return this.currentSettings.purchase_columns?.length
      ? this.currentSettings.purchase_columns
      : [...DEFAULT_PURCHASE_COLUMNS];
  }

  async setPurchaseColumns(columns: ColumnSetting[], persistStore = false): Promise<void> {
    safeStorage.setItem("lamsuite_purchase_columns", JSON.stringify(columns));
    this.currentSettings.purchase_columns = [...columns];
    if (persistStore) {
      await this.updateSettings({ purchase_columns: columns });
    }
  }

  getPurchaseHeaderFields(): HeaderFieldSetting[] {
    const local = safeStorage.getItem("lamsuite_purchase_header_fields");
    if (local) {
      try {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    return this.currentSettings.purchase_header_fields?.length
      ? this.currentSettings.purchase_header_fields
      : [...DEFAULT_PURCHASE_HEADER_FIELDS];
  }

  async setPurchaseHeaderFields(fields: HeaderFieldSetting[], persistStore = false): Promise<void> {
    safeStorage.setItem("lamsuite_purchase_header_fields", JSON.stringify(fields));
    this.currentSettings.purchase_header_fields = [...fields];
    if (persistStore) {
      await this.updateSettings({ purchase_header_fields: fields });
    }
  }

  getPurchasePresets(): BillingScreenPreset[] {
    const storePresets = this.currentSettings.saved_purchase_presets || [];
    const map = new Map<string, BillingScreenPreset>();
    BUILTIN_PURCHASE_PRESETS.forEach((p) => map.set(p.id, p));
    storePresets.forEach((p) => map.set(p.id, p));
    return Array.from(map.values());
  }

  async applyPurchasePreset(presetId: string, persistStore = false): Promise<{ columns: ColumnSetting[]; headerFields: HeaderFieldSetting[] }> {
    const presets = this.getPurchasePresets();
    const preset = presets.find((p) => p.id === presetId) || BUILTIN_PURCHASE_PRESETS[0];

    const columns = [...preset.columns];
    const headerFields = [...preset.headerFields];

    await this.setPurchaseColumns(columns, persistStore);
    await this.setPurchaseHeaderFields(headerFields, persistStore);
    this.currentSettings.active_purchase_preset = preset.id;

    if (persistStore) {
      await this.updateSettings({
        active_purchase_preset: preset.id,
        purchase_columns: columns,
        purchase_header_fields: headerFields,
      });
    }

    return { columns, headerFields };
  }

  async saveCustomPurchasePreset(
    name: string,
    description: string,
    columns: ColumnSetting[],
    headerFields: HeaderFieldSetting[]
  ): Promise<BillingScreenPreset> {
    const newPreset: BillingScreenPreset = {
      id: `preset_pur_custom_${Date.now()}`,
      name,
      description,
      isBuiltin: false,
      columns,
      headerFields,
    };

    const currentPresets = this.getPurchasePresets().filter((p) => !p.isBuiltin);
    currentPresets.push(newPreset);

    await this.updateSettings({
      saved_purchase_presets: [...BUILTIN_PURCHASE_PRESETS, ...currentPresets],
      active_purchase_preset: newPreset.id,
    });

    return newPreset;
  }

  async deleteCustomPurchasePreset(presetId: string): Promise<boolean> {
    const target = this.getPurchasePresets().find((p) => p.id === presetId);
    if (!target || target.isBuiltin) return false;

    const remaining = (this.currentSettings.saved_purchase_presets || []).filter((p) => p.id !== presetId);
    await this.updateSettings({
      saved_purchase_presets: remaining,
      active_purchase_preset: "pharmacy_inward",
    });
    return true;
  }

  async resetBillingLayoutToDefault(): Promise<{ columns: ColumnSetting[]; headerFields: HeaderFieldSetting[] }> {
    safeStorage.removeItem("lamsuite_counter_columns");
    safeStorage.removeItem("lamsuite_counter_header_fields");
    return await this.applyBillingPreset("pharmacy", true);
  }

  async updateSettings(updates: Partial<CompanySettings>): Promise<CompanySettings> {
    // Keep legacy top-level shortcuts in sync with sequences
    if (updates.invoice_prefix) {
      if (!updates.sequences) updates.sequences = { ...this.currentSettings.sequences };
      updates.sequences.invoicePrefix = updates.invoice_prefix;
    }
    if (updates.next_invoice_number) {
      if (!updates.sequences) updates.sequences = { ...this.currentSettings.sequences };
      updates.sequences.nextInvoiceNumber = updates.next_invoice_number;
    }

    this.currentSettings = {
      ...this.currentSettings,
      ...updates,
      sequences: { ...this.currentSettings.sequences, ...(updates.sequences || {}) },
      printing: { ...this.currentSettings.printing, ...(updates.printing || {}) },
      workspace: { ...this.currentSettings.workspace, ...(updates.workspace || {}) },
      security: { ...this.currentSettings.security, ...(updates.security || {}) },
      wallet: { ...this.currentSettings.wallet, ...(updates.wallet || {}) },
      smtp: { ...this.currentSettings.smtp, ...(updates.smtp || {}) },
      whatsapp: { ...this.currentSettings.whatsapp, ...(updates.whatsapp || {}) },
      payments: { ...this.currentSettings.payments, ...(updates.payments || {}) },
    };

    if (updates.payments?.upi || updates.payments?.upiVpa) {
      try {
        const auditId = `audit_upi_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
        await sqliteStorage.insertRecord("security_audit_logs", auditId, {
          id: auditId,
          event_type: "UPI_SETTINGS_UPDATED",
          timestamp: Date.now(),
          details: JSON.stringify({
            accounts: this.currentSettings.payments?.upi?.accounts?.map((a) => ({
              upiId: a.upiId,
              payeeName: a.payeeName,
              isDefault: a.isDefault,
              counterOverrides: a.counterOverrides,
            })),
            defaultVpa: this.currentSettings.payments?.upi?.defaultUpiId || this.currentSettings.payments?.upiVpa,
            enabled: this.currentSettings.payments?.upi?.enabled,
          }),
        });
      } catch (err) {
        console.warn("Failed to record UPI update in audit log:", err);
      }
    }

    if (this.currentSettings.sequences) {
      this.currentSettings.invoice_prefix = this.currentSettings.sequences.invoicePrefix;
      this.currentSettings.next_invoice_number = this.currentSettings.sequences.nextInvoiceNumber;
    }

    await sqliteStorage.insertRecord(
      "store_settings",
      "active_config",
      this.currentSettings as unknown as Record<string, unknown>
    );
    return { ...this.currentSettings };
  }

  async generateNextInvoiceNumber(): Promise<string> {
    await this.loadSettings();
    const currentNum = this.currentSettings.next_invoice_number;
    const prefix = this.currentSettings.invoice_prefix || "INV";
    const year = new Date().getFullYear();
    const formattedNum = String(currentNum).padStart(5, "0");
    const invoiceNumber = `${prefix}-${year}-${formattedNum}`;

    // Increment and persist next number
    await this.updateSettings({
      next_invoice_number: currentNum + 1,
      sequences: {
        ...this.currentSettings.sequences,
        nextInvoiceNumber: currentNum + 1,
      },
    });
    return invoiceNumber;
  }

  async generateNextDocumentNumber(type: "return" | "purchase" | "quotation" | "adjustment" | "transfer"): Promise<string> {
    await this.loadSettings();
    const year = new Date().getFullYear();
    const seq = { ...this.currentSettings.sequences };

    let prefix = "DOC";
    let num = 1;

    if (type === "return") {
      prefix = seq.returnPrefix || "RET";
      num = seq.nextReturnNumber || 101;
      seq.nextReturnNumber = num + 1;
    } else if (type === "purchase") {
      prefix = seq.purchasePrefix || "PUR";
      num = seq.nextPurchaseNumber || 201;
      seq.nextPurchaseNumber = num + 1;
    } else if (type === "quotation") {
      prefix = seq.quotationPrefix || "QUO";
      num = seq.nextQuotationNumber || 301;
      seq.nextQuotationNumber = num + 1;
    } else if (type === "adjustment") {
      prefix = seq.adjustmentPrefix || "ADJ";
      num = seq.nextAdjustmentNumber || 401;
      seq.nextAdjustmentNumber = num + 1;
    } else if (type === "transfer") {
      prefix = seq.transferPrefix || "TRF";
      num = seq.nextTransferNumber || 501;
      seq.nextTransferNumber = num + 1;
    }

    await this.updateSettings({ sequences: seq });
    return `${prefix}-${year}-${String(num).padStart(5, "0")}`;
  }

  isMenuEnabled(menuKey: string): boolean {
    return this.currentSettings.enabled_menu_items.includes(menuKey);
  }

  setEnabledMenuItems(menuKeys: string[]): void {
    this.currentSettings.enabled_menu_items = [...menuKeys];
  }

  async resetLocalData(scope: "transactions_only" | "full_factory_reset"): Promise<{
    success: boolean;
    clearedTables: string[];
  }> {
    const cleared: string[] = [];

    const transactionTables = [
      "invoices",
      "invoice_items",
      "stock_transactions",
      "sync_queue",
    ];

    const masterTables = [
      "products",
      "product_batches",
      "customers",
      "suppliers",
      "doctors",
      "patients",
      "store_settings",
    ];

    const tablesToClear = scope === "transactions_only" ? transactionTables : [...transactionTables, ...masterTables];

    for (const table of tablesToClear) {
      await sqliteStorage.executeSql(`DELETE FROM ${table}`);
      cleared.push(table);
    }

    if (scope === "full_factory_reset") {
      this.currentSettings = { ...DEFAULT_SETTINGS };
      await sqliteStorage.insertRecord(
        "store_settings",
        "active_config",
        this.currentSettings as unknown as Record<string, unknown>
      );
    }

    return { success: true, clearedTables: cleared };
  }
}

export const companySettingsService = new CompanySettingsService();
