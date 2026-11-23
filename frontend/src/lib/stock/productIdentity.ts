/**
 * G2-STOCK: a barcode is a lookup key, not an identity. Two local products
 * sharing a barcode are the same article only while their statutory and pack
 * facts agree. A blank, zero or default value is an unknown fact, not a
 * disagreement — the same rule the backend applies on receive.
 */

export interface ProductIdentityFacts {
  name: string;
  barcode?: string | null;
  hsn_sac_code?: string | null;
  gst_percent?: number | null;
  units_per_pack?: number | null;
}

export function identityConflicts(source: ProductIdentityFacts, dest: ProductIdentityFacts): string[] {
  const conflicts: string[] = [];

  const sourceHsn = (source.hsn_sac_code ?? "").trim();
  const destHsn = (dest.hsn_sac_code ?? "").trim();
  if (sourceHsn !== "" && destHsn !== "" && sourceHsn !== destHsn) {
    conflicts.push(`HSN/SAC ${sourceHsn} vs ${destHsn}`);
  }

  const sourceGst = Number(source.gst_percent ?? 0);
  const destGst = Number(dest.gst_percent ?? 0);
  if (sourceGst > 0 && destGst > 0 && Math.abs(sourceGst - destGst) > 0.001) {
    conflicts.push(`GST ${sourceGst}% vs ${destGst}%`);
  }

  const sourcePack = Math.trunc(Number(source.units_per_pack ?? 1));
  const destPack = Math.trunc(Number(dest.units_per_pack ?? 1));
  if (sourcePack > 1 && destPack > 1 && sourcePack !== destPack) {
    conflicts.push(`pack size ${sourcePack} vs ${destPack}`);
  }

  return conflicts;
}

export function identityConflictMessage(
  source: ProductIdentityFacts,
  dest: ProductIdentityFacts,
  conflicts: string[],
): string {
  return `Barcode ${dest.barcode || "—"} in this store belongs to "${dest.name}", but the sending store's "${source.name}" disagrees on ${conflicts.join(", ")}. Choose the correct destination product or create a copy instead.`;
}
