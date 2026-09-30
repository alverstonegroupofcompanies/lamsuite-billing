import { sqliteStorage } from "../db/sqliteStorage";

export interface CompanySettings {
  store_id: string;
  store_name: string;
  phone: string;
  email?: string;
  address: string;
  state_code: string;
  gstin?: string;
  drug_license_numbers?: string[];
  fssai_no?: string;
  tax_mode: "inclusive" | "exclusive";
  invoice_prefix: string;
  next_invoice_number: number;
  enabled_menu_items: string[];
}

export const DEFAULT_SETTINGS: CompanySettings = {
  store_id: "store_main",
  store_name: "LamStone Pharmacy & Retail",
  phone: "9876543210",
  address: "Main Road, Palakkad, Kerala",
  state_code: "32",
  gstin: "32AAAAA0000A1Z5",
  drug_license_numbers: ["20B-123456", "21B-123457"],
  fssai_no: "10020041000123",
  tax_mode: "inclusive",
  invoice_prefix: "INV",
  next_invoice_number: 1001,
  enabled_menu_items: ["pos", "purchases", "stock", "reports", "masters", "settings"],
};

export class CompanySettingsService {
  private currentSettings: CompanySettings = { ...DEFAULT_SETTINGS };

  async loadSettings(): Promise<CompanySettings> {
    const record = await sqliteStorage.findById<CompanySettings>("store_settings", "active_config");
    if (record) {
      this.currentSettings = { ...DEFAULT_SETTINGS, ...record };
    }
    return { ...this.currentSettings };
  }

  async updateSettings(updates: Partial<CompanySettings>): Promise<CompanySettings> {
    this.currentSettings = { ...this.currentSettings, ...updates };
    await sqliteStorage.insertRecord("store_settings", "active_config", this.currentSettings as unknown as Record<string, unknown>);
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
    await this.updateSettings({ next_invoice_number: currentNum + 1 });
    return invoiceNumber;
  }

  isMenuEnabled(menuKey: string): boolean {
    return this.currentSettings.enabled_menu_items.includes(menuKey);
  }

  setEnabledMenuItems(menuKeys: string[]): void {
    this.currentSettings.enabled_menu_items = [...menuKeys];
  }
}

export const companySettingsService = new CompanySettingsService();
