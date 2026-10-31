import { isTauri, invokeCommand, registerMockHandler } from "../ipc/ipcBridge";
import { sqliteStorage } from "../db/sqliteStorage";
import { dotMatrixRenderer, type DotMatrixPaperWidth } from "./dotMatrixRenderer";

export type PrinterStatus = "ready" | "offline" | "paper_out" | "error" | "busy" | "unknown";
export type PaperSize =
  | "a4"
  | "a5"
  | "half_a4"
  | "thermal_80mm"
  | "thermal_58mm"
  | "dot_matrix_6in"
  | "dot_matrix_10in"
  | "dot_matrix_80col"
  | "dot_matrix_12in"
  | "dot_matrix_120col"
  | "dot_matrix_15in"
  | "dot_matrix_132col"
  | "barcode_label";
export type PrinterType = "laser_inkjet" | "thermal_pos" | "dot_matrix" | "virtual_pdf";

export function isDotMatrixPaper(paperSize: PaperSize): boolean {
  return paperSize.startsWith("dot_matrix");
}

/**
 * Returns exact column width strictly based on user-selected paper size.
 * Prioritizes paper size over printer maximum carriage width so narrow formats are never stretched.
 */
export function getDotMatrixColumns(paperSize: PaperSize, fallback?: number): number {
  switch (paperSize) {
    case "dot_matrix_6in":
      // Always 50 cols (usable area between 0.5" left and right tractor-feed perforated margins)
      return 50;
    case "dot_matrix_10in":
    case "dot_matrix_80col":
      // Always 80 cols for 10-inch standard continuous paper
      return 80;
    case "dot_matrix_12in":
    case "dot_matrix_120col":
      // Always 120 cols for 12-inch continuous paper
      return 120;
    case "dot_matrix_15in":
    case "dot_matrix_132col":
      // Always 132 cols for 15-inch wide continuous paper
      return 132;
    default:
      if (typeof fallback === "number" && fallback > 0) return fallback;
      return 80;
  }
}

/**
 * Maps paper size to standard dot matrix physical width key.
 */
export function getPaperWidthFromSize(paperSize: PaperSize): "6in" | "10in" | "12in" | "15in" {
  switch (paperSize) {
    case "dot_matrix_6in":
      return "6in";
    case "dot_matrix_12in":
    case "dot_matrix_120col":
      return "12in";
    case "dot_matrix_15in":
    case "dot_matrix_132col":
      return "15in";
    case "dot_matrix_10in":
    case "dot_matrix_80col":
    default:
      return "10in";
  }
}

export function getPaperWidthInches(paperSize: PaperSize): number {
  switch (paperSize) {
    case "dot_matrix_6in":
      return 6.0;
    case "dot_matrix_10in":
    case "dot_matrix_80col":
      return 10.0;
    case "dot_matrix_12in":
    case "dot_matrix_120col":
      return 12.0;
    case "dot_matrix_15in":
    case "dot_matrix_132col":
      return 15.0;
    case "thermal_80mm":
      return 3.15;
    case "thermal_58mm":
      return 2.28;
    case "a4":
      return 8.27;
    case "a5":
      return 5.83;
    case "half_a4":
      return 5.83;
    default:
      return 8.5;
  }
}

/**
 * Resolves the full physical carriage/printable width in columns (at standard 10 CPI) for a dot matrix printer.
 * If not explicitly configured, infers from printer capabilities, model name, or supported paper sizes.
 * Never treats narrow paper size (such as 6-inch) as the printer's carriage width.
 */
