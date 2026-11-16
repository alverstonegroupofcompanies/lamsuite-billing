export interface ManualDiscount {
  type: "percent" | "amount";
  value: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function netBaseAmount(totals: { gross_subtotal?: number; line_discount_total: number }): number {
  return Math.max(0, round2((totals.gross_subtotal ?? 0) - totals.line_discount_total));
}

export function manualDiscountAmount(manual: ManualDiscount, netBase: number): number {
  const value = Math.max(0, Number(manual.value) || 0);
  if (manual.type === "percent") {
    return round2((Math.max(0, netBase) * Math.min(100, value)) / 100);
  }
  return round2(value);
}

export function combineBillDiscount(
  netBase: number,
  manual: ManualDiscount,
  extraAmounts: number[]
): number {
  const extra = extraAmounts.reduce((sum, amt) => sum + Math.max(0, Number(amt) || 0), 0);
  return Math.min(Math.max(0, netBase), round2(manualDiscountAmount(manual, netBase) + extra));
}

export function computePointsDiscount(points: number, valuePerPoint: number, maxBase: number): number {
  if (points <= 0 || valuePerPoint <= 0) return 0;
  return Math.min(Math.max(0, maxBase), round2(points * valuePerPoint));
}
