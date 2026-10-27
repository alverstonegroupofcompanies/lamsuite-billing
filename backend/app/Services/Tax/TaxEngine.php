<?php

namespace App\Services\Tax;

class TaxEngine
{
    public static function toPaise(float|int|string|null $amount): int
    {
        return (int) round(((float) ($amount ?? 0)) * 100);
    }

    public static function fromPaise(int $paise): float
    {
        return round($paise / 100, 2);
    }

    public static function cleanStateCode(?string $val, string $fallback = '32'): string
    {
        if (empty($val)) {
            return $fallback;
        }
        $trimmed = trim($val);
        if (preg_match('/^\d{2}/', $trimmed, $matches)) {
            return $matches[0];
        }
        return $fallback;
    }

    public static function isGstInclusive(
        ?string $rateBasis,
        string $defaultTaxMode = 'inclusive',
        ?bool $explicitInclusive = null
    ): bool {
        if ($explicitInclusive !== null) {
            return $explicitInclusive;
        }
        if ($rateBasis === 'mrp') {
            return true;
        }
        if (in_array($rateBasis, ['ptr', 'pts', 'ptss'], true)) {
            return false;
        }
        return $defaultTaxMode === 'inclusive';
    }

    /**
     * Calculates a full document in pure integer paise.
     *
     * @param array $input [
     *   'store_state' => '32',
     *   'customer_gstin' => null,
     *   'place_of_supply' => null,
     *   'default_tax_mode' => 'inclusive', // or 'exclusive'
     *   'is_composition' => false,
     *   'lines' => [
     *       [
     *           'line_id' => 'L1',
     *           'qty' => 1,
     *           'loose_qty' => 0,
     *           'free_qty' => 0,
     *           'units_per_pack' => 1,
     *           'unit_price' => 100.0,
     *           'rate_basis' => 'sel_rate',
     *           'discount_percent' => 0,
     *           'discount_amount' => 0,
     *           'gst_percent' => 18,
     *           'cess_percent' => 0,
     *           'is_tax_inclusive' => null
     *       ]
     *   ],
     *   'bill_discount' => ['type' => 'amount', 'value' => 0],
     *   'auto_round_off' => true,
     *   'manual_round_off' => null
     * ]
     * @return array
     */
    public static function calculate(array $input): array
    {
        return self::calculateDocumentTaxes($input);
    }

