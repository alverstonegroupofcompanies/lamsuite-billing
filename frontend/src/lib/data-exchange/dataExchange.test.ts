import { describe, it, expect, beforeEach } from "vitest";
import { universalDataParser } from "./engine/parser";
import { columnMapper } from "./engine/columnMapper";
import { dataValidator, parseAndNormalizeDate, excelSerialToIsoDate, isValidHsnCode } from "./engine/validator";
import { entityRegistry } from "./registry/entityRegistry";
import { templateGenerator } from "./engine/templateGenerator";
import { transactionalImporter } from "./engine/transactionalImporter";
import { universalExporter } from "./engine/exporter";
import { nonBlockingChunkRunner } from "./engine/importWorker";
import { sqliteStorage } from "../db/sqliteStorage";

describe("LamSuite Data Exchange (Import & Export Engine)", () => {
  beforeEach(async () => {
    await sqliteStorage.initDatabase();
  });

  describe("1. Universal Parser (CSV, TSV, SpreadsheetML)", () => {
    it("parses standard CSV with comma delimiter", () => {
      const csv = `barcode,name,mrp,sel_rate\n890123,Paracetamol,35,30\n890456,Amoxicillin,100,90`;
      const result = universalDataParser.parseText(csv, "catalog.csv");
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].headers).toEqual(["barcode", "name", "mrp", "sel_rate"]);
      expect(result.sheets[0].rows).toHaveLength(2);
      expect(result.sheets[0].rows[0].barcode).toBe("890123");
      expect(result.sheets[0].rows[0].name).toBe("Paracetamol");
    });

    it("parses TSV with tab delimiter and handles quoted cells with commas and newlines", () => {
      const tsv = `barcode\tname\tmrp\n890111\t"Paracetamol, 500mg"\t50.00`;
      const result = universalDataParser.parseText(tsv, "tab_data.tsv");
      expect(result.sheets[0].headers).toEqual(["barcode", "name", "mrp"]);
      expect(result.sheets[0].rows[0].name).toBe("Paracetamol, 500mg");
    });

    it("parses Excel 2003 / SpreadsheetML XML format with multiple worksheets", () => {
      const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Products">
    <Table>
      <Row><Cell><Data ss:Type="String">barcode</Data></Cell><Cell><Data ss:Type="String">name</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">890999</Data></Cell><Cell><Data ss:Type="String">Aspirin 75mg</Data></Cell></Row>
    </Table>
  </Worksheet>
</Workbook>`;
      const result = universalDataParser.parseText(xml, "marg_export.xml");
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].sheetName).toBe("Products");
      expect(result.sheets[0].headers).toEqual(["barcode", "name"]);
      expect(result.sheets[0].rows[0].barcode).toBe("890999");
      expect(result.sheets[0].rows[0].name).toBe("Aspirin 75mg");
    });
  });

  describe("2. Column Mapper & Source Software Presets", () => {
    const itemsDef = entityRegistry.require("items");

    it("auto-detects Marg ERP 9+ headers using preset", () => {
      const headers = ["ITEM_NAME", "BAR_CODE", "MRP", "PUR_RATE", "S_RATE", "HSN_CODE", "CONV_PACK"];
      const mappings = columnMapper.suggestMapping(headers, itemsDef, "marg_erp");

      const mapDict: Record<string, string | null> = {};
      mappings.forEach((m) => {
        mapDict[m.sourceColumn] = m.targetField;
      });

      expect(mapDict["ITEM_NAME"]).toBe("name");
      expect(mapDict["BAR_CODE"]).toBe("barcode");
      expect(mapDict["MRP"]).toBe("mrp");
      expect(mapDict["PUR_RATE"]).toBe("ptr");
      expect(mapDict["S_RATE"]).toBe("sel_rate");
      expect(mapDict["HSN_CODE"]).toBe("hsn_sac_code");
      expect(mapDict["CONV_PACK"]).toBe("units_per_pack");
    });

    it("auto-detects Busy Accounting 21+ headers", () => {
      const headers = ["Item Name", "Alias", "MRP", "Sale Price", "Tax %", "HSN/SAC"];
      const mappings = columnMapper.suggestMapping(headers, itemsDef, "busy_21");

      const mapDict: Record<string, string | null> = {};
      mappings.forEach((m) => {
        mapDict[m.sourceColumn] = m.targetField;
      });

      expect(mapDict["Item Name"]).toBe("name");
      expect(mapDict["Alias"]).toBe("barcode");
      expect(mapDict["MRP"]).toBe("mrp");
      expect(mapDict["Sale Price"]).toBe("sel_rate");
      expect(mapDict["Tax %"]).toBe("gst_percent");
      expect(mapDict["HSN/SAC"]).toBe("hsn_sac_code");
    });

    it("auto-detects Tally Prime headers", () => {
      const headers = ["Item", "Part No.", "Rate", "MRP", "HSN"];
      const mappings = columnMapper.suggestMapping(headers, itemsDef, "tally_prime");

      const mapDict: Record<string, string | null> = {};
      mappings.forEach((m) => {
        mapDict[m.sourceColumn] = m.targetField;
      });

      expect(mapDict["Item"]).toBe("name");
      expect(mapDict["Part No."]).toBe("barcode");
      expect(mapDict["Rate"]).toBe("sel_rate");
      expect(mapDict["MRP"]).toBe("mrp");
      expect(mapDict["HSN"]).toBe("hsn_sac_code");
    });
  });

  describe("3. Data Formats, Dates, GSTIN & Exact Math", () => {
    it("converts Excel serial dates to standard ISO and Indian date formats", () => {
      // Excel serial 45200 is 2023-10-01
      const res = parseAndNormalizeDate(45200);
      expect(res.isValid).toBe(true);
      expect(res.isoDate).toBe("2023-10-01");
      expect(res.displayDate).toBe("01-10-2023");
    });

    it("correctly parses Indian date DD-MM-YYYY and DD/MM/YYYY", () => {
      const d1 = parseAndNormalizeDate("15-08-2026");
      expect(d1.isValid).toBe(true);
      expect(d1.isoDate).toBe("2026-08-15");
      expect(d1.displayDate).toBe("15-08-2026");

      const d2 = parseAndNormalizeDate("05/11/2027");
      expect(d2.isValid).toBe(true);
      expect(d2.isoDate).toBe("2027-11-05");
    });

    it("rejects impossible/bad dates", () => {
      const bad1 = parseAndNormalizeDate("31-02-2026"); // February 31st
      expect(bad1.isValid).toBe(false);

      const bad2 = parseAndNormalizeDate("99-99-9999");
      expect(bad2.isValid).toBe(false);

      const bad3 = parseAndNormalizeDate("invalid-date-string");
      expect(bad3.isValid).toBe(false);
    });

    it("validates statutory HSN codes (2, 4, 6, 8 digits)", () => {
      expect(isValidHsnCode("3004")).toBe(true);
      expect(isValidHsnCode("30049099")).toBe(true);
      expect(isValidHsnCode("30")).toBe(true);
      expect(isValidHsnCode("123")).toBe(false); // 3 digits is invalid
      expect(isValidHsnCode("12345")).toBe(false); // 5 digits is invalid
    });
  });

  describe("4. Dry Run, Validation & Error Handling", () => {
    const itemsDef = entityRegistry.require("items");

    it("validates clean data with 0 errors", () => {
      const cleanRows = [
        {
          barcode: "8901234567890",
          name: "Azithromycin 500mg",
          hsn_sac_code: "30049099",
          mrp: 120.0,
          sel_rate: 110.0,
          ptr: 85.0,
          gst_percent: 12,
        },
      ];

      const { previewRows, summary } = dataValidator.performDryRun(
        cleanRows,
        itemsDef,
        { existingRecords: [], foreignKeysCache: {} }
      );

      expect(summary.errorRowsCount).toBe(0);
      expect(summary.validRowsCount).toBe(1);
      expect(summary.toCreateCount).toBe(1);
      expect(previewRows[0].action).toBe("create");
    });

    it("flags messy data with row errors and commercial inconsistencies (Selling Rate > MRP)", () => {
      const messyRows = [
        {
          barcode: "", // Missing required barcode
          name: "Faulty Item 1",
          mrp: 50.0,
          sel_rate: 45.0,
        },
        {
          barcode: "890888777",
          name: "Overpriced Item",
          mrp: 50.0,
          sel_rate: 65.0, // Selling rate exceeds MRP!
        },
      ];

      const { previewRows, summary } = dataValidator.performDryRun(
        messyRows,
        itemsDef,
        { existingRecords: [], foreignKeysCache: {} }
      );

      expect(summary.errorRowsCount).toBe(2);
      expect(previewRows[0].errors.some((e) => e.code === "REQUIRED_FIELD_MISSING")).toBe(true);
      expect(previewRows[1].errors.some((e) => e.code === "SELLING_RATE_EXCEEDS_MRP")).toBe(true);
    });

    it("detects existing duplicate records by primary barcode and suggests update", () => {
      const existingProduct = {
        id: "prod_1",
        barcode: "8901112223334",
        name: "Existing Paracetamol",
        mrp: 30,
        sel_rate: 28,
      };

      const rows = [
        {
          barcode: "8901112223334",
          name: "Existing Paracetamol (Updated Price)",
          mrp: 35.0,
          sel_rate: 32.0,
          hsn_sac_code: "30049099",
          gst_percent: 12,
        },
      ];

      const { previewRows, summary } = dataValidator.performDryRun(
        rows,
        itemsDef,
        { existingRecords: [existingProduct], foreignKeysCache: {} },
        "update_existing"
      );

      expect(summary.toUpdateCount).toBe(1);
      expect(previewRows[0].duplicateMatch).toBeDefined();
      expect(previewRows[0].duplicateMatch?.key).toBe("Primary Barcode");
      expect(previewRows[0].action).toBe("update");
    });
  });

  describe("5. Transactional Batch Importer & Rollback Undo", () => {
    const itemsDef = entityRegistry.require("items");

    it("imports a batch of items and rolls back cleanly with undo", async () => {
      const testBarcode = `TEST_${Date.now()}`;
      const rows = [
        {
          barcode: testBarcode,
          name: "Rollback Test Product",
          hsn_sac_code: "30049099",
          mrp: 50.0,
          sel_rate: 45.0,
          gst_percent: 12,
        },
      ];

      // 1. Execute Import
      const importRes = await transactionalImporter.executeImport({
        entityDef: itemsDef,
        fileName: "test_import.csv",
        rows,
      });

      expect(importRes.success).toBe(true);
      expect(importRes.createdCount).toBe(1);

      // Verify record is in database
      const inserted = await sqliteStorage.findByField<any>("products", "barcode", testBarcode);
      expect(inserted).toBeDefined();
      expect(inserted?.name).toBe("Rollback Test Product");

      // 2. Execute Rollback Undo
      const rollbackRes = await transactionalImporter.rollbackImport(importRes.batchId);
      expect(rollbackRes.success).toBe(true);
      expect(rollbackRes.revertedCount).toBe(1);

      // Verify record was deleted/reverted from database
      const afterRollback = await sqliteStorage.findByField<any>("products", "barcode", testBarcode);
      expect(afterRollback).toBeNull();
    });

    it("auto-creates missing masters (groups, brands, units) during import so re-importing the same file shows no missing master warnings", async () => {
      const itemsDef = entityRegistry.require("items");
      const groupsDef = entityRegistry.require("groups");
      const brandsDef = entityRegistry.require("brands");
      const unitsDef = entityRegistry.require("units");

      const sampleRows = [
        {
          barcode: "8901030012345",
          name: "Paracetamol 500mg Tablet (1x15)",
          hsn_sac_code: "30049099",
          category_name: "Analgesics",
          brand_name: "Calpol",
          unit_name: "STRIP",
          gst_percent: 12,
          mrp: 35,
          sel_rate: 32,
          ptr: 22.5,
        },
        {
          barcode: "8901030098765",
          name: "Amoxicillin 250mg Capsule (1x10)",
          hsn_sac_code: "30041000",
          category_name: "Antibiotics",
          brand_name: "Mox",
          unit_name: "STRIP",
          gst_percent: 12,
          mrp: 110,
          sel_rate: 98,
          ptr: 75,
        },
      ];

      // 1. First dry run: masters do not exist yet, so missingMasters should report groups, brands, units
      const firstDryRun = dataValidator.performDryRun(
        sampleRows,
        itemsDef,
        {
          existingRecords: await sqliteStorage.findAll("products"),
          foreignKeysCache: {
            groups: await groupsDef.exportQuery!(),
            brands: await brandsDef.exportQuery!(),
            units: await unitsDef.exportQuery!(),
          },
        },
        "create_missing_masters"
      );

      expect(firstDryRun.summary.missingMasters.length).toBe(3);

      // 2. Execute Import with actionPolicy = "create_missing_masters"
      const importRes = await transactionalImporter.executeImport({
        entityDef: itemsDef,
        fileName: "items_template.xlsx",
        rows: firstDryRun.previewRows.map((r) => r.data),
        actionPolicy: "create_missing_masters",
      });

      expect(importRes.success).toBe(true);
      expect(importRes.createdCount).toBe(2);

      // 3. Re-run Dry Run on the exact same spreadsheet rows
      const secondDryRun = dataValidator.performDryRun(
        sampleRows,
        itemsDef,
        {
          existingRecords: await sqliteStorage.findAll("products"),
          foreignKeysCache: {
            groups: await groupsDef.exportQuery!(),
            brands: await brandsDef.exportQuery!(),
            units: await unitsDef.exportQuery!(),
          },
        },
        "create_missing_masters"
      );

      // Missing masters must now be 0 (Analgesics, Antibiotics, Calpol, Mox, STRIP were created!)
      expect(secondDryRun.summary.missingMasters).toHaveLength(0);
      expect(secondDryRun.summary.warningRowsCount).toBe(0);
      expect(secondDryRun.summary.toUpdateCount).toBe(2);
      expect(secondDryRun.summary.toCreateCount).toBe(0);

      // 4. Re-executing import updates the 2 existing items instead of duplicating
      const secondImportRes = await transactionalImporter.executeImport({
        entityDef: itemsDef,
        fileName: "items_template.xlsx",
        rows: secondDryRun.previewRows.map((r) => r.data),
        actionPolicy: "create_missing_masters",
      });

      expect(secondImportRes.updatedCount).toBe(2);
      expect(secondImportRes.createdCount).toBe(0);
    });
  });

  describe("6. Non-Blocking Large File Runner", () => {
    it("simulates streaming 1,000 rows without blocking and reports progress", async () => {
      const largeRows = Array.from({ length: 1000 }, (_, i) => ({ id: i, val: `Row ${i}` }));
      let reportedProgressCount = 0;

      const processed = await nonBlockingChunkRunner.processInTimeSlices(
        largeRows,
        200,
        async (chunk) => {
          return chunk.map((item) => ({ ...item, processed: true }));
        },
        (progress) => {
          reportedProgressCount++;
          expect(progress.percentage).toBeGreaterThanOrEqual(0);
          expect(progress.percentage).toBeLessThanOrEqual(100);
        }
      );

      expect(processed).toHaveLength(1000);
      expect(reportedProgressCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("7. Round-Trip Export & Import Symmetry", () => {
    const customersDef = entityRegistry.require("customers");

    it("generates CSV export that can be parsed and mapped 100% symmetrically by importer", () => {
      const sampleCustomers = [
        {
          id: "cust_101",
          name: "Suresh Menon",
          phone: "9847012345",
          gstin: "32AAAAA0000A1Z5",
          address: "Aluva, Kochi",
          place_of_supply: "Kerala",
          credit_limit: 15000,
          outstanding_balance: 1200,
          is_active: true,
        },
      ];

      const columns = Object.values(customersDef.fields).map((f) => ({
        key: f.key,
        label: f.label,
      }));

      // 1. Export to CSV
      const csvContent = universalExporter.generateCsv(columns, sampleCustomers);
      expect(csvContent).toContain("Suresh Menon");
      expect(csvContent).toContain("9847012345");

      // 2. Parse Exported CSV with universal parser
      const parsed = universalDataParser.parseText(csvContent, "exported_customers.csv");
      expect(parsed.sheets[0].rows).toHaveLength(1);

      // 3. Map Columns
      const mappings = columnMapper.suggestMapping(parsed.sheets[0].headers, customersDef);

      // All customer fields should be mapped with high confidence
      const unmapped = mappings.filter((m) => m.targetField === null);
      expect(unmapped).toHaveLength(0);

      // Name and phone must map exactly
      const nameMap = mappings.find((m) => m.targetField === "name");
      const phoneMap = mappings.find((m) => m.targetField === "phone");
      expect(nameMap).toBeDefined();
      expect(phoneMap).toBeDefined();
    });

    it("parses Excel template and skips any secondary field-key header row so headers never appear as items", () => {
      const itemsDef = entityRegistry.require("items");
      const xmlTemplate = templateGenerator.generateExcelXmlTemplate(itemsDef, true);
      const parsed = universalDataParser.parseText(xmlTemplate, "items_template.xlsx");

      // Should only have the 2 sample rows, NOT the field key row
      expect(parsed.sheets[0].rows).toHaveLength(2);
      expect(parsed.sheets[0].rows[0]["Barcode / SKU *"]).toBe("8901030012345");

      // Also test a legacy 2-header CSV where row 1 has labels and row 2 has field keys
      const legacyCsv = `"Barcode / SKU *","Product Name *","Print Name","Generic / Composition","HSN / SAC Code *"\n"barcode","name","print_name","generic_name","hsn_sac_code"\n"8901030012345","Paracetamol 500mg","Paracetamol 500","Paracetamol IP","30049099"`;
      const parsedLegacy = universalDataParser.parseText(legacyCsv, "legacy.csv");
      expect(parsedLegacy.sheets[0].rows).toHaveLength(1);
      expect(parsedLegacy.sheets[0].rows[0]["Barcode / SKU *"]).toBe("8901030012345");
    });
  });
});
