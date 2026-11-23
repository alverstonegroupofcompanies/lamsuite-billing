/**
 * MRP is the ceiling a counter may charge for a pack (G11-TAX / TAX-02).
 *
 * Mirrors backend/app/Services/Tax/MrpCeiling.php so a till billing offline refuses
 * the same rates the server would: the batch's MRP, the product's when the batch
 * carries none, and for a loose rate that pack MRP split over the pack's units.
 */

export interface MrpCeilingLine {
  unit_price: number;
  rate_basis?: string;
  product: { name?: string; mrp?: number; units_per_pack?: number };
  selectedBatch?: { mrp?: number } | null;
}

/** Unset means on: only a store that switched the ceiling off may bill above MRP. */
export function mrpCeilingEnforced(flag: boolean | undefined | null): boolean {
  return flag !== false;
}

/** The highest rate the line may carry, or null when no MRP is on record. */
export function mrpRateCap(line: MrpCeilingLine): number | null {
  const batchMrp = Number(line.selectedBatch?.mrp) || 0;
  const packMrp = batchMrp > 0 ? batchMrp : Number(line.product?.mrp) || 0;
  if (packMrp <= 0) return null;

  const upp = Math.max(1, Math.round(Number(line.product?.units_per_pack) || 1));
  return String(line.rate_basis || "").trim().toLowerCase() === "loose_rate" ? packMrp / upp : packMrp;
}

/** The first line billed above its ceiling (a paisa of tolerance), with a message for the cashier. */
export function findMrpBreach(lines: MrpCeilingLine[]): { index: number; message: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cap = mrpRateCap(line);
    const rate = Number(line.unit_price) || 0;
    if (cap !== null && rate > cap + 0.005) {
      const loose = String(line.rate_basis || "").toLowerCase() === "loose_rate";
      return {
        index: i,
        message:
          `Line ${i + 1}: '${line.product?.name || "Item"}' is billed at ₹${rate.toFixed(2)} above its MRP ceiling of ₹${cap.toFixed(2)}` +
          (loose ? " (pack MRP split over the pack)." : ". Reduce the rate to the MRP, or correct the MRP on the batch."),
      };
    }
  }
  return null;
}
