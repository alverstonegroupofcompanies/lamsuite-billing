/**
 * Shared Unit Conversion & Smart Quantity Engine for LamSuite Billing.
 * 
 * Handles conversion between parent packaging units (boxes, strips, bottles, packs)
 * and smallest base units (tablets, capsules, ml, g, pieces).
 * 
 * Complies with Indian Pharma & Retail Billing standards (Schedule M/H, GST, FEFO).
 */

export interface UnitConversionConfig {
  units_per_pack: number;
  pack_unit_name?: string; // e.g., "strip", "box", "bottle", "pack"
  loose_unit_name?: string; // e.g., "tab", "tablet", "capsule", "ml", "g", "piece"
  allow_loose_sale?: boolean; // If false, only full packs are permitted
  loose_rate?: number; // Optional explicit loose selling price override
  precision?: number; // Decimals for fractional units (e.g. 2 for kg/litre)
}

export interface ParsedSmartQty {
  packs: number;
  loose: number;
  totalBaseUnits: number;
  isNormalized: boolean;
  rawNormalizedText: string;
  displaySummary: string;
  error?: string;
}

/**
 * Normalizes pack and loose quantity so that loose < units_per_pack.
 * E.g. 0 packs + 20 loose with units_per_pack 15 => 1 pack + 5 loose.
 */
export function normalizePackLoose(
  packs: number,
  loose: number,
  unitsPerPack: number
): { packs: number; loose: number; totalBaseUnits: number; isNormalized: boolean } {
  const upp = Math.max(1, Number(unitsPerPack) || 1);
  const rawPacks = Math.max(0, Number(packs) || 0);
  const rawLoose = Math.max(0, Number(loose) || 0);

  if (upp <= 1) {
    const total = rawPacks + rawLoose;
    return {
      packs: total,
      loose: 0,
      totalBaseUnits: total,
      isNormalized: rawLoose > 0,
    };
  }

  const totalBaseUnits = Math.round((rawPacks * upp + rawLoose) * 1000) / 1000;
  const normalizedPacks = Math.floor(totalBaseUnits / upp);
  const normalizedLoose = Math.round((totalBaseUnits % upp) * 1000) / 1000;

  const wasNormalized = normalizedPacks !== rawPacks || normalizedLoose !== rawLoose;

  return {
    packs: normalizedPacks,
    loose: normalizedLoose,
    totalBaseUnits,
    isNormalized: wasNormalized,
  };
}

/**
 * Parses smart quantity strings typed by counter operators.
 * Supports:
 * - "2" => 2 packs
 * - "2+5" => 2 packs + 5 loose
 * - "0+5" or "+5" => 0 packs + 5 loose
 * - "2.5" => 2.5 packs (converts fraction into loose units or base units)
 * - "10t" / "10 tab" / "10 tabs" => 10 loose tablets (normalized if > upp)
 * - "3s" / "3 strip" / "3 strips" / "3p" / "3 pack" => 3 packs
 * - "2s+5t" or "2s 5t" => 2 packs + 5 loose
 */
