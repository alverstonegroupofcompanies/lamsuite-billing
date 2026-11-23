<?php

namespace App\Services\Reports;

use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseItem;
use App\Services\Purchase\PurchaseChargeNormaliser;

/**
 * CR-C Task 4.13 / REP-007 — the goods half and the charge half of a supplier bill, kept apart.
 *
 * A bill header mixes them on purpose: `subtotal` is the goods alone, while `tax_total` carries
 * the charge GST the supplier also charged (PUR-001). The register therefore reads the stored
 * charge rows and takes them back out, so the two blocks add up to the payable instead of
 * competing with it.
 */
class PurchaseRegisterService
{
    /**
     * @return array<string, mixed>
     */
    public function summary(Purchase $purchase): array
    {
        $items = $purchase->relationLoaded('items')
            ? $purchase->items
            : PurchaseItem::where('purchase_id', $purchase->id)->get();

        $goodsTaxable = round((float) $purchase->subtotal, 2);
        $headerTax = round((float) $purchase->tax_total, 2);

        $byHead = $this->chargeRows($purchase);

        $chargeTaxable = 0.0;
        $chargeTax = 0.0;
        $separateTaxable = 0.0;
        $separateTax = 0.0;
        $landedSpread = 0.0;

        foreach ($byHead as $charge) {
            if ($charge['in_payable']) {
                $chargeTaxable += $charge['taxable'];
                $chargeTax += $charge['tax'];
            } else {
                $separateTaxable += $charge['taxable'];
                $separateTax += $charge['tax'];
            }

            if ($charge['treatment'] === 'add_to_cost') {
                $landedSpread += $charge['reversed'];
            }
        }

        $allocatedOnGoods = round($items->sum(fn (PurchaseItem $item) => (float) $item->charge_allocation), 2);

        return [
            'goods_taxable' => $goodsTaxable,
            // The header tax is goods + supplier-borne charge tax (PUR-001); the register shows them apart.
            'goods_tax' => round($headerTax - $chargeTax, 2),
            'charge_taxable' => round($chargeTaxable, 2),
            'charge_tax' => round($chargeTax, 2),
            'charge_total' => round($chargeTaxable + $chargeTax, 2),
            'separately_paid' => [
                'taxable' => round($separateTaxable, 2),
                'tax' => round($separateTax, 2),
                'total' => round($separateTaxable + $separateTax, 2),
            ],
            'by_head' => $byHead,
            'charge_count' => count($byHead),
            'landed_value' => round($goodsTaxable + $allocatedOnGoods - $landedSpread, 2),
            'payable' => round((float) $purchase->grand_total, 2),
            'round_off' => round((float) $purchase->round_off, 2),
        ];
    }

    /**
     * One row per charge head: the stored rows when the bill owns them, and — for a bill posted
     * before CR-C — the same single Freight line the normaliser shows everywhere else (PUR-017).
     * Without that overlay a legacy bill's payable would carry freight the register cannot place.
     *
     * @return array<int, array<string, mixed>>
     */
    public function chargeRows(Purchase $purchase): array
    {
        $charges = $purchase->relationLoaded('charges')
            ? $purchase->charges
            : PurchaseCharge::where('purchase_id', $purchase->id)->orderBy('seq')->get();

        $rows = $charges->map(function (PurchaseCharge $charge) use ($purchase): array {
            $taxable = round((float) $charge->taxable_amount, 2);
            $cgst = round((float) $charge->cgst_amount, 2);
            $sgst = round((float) $charge->sgst_amount, 2);
            $igst = round((float) $charge->igst_amount, 2);
            $cess = round((float) $charge->cess_amount, 2);

            return $this->row([
                'seq' => (int) $charge->seq,
                'head_code' => (string) $charge->head_code,
                'head_name' => (string) $charge->head_name,
                'sac_code' => $charge->sac_code,
                'treatment' => (string) $charge->treatment,
                'spread_method' => (string) $charge->spread_method,
                'spread_basis_used' => $charge->spread_basis_used,
                'itc_eligibility' => (string) $charge->itc_eligibility,
                'is_rcm' => (bool) $charge->is_rcm,
                'paid_separately' => (bool) $charge->paid_separately,
                'in_payable' => (bool) $charge->in_payable,
                'paid_to_label' => $charge->paid_to_label,
                'taxable' => $taxable,
                'gst_percent' => round((float) $charge->gst_percent, 2),
                'cgst' => $cgst,
                'sgst' => $sgst,
                'igst' => $igst,
                'cess' => $cess,
                'tax' => round($cgst + $sgst + $igst + $cess, 2),
                'allocated' => round((float) $charge->allocated_amount, 2),
                'reversed' => round((float) $charge->reversed_amount, 2),
                'source' => (string) $charge->source,
                'note' => $charge->note,
            ]);
        })->all();

        if ($rows !== []) {
            return $rows;
        }

        return array_map(fn (array $legacy) => $this->row([
            'seq' => (int) $legacy['seq'],
            'head_code' => (string) $legacy['head_code'],
            'head_name' => (string) $legacy['head_name'],
            'sac_code' => $legacy['sac_code'] ?? null,
            'treatment' => (string) $legacy['treatment'],
            'spread_method' => (string) $legacy['spread_method'],
            'spread_basis_used' => $legacy['spread_basis_used'] ?? null,
            'itc_eligibility' => (string) $legacy['itc_eligibility'],
            'is_rcm' => (bool) $legacy['is_rcm'],
            'paid_separately' => (bool) $legacy['paid_separately'],
            'in_payable' => !(bool) $legacy['paid_separately'],
            'paid_to_label' => $legacy['paid_to_label'] ?? null,
            'taxable' => round((float) $legacy['amount'], 2),
            'gst_percent' => round((float) $legacy['gst_percent'], 2),
            'cgst' => 0.0,
            'sgst' => 0.0,
            'igst' => 0.0,
            'cess' => 0.0,
            'tax' => 0.0,
            'allocated' => 0.0,
            'reversed' => round((float) $legacy['reversed_amount'], 2),
            'source' => (string) $legacy['source'],
            'note' => $legacy['note'] ?? null,
        ]), (new PurchaseChargeNormaliser())->forPurchase($purchase));
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function row(array $values): array
    {
        return $values + [
            // CR-C-11: `in_payable` is stored with the line, because the store's policy for
            // separately-paid charges is allowed to change after the bill was printed.
            'payment' => $values['paid_separately'] ? 'Paid Separately' : 'On Account',
            'total' => round((float) $values['taxable'] + (float) $values['tax'], 2),
        ];
    }
}
