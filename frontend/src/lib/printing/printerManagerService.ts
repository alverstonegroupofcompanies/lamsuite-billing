import { isTauri, invokeCommand, registerMockHandler } from "../ipc/ipcBridge";
import { sqliteStorage } from "../db/sqliteStorage";

export type PrinterStatus = "ready" | "offline" | "paper_out" | "error" | "busy" | "unknown";
export type PaperSize = "a4" | "a5" | "half_a4" | "thermal_80mm" | "thermal_58mm" | "dot_matrix_80col" | "barcode_label";
export type PrinterType = "laser_inkjet" | "thermal_pos" | "dot_matrix" | "virtual_pdf";

export interface SystemPrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  status: PrinterStatus;
  statusDetails?: string;
  driverName?: string;
  portName?: string;
  printerType: PrinterType;
  supportedPaperSizes: PaperSize[];
  isVirtual: boolean;
}

export interface PrinterProfileConfig {
  id: string; // printer name or unique identifier
  printerName: string;
  displayName?: string;
  paperSize: PaperSize;
  marginsMm: { top: number; right: number; bottom: number; left: number };
  scalePercent: number; // 100 by default (true size)
  orientation: "portrait" | "landscape";
  copies: number;
  isColor: boolean;
  silentPrint: boolean;
  currencySymbolFormat: "rupee_symbol" | "rs_text"; // "₹" vs "Rs."
  // Thermal POS specifics
  thermalWidthMm?: 58 | 80;
  enableAutoCut?: boolean;
  cutCommand?: "full_cut" | "partial_cut" | "none";
  feedLinesBeforeCut?: number;
  enableCashDrawerKick?: boolean;
  cashDrawerPin?: "pin_2" | "pin_5";
  // Dot matrix specifics
  dotMatrixFontMode?: "draft_condensed_17cpi" | "draft_10cpi" | "nlq_12cpi";
  formLengthInches?: 6 | 11 | 12;
  // Document type mapping
  assignedDocTypes?: string[];
  isDefaultForPaperSize?: boolean;
}

export interface PrintJobRecord {
  id: string;
  timestamp: string;
  documentType: string;
  documentNumber: string;
  printerName: string;
  paperSize: PaperSize;
  copies: number;
  isDuplicate: boolean;
  status: "success" | "failed" | "queued" | "cancelled";
  errorMessage?: string;
  operatorName?: string;
  filePath?: string;
  executionTimeMs?: number;
}

const STORAGE_PROFILES_KEY = "printer_profiles_master";
const STORAGE_DEFAULTS_KEY = "printer_paper_defaults";
const STORAGE_LAST_USED_KEY = "printer_last_used_map";

export const DEFAULT_SYSTEM_PRINTERS: SystemPrinterInfo[] = [
  {
    name: "EPSON TM-T82 Thermal",
    displayName: "EPSON TM-T82 Receipt (Thermal 80mm)",
    isDefault: true,
    status: "ready",
    driverName: "EPSON Advanced Printer Driver 5",
    portName: "USB001",
    printerType: "thermal_pos",
    supportedPaperSizes: ["thermal_80mm", "thermal_58mm"],
    isVirtual: false,
  },
  {
    name: "HP LaserJet Pro MFP 4104",
    displayName: "HP LaserJet Pro 4104 (A4 / A5 Laser)",
    isDefault: false,
    status: "ready",
    driverName: "HP Universal Printing PCL 6",
    portName: "WSD-PORT",
    printerType: "laser_inkjet",
    supportedPaperSizes: ["a4", "a5", "half_a4"],
    isVirtual: false,
  },
  {
    name: "TVS MSP 240 Star",
    displayName: "TVS MSP 240 (Dot Matrix 80-Col)",
    isDefault: false,
    status: "ready",
    driverName: "Generic / Text Only",
    portName: "LPT1",
    printerType: "dot_matrix",
    supportedPaperSizes: ["dot_matrix_80col", "half_a4"],
    isVirtual: false,
  },
  {
    name: "Microsoft Print to PDF",
    displayName: "Microsoft Print to PDF (Digital Vector)",
    isDefault: false,
    status: "ready",
    driverName: "Microsoft Print To PDF",
    portName: "PORTPROMPT:",
    printerType: "virtual_pdf",
    supportedPaperSizes: ["a4", "a5", "half_a4", "thermal_80mm", "thermal_58mm", "barcode_label"],
    isVirtual: true,
  },
  {
    name: "Save as PDF",
    displayName: "Save as High-Fidelity PDF Document",
    isDefault: false,
    status: "ready",
    driverName: "PDF Generator",
    portName: "FILE:",
    printerType: "virtual_pdf",
    supportedPaperSizes: ["a4", "a5", "half_a4", "thermal_80mm", "thermal_58mm", "barcode_label"],
    isVirtual: true,
  },
];

