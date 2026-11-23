<?php

namespace App\Services\Counter;

use App\Models\Product;

/**
 * The facts that separate a retyped rate from a rate the master already
 * documents.
 *
 * A line billed at the product's PTR, PTS or loose-unit rate is not an
 * override — and billing at MRP when the owned rate differs is not one either.
 * Treating all of those as overrides would ask an approver for the ordinary way
 * a store sells. The live gate and the offline ingest read this one answer so a
 * bill is judged the same way whichever path carried it.
 */
final class BillPriceFacts
{
    /**
     * @param  iterable<array{product_id?:mixed, unit_price?:mixed, rate_basis?:mixed}>  $lines
     * @return array{price_overridden?:bool, price_change_pct?:float}
     */
    public static function overrideFacts(int $storeId, iterable $lines): array
    {
        $normalized = [];
        $ids = [];

        foreach ($lines as $line) {
            $productId = is_array($line)
                ? ($line['product_id'] ?? null)
                : ($line->product_id ?? null);

            if (!is_numeric($productId)) {
                continue;
            }

            $normalized[] = [
                'product_id' => (int) $productId,
                'unit_price' => (float) (is_array($line) ? ($line['unit_price'] ?? 0) : ($line->unit_price ?? 0)),
                'rate_basis' => is_array($line) ? ($line['rate_basis'] ?? null) : ($line->rate_basis ?? null),
            ];
            $ids[] = (int) $productId;
        }

        if ($normalized === []) {
            return [];
        }

        $master = Product::where('store_id', $storeId)
            ->whereIn('id', array_values(array_unique($ids)))
            ->get(['id', 'sel_rate', 'mrp', 'ptr', 'pts']);

        $changePct = 0.0;
        $seen = false;

        foreach ($normalized as $line) {
            $product = $master->firstWhere('id', $line['product_id']);
            $rate = $line['unit_price'];

            if (!$product || $rate <= 0.0) {
                continue;
            }

            $expected = self::expectedRate($product, $line['rate_basis']);

            // A basis this table cannot resolve (loose rate, a basis with no
            // master price) is not evidence of an override.
            if ($expected === null) {
                continue;
            }

            if (abs($rate - $expected) < 0.005) {
                continue;
            }

            // Any documented rate is a legitimate way to bill the item.
            foreach (['sel_rate', 'mrp', 'ptr', 'pts'] as $field) {
                $documented = (float) ($product->{$field} ?? 0);
                if ($documented > 0 && abs($rate - $documented) < 0.005) {
                    continue 2;
                }
            }

            $seen = true;
            $changePct = max($changePct, abs($rate - $expected) / $expected * 100);
        }

        return $seen
            ? ['price_overridden' => true, 'price_change_pct' => round($changePct, 4)]
            : [];
    }

    private static function expectedRate(Product $product, mixed $basis): ?float
    {
        $basis = strtolower(trim((string) $basis));

        $rate = match ($basis) {
            'mrp' => (float) ($product->mrp ?? 0),
            'ptr' => (float) ($product->ptr ?? 0),
            'pts' => (float) ($product->pts ?? 0),
            // A loose rate is quoted per piece and cannot be compared to a pack
            // price; a basis this build does not know is not judged either.
            'loose_rate', 'ptss' => 0.0,
            default => (float) ($product->sel_rate ?? 0) ?: (float) ($product->mrp ?? 0),
        };

        return $rate > 0 ? $rate : null;
    }
}
