import type { BillsDefaultPeriod } from "../settings/companySettingsService";

export type BillsPeriod = BillsDefaultPeriod;

/** Order drives the Alt+← / Alt+→ period cycle on the Past Bills register. */
export const BILLS_PERIODS: readonly BillsPeriod[] = [
  "today",
  "yesterday",
  "last7days",
  "month",
  "all",
];

/** Order drives the Alt+Shift+P payment filter cycle. */
export const BILLS_PAYMENT_MODES = [
  "all",
  "Cash",
  "UPI",
  "Card",
  "Credit",
  "Bank Transfer",
] as const;

/** Order drives the Alt+S status filter cycle. */
export const BILLS_STATUSES = ["all", "issued", "cancelled"] as const;

export const BILLS_PINNED_PERIOD_KEY = "bills.pinnedPeriod";

export type BillsPaymentFilter = (typeof BILLS_PAYMENT_MODES)[number];
export type BillsStatusFilter = (typeof BILLS_STATUSES)[number];

export const isBillsPeriod = (value: unknown): value is BillsPeriod =>
  typeof value === "string" && (BILLS_PERIODS as readonly string[]).includes(value);

/**
 * A user's pinned period always wins; otherwise the store-owner default applies,
 * and finally the safe built-in default ("today").
 */
export const resolveBillsPeriod = (
  userPinned: unknown,
  ownerDefault: unknown
): BillsPeriod => {
  if (isBillsPeriod(userPinned)) return userPinned;
  return isBillsPeriod(ownerDefault) ? ownerDefault : "today";
};

export const cycleValue = <T,>(
  values: readonly T[],
  current: T,
  direction: 1 | -1
): T => {
  const index = values.indexOf(current);
  if (index === -1) return values[direction > 0 ? 0 : values.length - 1];
  return values[(index + direction + values.length) % values.length];
};