export class PrinterManagerService {
  private cachedPrinters: SystemPrinterInfo[] | null = null;
  private isSpoolingJob: boolean = false;

  constructor() {
    this.registerMockIpcHandlers();
  }

  private registerMockIpcHandlers(): void {
    registerMockHandler("get_system_printers", async () => {
      return DEFAULT_SYSTEM_PRINTERS;
    });

    registerMockHandler("print_native_job", async (args?: any) => {
      const printerName = args?.printer_name || args?.printerName || "Default";
      if (printerName === "Offline_Printer_Test") {
        return {
          success: false,
          error: "Printer 'Offline_Printer_Test' is currently offline or unreachable. Check cable/power.",
          status: "offline",
        };
      }

      // If running in browser window and not in Vitest/Node, trigger browser print/download
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        const isPdf = printerName.toLowerCase().includes("pdf") || printerName === "Save as PDF";
        if (isPdf && args?.pdf_base64) {
          try {
            const binary = atob(args.pdf_base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${args.document_number || "invoice"}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
          } catch (e) {
            console.warn("Browser PDF download failed:", e);
          }
        }
      }

      return {
        success: true,
        job_id: `spool_job_${Date.now()}`,
        printer_name: printerName,
        pages_printed: args?.copies || 1,
      };
    });
  }

  clearCache(): void {
    this.cachedPrinters = null;
  }

  /**
   * Fetches the live list of system printers installed on the OS.
   */
  async getSystemPrinters(forceRefresh = false): Promise<SystemPrinterInfo[]> {
    if (this.cachedPrinters && !forceRefresh) {
      return this.cachedPrinters;
    }

    try {
      const nativePrinters = await invokeCommand<SystemPrinterInfo[]>("get_system_printers");
      if (Array.isArray(nativePrinters) && nativePrinters.length > 0) {
        this.cachedPrinters = nativePrinters;
        return nativePrinters;
      }
    } catch (err) {
      console.warn("Printer discovery returned error, using detected defaults:", err);
    }

    // Dev/Web/Fallback list
    this.cachedPrinters = DEFAULT_SYSTEM_PRINTERS;
    return this.cachedPrinters;
  }

