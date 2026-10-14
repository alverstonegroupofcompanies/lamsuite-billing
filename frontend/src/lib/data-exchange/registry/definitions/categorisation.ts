import type { EntityDefinition } from "../types";
import { sqliteStorage } from "../../../db/sqliteStorage";

export const groupsDefinition: EntityDefinition = {
  id: "groups",
  label: "Item Groups & Categories",
  singularLabel: "Group",
  category: "masters",
  description: "Product categories, therapeutic classifications, and departmental groupings.",
  targetTable: "master_lookups",
  primaryKey: "id",
  requiredPermission: "masters:create",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "name", label: "Group Name", fields: ["name"], exactMatch: false },
  ],
  fields: {
    name: {
      key: "name",
      label: "Group / Category Name",
      type: "string",
      required: true,
      example: "Antibiotics",
      description: "Category display name",
      aliases: ["group", "group_name", "category", "category_name"],
    },
    parent_group: {
      key: "parent_group",
      label: "Parent Group",
      type: "string",
      required: false,
      example: "Pharmaceuticals",
      description: "Parent group for category hierarchies",
      aliases: ["parent", "parent_category"],
    },
    is_active: {
      key: "is_active",
      label: "Is Active",
      type: "boolean",
      required: false,
      defaultValue: true,
      example: true,
      description: "Active status",
    },
  },
  sampleRows: [
    { name: "Antibiotics", parent_group: "Medicines", is_active: true },
    { name: "Pain Relief", parent_group: "Medicines", is_active: true },
  ],
  transformRow: (raw) => ({
    id: raw.id || `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "category",
    name: String(raw.name || "").trim(),
    parent_name: raw.parent_group ? String(raw.parent_group).trim() : null,
    is_active: raw.is_active === false || raw.is_active === 0 ? 0 : 1,
  }),
  exportQuery: async () => {
    const list = await sqliteStorage.findAll<any>("master_lookups");
    return list.filter((item) => item.type === "category");
  },
};

export const brandsDefinition: EntityDefinition = {
  id: "brands",
  label: "Brands & Marketers",
  singularLabel: "Brand",
  category: "masters",
  description: "Product brands, trade names, and pharmaceutical marketers.",
  targetTable: "master_lookups",
  primaryKey: "id",
  requiredPermission: "masters:create",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "name", label: "Brand Name", fields: ["name"], exactMatch: false },
  ],
  fields: {
    name: {
      key: "name",
      label: "Brand Name",
      type: "string",
      required: true,
      example: "Cipla",
      description: "Commercial trade brand name",
      aliases: ["brand", "brand_name", "company"],
    },
    is_active: {
      key: "is_active",
      label: "Is Active",
      type: "boolean",
      required: false,
      defaultValue: true,
      example: true,
      description: "Active status",
    },
  },
  sampleRows: [
    { name: "Cipla", is_active: true },
    { name: "Sun Pharma", is_active: true },
    { name: "Abbott", is_active: true },
  ],
  transformRow: (raw) => ({
    id: raw.id || `brd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "brand",
    name: String(raw.name || "").trim(),
    is_active: raw.is_active === false || raw.is_active === 0 ? 0 : 1,
  }),
  exportQuery: async () => {
    const list = await sqliteStorage.findAll<any>("master_lookups");
    return list.filter((item) => item.type === "brand");
  },
};

export const manufacturersDefinition: EntityDefinition = {
  id: "manufacturers",
  label: "Manufacturers",
  singularLabel: "Manufacturer",
  category: "masters",
  description: "Licensed pharmaceutical and FMCG manufacturers.",
  targetTable: "master_lookups",
  primaryKey: "id",
  requiredPermission: "masters:create",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "name", label: "Manufacturer Name", fields: ["name"], exactMatch: false },
  ],
  fields: {
    name: {
      key: "name",
      label: "Manufacturer Name",
      type: "string",
      required: true,
      example: "GlaxoSmithKline Pharmaceuticals Ltd",
      description: "Company manufacturing entity",
      aliases: ["mfg_name", "manufacturer", "mfg_company"],
    },
    address: {
      key: "address",
      label: "Factory / Plant Address",
      type: "string",
      required: false,
      example: "Plot 10, Industrial Area, Solan HP",
      description: "Manufacturing plant location",
      aliases: ["address", "location"],
    },
    is_active: {
      key: "is_active",
      label: "Is Active",
      type: "boolean",
      required: false,
      defaultValue: true,
      example: true,
      description: "Active status",
    },
  },
  sampleRows: [
    { name: "GlaxoSmithKline Ltd", address: "Mumbai, Maharashtra", is_active: true },
    { name: "Pfizer India Ltd", address: "Navi Mumbai", is_active: true },
  ],
  transformRow: (raw) => ({
    id: raw.id || `mfg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "manufacturer",
    name: String(raw.name || "").trim(),
    address: raw.address ? String(raw.address).trim() : null,
    is_active: raw.is_active === false || raw.is_active === 0 ? 0 : 1,
  }),
  exportQuery: async () => {
    const list = await sqliteStorage.findAll<any>("master_lookups");
    return list.filter((item) => item.type === "manufacturer");
  },
};

export const unitsDefinition: EntityDefinition = {
  id: "units",
  label: "Units of Measure (UOM)",
  singularLabel: "Unit",
  category: "masters",
  description: "Standard units of measure for inventory and billing conversions.",
  targetTable: "master_lookups",
  primaryKey: "id",
  requiredPermission: "masters:create",
  supportsRoundTrip: true,
  duplicateKeys: [
    { id: "symbol", label: "Unit Symbol", fields: ["symbol"], exactMatch: true },
    { id: "name", label: "Unit Name", fields: ["name"], exactMatch: false },
  ],
  fields: {
    name: {
      key: "name",
      label: "Unit Name",
      type: "string",
      required: true,
      example: "STRIP",
      description: "Unit description (e.g. TABLET, STRIP, BOTTLE, BOX, KG)",
      aliases: ["unit", "unit_name", "uom"],
    },
    symbol: {
      key: "symbol",
      label: "Unit Code / Symbol",
      type: "string",
      required: true,
      example: "STP",
      description: "Statutory 3-character GST unit quantity code (e.g. NOS, KGS, BOX)",
      aliases: ["symbol", "code", "uqc", "unit_code"],
    },
    precision: {
      key: "precision",
      label: "Decimal Precision",
      type: "number",
      required: false,
      defaultValue: 0,
      example: 0,
      description: "Allowed decimal places (0 for discrete units, 2 or 3 for weight/length)",
      aliases: ["precision", "decimals"],
      min: 0,
      max: 4,
    },
    is_active: {
      key: "is_active",
      label: "Is Active",
      type: "boolean",
      required: false,
      defaultValue: true,
      example: true,
      description: "Active status",
    },
  },
  sampleRows: [
    { name: "STRIP", symbol: "STP", precision: 0, is_active: true },
    { name: "TABLET", symbol: "TAB", precision: 0, is_active: true },
    { name: "BOTTLE", symbol: "BTL", precision: 0, is_active: true },
    { name: "KILOGRAM", symbol: "KGS", precision: 3, is_active: true },
  ],
  transformRow: (raw) => ({
    id: raw.id || `unt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "unit",
    name: String(raw.name || "").trim(),
    symbol: String(raw.symbol || raw.name || "").trim().toUpperCase(),
    precision: Number(raw.precision || 0),
    is_active: raw.is_active === false || raw.is_active === 0 ? 0 : 1,
  }),
  exportQuery: async () => {
    const list = await sqliteStorage.findAll<any>("master_lookups");
    return list.filter((item) => item.type === "unit");
  },
};
