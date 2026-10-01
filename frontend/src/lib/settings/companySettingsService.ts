import { sqliteStorage } from "../db/sqliteStorage";

export interface ColumnSetting {
  id: string;
  label: string;
  visible: boolean;
  width?: number; // width in pixels or flex
  order: number;
}

export interface DocumentSequenceConfig {
  invoicePrefix: string;
  nextInvoiceNumber: number;
  returnPrefix: string;
  nextReturnNumber: number;
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
  paperSize: "thermal_80mm" | "thermal_58mm" | "a4" | "a5";
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
  silentPrinting: boolean;
  selectedPrinterName?: string;
}

export interface WorkspaceSettings {
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable";
  fontSize: "sm" | "base" | "lg";
  notificationsEnabled: boolean;
  autoUpdateCheck: boolean;
  wifiStrengthSimulator: number; // 0 - 100%
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
  wallet: WalletConfig;
  smtp: EmailSmtpConfig;
  invoice_columns: ColumnSetting[];

  enabled_menu_items: string[];
}

export const DEFAULT_COLUMNS: ColumnSetting[] = [
  { id: "item", label: "Item / Particulars", visible: true, width: 220, order: 1 },
  { id: "batch", label: "Batch & Exp", visible: true, width: 110, order: 2 },
  { id: "hsn", label: "HSN/SAC", visible: true, width: 90, order: 3 },
  { id: "qty", label: "Quantity", visible: true, width: 70, order: 4 },
  { id: "mrp", label: "MRP (₹)", visible: true, width: 80, order: 5 },
  { id: "rate", label: "Rate (₹)", visible: true, width: 80, order: 6 },
  { id: "ptr", label: "PTR (₹)", visible: false, width: 80, order: 7 },
  { id: "pts", label: "PTS (₹)", visible: false, width: 80, order: 8 },
  { id: "disc", label: "Disc %", visible: true, width: 70, order: 9 },
  { id: "tax", label: "GST %", visible: true, width: 70, order: 10 },
  { id: "total", label: "Total (₹)", visible: true, width: 90, order: 11 },
];

export const DEFAULT_SETTINGS: CompanySettings = {
  store_id: "store_main",
  store_name: "LamStone Pharmacy & Retail",
  display_name: "LamStone Super Clinic & Medicos",
  phone: "9876543210",
  email: "billing@lamstone.in",
  address: "Main Road, Palakkad, Kerala - 678001",
  state_code: "32",
  gstin: "32AAAAA0000A1Z5",
  drug_license_numbers: ["20B-123456", "21B-123457"],
  fssai_no: "10020041000123",
  currency_symbol: "₹",

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
    returnPrefix: "RET",
    nextReturnNumber: 101,
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
    footerNote: "Thank you for shopping with us! Get well soon.",
    termsAndConditions: "Goods once sold cannot be returned without original cash memo.",
    jurisdictionNote: "Subject to Palakkad Jurisdiction only.",
    brandByline: "Powered by LamSuite Retail 2.0",
    printDrugLicenses: true,
    printDoctorDetails: true,
    printPatientDetails: true,
    printUpiQrCode: true,
    silentPrinting: true,
    selectedPrinterName: "Default System Thermal Printer",
  },

  workspace: {
    theme: "light",
    density: "comfortable",
    fontSize: "base",
    notificationsEnabled: true,
    autoUpdateCheck: true,
    wifiStrengthSimulator: 95,
  },

  security: {
    idleTimeoutMinutes: 15,
    maxFailedLogins: 5,
    allowBiometricSignIn: true,
    defaultRole: "cashier",
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

  invoice_columns: [...DEFAULT_COLUMNS],
  enabled_menu_items: ["pos", "bills", "purchases", "stock", "reports", "masters", "settings"],
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
        wallet: { ...DEFAULT_SETTINGS.wallet, ...(record.wallet || {}) },
        smtp: { ...DEFAULT_SETTINGS.smtp, ...(record.smtp || {}) },
        invoice_columns: record.invoice_columns?.length ? record.invoice_columns : [...DEFAULT_COLUMNS],
      };
    }
    return { ...this.currentSettings };
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
    };

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