  /**
   * Returns a default profile configuration for a printer.
   */
  createDefaultProfileForPrinter(printer: SystemPrinterInfo): PrinterProfileConfig {
    const isThermal = printer.printerType === "thermal_pos";
    const isDotMatrix = printer.printerType === "dot_matrix";

    let defaultPaper: PaperSize = "a4";
    if (isThermal) defaultPaper = "thermal_80mm";
    if (isDotMatrix) defaultPaper = "dot_matrix_80col";

    return {
      id: printer.name,
      printerName: printer.name,
      displayName: printer.displayName,
      paperSize: defaultPaper,
      marginsMm: isThermal ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 8, right: 8, bottom: 8, left: 8 },
      scalePercent: 100, // strictly 100% scale
      orientation: "portrait",
      copies: 1,
      isColor: false,
      silentPrint: isThermal, // silent by default for thermal POS
      currencySymbolFormat: isDotMatrix ? "rs_text" : "rupee_symbol",
      thermalWidthMm: isThermal ? 80 : undefined,
      enableAutoCut: isThermal,
      cutCommand: isThermal ? "full_cut" : "none",
      feedLinesBeforeCut: isThermal ? 3 : 0,
      enableCashDrawerKick: isThermal,
      cashDrawerPin: "pin_2",
      dotMatrixFontMode: isDotMatrix ? "draft_condensed_17cpi" : undefined,
      formLengthInches: isDotMatrix ? 11 : undefined,
      assignedDocTypes: isThermal ? ["tax_invoice", "sales_return", "bill"] : ["tax_invoice", "purchase", "report"],
    };
  }

  /**
   * Retrieves all saved printer profiles from storage.
   */
  async getAllProfiles(): Promise<PrinterProfileConfig[]> {
    const saved = await sqliteStorage.findById<{ profiles: PrinterProfileConfig[] }>("system_settings", STORAGE_PROFILES_KEY);
    if (saved && Array.isArray(saved.profiles) && saved.profiles.length > 0) {
      return saved.profiles;
    }

    // Seed defaults based on discovered printers
    const printers = await this.getSystemPrinters();
    const defaults = printers.map((p) => this.createDefaultProfileForPrinter(p));
    await this.saveAllProfiles(defaults);
    return defaults;
  }

  /**
   * Saves all printer profiles.
   */
  async saveAllProfiles(profiles: PrinterProfileConfig[]): Promise<void> {
    await sqliteStorage.insertRecord("system_settings", STORAGE_PROFILES_KEY, {
      id: STORAGE_PROFILES_KEY,
      profiles,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Retrieves profile for a specific printer name.
   */
  async getProfileForPrinter(printerName: string): Promise<PrinterProfileConfig> {
    const profiles = await this.getAllProfiles();
    const found = profiles.find((p) => p.printerName.toLowerCase() === printerName.toLowerCase());
    if (found) return found;

    const printers = await this.getSystemPrinters();
    const printerInfo = printers.find((p) => p.name.toLowerCase() === printerName.toLowerCase());
    if (printerInfo) {
      const newProfile = this.createDefaultProfileForPrinter(printerInfo);
      profiles.push(newProfile);
      await this.saveAllProfiles(profiles);
      return newProfile;
    }

    // Generic fallback
    return {
      id: printerName,
      printerName: printerName,
      paperSize: "a4",
      marginsMm: { top: 8, right: 8, bottom: 8, left: 8 },
      scalePercent: 100,
      orientation: "portrait",
      copies: 1,
      isColor: false,
      silentPrint: false,
      currencySymbolFormat: "rupee_symbol",
    };
  }

  /**
   * Updates or creates a single printer profile.
   */
  async saveProfile(profile: PrinterProfileConfig): Promise<void> {
    const profiles = await this.getAllProfiles();
    const idx = profiles.findIndex((p) => p.printerName.toLowerCase() === profile.printerName.toLowerCase());
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    await this.saveAllProfiles(profiles);
  }

  /**
   * Gets default printer mapped for a specific paper size.
   */
  async getDefaultPrinterForPaperSize(paperSize: PaperSize): Promise<string> {
    const defaults = await sqliteStorage.findById<Record<string, string>>("system_settings", STORAGE_DEFAULTS_KEY);
    if (defaults && defaults[paperSize]) {
      // Validate that printer exists
      const printers = await this.getSystemPrinters();
      const exists = printers.some((p) => p.name.toLowerCase() === defaults[paperSize].toLowerCase());
      if (exists) return defaults[paperSize];
    }

    // Pick best match from system printers
    const printers = await this.getSystemPrinters();
    if (paperSize === "thermal_80mm" || paperSize === "thermal_58mm") {
      const thermal = printers.find((p) => p.printerType === "thermal_pos");
      if (thermal) return thermal.name;
    } else if (paperSize === "dot_matrix_80col") {
      const dot = printers.find((p) => p.printerType === "dot_matrix");
      if (dot) return dot.name;
    } else {
      const laser = printers.find((p) => p.printerType === "laser_inkjet" || (!p.isVirtual && p.printerType !== "thermal_pos"));
      if (laser) return laser.name;
    }

    const defaultPrinter = printers.find((p) => p.isDefault);
    return defaultPrinter ? defaultPrinter.name : printers[0]?.name || "Default Printer";
  }

  /**
   * Sets default printer for a specific paper size.
   */
  async setDefaultPrinterForPaperSize(paperSize: PaperSize, printerName: string): Promise<void> {
    const current = (await sqliteStorage.findById<Record<string, string>>("system_settings", STORAGE_DEFAULTS_KEY)) || { id: STORAGE_DEFAULTS_KEY };
    current[paperSize] = printerName;
    await sqliteStorage.insertRecord("system_settings", STORAGE_DEFAULTS_KEY, {
      ...current,
      id: STORAGE_DEFAULTS_KEY,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Gets last-used printer for document type and paper size.
   */
  async getLastUsedPrinter(docType: string, paperSize: PaperSize): Promise<string> {
    const key = `${docType}_${paperSize}`;
    const map = await sqliteStorage.findById<Record<string, string>>("system_settings", STORAGE_LAST_USED_KEY);
    if (map && map[key]) {
      const printers = await this.getSystemPrinters();
      const exists = printers.some((p) => p.name.toLowerCase() === map[key].toLowerCase());
      if (exists) return map[key];
    }

    return await this.getDefaultPrinterForPaperSize(paperSize);
  }

  /**
   * Remembers last-used printer for document type and paper size.
   */
  async setLastUsedPrinter(docType: string, paperSize: PaperSize, printerName: string): Promise<void> {
    const key = `${docType}_${paperSize}`;
    const current = (await sqliteStorage.findById<Record<string, string>>("system_settings", STORAGE_LAST_USED_KEY)) || { id: STORAGE_LAST_USED_KEY };
    current[key] = printerName;
    await sqliteStorage.insertRecord("system_settings", STORAGE_LAST_USED_KEY, {
      ...current,
      id: STORAGE_LAST_USED_KEY,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Validates whether a printer is capable of printing the target paper size.
   */
  validatePaperCompatibility(printer: SystemPrinterInfo, paperSize: PaperSize): { compatible: boolean; warning?: string; suggestedPaper?: PaperSize } {
    if (printer.isVirtual) {
      return { compatible: true };
    }

    if (printer.printerType === "thermal_pos") {
      if (paperSize === "a4" || paperSize === "a5") {
        return {
          compatible: false,
          warning: `'${printer.displayName}' is a thermal receipt printer and cannot print full ${paperSize.toUpperCase()} invoices.`,
          suggestedPaper: "thermal_80mm",
        };
      }
    }

    if (printer.printerType === "laser_inkjet" || printer.printerType === "dot_matrix") {
      if (paperSize === "thermal_80mm" || paperSize === "thermal_58mm") {
        return {
          compatible: false,
          warning: `'${printer.displayName}' is a page printer and cannot print continuous thermal rolls.`,
          suggestedPaper: "a4",
        };
      }
    }

    return { compatible: true };
  }

  /**
   * Records a completed or failed print job into the local audit history table.
   */
  async recordPrintJob(job: Omit<PrintJobRecord, "id" | "timestamp">): Promise<PrintJobRecord> {
    const record: PrintJobRecord = {
      ...job,
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    await sqliteStorage.insertRecord("print_history", record.id, record);
    return record;
  }

  /**
   * Retrieves the last print job for a specific document number.
   */
  async getLastPrintJobForDocument(documentNumber: string): Promise<PrintJobRecord | null> {
    if (!documentNumber) return null;
    const history = await sqliteStorage.findAll<PrintJobRecord>("print_history");
    const matching = history
      .filter((j) => j.documentNumber === documentNumber)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return matching[0] || null;
  }

  /**
   * Dispatches a print job safely with debouncing, status checks, and audit logging.
   */
  async executePrintJob(params: {
    printerName: string;
    paperSize: PaperSize;
    docType: string;
    docNumber: string;
    copies?: number;
    isDuplicate?: boolean;
    operatorName?: string;
    htmlContent?: string;
    pdfBytes?: Uint8Array;
    rawEscPosBytes?: Uint8Array;
    useSystemDialog?: boolean;
  }): Promise<{ success: boolean; error?: string; jobId?: string }> {
    if (this.isSpoolingJob) {
      return { success: false, error: "Another print job is currently spooling. Please wait a moment." };
    }

    this.isSpoolingJob = true;
    const startTime = Date.now();

    try {
      const printers = await this.getSystemPrinters(true);
      const targetPrinter = printers.find((p) => p.name.toLowerCase() === params.printerName.toLowerCase());

      if (!targetPrinter && params.printerName !== "Save as PDF" && params.printerName !== "Microsoft Print to PDF") {
        const errMsg = `Selected printer '${params.printerName}' was not found in system devices.`;
        await this.recordPrintJob({
          documentType: params.docType,
          documentNumber: params.docNumber,
          printerName: params.printerName,
          paperSize: params.paperSize,
          copies: params.copies || 1,
          isDuplicate: Boolean(params.isDuplicate),
          status: "failed",
          errorMessage: errMsg,
          operatorName: params.operatorName,
          executionTimeMs: Date.now() - startTime,
        });
        return { success: false, error: errMsg };
      }

      if (targetPrinter && targetPrinter.status === "offline") {
        const errMsg = `Printer '${targetPrinter.displayName}' is currently offline. Please check power and cable.`;
        await this.recordPrintJob({
          documentType: params.docType,
          documentNumber: params.docNumber,
          printerName: params.printerName,
          paperSize: params.paperSize,
          copies: params.copies || 1,
          isDuplicate: Boolean(params.isDuplicate),
          status: "failed",
          errorMessage: errMsg,
          operatorName: params.operatorName,
          executionTimeMs: Date.now() - startTime,
        });
        return { success: false, error: errMsg };
      }

      // Invoke native print command
      const profile = await this.getProfileForPrinter(params.printerName);
      const res = await invokeCommand<{ success: boolean; job_id?: string; error?: string }>("print_native_job", {
        printerName: params.printerName,
        printer_name: params.printerName,
        paperSize: params.paperSize,
        paper_size: params.paperSize,
        documentType: params.docType,
        document_type: params.docType,
        documentNumber: params.docNumber,
        document_number: params.docNumber,
        copies: params.copies || profile.copies || 1,
        silent: profile.silentPrint && !params.useSystemDialog,
        htmlContent: params.htmlContent,
        html_content: params.htmlContent,
        pdfBase64: params.pdfBytes ? this.uint8ArrayToBase64(params.pdfBytes) : undefined,
        pdf_base64: params.pdfBytes ? this.uint8ArrayToBase64(params.pdfBytes) : undefined,
        rawBytes: params.rawEscPosBytes ? Array.from(params.rawEscPosBytes) : undefined,
        raw_bytes: params.rawEscPosBytes ? Array.from(params.rawEscPosBytes) : undefined,
        autoCut: profile.enableAutoCut,
        auto_cut: profile.enableAutoCut,
        cashDrawer: profile.enableCashDrawerKick,
        cash_drawer: profile.enableCashDrawerKick,
      });

      if (res && res.success) {
        await this.setLastUsedPrinter(params.docType, params.paperSize, params.printerName);
        await this.recordPrintJob({
          documentType: params.docType,
          documentNumber: params.docNumber,
          printerName: params.printerName,
          paperSize: params.paperSize,
          copies: params.copies || 1,
          isDuplicate: Boolean(params.isDuplicate),
          status: "success",
          operatorName: params.operatorName,
          executionTimeMs: Date.now() - startTime,
        });
        return { success: true, jobId: res.job_id };
      } else {
        const err = res?.error || "Print spooler rejected job";
        await this.recordPrintJob({
          documentType: params.docType,
          documentNumber: params.docNumber,
          printerName: params.printerName,
          paperSize: params.paperSize,
          copies: params.copies || 1,
          isDuplicate: Boolean(params.isDuplicate),
          status: "failed",
          errorMessage: err,
          operatorName: params.operatorName,
          executionTimeMs: Date.now() - startTime,
        });
        return { success: false, error: err };
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      await this.recordPrintJob({
        documentType: params.docType,
        documentNumber: params.docNumber,
        printerName: params.printerName,
        paperSize: params.paperSize,
        copies: params.copies || 1,
        isDuplicate: Boolean(params.isDuplicate),
        status: "failed",
        errorMessage: errMsg,
        operatorName: params.operatorName,
        executionTimeMs: Date.now() - startTime,
      });
      return { success: false, error: errMsg };
    } finally {
      this.isSpoolingJob = false;
    }
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

export const printerManagerService = new PrinterManagerService();