export function getPrinterCarriageColumns(
  printer?: SystemPrinterInfo | null,
  profile?: PrinterProfileConfig | null
): number {
  if (profile?.dotMatrixCarriageWidth) {
    return Number(profile.dotMatrixCarriageWidth);
  }
  if (printer?.carriageWidthCols) {
    return printer.carriageWidthCols;
  }
  if (printer?.supportedPaperSizes && printer.supportedPaperSizes.length > 0) {
    if (printer.supportedPaperSizes.includes("dot_matrix_15in") || printer.supportedPaperSizes.includes("dot_matrix_132col")) return 132;
    if (printer.supportedPaperSizes.includes("dot_matrix_12in") || printer.supportedPaperSizes.includes("dot_matrix_120col")) return 120;
    if (printer.supportedPaperSizes.includes("dot_matrix_10in") || printer.supportedPaperSizes.includes("dot_matrix_80col")) return 80;
  }
  if (printer?.name || printer?.displayName) {
    const name = `${printer.name} ${printer.displayName || ""}`.toLowerCase();
    if (name.includes("15\"") || name.includes("15-inch") || name.includes("132") || name.includes("136") || name.includes("lq-2090") || name.includes("wide")) {
      return 132;
    }
    if (name.includes("12\"") || name.includes("12-inch") || name.includes("120") || name.includes("245") || name.includes("250")) {
      return 120;
    }
    if (name.includes("100") || name.includes("10\"") && name.includes("wide")) {
      return 100;
    }
    if (name.includes("80") || name.includes("10\"") || name.includes("msp 240") || name.includes("lx-300") || name.includes("lx-310")) {
      return 80;
    }
  }
  // Default for standard dot matrix carriage
  return 80;
}

export interface ContinuousPaperGeometry {
  paperWidthInches: number; // e.g. 6.0
  paperTotalCols: number; // e.g. 60 (at standard 10 CPI)
  tractorMarginLeftCols: number; // e.g. 5 (0.5" perforated margin with pin-feed holes)
  tractorMarginRightCols: number; // e.g. 5 (0.5" perforated margin with pin-feed holes)
  usableBodyCols: number; // e.g. 50 (area between perforations: 60 - 5 - 5 = 50)
  paperLeftOffsetCols: number; // offset to center the physical paper on platen: floor((printerCols - paperTotalCols) / 2)
  contentLeftOffsetCols: number; // total left indent before text = paperLeftOffsetCols + tractorMarginLeftCols + manualMargin
}

/**
 * Returns exact physical paper dimensions and tractor-feed positioning.
 */
export function getContinuousPaperGeometry(params: {
  paperSize?: PaperSize;
  paperWidth?: DotMatrixPaperWidth;
  printerCarriageCols?: number;
  autoCenter?: boolean;
  manualLeftMarginSpaces?: number;
  customUsableCols?: number;
}): ContinuousPaperGeometry {
  let paperWidthInches = 10.0;
  let paperTotalCols = 80;
  let tractorMargin = 0;
  let usableCols = 80;

  const size = params.paperSize;
  const width = params.paperWidth;

  if (size === "dot_matrix_6in" || width === "6in" || (typeof width === "number" && width <= 7)) {
    paperWidthInches = 6.0;
    paperTotalCols = 60;
    tractorMargin = 5; // 0.5" perforated strip with pin-feed holes on each side
    usableCols = params.customUsableCols || 50; // 5.0" usable body between perforations
  } else if (size === "dot_matrix_12in" || size === "dot_matrix_120col" || width === "12in" || (typeof width === "number" && width > 11 && width <= 13)) {
    paperWidthInches = 12.0;
    paperTotalCols = 120;
    tractorMargin = 0;
    usableCols = params.customUsableCols || 120;
  } else if (size === "dot_matrix_15in" || size === "dot_matrix_132col" || width === "15in" || (typeof width === "number" && width > 13)) {
    paperWidthInches = 15.0;
    paperTotalCols = 132;
    tractorMargin = 0;
    usableCols = params.customUsableCols || 132;
  } else {
    paperWidthInches = 10.0;
    paperTotalCols = 80;
    tractorMargin = 0;
    usableCols = params.customUsableCols || 80;
  }

  const printerCarriageCols = params.printerCarriageCols || paperTotalCols;
  const autoCenter = params.autoCenter !== false;
  const manualMargin = Math.max(0, params.manualLeftMarginSpaces || 0);

  let paperLeftOffsetCols = 0;
  if (autoCenter && printerCarriageCols > paperTotalCols) {
    paperLeftOffsetCols = Math.floor((printerCarriageCols - paperTotalCols) / 2);
  }

  const contentLeftOffsetCols = paperLeftOffsetCols + tractorMargin + manualMargin;

  return {
    paperWidthInches,
    paperTotalCols,
    tractorMarginLeftCols: tractorMargin,
    tractorMarginRightCols: tractorMargin,
    usableBodyCols: usableCols,
    paperLeftOffsetCols,
    contentLeftOffsetCols,
  };
}

