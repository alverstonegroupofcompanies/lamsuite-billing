// Shared store-time helpers. All persisted timestamps are UTC; all document
// dates are calendar dates in the store's timezone. Every period boundary in
// the app must be computed here so dashboard, bills, reports and GST agree.

export const DEFAULT_STORE_TIMEZONE = "Asia/Kolkata";

export type PeriodKey = "today" | "yesterday" | "last7" | "this_week" | "this_month" | "all_time";

export interface PeriodRange {
  /** Inclusive local start date (YYYY-MM-DD), null for all_time. */
  startDate: string | null;
  /** Inclusive local end date (YYYY-MM-DD), null for all_time. */
  endDate: string | null;
  /** Exclusive UTC instant bounds, null for all_time. */
  startUtc: Date | null;
  endUtc: Date | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function getStoreTimezone(source: any): string {
  if (!source) return DEFAULT_STORE_TIMEZONE;
  const candidates = [
    source.timezone,
    source.store_timezone,
    source.store_details?.timezone,
    source.store?.timezone,
    source.settings?.store_details?.timezone,
    source.settings?.storeTimezone,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return found ? String(found) : DEFAULT_STORE_TIMEZONE;
}

function partsInTimezone(date: Date, tz: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl can return 24 for midnight in some engines; normalise to 0.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset in ms: local wall-clock (interpreted as UTC) minus the real instant. */
function timezoneOffsetMs(date: Date, tz: string): number {
  const p = partsInTimezone(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** YYYY-MM-DD for the given instant in the store timezone. */
export function formatInStoreTZ(date: Date, tz: string = DEFAULT_STORE_TIMEZONE): string {
  const p = partsInTimezone(date, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function toStoreDateString(value: Date | string | number, tz: string = DEFAULT_STORE_TIMEZONE): string {
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) return value.trim();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatInStoreTZ(date, tz);
}

/** UTC instant for local midnight of a YYYY-MM-DD date in the store timezone. */
export function parseStoreDate(dateStr: string, tz: string = DEFAULT_STORE_TIMEZONE): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    const fallback = new Date(dateStr);
    return Number.isNaN(fallback.getTime()) ? new Date(NaN) : fallback;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const wallClockUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

  // Two-pass correction handles DST transitions.
  let instant = wallClockUtc - timezoneOffsetMs(new Date(wallClockUtc), tz);
  instant = wallClockUtc - timezoneOffsetMs(new Date(instant), tz);
  return new Date(instant);
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function todayInStoreTZ(tz: string = DEFAULT_STORE_TIMEZONE, now: Date = new Date()): string {
  return formatInStoreTZ(now, tz);
}

export function yesterdayInStoreTZ(tz: string = DEFAULT_STORE_TIMEZONE, now: Date = new Date()): string {
  return addDaysToDateString(todayInStoreTZ(tz, now), -1);
}

/** Today's calendar date in the store timezone, from a settings/profile object. */
export function storeToday(source?: any, now: Date = new Date()): string {
  return todayInStoreTZ(getStoreTimezone(source), now);
}

export function getPeriodRange(
  period: PeriodKey,
  tz: string = DEFAULT_STORE_TIMEZONE,
  now: Date = new Date()
): PeriodRange {
  const today = formatInStoreTZ(now, tz);

  if (period === "all_time") {
    return { startDate: null, endDate: null, startUtc: null, endUtc: null };
  }

  let startDate: string;
  switch (period) {
    case "today":
      startDate = today;
      break;
    case "yesterday":
      startDate = addDaysToDateString(today, -1);
      break;
    case "last7":
      startDate = addDaysToDateString(today, -6);
      break;
    case "this_week": {
      const [y, m, d] = today.split("-").map(Number);
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
      const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
      startDate = addDaysToDateString(today, mondayOffset);
      break;
    }
    case "this_month":
      startDate = `${today.slice(0, 7)}-01`;
      break;
    default:
      startDate = today;
  }

  const endDate = period === "yesterday" ? addDaysToDateString(today, -1) : today;
  return {
    startDate,
    endDate,
    startUtc: parseStoreDate(startDate, tz),
    // Half-open bound: local midnight of the day after endDate.
    endUtc: parseStoreDate(addDaysToDateString(endDate, 1), tz),
  };
}

/** Date-only comparison using the store calendar date. */
export function isDateInRange(
  value: string | Date | number,
  startDate: string | null,
  endDate: string | null,
  tz: string = DEFAULT_STORE_TIMEZONE
): boolean {
  const date = toStoreDateString(value, tz);
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

export function nowIsoUtc(now: Date = new Date()): string {
  return now.toISOString();
}

/** Convert a UTC instant to the store-local wall clock for display. */
export function formatDateTimeInStoreTZ(
  value: Date | string | number,
  tz: string = DEFAULT_STORE_TIMEZONE,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  }).format(date);
}

/**
 * A server timestamp as epoch millis. The API answers both an ISO instant and the bare
 * "YYYY-MM-DD HH:MM:SS" that SQLite stores, and a till list that sorts by `created_at` needs one.
 */
export function serverTimeToEpoch(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;

  const raw = String(value).trim();
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}T00:00:00`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}
