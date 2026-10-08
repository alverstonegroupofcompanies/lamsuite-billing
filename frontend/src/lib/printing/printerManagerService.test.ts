import { describe, it, expect, beforeEach } from "vitest";
import {
  printerManagerService,
  DEFAULT_SYSTEM_PRINTERS,
  type SystemPrinterInfo,
  type PrinterProfileConfig,
} from "./printerManagerService";
import { registerMockHandler, resetMockHandlers } from "../ipc/ipcBridge";

describe("PrinterManagerService Native Discovery & Profiles", () => {
  const memoryDb = new Map<string, Map<string, any>>();

  beforeEach(() => {
    resetMockHandlers();
    printerManagerService.clearCache();
    memoryDb.clear();

    registerMockHandler("db:insert", async (args: any) => {
      const { table, id, record } = args || {};
      if (!memoryDb.has(table)) memoryDb.set(table, new Map());
      memoryDb.get(table)!.set(id, record);
      return { success: true };
    });

    registerMockHandler("db:findById", async (args: any) => {
      const { table, id } = args || {};
      const t = memoryDb.get(table);
      return t ? t.get(id) || null : null;
    });

    registerMockHandler("db:findAll", async (args: any) => {
      const { table } = args || {};
      const t = memoryDb.get(table);
      return t ? Array.from(t.values()) : [];
    });

    registerMockHandler("print_native_job", async (args: any) => {
      const printerName = args?.printer_name || args?.printerName;
      return { success: true, job_id: `spool_job_${Date.now()}`, printer_name: printerName };
    });
  });

  it("discovers system printers with hardware details and statuses", async () => {
    registerMockHandler("get_system_printers", async () => {
      return DEFAULT_SYSTEM_PRINTERS;
    });

    const printers = await printerManagerService.getSystemPrinters(true);
    expect(printers.length).toBeGreaterThanOrEqual(4);

    const thermal = printers.find((p) => p.printerType === "thermal_pos");
    expect(thermal).toBeDefined();
    expect(thermal?.name).toContain("TM-T82");
    expect(thermal?.status).toBe("ready");

    const laser = printers.find((p) => p.printerType === "laser_inkjet");
    expect(laser).toBeDefined();
    expect(laser?.name).toContain("LaserJet");

    const dotMatrix = printers.find((p) => p.printerType === "dot_matrix");
    expect(dotMatrix).toBeDefined();
    expect(dotMatrix?.name).toContain("MSP 240");
  });

  it("validates paper size compatibility against printer hardware types", () => {
    const thermalPrinter: SystemPrinterInfo = {
      name: "EPSON TM-T82",
      displayName: "EPSON TM-T82 Thermal",
      isDefault: true,
      status: "ready",
      printerType: "thermal_pos",
      supportedPaperSizes: ["thermal_80mm", "thermal_58mm"],
      isVirtual: false,
    };

    const laserPrinter: SystemPrinterInfo = {
      name: "HP LaserJet Pro",
      displayName: "HP LaserJet Pro 4104",
      isDefault: false,
      status: "ready",
      printerType: "laser_inkjet",
      supportedPaperSizes: ["a4", "a5", "half_a4"],
      isVirtual: false,
    };

    // Thermal with A4: Incompatible
    const thermalA4 = printerManagerService.validatePaperCompatibility(thermalPrinter, "a4");
    expect(thermalA4.compatible).toBe(false);
    expect(thermalA4.warning).toContain("thermal receipt printer");
    expect(thermalA4.suggestedPaper).toBe("thermal_80mm");

    // Thermal with 80mm: Compatible
    const thermal80 = printerManagerService.validatePaperCompatibility(thermalPrinter, "thermal_80mm");
    expect(thermal80.compatible).toBe(true);

    // Laser with Thermal 80mm: Incompatible
    const laserThermal = printerManagerService.validatePaperCompatibility(laserPrinter, "thermal_80mm");
    expect(laserThermal.compatible).toBe(false);
    expect(laserThermal.suggestedPaper).toBe("a4");

    // Laser with A4: Compatible
    const laserA4 = printerManagerService.validatePaperCompatibility(laserPrinter, "a4");
    expect(laserA4.compatible).toBe(true);
  });

  it("handles offline printer error gracefully without false success", async () => {
    registerMockHandler("get_system_printers", async () => {
      return [
        {
          name: "Broken_Printer",
          displayName: "Broken Thermal POS",
          isDefault: false,
          status: "offline",
          printerType: "thermal_pos",
          supportedPaperSizes: ["thermal_80mm"],
          isVirtual: false,
        },
      ];
    });

    const res = await printerManagerService.executePrintJob({
      printerName: "Broken_Printer",
      paperSize: "thermal_80mm",
      docType: "tax_invoice",
      docNumber: "INV-999",
      htmlContent: "<html></html>",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("offline");

    // Verify error was logged in print history
    const lastJob = await printerManagerService.getLastPrintJobForDocument("INV-999");
    expect(lastJob).toBeDefined();
    expect(lastJob?.status).toBe("failed");
    expect(lastJob?.errorMessage).toContain("offline");
  });

  it("stores and remembers last-used printer per paper size and document type", async () => {
    await printerManagerService.setLastUsedPrinter("tax_invoice", "a4", "HP LaserJet Pro MFP 4104");
    await printerManagerService.setLastUsedPrinter("tax_invoice", "thermal_80mm", "EPSON TM-T82 Thermal");

    const a4Printer = await printerManagerService.getLastUsedPrinter("tax_invoice", "a4");
    expect(a4Printer).toBe("HP LaserJet Pro MFP 4104");

    const thermalPrinter = await printerManagerService.getLastUsedPrinter("tax_invoice", "thermal_80mm");
    expect(thermalPrinter).toBe("EPSON TM-T82 Thermal");
  });

  it("persists and updates custom printer profiles offline", async () => {
    const customProfile: PrinterProfileConfig = {
      id: "EPSON TM-T82 Custom",
      printerName: "EPSON TM-T82 Thermal",
      paperSize: "thermal_80mm",
      marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
      scalePercent: 100,
      orientation: "portrait",
      copies: 2,
      isColor: false,
      silentPrint: true,
      currencySymbolFormat: "rs_text",
      thermalWidthMm: 80,
      enableAutoCut: true,
      enableCashDrawerKick: true,
    };

    await printerManagerService.saveProfile(customProfile);
    const retrieved = await printerManagerService.getProfileForPrinter("EPSON TM-T82 Thermal");
    expect(retrieved.copies).toBe(2);
    expect(retrieved.currencySymbolFormat).toBe("rs_text");
    expect(retrieved.enableAutoCut).toBe(true);
    expect(retrieved.enableCashDrawerKick).toBe(true);
  });
});
