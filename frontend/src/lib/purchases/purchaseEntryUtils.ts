/**
 * Utilities for Purchase Inward Entry:
 * - Expiry date parsing & validation (MMYY, MM/YY, YYYY-MM)
 * - Quantity & Free goods shorthand parsing (10+2, 2+5)
 * - Margin calculations and surge warnings
 */

export interface ParsedExpiryResult {
  isoDate: string; // e.g. 2028-05-31
  display: string; // e.g. 05/28
  isExpired: boolean;
  isNearExpiry: boolean;
  isValid: boolean;
  error?: string;
}

/**
 * Parses user typed expiry input into standardized last-day-of-month ISO date
 * Supported formats: MMYY (0528), MM/YY (05/28), MM-YY, YYYY-MM, YYYY-MM-DD
 */
export function parseExpiryInput(input: string, referenceDate = new Date()): ParsedExpiryResult {
  const clean = input.trim().replace(/\s+/g, "");
  if (!clean) {
    return { isoDate: "", display: "", isExpired: false, isNearExpiry: false, isValid: false };
  }

  let month = 0;
  let year = 0;

  // Case 1: 4 digits MMYY e.g. 0528 or 1227
  const mmyyMatch = clean.match(/^(\d{2})(\d{2})$/);
  // Case 2: 3 digits MYY e.g. 528 (May 2028)
  const myyMatch = clean.match(/^(\d{1})(\d{2})$/);
  // Case 3: MM/YY or MM-YY or MM.YY
  const mmyySlashMatch = clean.match(/^(\d{1,2})[/\-.](\d{2,4})$/);
  // Case 4: YYYY-MM or YYYY-MM-DD
  const yyyymmMatch = clean.match(/^(\d{4})[/\-.](\d{1,2})(?:[/\-.](\d{1,2}))?$/);

  if (mmyyMatch) {
    month = parseInt(mmyyMatch[1], 10);
    year = 2000 + parseInt(mmyyMatch[2], 10);
  } else if (myyMatch) {
    month = parseInt(myyMatch[1], 10);
    year = 2000 + parseInt(myyMatch[2], 10);
  } else if (mmyySlashMatch) {
    month = parseInt(mmyySlashMatch[1], 10);
    const yr = parseInt(mmyySlashMatch[2], 10);
    year = yr < 100 ? 2000 + yr : yr;
  } else if (yyyymmMatch) {
    year = parseInt(yyyymmMatch[1], 10);
    month = parseInt(yyyymmMatch[2], 10);
  } else {
    return {
      isoDate: clean,
      display: clean,
      isExpired: false,
      isNearExpiry: false,
      isValid: false,
      error: "Invalid expiry format (use MM/YY)",
    };
  }

  if (month < 1 || month > 12) {
    return {
      isoDate: clean,
      display: clean,
      isExpired: false,
      isNearExpiry: false,
      isValid: false,
      error: "Month must be between 01 and 12",
    };
  }

  // Get last day of that month
  const lastDay = new Date(year, month, 0).getDate();
  const padMonth = String(month).padStart(2, "0");
  const padDay = String(lastDay).padStart(2, "0");
  const isoDate = `${year}-${padMonth}-${padDay}`;
  const displayYearShort = String(year).slice(-2);
  const display = `${padMonth}/${displayYearShort}`;

  // Evaluate expiry status against reference date
  const expiryTimestamp = new Date(year, month - 1, lastDay, 23, 59, 59).getTime();
  const currentTimestamp = referenceDate.getTime();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

  const isExpired = expiryTimestamp < currentTimestamp;
  const isNearExpiry = !isExpired && expiryTimestamp < currentTimestamp + ninetyDaysMs;

  return {
    isoDate,
    display,
    isExpired,
    isNearExpiry,
    isValid: true,
  };
}

/**
 * Parses quantity strings supporting multiple shorthand forms:
 * - "10+2" -> 10 billed packs + 2 free packs
 * - "2+5" -> 2 packs + 5 loose units (when allowLoose is true)
 * - "15" -> 15 packs
 */
export function parseQuantityEntry(
  raw: string,
  allowLoose = true
): {
  packs: number;
  loose: number;
  free: number;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { packs: 1, loose: 0, free: 0 };
  }

  // Check "10+2" or "10 + 2" pattern
  const plusMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/);
  if (plusMatch) {
    const first = parseFloat(plusMatch[1]) || 0;
    const second = parseFloat(plusMatch[2]) || 0;

    // Convention in pharmacy wholesale: if second number is small and first >= 5, it's typically free scheme (e.g. 10+2 free)
    // But if second number is explicitly entered, we can allow loose or free
    if (allowLoose && second > 0 && second <= 10 && first <= 10) {
      // e.g. 2+5 means 2 packs + 5 loose
      return { packs: first, loose: second, free: 0 };
    }
    // Otherwise e.g. 10+2 or 50+5 is billed + free
    return { packs: first, loose: 0, free: second };
  }

  const num = parseFloat(trimmed);
  return {
    packs: isNaN(num) ? 1 : Math.max(0, num),
    loose: 0,
    free: 0,
  };
}

/**
 * Calculates live margin percentage and checks negative margin
 */
export function calculateLineMargin(
  purchaseRate: number,
  sellingRate: number,
  unitsPerPack = 1
): {
  marginPercent: number;
  isNegative: boolean;
  effectiveUnitCost: number;
} {
  const packs = Math.max(1, unitsPerPack);
  const effectiveUnitCost = packs > 1 ? purchaseRate / packs : purchaseRate;

  if (sellingRate <= 0 || effectiveUnitCost <= 0) {
    return { marginPercent: 0, isNegative: false, effectiveUnitCost };
  }

  const margin = Math.round(((sellingRate - effectiveUnitCost) / sellingRate) * 1000) / 10;
  const isNegative = sellingRate < effectiveUnitCost - 0.01;

  return {
    marginPercent: margin,
    isNegative,
    effectiveUnitCost: Math.round(effectiveUnitCost * 100) / 100,
  };
}
