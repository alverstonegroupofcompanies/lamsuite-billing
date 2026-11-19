<?php

namespace App\Services\Sales;

use App\Models\Store;
use App\Services\Tax\TaxEngine;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class SalesOrderTaxService
{
    public function nextSequence(string $table, string $column, int $storeId, string $prefix): string
    {
        $date = Carbon::now()->format('Ymd');
        $like = "{$prefix}-{$date}-%";
        $last = DB::table($table)
            ->where('store_id', $storeId)
            ->where($column, 'like', $like)
            ->orderByDesc($column)
            ->value($column);

        $seq = 1;
        if ($last && preg_match('/-(\d+)$/', $last, $m)) {
            $seq = (int) $m[1] + 1;
        }

        return sprintf('%s-%s-%04d', $prefix, $date, $seq);
    }

    /**
     * Calculate line + document totals authoritatively via the tax engine.
     *
     * @return array{0: array, 1: array}
     */
    public function calculateDocument(Store $store, array $items, array $meta): array
    {
        $context = $this->taxContext($store, $meta);
        $engineLines = [];
        foreach ($items as $idx => $item) {
            $engineLines[] = [
                'line_id' => (string) $idx,
                'product_id' => (string) ($item['product_id'] ?? $idx),
                'product_name' => $item['product_name'] ?? '',
                'hsn_code' => $item['hsn_code'] ?? null,
                'qty' => (float) ($item['qty'] ?? 0),
                'loose_qty' => (float) ($item['loose_qty'] ?? 0),
                'units_per_pack' => max(1, (int) ($item['units_per_pack'] ?? 1)),
                'unit_price' => (float) ($item['unit_price'] ?? 0),
                'rate_basis' => 'sel_rate',
                'discount_percent' => (float) ($item['discount_percent'] ?? 0),
                'discount_amount' => (float) ($item['discount_amount'] ?? 0),
                'gst_percent' => (float) ($item['gst_percent'] ?? 0),
                'cess_percent' => 0,
            ];
        }

        $taxDoc = TaxEngine::calculateDocumentTaxes(array_merge($context, [
            'lines' => $engineLines,
            'auto_round_off' => true,
        ]));

        return [$taxDoc, $engineLines];
    }

    private function taxContext(Store $store, array $meta): array
    {
        $storeState = $store->state_code ?: '32';
        $policy = app(\App\Services\Tax\StoreTaxPolicy::class)->forStore($store->id);
        $storeGstType = $policy['gst_type'];
        $isComposition = in_array($storeGstType, ['composition', 'no_tax', 'unregistered'], true);

        return [
            'store_state' => $storeState,
            'customer_gstin' => $meta['customer_gstin'] ?? null,
            'place_of_supply' => $meta['place_of_supply'] ?? $storeState,
            'default_tax_mode' => $policy['tax_mode'],
            'gst_type' => $storeGstType,
            'is_composition' => $isComposition,
        ];
    }
}
