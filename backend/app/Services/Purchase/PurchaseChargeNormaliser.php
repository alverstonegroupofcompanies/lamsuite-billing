<?php

namespace App\Services\Purchase;

use App\Models\Purchase;

/**
 * PUR-017 legacy migration. A bill posted before CR-C stored one scalar,
 * `purchases.freight_charges`, and nothing else. Instead of rewriting history that
 * scalar is presented as a single Freight charge line in the shape both tax engines
 * consume, so historic bills can be viewed, re-costed and edited through the charges
 * path. Once a bill owns real charge rows the scalar is ignored: the overlay never
 * doubles a posted charge and never restates a total or a payable.
 */
class PurchaseChargeNormaliser
{
    public const LEGACY_HEAD_CODE = 'FREIGHT';

    public const LEGACY_HEAD_NAME = 'Freight';

    /**
     * @return array<int, array<string, mixed>> engine-shaped charges built from legacy columns
     */
    public function forPurchase(Purchase $purchase): array
    {
        $stored = $purchase->relationLoaded('charges')
            ? $purchase->charges->isNotEmpty()
            : $purchase->charges()->exists();

        if ($stored) {
            return [];
        }

        $freight = (float) ($purchase->freight_charges ?? 0);

        if ($freight === 0.0) {
            return [];
        }

        return [[
            'charge_id' => null,
            'external_id' => 'legacy-freight-' . $purchase->id,
            'seq' => 1,
            'head_code' => self::LEGACY_HEAD_CODE,
            'head_name' => self::LEGACY_HEAD_NAME,
            'note' => 'Legacy freight carried over from a pre-charges bill',
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'spread_basis_used' => 'value',
            'itc_eligibility' => 'eligible',
            'is_rcm' => false,
            'paid_separately' => false,
            'place_of_supply' => $purchase->place_of_supply,
            'sac_code' => null,
            'amount' => $freight,
            'gst_percent' => 0.0,
            'cess_percent' => 0.0,
            'source' => 'legacy_freight',
            'reversed_amount' => 0.0,
        ]];
    }
}
