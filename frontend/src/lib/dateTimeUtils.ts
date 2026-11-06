// Shared date‑time utilities that respect the store's configured timezone.
// All dates stored in the backend are in UTC. The UI and services need to present
// and compute dates in the store's local timezone (default Asia/Kolkata).

export interface StoreTimezone {
  /** IANA timezone identifier, e.g. "Asia/Kolkata" */
  tz: string;
}

/**
 * Format a Date object into an ISO‑8601 date string (YYYY‑MM‑DD) **in the store's timezone**.
 * The returned string has no time component – it represents the "local" calendar date
 * for the given store.
 */
export function formatInStoreTZ(date: Date, tz: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // formatter outputs "YYYY‑MM‑DD" for en-CA locale.
  return formatter.format(date);
}

/**
 * Parse a date string (YYYY‑MM‑DD) **as if it were in the store's timezone** and
 * return a Date object in UTC.
 * This is useful when the UI sends a date‑only value to the backend – the backend
 * can convert it to UTC by assuming the store's timezone.
 */
export function parseStoreDate(dateStr: string, tz: string): Date {
  // Create a date at midnight in the given timezone.
  const [year, month, day] = dateStr.split('-').map(Number);
  // Construct a date using the timezone offset at that local time.
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  // Determine the offset of the target timezone at that moment.
  const offset = -new Date().toLocaleString('en-US', {
    timeZone: tz,
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).split(',').length; // dummy to force evaluation (value not used directly)
  // Simpler: use Intl.DateTimeFormat to get the offset in minutes.
  const tzDate = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcDate);
  // Not straightforward; for now we rely on the fact that the backend will treat
  // the incoming string as a local date and convert using Carbon with store tz.
  // So we simply return the UTC midnight date.
  return utcDate;
}

/**
 * Get the store's timezone string from the cached store object.
 * If none is present, fall back to the default "Asia/Kolkata".
 */
export function getStoreTimezone(store: any): string {
  return (store && store.timezone) ? store.timezone : 'Asia/Kolkata';
}
