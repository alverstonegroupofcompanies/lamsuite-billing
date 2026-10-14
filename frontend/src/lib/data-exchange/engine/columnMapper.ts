import type { EntityDefinition, ColumnMapping } from "../registry/types";

export interface SourcePreset {
  id: string;
  name: string;
  description: string;
  mappings: Record<string, string>; // sourceHeaderLower -> targetFieldKey
}

export const BUILTIN_SOURCE_PRESETS: SourcePreset[] = [
  {
    id: "marg_erp",
    name: "Marg ERP 9+",
    description: "Export format from Marg Pharmaceuticals / FMCG billing software",
    mappings: {
      item_name: "name",
      itemname: "name",
      particulars: "name",
      batch_no: "batch_no",
      batchno: "batch_no",
      exp_date: "expiry_date",
      expdate: "expiry_date",
      expiry: "expiry_date",
      pur_rate: "ptr",
      purrate: "ptr",
      cost_rate: "ptr",
      mrp: "mrp",
      s_rate: "sel_rate",
      salerate: "sel_rate",
      srate: "sel_rate",
      qty: "stock_qty",
      conv_pack: "units_per_pack",
      packing: "units_per_pack",
      hsn_code: "hsn_sac_code",
      hsncode: "hsn_sac_code",
      bar_code: "barcode",
      barcode: "barcode",
      sgst_cgst: "gst_percent",
      tax_per: "gst_percent",
      party_name: "name",
      partyname: "name",
      mobile_no: "phone",
      mobileno: "phone",
      gst_no: "gstin",
      gstno: "gstin",
    },
  },
  {
    id: "busy_21",
    name: "Busy Accounting 21+",
    description: "Standard master and bill exports from Busy Accounting",
    mappings: {
      item_name: "name",
      alias: "barcode",
      item_code: "barcode",
      batch: "batch_no",
      exp_date: "expiry_date",
      quantity: "stock_qty",
      qty: "stock_qty",
      price: "ptr",
      mrp: "mrp",
      sale_price: "sel_rate",
      tax: "gst_percent",
      tax_percent: "gst_percent",
      tax_rate: "gst_percent",
      hsn_sac: "hsn_sac_code",
      account_name: "name",
      party: "name",
      mobile: "phone",
      gstin: "gstin",
      state: "place_of_supply",
    },
  },
  {
    id: "tally_prime",
    name: "Tally Prime",
    description: "XML and Excel inventory / ledger exports from Tally Prime & ERP 9",
    mappings: {
      item: "name",
      stock_item: "name",
      part_no: "barcode",
      billed_qty: "stock_qty",
      actual_qty: "stock_qty",
      rate: "sel_rate",
      per: "unit_name",
      mrp: "mrp",
      hsn: "hsn_sac_code",
      tax_rate: "gst_percent",
      ledger_name: "name",
      phone_no: "phone",
      gstin_uin: "gstin",
      state_name: "place_of_supply",
    },
  },
  {
    id: "lamsuite_standard",
    name: "LamSuite Standard",
    description: "Native LamSuite round-trip export headers",
    mappings: {},
  },
];

export class ColumnMapper {
  private normalizeString(str: string): string {
    return str
      .trim()
      .toLowerCase()
      .replace(/%/g, "_percent")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  /**
   * Suggest column mapping for source headers against entity definition.
   */
  suggestMapping(headers: string[], entityDef: EntityDefinition, presetId?: string): ColumnMapping[] {
    const preset = BUILTIN_SOURCE_PRESETS.find((p) => p.id === presetId);
    const assignedFields = new Set<string>();

    return headers.map((sourceCol) => {
      const normSource = this.normalizeString(sourceCol);

      // 1. Check active preset mappings
      if (preset && preset.mappings[normSource]) {
        const target = preset.mappings[normSource];
        if (entityDef.fields[target] && !assignedFields.has(target)) {
          assignedFields.add(target);
          return {
            sourceColumn: sourceCol,
            targetField: target,
            confidence: 0.95,
            isAutoMatched: true,
          };
        }
      }

      // 2. Exact match with field key
      for (const [key, field] of Object.entries(entityDef.fields)) {
        if (this.normalizeString(key) === normSource) {
          assignedFields.add(key);
          return {
            sourceColumn: sourceCol,
            targetField: key,
            confidence: 1.0,
            isAutoMatched: true,
          };
        }
      }

      // 3. Exact match with field label
      for (const [key, field] of Object.entries(entityDef.fields)) {
        if (this.normalizeString(field.label) === normSource && !assignedFields.has(key)) {
          assignedFields.add(key);
          return {
            sourceColumn: sourceCol,
            targetField: key,
            confidence: 0.9,
            isAutoMatched: true,
          };
        }
      }

      // 4. Match with aliases
      for (const [key, field] of Object.entries(entityDef.fields)) {
        if (field.aliases && !assignedFields.has(key)) {
          const matchAlias = field.aliases.some((alias) => this.normalizeString(alias) === normSource);
          if (matchAlias) {
            assignedFields.add(key);
            return {
              sourceColumn: sourceCol,
              targetField: key,
              confidence: 0.85,
              isAutoMatched: true,
            };
          }
        }
      }

      // 5. Fuzzy / Substring heuristic
      for (const [key, field] of Object.entries(entityDef.fields)) {
        if (!assignedFields.has(key)) {
          const normKey = this.normalizeString(key);
          if (normSource.includes(normKey) || normKey.includes(normSource)) {
            assignedFields.add(key);
            return {
              sourceColumn: sourceCol,
              targetField: key,
              confidence: 0.7,
              isAutoMatched: true,
            };
          }
        }
      }

      // No high confidence match found
      return {
        sourceColumn: sourceCol,
        targetField: null,
        confidence: 0,
        isAutoMatched: false,
      };
    });
  }

  /**
   * Save user custom mapping to localStorage.
   */
  saveUserMapping(name: string, entityId: string, mappings: Record<string, string>): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    const key = `lamsuite_mapping_${entityId}_${name}`;
    localStorage.setItem(key, JSON.stringify(mappings));
  }

  /**
   * Load user custom mapping from localStorage.
   */
  loadUserMapping(name: string, entityId: string): Record<string, string> | null {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const key = `lamsuite_mapping_${entityId}_${name}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * List all saved custom mappings for an entity.
   */
  listUserMappings(entityId: string): string[] {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const prefix = `lamsuite_mapping_${entityId}_`;
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        names.push(k.substring(prefix.length));
      }
    }
    return names;
  }
}

export const columnMapper = new ColumnMapper();
