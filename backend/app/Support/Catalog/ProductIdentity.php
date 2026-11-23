<?php

namespace App\Support\Catalog;

use App\Models\Product;

/**
 * G2-STOCK: a barcode is a lookup key, not an identity. Two products sharing a
 * barcode are the same article only while their statutory/pack facts agree.
 * A blank, zero or default value is an unknown fact, not a disagreement.
 */
final class ProductIdentity
{
    /**
     * @return string[] human-readable differences, empty when the pair is compatible
     */
    public static function conflicts(Product $source, Product $dest): array
    {
        $conflicts = [];

        $sourceHsn = trim((string) $source->hsn_sac_code);
        $destHsn = trim((string) $dest->hsn_sac_code);
        if ($sourceHsn !== '' && $destHsn !== '' && $sourceHsn !== $destHsn) {
            $conflicts[] = "HSN/SAC {$sourceHsn} vs {$destHsn}";
        }

        $sourceGst = (float) $source->gst_percent;
        $destGst = (float) $dest->gst_percent;
        if ($sourceGst > 0 && $destGst > 0 && abs($sourceGst - $destGst) > 0.001) {
            $conflicts[] = "GST {$sourceGst}% vs {$destGst}%";
        }

        $sourcePack = (int) ($source->units_per_pack ?? 1);
        $destPack = (int) ($dest->units_per_pack ?? 1);
        if ($sourcePack > 1 && $destPack > 1 && $sourcePack !== $destPack) {
            $conflicts[] = "pack size {$sourcePack} vs {$destPack}";
        }

        return $conflicts;
    }

    public static function conflictMessage(Product $source, Product $dest, array $conflicts): string
    {
        return sprintf(
            'Barcode %s in this store belongs to "%s", but the sending store\'s "%s" disagrees on %s. Choose the correct destination product or create a copy instead.',
            $dest->barcode ?: '—',
            $dest->name,
            $source->name,
            implode(', ', $conflicts)
        );
    }
}
