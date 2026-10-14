import type {
  EntityDefinition,
  RowValidationError,
  ValidationContext,
  ImportPreviewRow,
  ImportDryRunSummary,
  RowAction,
} from "../registry/types";
import { isValidGstin, normalizeIndianPhone } from "../../masters/partiesStore";

/**
 * Convert Excel date serial numbers (e.g. 45200) to ISO date string (YYYY-MM-DD).
 * Excel day 1 is 1900-01-01 (with the 1900 leap year bug).
 */
export function excelSerialToIsoDate(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400 * 1000;
  const dateInfo = new Date(utcValue);
  return dateInfo.toISOString().slice(0, 10);
}

/**
 * Parse any Indian date (DD-MM-YYYY, DD/MM/YYYY, D-M-YYYY), ISO date (YYYY-MM-DD),
 * or Excel numerical serial into normalized YYYY-MM-DD format.
 */
export function parseAndNormalizeDate(input: any): { isoDate: string; displayDate: string; isValid: boolean } {
  if (input === null || input === undefined || String(input).trim() === "") {
    return { isoDate: "", displayDate: "", isValid: false };
  }

  const str = String(input).trim();

  // 1. Check if it's a numeric Excel serial (e.g. 45200 or 44561)
  if (/^\d{4,5}(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    if (num > 30000 && num < 80000) {
      try {
        const iso = excelSerialToIsoDate(num);
        const [y, m, d] = iso.split("-");
        return { isoDate: iso, displayDate: `${d}-${m}-${y}`, isValid: true };
      } catch {
        // Fall through
      }
    }
  }

  // 2. Check Indian date formats DD-MM-YYYY or DD/MM/YYYY
  const indianDateMatch = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (indianDateMatch) {
    const day = parseInt(indianDateMatch[1], 10);
    const month = parseInt(indianDateMatch[2], 10);
    const year = parseInt(indianDateMatch[3], 10);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970 && year <= 2100) {
      // Check day validity for month
      const daysInMonth = new Date(year, month, 0).getDate();
      if (day <= daysInMonth) {
        const padDay = String(day).padStart(2, "0");
        const padMonth = String(month).padStart(2, "0");
        return {
          isoDate: `${year}-${padMonth}-${padDay}`,
          displayDate: `${padDay}-${padMonth}-${year}`,
          isValid: true,
        };
      }
    }
  }

  // 3. Check ISO format YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const daysInMonth = new Date(year, month, 0).getDate();
      if (day <= daysInMonth) {
        const padDay = String(day).padStart(2, "0");
        const padMonth = String(month).padStart(2, "0");
        return {
          isoDate: `${year}-${padMonth}-${padDay}`,
          displayDate: `${padDay}-${padMonth}-${year}`,
          isValid: true,
        };
      }
    }
  }

  // 4. Month-Year format (MM-YYYY or MM/YYYY commonly used for expiry)
  const myMatch = str.match(/^(\d{1,2})[-\/.](\d{4})$/);
  if (myMatch) {
    const month = parseInt(myMatch[1], 10);
    const year = parseInt(myMatch[2], 10);
    if (month >= 1 && month <= 12) {
      const lastDay = new Date(year, month, 0).getDate();
      const padMonth = String(month).padStart(2, "0");
      return {
        isoDate: `${year}-${padMonth}-${lastDay}`,
        displayDate: `${lastDay}-${padMonth}-${year}`,
        isValid: true,
      };
    }
  }

  return { isoDate: "", displayDate: str, isValid: false };
}

/**
 * Validate HSN/SAC code against Indian GST rules (2, 4, 6, or 8 digits).
 */
export function isValidHsnCode(hsn: string): boolean {
  const clean = String(hsn).trim().replace(/\D/g, "");
  return [2, 4, 6, 8].includes(clean.length);
}

/**
 * Exact decimal rounder preventing floating-point epsilon inaccuracies.
 */