/**
 * Calculates horizontal left offset (in character spaces at standard 10 CPI) to center continuous paper
 * and its printable content within the printer's supported carriage width.
 * Accounts for both physical paper platen centering and 0.5" tractor-feed perforated margins.
 */
export function calculateHorizontalCenteringOffset(
  printerCarriageCols: number,
  paperWidthCols: number,
  options?: { includeTractorMargin?: boolean; paperSize?: PaperSize | string }
): number {
  if (!printerCarriageCols) return 0;

  const is6inTractor =
    options?.paperSize === "dot_matrix_6in" ||
    (paperWidthCols === 50 && options?.includeTractorMargin !== false) ||
    (paperWidthCols <= 55 && options?.includeTractorMargin !== false);

  if (is6inTractor) {
    const paperPhysicalCols = 60; // 6.0 inches total physical paper width
    const tractorMargin = options?.includeTractorMargin !== false ? 5 : 0; // 0.5 inches tractor margin (5 cols)
    const paperLeftOffset = printerCarriageCols > paperPhysicalCols
      ? Math.floor((printerCarriageCols - paperPhysicalCols) / 2)
      : 0;
    return paperLeftOffset + tractorMargin;
  }

  // Standard paper (e.g. 60 raw cols, 80 cols, 120 cols, 132 cols)
  if (!paperWidthCols || paperWidthCols >= printerCarriageCols) {
    return 0;
  }
  return Math.floor((printerCarriageCols - paperWidthCols) / 2);
}