    public static function calculateDocumentTaxes(array $input): array
    {
        $storeState = self::cleanStateCode($input['store_state'] ?? '32', '32');
        $posState = $storeState;

        if (!empty($input['customer_gstin']) && strlen(trim($input['customer_gstin'])) >= 2) {
            $posState = self::cleanStateCode(trim($input['customer_gstin']), $storeState);
        } elseif (!empty($input['place_of_supply']) && strlen(trim($input['place_of_supply'])) >= 2) {
            $posState = self::cleanStateCode(trim($input['place_of_supply']), $storeState);
        }

        $isInterState = $storeState !== $posState;
        $defaultTaxMode = $input['default_tax_mode'] ?? 'inclusive';
        $isComposition = (bool) ($input['is_composition'] ?? false);

        $lines = $input['lines'] ?? [];
        $preLines = [];
        $sumNetBasePaise = 0;
        $grossSubtotalPaise = 0;
        $lineDiscountTotalPaise = 0;

        foreach ($lines as $line) {
            $packs = max(0, (float) ($line['qty'] ?? $line['pack_qty'] ?? 0));
            $loose = max(0, (float) ($line['loose_qty'] ?? 0));
            $free = max(0, (float) ($line['free_qty'] ?? $line['free_pack_qty'] ?? 0));
            $upp = max(1, (int) round((float) ($line['units_per_pack'] ?? 1)));
            $billedUnits = ($packs * $upp) + $loose;
            $freeUnits = $free * $upp;
            $totalUnits = $billedUnits + $freeUnits;

            $unitPricePaise = self::toPaise($line['unit_price'] ?? 0);
            $rateBasis = $line['rate_basis'] ?? 'sel_rate';
            $isInclusive = self::isGstInclusive($rateBasis, $defaultTaxMode, $line['is_tax_inclusive'] ?? null);

            if ($rateBasis === 'loose_rate') {
                $grossPaise = (int) round($billedUnits * ($unitPricePaise / 100) * 100);
            } else {
                $packGrossPaise = (int) round($packs * $unitPricePaise);
                $looseGrossPaise = $loose > 0 ? (int) round(($loose * $unitPricePaise) / $upp) : 0;
                $grossPaise = $packGrossPaise + $looseGrossPaise;
            }

            $lineDiscPaise = 0;
            if ($grossPaise > 0) {
                $pctDiscPaise = !empty($line['discount_percent']) && (float)$line['discount_percent'] > 0
                    ? (int) round(($grossPaise * (float)$line['discount_percent']) / 100)
                    : 0;
                $flatDiscPaise = !empty($line['discount_amount']) && (float)$line['discount_amount'] > 0
                    ? self::toPaise($line['discount_amount'])
                    : 0;
                $lineDiscPaise = min($grossPaise, $pctDiscPaise + $flatDiscPaise);
            }

            $lineNetBasePaise = max(0, $grossPaise - $lineDiscPaise);
            $sumNetBasePaise += $lineNetBasePaise;
            $grossSubtotalPaise += $grossPaise;
            $lineDiscountTotalPaise += $lineDiscPaise;

            $preLines[] = [
                'lineInput' => $line,
                'packs' => $packs,
                'loose' => $loose,
                'free' => $free,
                'upp' => $upp,
                'billedUnits' => $billedUnits,
                'freeUnits' => $freeUnits,
                'totalUnits' => $totalUnits,
                'unitPricePaise' => $unitPricePaise,
                'rateBasis' => $rateBasis,
                'isInclusive' => $isInclusive,
                'grossPaise' => $grossPaise,
                'lineDiscPaise' => $lineDiscPaise,
                'lineNetBasePaise' => $lineNetBasePaise,
            ];
        }

        // Allocate Bill-Level Discount
        $billDiscount = $input['bill_discount'] ?? ['type' => 'amount', 'value' => 0];
        $totalBillDiscPaise = 0;
        if (!empty($billDiscount['value']) && (float)$billDiscount['value'] > 0 && $sumNetBasePaise > 0) {
            if (($billDiscount['type'] ?? 'amount') === 'percent') {
                $totalBillDiscPaise = (int) round(($sumNetBasePaise * min(100, max(0, (float)$billDiscount['value']))) / 100);
            } else {
                $totalBillDiscPaise = min($sumNetBasePaise, self::toPaise($billDiscount['value']));
            }
        }

        $allocatedBillDiscList = array_fill(0, count($preLines), 0);
        $distributedBillDiscPaise = 0;
        $maxNetBaseIdx = 0;
        $maxNetBaseVal = -1;

        if ($totalBillDiscPaise > 0 && $sumNetBasePaise > 0) {
            foreach ($preLines as $i => $pl) {
                $lineNet = $pl['lineNetBasePaise'];
                if ($lineNet > $maxNetBaseVal) {
                    $maxNetBaseVal = $lineNet;
                    $maxNetBaseIdx = $i;
                }
                $alloc = (int) round(($totalBillDiscPaise * $lineNet) / $sumNetBasePaise);
                $allocatedBillDiscList[$i] = $alloc;
                $distributedBillDiscPaise += $alloc;
            }

            $remainder = $totalBillDiscPaise - $distributedBillDiscPaise;
            if ($remainder !== 0 && $maxNetBaseIdx >= 0) {
                $allocatedBillDiscList[$maxNetBaseIdx] += $remainder;
            }
        }

        // Calculate line taxes and totals
        $calculatedLines = [];
        $taxableSubtotalPaise = 0;
        $cgstTotalPaise = 0;
        $sgstTotalPaise = 0;
        $igstTotalPaise = 0;
        $cessTotalPaise = 0;
        $hsnMap = [];

        foreach ($preLines as $i => $pl) {
            $allocDiscPaise = $allocatedBillDiscList[$i];
            $discountedBasePaise = max(0, $pl['lineNetBasePaise'] - $allocDiscPaise);

            $gstPercent = $isComposition ? 0.0 : max(0.0, (float) ($pl['lineInput']['gst_percent'] ?? $pl['lineInput']['gst_rate'] ?? 0));
            $cessPercent = $isComposition ? 0.0 : max(0.0, (float) ($pl['lineInput']['cess_percent'] ?? $pl['lineInput']['cess_rate'] ?? 0));
            $combinedRate = $gstPercent + $cessPercent;

            if ($pl['isInclusive']) {
                if ($combinedRate > 0) {
                    $taxablePaise = (int) round($discountedBasePaise / (1 + $combinedRate / 100));
                    $totalTaxPaise = max(0, $discountedBasePaise - $taxablePaise);
                    if ($cessPercent > 0) {
                        $cessPaise = (int) round(($taxablePaise * $cessPercent) / 100);
                        $gstPaise = max(0, $totalTaxPaise - $cessPaise);
                    } else {
                        $cessPaise = 0;
                        $gstPaise = $totalTaxPaise;
                    }
                } else {
                    $taxablePaise = $discountedBasePaise;
                    $gstPaise = 0;
                    $cessPaise = 0;
                }
            } else {
                $taxablePaise = $discountedBasePaise;
                $gstPaise = $gstPercent > 0 ? (int) round(($taxablePaise * $gstPercent) / 100) : 0;
                $cessPaise = $cessPercent > 0 ? (int) round(($taxablePaise * $cessPercent) / 100) : 0;
            }

            $cgstRate = 0.0;
            $cgstPaise = 0;
            $sgstRate = 0.0;
            $sgstPaise = 0;
            $igstRate = 0.0;
            $igstPaise = 0;

            if ($isInterState) {
                $igstRate = $gstPercent;
                $igstPaise = $gstPaise;
            } else {
                $cgstRate = $gstPercent / 2.0;
                $sgstRate = $gstPercent / 2.0;
                $cgstPaise = (int) round(($taxablePaise * $cgstRate) / 100);
                $sgstPaise = (int) round(($taxablePaise * $sgstRate) / 100);
            }

            $totalTaxPaise = $cgstPaise + $sgstPaise + $igstPaise + $cessPaise;
            $lineTotalPaise = $taxablePaise + $totalTaxPaise;

            $taxableSubtotalPaise += $taxablePaise;
            $cgstTotalPaise += $cgstPaise;
            $sgstTotalPaise += $sgstPaise;
            $igstTotalPaise += $igstPaise;
            $cessTotalPaise += $cessPaise;

            $hsn = trim($pl['lineInput']['hsn_code'] ?? '30049099');
            $hsnKey = "{$hsn}_{$gstPercent}_{$cessPercent}";
            if (!isset($hsnMap[$hsnKey])) {
                $hsnMap[$hsnKey] = [
                    'hsn' => $hsn,
                    'rate' => $gstPercent,
                    'cessRate' => $cessPercent,
                    'taxablePaise' => 0,
                    'cgstPaise' => 0,
                    'sgstPaise' => 0,
                    'igstPaise' => 0,
                    'cessPaise' => 0,
                ];
            }
            $hsnMap[$hsnKey]['taxablePaise'] += $taxablePaise;
            $hsnMap[$hsnKey]['cgstPaise'] += $cgstPaise;
            $hsnMap[$hsnKey]['sgstPaise'] += $sgstPaise;
            $hsnMap[$hsnKey]['igstPaise'] += $igstPaise;
            $hsnMap[$hsnKey]['cessPaise'] += $cessPaise;

            $calculatedLines[] = [
                'line_id' => $pl['lineInput']['line_id'] ?? null,
                'product_id' => $pl['lineInput']['product_id'] ?? null,
                'product_name' => $pl['lineInput']['product_name'] ?? null,
                'hsn_code' => $pl['lineInput']['hsn_code'] ?? null,
                'qty' => $pl['packs'],
                'loose_qty' => $pl['loose'],
                'free_qty' => $pl['free'],
                'units_per_pack' => $pl['upp'],
                'billed_units' => $pl['billedUnits'],
                'free_units' => $pl['freeUnits'],
                'total_units' => $pl['totalUnits'],
                'unit_price' => self::fromPaise($pl['unitPricePaise']),
                'rate_basis' => $pl['rateBasis'],
                'is_tax_inclusive' => $pl['isInclusive'],
                'gross_amount' => self::fromPaise($pl['grossPaise']),
                'line_discount' => self::fromPaise($pl['lineDiscPaise']),
                'allocated_bill_discount' => self::fromPaise($allocDiscPaise),
                'taxable_amount' => self::fromPaise($taxablePaise),
                'gst_rate' => $gstPercent,
                'cgst_rate' => $cgstRate,
                'cgst_amount' => self::fromPaise($cgstPaise),
                'sgst_rate' => $sgstRate,
                'sgst_amount' => self::fromPaise($sgstPaise),
                'igst_rate' => $igstRate,
                'igst_amount' => self::fromPaise($igstPaise),
                'cess_rate' => $cessPercent,
                'cess_amount' => self::fromPaise($cessPaise),
                'total_tax' => self::fromPaise($totalTaxPaise),
                'total_amount' => self::fromPaise($lineTotalPaise),
                'effective_unit_cost' => $pl['totalUnits'] > 0 ? self::fromPaise((int) round($taxablePaise / $pl['totalUnits'])) : 0.0,
            ];
        }

        $totalTaxAllPaise = $cgstTotalPaise + $sgstTotalPaise + $igstTotalPaise + $cessTotalPaise;
        $netBeforeRoundPaise = $taxableSubtotalPaise + $totalTaxAllPaise;

        $roundOffPaise = 0;
        $grandTotalPaise = $netBeforeRoundPaise;

        if (isset($input['manual_round_off']) && $input['manual_round_off'] !== null) {
            $roundOffPaise = self::toPaise($input['manual_round_off']);
            $grandTotalPaise = max(0, $netBeforeRoundPaise + $roundOffPaise);
        } elseif (($input['auto_round_off'] ?? true) !== false) {
            $roundedRupeePaise = (int) round($netBeforeRoundPaise / 100) * 100;
            $roundOffPaise = $roundedRupeePaise - $netBeforeRoundPaise;
            $grandTotalPaise = $roundedRupeePaise;
        }

        $hsnSummary = [];
        foreach ($hsnMap as $h) {
            $totTaxP = $h['cgstPaise'] + $h['sgstPaise'] + $h['igstPaise'] + $h['cessPaise'];
            $hsnSummary[] = [
                'hsn_code' => $h['hsn'],
                'gst_rate' => $h['rate'],
                'taxable_value' => self::fromPaise($h['taxablePaise']),
                'cgst_rate' => $isInterState ? 0.0 : $h['rate'] / 2.0,
                'cgst_amount' => self::fromPaise($h['cgstPaise']),
                'sgst_rate' => $isInterState ? 0.0 : $h['rate'] / 2.0,
                'sgst_amount' => self::fromPaise($h['sgstPaise']),
                'igst_rate' => $isInterState ? $h['rate'] : 0.0,
                'igst_amount' => self::fromPaise($h['igstPaise']),
                'cess_rate' => $h['cessRate'],
                'cess_amount' => self::fromPaise($h['cessPaise']),
                'total_tax' => self::fromPaise($totTaxP),
                'total_amount' => self::fromPaise($h['taxablePaise'] + $totTaxP),
            ];
        }

        return [
            'gross_subtotal' => self::fromPaise($grossSubtotalPaise),
            'line_discount_total' => self::fromPaise($lineDiscountTotalPaise),
            'bill_discount_total' => self::fromPaise($totalBillDiscPaise),
            'taxable_subtotal' => self::fromPaise($taxableSubtotalPaise),
            'cgst_total' => self::fromPaise($cgstTotalPaise),
            'sgst_total' => self::fromPaise($sgstTotalPaise),
            'igst_total' => self::fromPaise($igstTotalPaise),
            'cess_total' => self::fromPaise($cessTotalPaise),
            'total_tax' => self::fromPaise($totalTaxAllPaise),
            'net_before_round' => self::fromPaise($netBeforeRoundPaise),
            'round_off' => self::fromPaise($roundOffPaise),
            'grand_total' => self::fromPaise($grandTotalPaise),
            'is_inter_state' => $isInterState,
            'store_state' => $storeState,
            'place_of_supply' => $posState,
            'lines' => $calculatedLines,
            'hsn_summary' => $hsnSummary,
        ];
    }
}