export function roundToExactDecimals(val: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

export class DataValidator {
  /**
   * Validate a single row against an EntityDefinition.
   */
  validateRow(
    row: Record<string, any>,
    rowNumber: number,
    entityDef: EntityDefinition,
    context: ValidationContext
  ): {
    errors: RowValidationError[];
    warnings: RowValidationError[];
    normalizedData: Record<string, any>;
  } {
    const errors: RowValidationError[] = [];
    const warnings: RowValidationError[] = [];
    const normalizedData: Record<string, any> = { ...row };

    // 1. Field-level type and requirement validations
    for (const [key, field] of Object.entries(entityDef.fields)) {
      const val = row[key];
      const hasValue = val !== undefined && val !== null && String(val).trim() !== "";

      // Required field check
      if (field.required && !hasValue) {
        errors.push({
          rowNumber,
          field: key,
          message: `Field "${field.label}" is required.`,
          severity: "error",
          code: "REQUIRED_FIELD_MISSING",
        });
        continue;
      }

      if (!hasValue) {
        if (field.defaultValue !== undefined) {
          normalizedData[key] = field.defaultValue;
        }
        continue;
      }

      // Type validations
      switch (field.type) {
        case "number":
        case "currency": {
          const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ""));
          if (isNaN(num)) {
            errors.push({
              rowNumber,
              field: key,
              value: val,
              message: `Field "${field.label}" must be a valid number.`,
              severity: "error",
              code: "INVALID_NUMBER",
            });
          } else {
            if (field.min !== undefined && num < field.min) {
              errors.push({
                rowNumber,
                field: key,
                value: num,
                message: `Field "${field.label}" cannot be less than ${field.min}.`,
                severity: "error",
                code: "MIN_VALUE_EXCEEDED",
              });
            }
            if (field.max !== undefined && num > field.max) {
              errors.push({
                rowNumber,
                field: key,
                value: num,
                message: `Field "${field.label}" cannot be greater than ${field.max}.`,
                severity: "error",
                code: "MAX_VALUE_EXCEEDED",
              });
            }
            normalizedData[key] = roundToExactDecimals(num, field.type === "currency" ? 2 : 4);
          }
          break;
        }

        case "date": {
          const parsedDate = parseAndNormalizeDate(val);
          if (!parsedDate.isValid) {
            errors.push({
              rowNumber,
              field: key,
              value: val,
              message: `Field "${field.label}" has invalid date format "${val}". Expected Indian format (DD-MM-YYYY).`,
              severity: "error",
              code: "INVALID_DATE_FORMAT",
            });
          } else {
            normalizedData[key] = parsedDate.displayDate;
            normalizedData[`${key}_iso`] = parsedDate.isoDate;

            // Warning if expiry date is in the past
            if (key.includes("expiry") || key.includes("exp")) {
              const todayIso = new Date().toISOString().slice(0, 10);
              if (parsedDate.isoDate < todayIso) {
                warnings.push({
                  rowNumber,
                  field: key,
                  value: val,
                  message: `Expiry date (${parsedDate.displayDate}) is in the past. Expired item.`,
                  severity: "warning",
                  code: "EXPIRED_DATE_WARNING",
                });
              }
            }
          }
          break;
        }

        case "boolean": {
          const s = String(val).toLowerCase().trim();
          normalizedData[key] = s === "true" || s === "1" || s === "yes" || s === "y";
          break;
        }

        case "select": {
          const s = String(val).trim();
          if (field.options && field.options.length > 0) {
            const valid = field.options.some(
              (opt) => opt.value.toLowerCase() === s.toLowerCase() || opt.label.toLowerCase() === s.toLowerCase()
            );
            if (!valid) {
              errors.push({
                rowNumber,
                field: key,
                value: val,
                message: `Invalid choice "${val}" for "${field.label}". Expected one of: ${field.options.map((o) => o.label).join(", ")}.`,
                severity: "error",
                code: "INVALID_SELECT_OPTION",
              });
            }
          }
          break;
        }

        case "string":
        default: {
          const s = String(val).trim();
          normalizedData[key] = s;

          // HSN Code specific check
          if (key === "hsn_sac_code" || key === "hsn_code" || key === "hsn") {
            if (!isValidHsnCode(s)) {
              warnings.push({
                rowNumber,
                field: key,
                value: s,
                message: `HSN code "${s}" should ideally be 2, 4, 6 or 8 digits under statutory GST rules.`,
                severity: "warning",
                code: "HSN_FORMAT_WARNING",
              });
            }
          }

          // GSTIN specific check
          if (key === "gstin" || key === "supplier_gstin" || key === "customer_gstin") {
            if (s.length > 0 && !isValidGstin(s)) {
              errors.push({
                rowNumber,
                field: key,
                value: s,
                message: `Invalid 15-character statutory GSTIN format: "${s}".`,
                severity: "error",
                code: "INVALID_GSTIN",
              });
            }
          }

          // Phone specific check
          if (key === "phone" || key === "mobile") {
            const cleanPhone = normalizeIndianPhone(s);
            if (cleanPhone.length !== 10) {
              errors.push({
                rowNumber,
                field: key,
                value: s,
                message: `Invalid mobile number "${s}". Must be a 10-digit Indian number.`,
                severity: "error",
                code: "INVALID_PHONE",
              });
            } else {
              normalizedData[key] = cleanPhone;
            }
          }

          // Regex pattern check if defined
          if (field.pattern && !field.pattern.test(s)) {
            errors.push({
              rowNumber,
              field: key,
              value: s,
              message: field.patternErrorMessage || `Field "${field.label}" does not match required format.`,
              severity: "error",
              code: "PATTERN_MISMATCH",
            });
          }
          break;
        }
      }
    }

    // 2. Pricing & Commercial Consistency Checks (MRP >= Selling Rate >= PTR)
    if (normalizedData.mrp && normalizedData.sel_rate) {
      if (Number(normalizedData.sel_rate) > Number(normalizedData.mrp)) {
        errors.push({
          rowNumber,
          field: "sel_rate",
          message: `Selling Rate (₹${normalizedData.sel_rate}) cannot exceed MRP (₹${normalizedData.mrp}).`,
          severity: "error",
          code: "SELLING_RATE_EXCEEDS_MRP",
        });
      }
    }

    // 3. Entity-specific custom validation hook
    if (entityDef.validateRow) {
      const customErrors = entityDef.validateRow(normalizedData, rowNumber, context);
      for (const err of customErrors) {
        if (err.severity === "warning") {
          warnings.push(err);
        } else {
          errors.push(err);
        }
      }
    }

    return { errors, warnings, normalizedData };
  }

  /**
   * Complete Dry-Run analysis across an entire batch of rows.
   */
  performDryRun(
    rows: Record<string, any>[],
    entityDef: EntityDefinition,
    context: ValidationContext,
    actionPolicy: "create_missing_masters" | "skip_duplicates" | "update_existing" | "merge_existing" = "create_missing_masters"
  ): {
    previewRows: ImportPreviewRow[];
    summary: ImportDryRunSummary;
  } {
    const previewRows: ImportPreviewRow[] = [];
    const missingMastersMap = new Map<string, Set<string>>();

    // Track internal duplicates inside the file itself
    const seenInternalKeys = new Map<string, number>();

    let validRowsCount = 0;
    let errorRowsCount = 0;
    let warningRowsCount = 0;
    let toCreateCount = 0;
    let toUpdateCount = 0;
    let toSkipCount = 0;
    let toMergeCount = 0;

    const filteredRows = rows.filter((rawRow) => !this.isEntityHeaderRow(rawRow, entityDef));

    for (let i = 0; i < filteredRows.length; i++) {
      const rowNum = i + 1;
      const rawRow = filteredRows[i];

      const { errors, warnings, normalizedData } = this.validateRow(rawRow, rowNum, entityDef, context);

      // Check duplicates against existing database records
      let duplicateMatch: ImportPreviewRow["duplicateMatch"] | undefined;
      for (const dupDef of entityDef.duplicateKeys) {
        const match = context.existingRecords.find((existing) =>
          dupDef.fields.every((f) => {
            const normVal = String(normalizedData[f] || "").trim().toLowerCase();
            const existVal = String(existing[f] || "").trim().toLowerCase();
            return normVal.length > 0 && normVal === existVal;
          })
        );

        if (match) {
          duplicateMatch = {
            key: dupDef.label,
            existingId: match.id || match.code || "unknown",
            existingSummary: match.name || match.barcode || match.invoice_number || "Existing Record",
          };
          break;
        }
      }

      // Check internal duplicates within file
      for (const dupDef of entityDef.duplicateKeys) {
        const compositeKey = dupDef.fields.map((f) => String(normalizedData[f] || "").toLowerCase()).join("::");
        if (compositeKey.replace(/:/g, "").length > 0) {
          if (seenInternalKeys.has(compositeKey)) {
            warnings.push({
              rowNumber: rowNum,
              message: `Duplicate entry within file matching Row #${seenInternalKeys.get(compositeKey)} (${dupDef.label}).`,
              severity: "warning",
              code: "INTERNAL_FILE_DUPLICATE",
            });
          } else {
            seenInternalKeys.set(compositeKey, rowNum);
          }
        }
      }

      // Check Foreign Keys (e.g. unknown brand, unit, category, supplier)
      const missingFks: ImportPreviewRow["missingForeignKeys"] = [];
      if (entityDef.foreignKeys) {
        for (const fk of entityDef.foreignKeys) {
          const val = normalizedData[fk.field];
          if (val && String(val).trim().length > 0) {
            const cache = context.foreignKeysCache[fk.targetEntityId] || [];
            const exists = cache.some(
              (item) => String(item[fk.lookupField] || "").toLowerCase() === String(val).toLowerCase()
            );

            if (!exists) {
              missingFks.push({
                field: fk.field,
                targetEntityId: fk.targetEntityId,
                value: String(val),
              });

              if (!missingMastersMap.has(fk.targetEntityId)) {
                missingMastersMap.set(fk.targetEntityId, new Set());
              }
              missingMastersMap.get(fk.targetEntityId)!.add(String(val));

              if (!fk.autoCreateSupported && actionPolicy !== "create_missing_masters") {
                errors.push({
                  rowNumber: rowNum,
                  field: fk.field,
                  value: val,
                  message: `Referenced ${fk.targetEntityId} "${val}" does not exist in master records.`,
                  severity: "error",
                  code: "FOREIGN_KEY_NOT_FOUND",
                });
              } else {
                warnings.push({
                  rowNumber: rowNum,
                  field: fk.field,
                  value: val,
                  message: `Referenced ${fk.targetEntityId} "${val}" will be auto-created during import.`,
                  severity: "warning",
                  code: "AUTO_CREATE_MASTER_NOTICE",
                });
              }
            }
          }
        }
      }

      // Determine Action
      let action: RowAction = "create";
      if (errors.length > 0) {
        action = "error";
        errorRowsCount++;
      } else {
        validRowsCount++;
        if (duplicateMatch) {
          if (actionPolicy === "skip_duplicates") {
            action = "skip";
            toSkipCount++;
          } else if (actionPolicy === "update_existing") {
            action = "update";
            toUpdateCount++;
          } else if (actionPolicy === "merge_existing") {
            action = "merge";
            toMergeCount++;
          } else {
            action = "update";
            toUpdateCount++;
          }
        } else {
          action = "create";
          toCreateCount++;
        }
      }

      if (warnings.length > 0) {
        warningRowsCount++;
      }

      previewRows.push({
        rowNumber: rowNum,
        data: normalizedData,
        errors: [...errors, ...warnings],
        action,
        duplicateMatch,
        missingForeignKeys: missingFks.length > 0 ? missingFks : undefined,
      });
    }

    const missingMasters = Array.from(missingMastersMap.entries()).map(([entityId, valSet]) => ({
      entityId,
      field: "name",
      values: Array.from(valSet),
    }));

    return {
      previewRows,
      summary: {
        totalRows: filteredRows.length,
        validRowsCount,
        errorRowsCount,
        warningRowsCount,
        toCreateCount,
        toUpdateCount,
        toSkipCount,
        toMergeCount,
        missingMasters,
      },
    };
  }

  /**
   * Detect if a mapped row is actually a header or sub-header row (e.g. cell values match field keys or labels).
   */
  private isEntityHeaderRow(rawRow: Record<string, any>, entityDef: EntityDefinition): boolean {
    let matchedHeaderCells = 0;
    let nonEmptyCells = 0;

    for (const [key, field] of Object.entries(entityDef.fields)) {
      const val = String(rawRow[key] ?? "").trim();
      if (!val) continue;
      nonEmptyCells++;

      const cleanVal = val.toLowerCase().replace(/\s*\*\s*$/, "").trim();
      const cleanKey = key.toLowerCase();
      const cleanLabel = field.label.toLowerCase().trim();

      if (cleanVal === cleanKey || cleanVal === cleanLabel) {
        matchedHeaderCells++;
      }
    }

    return nonEmptyCells >= 2 && matchedHeaderCells >= 2 && matchedHeaderCells >= Math.ceil(nonEmptyCells * 0.5);
  }
}

export const dataValidator = new DataValidator();
