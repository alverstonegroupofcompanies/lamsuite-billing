export interface BatchItem {
  id: string;
  batch_no: string;
  expiry_date: string;
  stock_qty: number;
  mrp?: number;
  selling_rate?: number;
  purchase_rate?: number;
}

export interface FefoAllocation {
  batch_no: string;
  expiry_date: string;
  allocated_qty: number;
  stock_qty: number;
  selling_rate?: number;
  mrp?: number;
}

export function isDateExpired(expiryDate: string, referenceDate: Date = new Date()): boolean {
  if (!expiryDate) return false;
  const todayStr = referenceDate.toISOString().slice(0, 10);
  if (expiryDate.length === 7) {
    // format YYYY-MM
    return expiryDate < todayStr.slice(0, 7);
  }
  return expiryDate < todayStr;
}

/**
 * Selects batches using First Expiry, First Out (FEFO) strategy.
 * Prioritizes batches with earliest expiration date that are unexpired and have positive stock.
 */
export function selectBatchesFefo(
  batches: BatchItem[],
  requiredQty: number,
  productName: string = "Item",
  referenceDate: Date = new Date()
): FefoAllocation[] {
  if (requiredQty <= 0) {
    return [];
  }

  // Filter valid batches: stock > 0 and not expired
  const validBatches = batches
    .filter((b) => Number(b.stock_qty) > 0 && !isDateExpired(b.expiry_date, referenceDate))
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

  const totalAvailable = validBatches.reduce((sum, b) => sum + Number(b.stock_qty), 0);
  if (totalAvailable < requiredQty) {
    throw new Error(
      `Insufficient available stock for '${productName}'. Required: ${requiredQty}, Available: ${totalAvailable} across unexpired batches.`
    );
  }

  let remaining = requiredQty;
  const allocations: FefoAllocation[] = [];

  for (const batch of validBatches) {
    if (remaining <= 0) break;
    const canTake = Math.min(remaining, Number(batch.stock_qty));
    allocations.push({
      batch_no: batch.batch_no,
      expiry_date: batch.expiry_date,
      allocated_qty: canTake,
      stock_qty: Number(batch.stock_qty),
      selling_rate: batch.selling_rate,
      mrp: batch.mrp,
    });
    remaining -= canTake;
  }

  return allocations;
}
