<?php

namespace App\Services\Tax;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;

/**
 * MRP is the ceiling a counter may charge for a pack (G11-TAX / TAX-02).
 *
 * A rate typed on the till used to be billed as it came, so a strip carrying a
 * printed MRP of Rs 90 could go out at Rs 150. The ceiling is read from the
 * masters — the batch's own MRP, the product's when the batch carries none —
 * never from the `mrp` a payload happens to send, because that is the number a
 * wrong bill is trying to justify.
 */
class MrpCeiling
{
    /** The store switches the ceiling off; unless it says so, it is on. */
    public static function enforcedFor(?Store $store): bool
    {
        $flags = $store->feature_flags ?? [];

        return (bool) ($flags['enforce_mrp_capping'] ?? true);
    }

    /**
     * The highest rate the line may carry, or null when nothing here states a ceiling.
     *
     * Every basis but a loose rate quotes the pack; a loose rate is per piece, so it
     * is measured against the pack MRP split across the pack's units.
     */
    public static function rateCap(?Product $product, ?ProductBatch $batch, array $line, int $unitsPerPack): ?float
    {
        $packMrp = (float) ($batch->mrp ?? 0) > 0
            ? (float) $batch->mrp
            : (float) ($product->mrp ?? 0);

        if ($packMrp <= 0) {
            return null;
        }

        return strtolower(trim((string) ($line['rate_basis'] ?? ''))) === 'loose_rate'
            ? $packMrp / max(1, $unitsPerPack)
            : $packMrp;
    }

    /** A paisa of tolerance, so float noise never rejects a rate that equals the MRP. */
    public static function isBreach(float $rate, ?float $cap): bool
    {
        return $cap !== null && $rate > $cap + 0.005;
    }
}
