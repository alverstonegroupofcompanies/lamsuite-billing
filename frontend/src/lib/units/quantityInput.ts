import { normalizePackLoose, type UnitConversionConfig } from "../billing/unitConversion";

export interface StrictQuantityConfig extends UnitConversionConfig {
  /** Decimal quantities are allowed (kg/litre/unit-based products). */
  allowDecimal?: boolean;
}

export interface ParsedQuantityInput {
  ok: boolean;
  packs: number;
  loose: number;
  totalBaseUnits: number;
  error?: string;
}

const INVALID_CHARS = /[^\d.+]/;

/**
 * Removes characters that cannot be part of a quantity while keeping a single
 * decimal point and a single pack+loose separator. Used for controlled inputs
 * and clipboard paste so letters never reach state or the server.
 */
export function sanitizeQuantityText(raw: string, config: StrictQuantityConfig): string {
  if (!raw) return "";
  let text = raw.trim().replace(/\s+/g, "");

  const allowPlus = config.allow_loose_sale ?? (Number(config.units_per_pack) || 1) > 1;
  const allowDecimal = config.allowDecimal ?? (Number(config.units_per_pack) || 1) <= 1;
  const precision = Math.max(0, config.precision ?? (allowDecimal ? 2 : 0));

  // Without pack support "2+3" is meaningless; truncating avoids silently
  // turning a paste of "2+3" into "23".
  if (!allowPlus) text = text.split("+")[0];

  const plusIndex = text.indexOf("+");
  let packPart = plusIndex >= 0 ? text.slice(0, plusIndex) : text;
  let loosePart = plusIndex >= 0 ? text.slice(plusIndex + 1) : "";

  const cleanNumber = (part: string, decimals: boolean): string => {
    let cleaned = part.replace(/[^\d.]/g, "");
    const firstDot = cleaned.indexOf(".");
    if (!decimals) {
      // Keep the decimal point so validation can reject "2.5" instead of
      // silently merging the digits into "25".
      if (firstDot >= 0) {
        cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
      }
    } else if (firstDot >= 0) {
      cleaned =
        cleaned.slice(0, firstDot + 1) +
        cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, precision);
    }
    return cleaned;
  };

  const packAllowsDecimal = !allowPlus && allowDecimal;
  packPart = cleanNumber(packPart, packAllowsDecimal);
  if (plusIndex >= 0) loosePart = cleanNumber(loosePart, allowDecimal);

  return plusIndex >= 0 ? `${packPart}+${loosePart}` : packPart;
}

export function parseQuantityInput(raw: string | number, config: StrictQuantityConfig): ParsedQuantityInput {
  const upp = Math.max(1, Number(config.units_per_pack) || 1);
  const allowLoose = config.allow_loose_sale ?? upp > 1;
  const allowDecimal = config.allowDecimal ?? upp <= 1;
  const text = typeof raw === "number" ? String(raw) : (raw ?? "").trim();

  if (!text) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "Enter a quantity." };
  }
  if (INVALID_CHARS.test(text)) {
    return {
      ok: false,
      packs: 0,
      loose: 0,
      totalBaseUnits: 0,
      error: allowLoose
        ? "Use digits and a decimal point only (for example 2+5)."
        : "Use digits and a decimal point only.",
    };
  }

  const plusIndex = text.indexOf("+");
  if (plusIndex >= 0 && text.indexOf("+", plusIndex + 1) >= 0) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "Use a single + between packs and loose units." };
  }

  const packText = plusIndex >= 0 ? text.slice(0, plusIndex) : text;
  const looseText = plusIndex >= 0 ? text.slice(plusIndex + 1) : "";

  if (plusIndex >= 0 && upp <= 1) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "This product has no pack size; enter a single quantity." };
  }
  if (plusIndex >= 0 && !allowLoose) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "Loose units are not enabled for this product." };
  }

  if ((packText && !/^\d*\.?\d*$/.test(packText)) || (looseText && !/^\d*\.?\d*$/.test(looseText))) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "Enter a valid number." };
  }

  const packs = packText === "" ? 0 : Number(packText);
  const loose = looseText === "" ? 0 : Number(looseText);

  if (!Number.isFinite(packs) || !Number.isFinite(loose)) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "Enter a valid number." };
  }
  if (packs < 0 || loose < 0) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "Quantity cannot be negative." };
  }
  if (upp > 1 && !Number.isInteger(packs)) {
    return {
      ok: false,
      packs: 0,
      loose: 0,
      totalBaseUnits: 0,
      error: "Packs must be a whole number. Use 2+5 for two packs and five loose units.",
    };
  }
  if (!allowDecimal && (!Number.isInteger(packs) || !Number.isInteger(loose))) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "This product does not allow decimal quantities." };
  }

  const total = Math.round((packs * upp + loose) * 1000) / 1000;
  if (total <= 0) {
    return { ok: false, packs: 0, loose: 0, totalBaseUnits: 0, error: "Quantity must be greater than zero." };
  }

  const normalised = normalizePackLoose(packs, loose, upp);
  return {
    ok: true,
    packs: normalised.packs,
    loose: normalised.loose,
    totalBaseUnits: normalised.totalBaseUnits,
  };
}

export function formatQuantityInput(packs: number, loose: number, upp: number): string {
  if (upp <= 1) return String(packs + loose);
  return loose > 0 ? `${packs}+${loose}` : String(packs);
}