export interface SystemPrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  status: PrinterStatus;
  statusDetails?: string;
  driverName?: string;
  portName?: string;
  printerType: PrinterType;
  carriageWidthCols?: number;
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
  dotMatrixColumns?: 60 | 80 | 120 | 132;
  dotMatrixCarriageWidth?: 80 | 120 | 132 | 136;
  dotMatrixAutoCenter?: boolean;
  dotMatrixLoadedPaperWidth?: "6in" | "10in" | "12in" | "15in";
  dotMatrixCommandSet?: "esc_p" | "tvs_native" | "plain_ascii";
  dotMatrixPitch?: "10cpi" | "12cpi" | "17cpi_condensed";
  linesPerPage?: number;
  doubleStrikeCarbon?: boolean;
  prePrintedStationery?: boolean;
  leftMarginSpaces?: number;
  topMarginLines?: number;
  endOfJobAction?: "stop_immediately" | "feed_tear_off" | "form_feed";
  feedLinesForTearOff?: number; // 0 to 10 lines
  logRawHexDump?: boolean;
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
  hexDump?: string;
  rawBytesLength?: number;
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
    displayName: "TVS MSP 240 (Dot Matrix 80-Col / 10\")",
    isDefault: false,
    status: "ready",
    driverName: "Generic / Text Only",
    portName: "LPT1",
    printerType: "dot_matrix",
    carriageWidthCols: 80,
    supportedPaperSizes: ["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "half_a4"],
    isVirtual: false,
  },
  {
    name: "TVS MSP 245 Star",
    displayName: "TVS MSP 245 (Dot Matrix 12\" / 120-Col)",
    isDefault: false,
    status: "ready",
    driverName: "Generic / Text Only",
    portName: "LPT1",
    printerType: "dot_matrix",
    carriageWidthCols: 120,
    supportedPaperSizes: ["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "dot_matrix_12in", "dot_matrix_120col", "half_a4"],
    isVirtual: false,
  },
  {
    name: "Epson LQ-2090 Wide Carriage",
    displayName: "Epson LQ-2090 (Dot Matrix 15\" / 132-Col Wide)",
    isDefault: false,
    status: "ready",
    driverName: "Generic / Text Only",
    portName: "LPT1",
    printerType: "dot_matrix",
    carriageWidthCols: 132,
    supportedPaperSizes: ["dot_matrix_6in", "dot_matrix_10in", "dot_matrix_80col", "dot_matrix_12in", "dot_matrix_120col", "dot_matrix_15in", "dot_matrix_132col", "half_a4"],
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
  private lastJobSignature: string = "";
  private lastJobTimestamp: number = 0;

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

      // If running in browser window and target is strictly "Save as PDF", trigger browser download
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        if (printerName === "Save as PDF" && args?.pdf_base64) {
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
      marginsMm: isThermal || isDotMatrix ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 8, right: 8, bottom: 8, left: 8 },
      scalePercent: 100, // strictly 100% scale
      orientation: "portrait",
      copies: 1,
      isColor: false,
      silentPrint: isThermal || isDotMatrix,
      currencySymbolFormat: isDotMatrix ? "rs_text" : "rupee_symbol",
      thermalWidthMm: isThermal ? 80 : undefined,
      enableAutoCut: isThermal,
      cutCommand: isThermal ? "full_cut" : "none",
      feedLinesBeforeCut: isThermal ? 3 : 0,
      enableCashDrawerKick: isThermal,
      cashDrawerPin: "pin_2",
      dotMatrixColumns: isDotMatrix ? 80 : undefined,
      dotMatrixCarriageWidth: isDotMatrix ? ((printer.carriageWidthCols || 80) as any) : undefined,
      dotMatrixAutoCenter: isDotMatrix ? true : undefined,
      dotMatrixCommandSet: isDotMatrix ? "esc_p" : undefined,
      dotMatrixPitch: isDotMatrix ? "10cpi" : undefined,
      linesPerPage: isDotMatrix ? 66 : undefined,
      doubleStrikeCarbon: false,
      prePrintedStationery: false,
      leftMarginSpaces: 0,
      topMarginLines: 0,
      endOfJobAction: isDotMatrix ? "stop_immediately" : undefined,
      feedLinesForTearOff: isDotMatrix ? 0 : undefined,
      logRawHexDump: false,
      assignedDocTypes: isThermal
        ? ["tax_invoice", "sales_return", "bill"]
        : isDotMatrix
        ? ["tax_invoice", "sales_return", "credit_note", "debit_note", "purchase", "bill"]
        : ["tax_invoice", "purchase", "report"],
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
    } else if (isDotMatrixPaper(paperSize)) {
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
  validatePaperCompatibility(printer: SystemPrinterInfo, paperSize: PaperSize): { compatible: boolean; warning?: string; suggestedPaper?: PaperSize; driverWarning?: string } {
    if (printer.isVirtual) {
      return { compatible: true };
    }

    const isThermalPaper = paperSize === "thermal_80mm" || paperSize === "thermal_58mm";
    const isDotPaper = isDotMatrixPaper(paperSize);
    const isPagePaper = paperSize === "a4" || paperSize === "a5" || paperSize === "half_a4";

    if (printer.printerType === "thermal_pos") {
      if (isDotPaper) {
        return {
          compatible: false,
          warning: `'${printer.displayName}' is a thermal receipt printer and is not compatible with Dot Matrix profiles. ESC/P dot-matrix output will not format correctly on thermal paper.`,
          suggestedPaper: "thermal_80mm",
        };
      }
      if (isPagePaper) {
        return {
          compatible: false,
          warning: `'${printer.displayName}' is a thermal receipt printer and cannot print full ${paperSize.toUpperCase()} invoices.`,
          suggestedPaper: "thermal_80mm",
        };
      }
    }

    if (printer.printerType === "dot_matrix") {
      if (isThermalPaper) {
        return {
          compatible: false,
          warning: `'${printer.displayName}' is a dot-matrix tractor-feed printer and cannot print continuous thermal roll formats.`,
          suggestedPaper: "dot_matrix_80col",
        };
      }
      const carriage = getPrinterCarriageColumns(printer);
      const paperCols = getDotMatrixColumns(paperSize);
      if (carriage && paperCols > carriage) {
        return {
          compatible: false,
          warning: `'${printer.displayName}' has a ${carriage}-column carriage, which cannot physically accommodate ${getPaperWidthInches(paperSize)}-inch (${paperCols}-column) continuous paper.`,
          suggestedPaper: carriage >= 120 ? "dot_matrix_120col" : "dot_matrix_80col",
        };
      }
    }

    if (printer.printerType === "laser_inkjet") {
      if (isThermalPaper) {
        return {
          compatible: false,
          warning: `'${printer.displayName}' is a page printer and cannot print continuous thermal rolls.`,
          suggestedPaper: "a4",
        };
      }
      if (isDotPaper) {
        return {
          compatible: false,
          warning: `'${printer.displayName}' is a laser/inkjet printer and does not support native dot-matrix ESC/P continuous text streaming.`,
          suggestedPaper: "a4",
        };
      }
    }

    let driverWarning: string | undefined;
    if (isDotPaper && printer.driverName) {
      const dLower = printer.driverName.toLowerCase();
      const isTextOrRaw = dLower.includes("generic") || dLower.includes("text") || dLower.includes("dot") || dLower.includes("raw");
      const isGraphical = dLower.includes("pcl") || dLower.includes("gdi") || dLower.includes("postscript") || dLower.includes("advanced") || dLower.includes("laser");
      if (isGraphical && !isTextOrRaw) {
        driverWarning = `Selected printer uses graphical driver ('${printer.driverName}'). A 'Generic / Text Only' driver or RAW spooler is recommended to avoid driver-added page ejects.`;
      }
    }

    return { compatible: true, driverWarning };
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
    skipWebviewFallback?: boolean;
  }): Promise<{ success: boolean; error?: string; jobId?: string; fallbackToWebview?: boolean }> {
    if (this.isSpoolingJob) {
      return { success: false, error: "Another print job is currently in progress. Please wait for the spooler." };
    }

    // Debounce duplicate clicks/keys within 1200ms
    const signature = `${params.docType}_${params.docNumber}_${params.printerName}_${params.paperSize}`;
    const now = Date.now();
    if (now - this.lastJobTimestamp < 1200 && this.lastJobSignature === signature) {
      return { success: false, error: "Duplicate print request ignored." };
    }
    this.lastJobTimestamp = now;
    this.lastJobSignature = signature;

    this.isSpoolingJob = true;
    const startTime = Date.now();

    try {
      const printers = await this.getSystemPrinters(true);
      const targetPrinter = printers.find((p) => p.name.toLowerCase() === params.printerName.toLowerCase());

      if (!targetPrinter && params.printerName !== "Save as PDF" && params.printerName !== "Microsoft Print to PDF") {
        const errMsg = `Selected printer '${params.printerName}' was not found in system devices. It may have been disconnected or removed.`;
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
        const errMsg = `Printer '${targetPrinter.displayName}' is currently offline or disconnected. Please check power and cable.`;
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

      if (targetPrinter && targetPrinter.status === "paper_out") {
        const errMsg = `Printer '${targetPrinter.displayName}' is out of paper. Please reload paper into the tray.`;
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
      const hexDump = params.rawEscPosBytes ? dotMatrixRenderer.formatHexDump(params.rawEscPosBytes) : undefined;
      const res = await invokeCommand<{
        success: boolean;
        job_id?: string;
        error?: string;
        fallback_to_webview?: boolean;
      }>("print_native_job", {
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
          hexDump,
          rawBytesLength: params.rawEscPosBytes?.length,
        });

        // If fallback_to_webview is returned and caller did not suppress fallback
        if (res.fallback_to_webview && !params.skipWebviewFallback && params.htmlContent) {
          await this.printHtmlViaWebview(params.htmlContent);
        }

        return {
          success: true,
          jobId: res.job_id,
          fallbackToWebview: res.fallback_to_webview,
        };
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
          hexDump,
          rawBytesLength: params.rawEscPosBytes?.length,
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

  /**
   * Helper to print HTML directly using WebView native print call
   */
  printHtmlViaWebview(html: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        resolve(false);
        return;
      }
      try {
        const frame = document.createElement("iframe");
        frame.style.position = "fixed";
        frame.style.right = "0";
        frame.style.bottom = "0";
        frame.style.width = "0";
        frame.style.height = "0";
        frame.style.border = "0";
        document.body.appendChild(frame);

        const doc = frame.contentWindow?.document;
        if (!doc) {
          if (document.body.contains(frame)) document.body.removeChild(frame);
          resolve(false);
          return;
        }

        doc.open();
        doc.write(html);
        doc.close();

        setTimeout(() => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          } catch (e) {
            console.warn("Webview native print error:", e);
          }
          setTimeout(() => {
            if (document.body.contains(frame)) {
              document.body.removeChild(frame);
            }
            resolve(true);
          }, 3000);
        }, 250);
      } catch (err) {
        console.error("Failed to trigger webview native print:", err);
        resolve(false);
      }
    });
  }

  /**
   * Retrieves the print audit history log.
   */
  async getPrintHistory(limit = 100): Promise<PrintJobRecord[]> {
    const history = await sqliteStorage.findAll<PrintJobRecord>("print_history");
    return history
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Clears the print audit history log.
   */
  async clearPrintHistory(): Promise<void> {
    const records = await this.getPrintHistory(1000);
    for (const r of records) {
      await sqliteStorage.deleteRecord("print_history", r.id);
    }
    await sqliteStorage.clearTable("print_history");
  }

  /**
   * Dispatches a test slip/invoice to the selected printer.
   */
  async sendTestPrint(printerName: string, paperSize: PaperSize): Promise<{ success: boolean; error?: string; jobId?: string }> {
    const isThermal = paperSize.startsWith("thermal");
    const isDot = paperSize.startsWith("dot_matrix");

    let rawEscPosBytes: Uint8Array | undefined;
    if (isThermal) {
      const encoder = new TextEncoder();
      const text = "\x1B@\x1Ba\x01LamSuite Hardware Calibration Test\n" +
        "Printer: " + printerName + "\n" +
        "Date: " + new Date().toLocaleString() + "\n" +
        "Status: SPOOLER READY\n" +
        "--------------------------------\n\n\n\x1DV\x42\x00";
      rawEscPosBytes = encoder.encode(text);
    } else if (isDot) {
      // Exactly 3 lines, no form feed, stops immediately
      const cols = getDotMatrixColumns(paperSize);
      const widthIn = getPaperWidthInches(paperSize);
      const printers = await this.getSystemPrinters();
      const printer = printers.find((p) => p.name.toLowerCase() === printerName.toLowerCase());
      const profile = await this.getProfileForPrinter(printerName);
      const carriageCols = getPrinterCarriageColumns(printer, profile);
      const offset = profile.dotMatrixAutoCenter !== false
        ? calculateHorizontalCenteringOffset(carriageCols, cols, { paperSize })
        : 0;
      const leftPad = " ".repeat(offset);
      const encoder = new TextEncoder();
      const is6in = paperSize === "dot_matrix_6in";
      const detailStr = offset > 0
        ? is6in
          ? ` [Centered +${offset}C (Platen +${Math.max(0, offset - 5)}C + Tractor 5C)]`
          : ` [Centered +${offset}C]`
        : "";
      const text = "\x1B@" + leftPad + "LamSuite Dot-Matrix Calibration Test (" + cols + " Col / " + widthIn + "\")\r\n" +
        leftPad + "Printer: " + printerName + detailStr + "\r\n" +
        leftPad + "Status: Ready - Head Stopped Immediately\r\n";
      rawEscPosBytes = encoder.encode(text);
    }

    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>LamSuite Test Print</title>
        <style>body { font-family: sans-serif; padding: 24px; color: #1e293b; }</style>
      </head>
      <body>
        <h2 style="color: #2563eb;">LamSuite Printer Calibration Test</h2>
        <p><strong>Printer:</strong> ${printerName}</p>
        <p><strong>Paper Size:</strong> ${paperSize}</p>
        <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #cbd5e1;"/>
        <p style="color: #16a34a; font-weight: bold;">✓ Windows Print Spooler communication is verified and functional.</p>
      </body>
      </html>
    `;

    return this.executePrintJob({
      printerName,
      paperSize,
      docType: "test_print",
      docNumber: `TEST-${Date.now().toString().slice(-4)}`,
      copies: 1,
      htmlContent: testHtml,
      rawEscPosBytes,
    });
  }

  /**
   * Advances dot-matrix tractor paper by exactly one line (CRLF) for manual alignment.
   */
  async feedOneLine(printerName: string): Promise<{ success: boolean; error?: string; jobId?: string }> {
    const encoder = new TextEncoder();
    const rawEscPosBytes = encoder.encode("\r\n");
    return this.executePrintJob({
      printerName,
      paperSize: "dot_matrix_80col",
      docType: "feed_line",
      docNumber: `FEED-${Date.now().toString().slice(-4)}`,
      copies: 1,
      rawEscPosBytes,
    });
  }

  /**
   * Advances dot-matrix tractor paper to the next page Top-of-Form boundary (Form Feed 0x0C).
   */
  async formFeed(printerName: string): Promise<{ success: boolean; error?: string; jobId?: string }> {
    const rawEscPosBytes = new Uint8Array([0x0C]);
    return this.executePrintJob({
      printerName,
      paperSize: "dot_matrix_80col",
      docType: "form_feed",
      docNumber: `FF-${Date.now().toString().slice(-4)}`,
      copies: 1,
      rawEscPosBytes,
    });
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
