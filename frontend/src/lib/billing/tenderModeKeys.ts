import { DEFAULT_PAYMENT_MODES, type PaymentModeConfig } from "../settings/companySettingsService";

/**
 * The settlement buttons are the mode map. A digit key is that button's number among the
 * enabled modes, and the letter aliases name the mode. Reading `event.key` alone breaks on
 * macOS, where Option+2 arrives as `™` and Option+8 as `•`; the physical key code still says
 * Digit2 / Digit8, so it is read first.
 */
export const TENDER_MODE_ORDER = [
  "Cash",
  "UPI",
  "Card",
  "Bank Transfer",
  "Cheque",
  "Wallet",
  "Gift Voucher",
  "Credit",
] as const;

export const TENDER_LETTER_ALIASES: Record<string, string> = {
  c: "Cash",
  u: "UPI",
  d: "Card",
  b: "Bank Transfer",
  q: "Cheque",
  w: "Wallet",
  v: "Gift Voucher",
  r: "Credit",
};

export function enabledTenderModes(modes: PaymentModeConfig[] = DEFAULT_PAYMENT_MODES): string[] {
  const configured = new Map(modes.map((mode) => [mode.name, mode]));
  return TENDER_MODE_ORDER.filter((name) => configured.get(name)?.enabled !== false);
}

function digitFromEvent(event: { key: string; code?: string }): number | null {
  const fromCode = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || "");
  if (fromCode) return Number(fromCode[1]);
  if (/^[1-9]$/.test(event.key)) return Number(event.key);
  return null;
}

function letterFromEvent(event: { key: string; code?: string }): string {
  const fromCode = /^Key([A-Z])$/.exec(event.code || "");
  return (fromCode?.[1] ?? event.key).toLowerCase();
}

export function resolveTenderMode(
  event: { key: string; code?: string },
  modes: string[] = enabledTenderModes()
): string | null {
  const digit = digitFromEvent(event);
  if (digit) return modes[digit - 1] ?? null;
  return TENDER_LETTER_ALIASES[letterFromEvent(event)] ?? null;
}