export function parseSmartQty(
  input: string | number,
  config: UnitConversionConfig
): ParsedSmartQty {
  const upp = Math.max(1, Number(config.units_per_pack) || 1);
  const allowLoose = config.allow_loose_sale ?? (upp > 1);
  const packName = config.pack_unit_name || (upp > 1 ? "pack" : "pcs");
  const looseName = config.loose_unit_name || (upp > 1 ? "pc" : "unit");

  if (input === undefined || input === null || input === "") {
    return {
      packs: 0,
      loose: 0,
      totalBaseUnits: 0,
      isNormalized: false,
      rawNormalizedText: "0",
      displaySummary: `= 0 ${looseName}s`,
    };
  }

  if (typeof input === "number") {
    const num = Math.max(0, input);
    if (!allowLoose || upp <= 1 || Number.isInteger(num)) {
      const norm = normalizePackLoose(num, 0, upp);
      return {
        ...norm,
        rawNormalizedText: `${norm.packs}${norm.loose > 0 ? `+${norm.loose}` : ""}`,
        displaySummary: formatQuantityDisplay(norm.packs, norm.loose, upp, packName, looseName),
      };
    }
    // Float number conversion, e.g. 2.5
    const baseUnits = Math.round(num * upp);
    const norm = normalizePackLoose(0, baseUnits, upp);
    return {
      ...norm,
      rawNormalizedText: `${norm.packs}${norm.loose > 0 ? `+${norm.loose}` : ""}`,
      displaySummary: formatQuantityDisplay(norm.packs, norm.loose, upp, packName, looseName),
    };
  }

  const str = input.toString().trim().toLowerCase();
  if (!str) {
    return {
      packs: 0,
      loose: 0,
      totalBaseUnits: 0,
      isNormalized: false,
      rawNormalizedText: "0",
      displaySummary: `= 0 ${looseName}s`,
    };
  }

  let packs = 0;
  let loose = 0;

  // Case 1: "+5" or "0+5" or "2+5" or "2+5t" or "2s+5t"
  if (str.includes("+")) {
    const parts = str.split("+");
    const packPart = parts[0].replace(/[^\d.]/g, "").trim();
    const loosePart = parts[1].replace(/[^\d.]/g, "").trim();

    packs = packPart ? parseFloat(packPart) || 0 : 0;
    loose = loosePart ? parseFloat(loosePart) || 0 : 0;
  }
  // Case 2: "2s 5t" or "2strip 5tab"
  else if (/[0-9.]+\s*[s|p|box|strip|pack]+\s*[0-9.]+\s*[t|tab|loose|cap|unit]*/i.test(str)) {
    const match = str.match(/([0-9.]+)\s*[s|p|box|strip|pack]+\s*([0-9.]+)/i);
    if (match) {
      packs = parseFloat(match[1]) || 0;
      loose = parseFloat(match[2]) || 0;
    }
  }
  // Case 3: Loose suffix only e.g. "10t", "10 tab", "10 tabs", "10 tablets", "10 loose", "10u"
  else if (
    /^[0-9.]+\s*(t|tab|tabs|tablet|tablets|loose|cap|caps|capsule|capsules|ml|g|unit|units|piece|pieces)$/i.test(
      str
    )
  ) {
    const num = parseFloat(str.replace(/[^\d.]/g, "")) || 0;
    loose = num;
    packs = 0;
  }
  // Case 4: Pack suffix only e.g. "3s", "3 strip", "3 strips", "3p", "3 pack", "3 box"
  else if (/^[0-9.]+\s*(s|strip|strips|p|pack|packs|box|boxes|bottle|bottles|b)$/i.test(str)) {
    const num = parseFloat(str.replace(/[^\d.]/g, "")) || 0;
    packs = num;
    loose = 0;
  }
  // Case 5: Plain decimal e.g. "2.5" with pack size > 1
  else if (str.includes(".") && upp > 1) {
    const floatVal = parseFloat(str) || 0;
    if (config.precision && config.precision > 0) {
      // Measurable item (e.g. 2.5 kg or 1.25 L)
      packs = floatVal;
      loose = 0;
    } else {
      // Discrete blister packs: 2.5 strips of 10 => 25 tablets
      const totalBaseUnits = Math.round(floatVal * upp);
      packs = Math.floor(totalBaseUnits / upp);
      loose = totalBaseUnits % upp;
    }
  }
  // Case 6: Standard integer e.g. "2"
  else {
    const num = parseFloat(str.replace(/[^\d.]/g, "")) || 0;
    packs = num;
    loose = 0;
  }

  // If loose sale is disallowed, clamp loose to 0 or round up to full pack
  if (!allowLoose && loose > 0) {
    loose = 0;
  }

  const norm = normalizePackLoose(packs, loose, upp);

  const rawNormalizedText =
    norm.loose > 0
      ? norm.packs > 0
        ? `${norm.packs}+${norm.loose}`
        : `+${norm.loose}`
      : `${norm.packs}`;

  const displaySummary = formatQuantityDisplay(
    norm.packs,
    norm.loose,
    upp,
    packName,
    looseName
  );

  return {
    packs: norm.packs,
    loose: norm.loose,
    totalBaseUnits: norm.totalBaseUnits,
    isNormalized: norm.isNormalized,
    rawNormalizedText,
    displaySummary,
  };
}

/**
 * Formats pack and loose quantities for display across UI, invoices, and prints.
 * E.g. "2 strips + 5 tabs (35 tabs)" or "35 tabs" or "2 strips"
 */
export function formatQuantityDisplay(
  packs: number,
  loose: number,
  unitsPerPack: number,
  packName = "pack",
  looseName = "pc",
  mode: "full" | "short" | "label_only" = "full"
): string {
  const upp = Math.max(1, Number(unitsPerPack) || 1);
  const p = Math.max(0, Number(packs) || 0);
  const l = Math.max(0, Number(loose) || 0);
  const totalBase = Math.round((p * upp + l) * 1000) / 1000;

  const pLabel = p === 1 ? packName : `${packName}s`;
  const lLabel = l === 1 ? looseName : `${looseName}s`;

  if (upp <= 1) {
    return mode === "short" ? `${totalBase}` : `${totalBase} ${pLabel}`;
  }

  if (p === 0 && l === 0) {
    return `0 ${pLabel}`;
  }

  if (p > 0 && l > 0) {
    if (mode === "short") return `${p}s + ${l}t`;
    if (mode === "label_only") return `${p} ${pLabel} + ${l} ${lLabel}`;
    return `${p} ${pLabel} + ${l} ${lLabel} (= ${totalBase} ${lLabel})`;
  }

  if (p > 0 && l === 0) {
    if (mode === "short") return `${p}s`;
    if (mode === "label_only") return `${p} ${pLabel}`;
    return `${p} ${pLabel} (= ${totalBase} ${lLabel})`;
  }

  // l > 0 && p === 0
  if (mode === "short") return `${l}t`;
  return `${l} ${lLabel}`;
}

/**
 * Calculates loose rate automatically or applies explicit loose rate override.
 */
export function calculateDerivedLooseRate(
  packRate: number,
  unitsPerPack: number,
  customLooseRate?: number,
  decimals = 2
): number {
  if (customLooseRate !== undefined && customLooseRate !== null && customLooseRate > 0) {
    return customLooseRate;
  }
  const upp = Math.max(1, Number(unitsPerPack) || 1);
  const rate = Math.max(0, Number(packRate) || 0);
  if (upp <= 1) return rate;

  const factor = Math.pow(10, decimals);
  return Math.round((rate / upp) * factor) / factor;
}

/**
 * Converts total base units into packs and loose units.
 */
export function baseUnitsToPackLoose(
  totalBaseUnits: number,
  unitsPerPack: number
): { packs: number; loose: number } {
  return normalizePackLoose(0, totalBaseUnits, unitsPerPack);
}

/**
 * Converts packs and loose units into total base units.
 */
export function packLooseToBaseUnits(
  packs: number,
  loose: number,
  unitsPerPack: number
): number {
  const upp = Math.max(1, Number(unitsPerPack) || 1);
  return Math.max(0, packs) * upp + Math.max(0, loose);
}

export { formatExpiryDisplay, parseExpiryDateParts } from "../masters/productsStore";
