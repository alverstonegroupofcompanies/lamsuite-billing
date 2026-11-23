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
     * Rounds half away from zero. JS Math.round() sends .5 toward +infinity, so both
     * engine tiers must route signed rounding through this rule to stay paisa-identical.
     */
    public static function roundSigned(float|int $value): int
    {
        $value = (float) $value;
        return $value < 0 ? -(int) round(-$value) : (int) round($value);
    }

    /**
     * The CGST half of a signed GST amount; the caller takes the residue as SGST so the
     * two halves always re-add to the original paisa.
     */
    public static function halfUpSigned(int $paise): int
    {
        return $paise < 0 ? -(int) round(-$paise / 2) : (int) round($paise / 2);
    }

    /**
     * Largest-remainder paisa split: exact quotients first, then each leftover paisa to
     * the line with the largest fractional part, ties broken by grid order.
     *
     * @param float[] $basis
     * @return array{allocations: int[], recipients: bool[]}
     */
    public static function allocateByBasis(int $amountAbsPaise, array $basis): array
    {
        $count = count($basis);
        $allocations = array_fill(0, $count, 0);
        $recipients = array_fill(0, $count, false);

        if ($count === 0 || $amountAbsPaise === 0) {
            return ['allocations' => $allocations, 'recipients' => $recipients];
        }

        $totalBasis = array_sum($basis);
        if ($totalBasis <= 0) {
            // A degenerate basis (every line worth 0) still has to place the whole amount,
            // otherwise Σ allocations != charge value and the reconciliation identity breaks.
            $allocations[0] = $amountAbsPaise;
            $recipients[0] = true;
            return ['allocations' => $allocations, 'recipients' => $recipients];
        }

        $fractions = [];
        $distributed = 0;
        foreach ($basis as $i => $weight) {
            $exact = ($amountAbsPaise * (float) $weight) / $totalBasis;
            $quotient = (int) floor($exact);
            $allocations[$i] = $quotient;
            $fractions[$i] = $exact - $quotient;
            $distributed += $quotient;
        }

        $remainder = $amountAbsPaise - $distributed;
        $order = array_keys($allocations);
        usort($order, function ($a, $b) use ($fractions) {
            if ($fractions[$a] != $fractions[$b]) {
                return $fractions[$b] <=> $fractions[$a];
            }
            return $a <=> $b;
        });

        foreach ($order as $index) {
            if ($remainder <= 0) {
                break;
            }
            $allocations[$index] += 1;
            $recipients[$index] = true;
            $remainder -= 1;
        }

        return ['allocations' => $allocations, 'recipients' => $recipients];
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
     *           'gross_weight_kg' => null,
     *           'is_tax_inclusive' => null
     *       ]
     *   ],
     *   'bill_discount' => ['type' => 'amount', 'value' => 0],
     *   'charges' => [
     *       [
     *           'charge_id' => 'C1',
     *           'head_code' => 'FREIGHT',
     *           'head_name' => 'Freight',
     *           'sac_code' => '996714',
     *           'amount' => 200.0,
     *           'gst_percent' => 18,
     *           'cess_percent' => 0,
     *           'treatment' => 'add_to_cost', // or 'expense'
     *           'spread_method' => 'value',   // 'value' | 'quantity' | 'weight'
     *           'itc_eligibility' => 'eligible',
     *           'is_rcm' => false,
     *           'paid_separately' => false
     *       ]
     *   ],
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
        $gstType = $input['gst_type'] ?? ($input['is_composition'] ?? false ? 'composition' : 'regular');
        $isComposition = (bool) ($input['is_composition'] ?? false) || in_array($gstType, ['composition', 'no_tax', 'unregistered'], true);
        $documentTitle = $isComposition ? 'Bill of Supply' : 'Tax Invoice';

        $lines = $input['lines'] ?? [];
        $preLines = [];
        $sumNetBasePaise = 0;
        $grossSubtotalPaise = 0;
        $lineDiscountTotalPaise = 0;

        foreach ($lines as $line) {
            $packs = max(0, (float) ($line['qty'] ?? $line['pack_qty'] ?? 0));
            $loose = max(0, (float) ($line['loose_qty'] ?? 0));
            $free = max(0, (float) ($line['free_qty'] ?? $line['free_pack_qty'] ?? 0));
            $freeLoose = max(0, (float) ($line['free_loose_qty'] ?? 0));
            $upp = max(1, (int) round((float) ($line['units_per_pack'] ?? 1)));
            $billedUnits = ($packs * $upp) + $loose;
            $freeUnits = ($free * $upp) + $freeLoose;
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
                // A line's discount is described by a percent, an amount, or — the defect
                // this guards — both. A till that sends a percent plus the amount it
                // produced is naming one discount twice, so it must come off once; a
                // purchase line carries a trade percent *and* a separate scheme amount,
                // and dropping either would bill the line above what the supplier
                // charged. The paisa tell them apart: an echo of the percent equals it,
                // a second discount does not.
                $pct = min(100, max(0, (float) ($line['discount_percent'] ?? 0)));
                $flat = max(0, (float) ($line['discount_amount'] ?? 0));
                $pctPaise = $pct > 0 ? min($grossPaise, (int) round(($grossPaise * $pct) / 100)) : 0;
                $flatPaise = $flat > 0 ? min($grossPaise, self::toPaise($flat)) : 0;
                $lineDiscPaise = ($pctPaise > 0 && $flatPaise > 0 && abs($pctPaise - $flatPaise) <= 1)
                    ? $pctPaise
                    : min($grossPaise, $pctPaise + $flatPaise);
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
        $lineTaxablePaiseList = [];
        $lineTotalUnitsList = [];
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
                // Split the GST amount of the line; rounding each half off the taxable base
                // can drop a paisa, and on inclusive lines that breaks taxable + tax = MRP.
                $cgstPaise = (int) round($gstPaise / 2);
                $sgstPaise = $gstPaise - $cgstPaise;
            }

            $totalTaxPaise = $cgstPaise + $sgstPaise + $igstPaise + $cessPaise;
            $lineTotalPaise = $taxablePaise + $totalTaxPaise;

            $taxableSubtotalPaise += $taxablePaise;
            $lineTaxablePaiseList[] = $taxablePaise;
            $lineTotalUnitsList[] = $pl['totalUnits'];
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

        // Purchase charges (CR-C): each charge is taxed by this same engine, then an
        // add-to-cost charge is spread across this bill's item lines in whole paisa.
        $goodsTotalTaxPaise = $cgstTotalPaise + $sgstTotalPaise + $igstTotalPaise + $cessTotalPaise;
        $chargeCount = count($preLines);
        $lineChargeAllocPaise = array_fill(0, $chargeCount, 0);
        $calculatedCharges = [];
        $chargeSacMap = [];
        $chargeTaxablePayablePaise = 0;
        $chargeTaxPayablePaise = 0;
        $chargeTotalPayablePaise = 0;
        $separateChargeTaxablePaise = 0;
        $separateChargeTaxPaise = 0;
        $separateChargeTotalPaise = 0;
        $landedCostAdditionPaise = 0;
        $expenseChargeTotalPaise = 0;
        $chargeCreditableTaxPaise = 0;
        $chargeNonCreditableTaxPaise = 0;

        // A separately-paid charge is normally outside what the supplier is owed. A store may
        // instead bill it into the payable — the supplier's own printed bill includes it — and
        // then it joins the goods money exactly like any other charge (CR-C-11).
        $separatelyPaidInPayable = !empty($input['separately_paid_in_payable']);

        foreach ($input['charges'] ?? [] as $charge) {
            $taxablePaise = self::toPaise($charge['amount'] ?? 0);
            $sign = $taxablePaise < 0 ? -1 : 1;
            $gstPercent = $isComposition ? 0.0 : max(0.0, (float) ($charge['gst_percent'] ?? $charge['gst_rate'] ?? 0));
            $cessPercent = $isComposition ? 0.0 : max(0.0, (float) ($charge['cess_percent'] ?? $charge['cess_rate'] ?? 0));

            $gstPaise = $gstPercent > 0 ? $sign * self::roundSigned((abs($taxablePaise) * $gstPercent) / 100) : 0;
            $cessPaise = $cessPercent > 0 ? $sign * self::roundSigned((abs($taxablePaise) * $cessPercent) / 100) : 0;

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
                $cgstPaise = self::halfUpSigned($gstPaise);
                $sgstPaise = $gstPaise - $cgstPaise;
            }

            $totalTaxPaise = $cgstPaise + $sgstPaise + $igstPaise + $cessPaise;
            $totalAmountPaise = $taxablePaise + $totalTaxPaise;

            $treatment = ($charge['treatment'] ?? 'add_to_cost') === 'expense' ? 'expense' : 'add_to_cost';
            $paidSeparately = (bool) ($charge['paid_separately'] ?? false);
            // A reversal line carries the answer the bill it gives back was posted under, so it keeps
            // that membership instead of today's policy — a policy flip must not make a debit note
            // credit money the original bill never billed (PUR-016).
            $inPayable = array_key_exists('in_payable', $charge)
                ? (bool) $charge['in_payable']
                : (!$paidSeparately || $separatelyPaidInPayable);
            $isCreditable = ($charge['itc_eligibility'] ?? 'eligible') === 'eligible';
            $creditableTaxPaise = $isCreditable ? $totalTaxPaise : 0;
            $nonCreditableTaxPaise = $isCreditable ? 0 : $totalTaxPaise;
            // An expensed charge posts ex-GST, plus the tax that can never be claimed back,
            // so a blocked head cannot make value vanish from the books.
            $expensePostingPaise = $treatment === 'expense' ? $taxablePaise + $nonCreditableTaxPaise : 0;

            $spreadMethod = $charge['spread_method'] ?? 'value';
            $spreadBasisUsed = 'none';
            $spreadFallbackReason = null;
            $linesWithoutWeight = [];
            $allocationsOut = [];

            if ($treatment === 'add_to_cost' && $chargeCount > 0) {
                // Non-creditable tax cannot be claimed back, so it is capitalised with the
                // charge instead of being left unbooked.
                $spreadAmountPaise = $taxablePaise + $nonCreditableTaxPaise;
                $basis = [];
                if ($spreadMethod === 'weight') {
                    $hasWeightForAll = true;
                    foreach ($preLines as $i => $pl) {
                        $weight = $pl['lineInput']['gross_weight_kg'] ?? null;
                        if ($weight === null || $weight === '' || (float) $weight <= 0) {
                            $hasWeightForAll = false;
                            $linesWithoutWeight[] = $pl['lineInput']['line_id'] ?? ('L' . ($i + 1));
                        }
                        $basis[] = max(0.0, (float) $weight);
                    }
                    if ($hasWeightForAll) {
                        $spreadBasisUsed = 'weight';
                    } else {
                        // A mixed basis is forbidden: the whole charge falls back to value.
                        $spreadBasisUsed = 'value';
                        $spreadFallbackReason = 'missing_weight';
                        $basis = $lineTaxablePaiseList;
                    }
                } elseif ($spreadMethod === 'quantity') {
                    $spreadBasisUsed = 'quantity';
                    $basis = $lineTotalUnitsList;
                } else {
                    $spreadBasisUsed = 'value';
                    $basis = $lineTaxablePaiseList;
                }

                $split = self::allocateByBasis(abs($spreadAmountPaise), $basis);
                foreach ($split['allocations'] as $i => $absoluteAllocPaise) {
                    $allocPaise = $sign * $absoluteAllocPaise;
                    $lineChargeAllocPaise[$i] += $allocPaise;
                    $landedCostAdditionPaise += $allocPaise;
                    $allocationsOut[] = [
                        'line_id' => $preLines[$i]['lineInput']['line_id'] ?? null,
                        'product_id' => $preLines[$i]['lineInput']['product_id'] ?? null,
                        'product_name' => $preLines[$i]['lineInput']['product_name'] ?? null,
                        'allocated_amount' => self::fromPaise($allocPaise),
                        'is_remainder_paisa' => $split['recipients'][$i],
                    ];
                }
            }

            if ($inPayable) {
                $chargeTaxablePayablePaise += $taxablePaise;
                $chargeTaxPayablePaise += $totalTaxPaise;
                $chargeTotalPayablePaise += $totalAmountPaise;
                $cgstTotalPaise += $cgstPaise;
                $sgstTotalPaise += $sgstPaise;
                $igstTotalPaise += $igstPaise;
                $cessTotalPaise += $cessPaise;

                $sac = trim((string) ($charge['sac_code'] ?? ''));
                if ($sac === '') {
                    $sac = '996799';
                }
                // Prefixed key so a charge can never merge into a goods row of the same code.
                $sacKey = "SAC_{$sac}_{$gstPercent}_{$cessPercent}";
                if (!isset($chargeSacMap[$sacKey])) {
                    $chargeSacMap[$sacKey] = [
                        'hsn' => $sac,
                        'rate' => $gstPercent,
                        'cessRate' => $cessPercent,
                        'taxablePaise' => 0,
                        'cgstPaise' => 0,
                        'sgstPaise' => 0,
                        'igstPaise' => 0,
                        'cessPaise' => 0,
                    ];
                }
                $chargeSacMap[$sacKey]['taxablePaise'] += $taxablePaise;
                $chargeSacMap[$sacKey]['cgstPaise'] += $cgstPaise;
                $chargeSacMap[$sacKey]['sgstPaise'] += $sgstPaise;
                $chargeSacMap[$sacKey]['igstPaise'] += $igstPaise;
                $chargeSacMap[$sacKey]['cessPaise'] += $cessPaise;
            } else {
                $separateChargeTaxablePaise += $taxablePaise;
                $separateChargeTaxPaise += $totalTaxPaise;
                $separateChargeTotalPaise += $totalAmountPaise;
            }

            $expenseChargeTotalPaise += $expensePostingPaise;
            $chargeCreditableTaxPaise += $creditableTaxPaise;
            $chargeNonCreditableTaxPaise += $nonCreditableTaxPaise;

            $calculatedCharges[] = [
                'charge_id' => $charge['charge_id'] ?? null,
                'head_code' => $charge['head_code'] ?? null,
                'head_name' => $charge['head_name'] ?? null,
                'sac_code' => $charge['sac_code'] ?? null,
                'note' => $charge['note'] ?? null,
                'amount' => self::fromPaise($taxablePaise),
                'treatment' => $treatment,
                'spread_method' => $spreadMethod,
                'spread_basis_used' => $spreadBasisUsed,
                'spread_fallback_reason' => $spreadFallbackReason,
                'lines_without_weight' => $linesWithoutWeight,
                'gst_rate' => $gstPercent,
                'cgst_rate' => $cgstRate,
                'sgst_rate' => $sgstRate,
                'igst_rate' => $igstRate,
                'cess_rate' => $cessPercent,
                'taxable_amount' => self::fromPaise($taxablePaise),
                'cgst_amount' => self::fromPaise($cgstPaise),
                'sgst_amount' => self::fromPaise($sgstPaise),
                'igst_amount' => self::fromPaise($igstPaise),
                'cess_amount' => self::fromPaise($cessPaise),
                'total_tax' => self::fromPaise($totalTaxPaise),
                'total_amount' => self::fromPaise($totalAmountPaise),
                'itc_eligibility' => $charge['itc_eligibility'] ?? 'eligible',
                'creditable_tax' => self::fromPaise($creditableTaxPaise),
                'non_creditable_tax' => self::fromPaise($nonCreditableTaxPaise),
                'is_rcm' => (bool) ($charge['is_rcm'] ?? false),
                'paid_separately' => $paidSeparately,
                'paid_to_label' => $charge['paid_to_label'] ?? null,
                'in_payable' => $inPayable,
                'expense_posting' => self::fromPaise($expensePostingPaise),
                'allocations' => $allocationsOut,
            ];
        }

        foreach ($calculatedLines as $i => $line) {
            $allocPaise = $lineChargeAllocPaise[$i] ?? 0;
            $landedPaise = $lineTaxablePaiseList[$i] + $allocPaise;
            $units = (float) $line['total_units'];
            // PUR-002: free goods absorb their share of the charge, so the effective unit
            // cost and the landed unit cost are the same number.
            $perUnitPaise = $units > 0 ? self::fromPaise(self::roundSigned($landedPaise / $units)) : 0.0;
            $calculatedLines[$i]['charge_allocation'] = self::fromPaise($allocPaise);
            $calculatedLines[$i]['landed_amount'] = self::fromPaise($landedPaise);
            $calculatedLines[$i]['landed_unit_cost'] = $perUnitPaise;
            $calculatedLines[$i]['effective_unit_cost'] = $perUnitPaise;
        }

        $totalTaxAllPaise = $cgstTotalPaise + $sgstTotalPaise + $igstTotalPaise + $cessTotalPaise;
        $netBeforeRoundPaise = $taxableSubtotalPaise + $chargeTaxablePayablePaise + $totalTaxAllPaise;

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
        foreach (array_merge($hsnMap, $chargeSacMap) as $h) {
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
            'charge_taxable_total' => self::fromPaise($chargeTaxablePayablePaise),
            'charge_tax_total' => self::fromPaise($chargeTaxPayablePaise),
            'charge_total' => self::fromPaise($chargeTotalPayablePaise),
            'separate_charge_taxable_total' => self::fromPaise($separateChargeTaxablePaise),
            'separate_charge_tax_total' => self::fromPaise($separateChargeTaxPaise),
            'separate_charge_total' => self::fromPaise($separateChargeTotalPaise),
            'landed_cost_addition' => self::fromPaise($landedCostAdditionPaise),
            'expense_charge_total' => self::fromPaise($expenseChargeTotalPaise),
            'creditable_input_tax_total' => self::fromPaise($goodsTotalTaxPaise + $chargeCreditableTaxPaise),
            'non_creditable_tax_total' => self::fromPaise($chargeNonCreditableTaxPaise),
            'reconciliation_identity_delta' => self::fromPaise(
                $taxableSubtotalPaise
                + $landedCostAdditionPaise
                + $expenseChargeTotalPaise
                + $goodsTotalTaxPaise
                + $chargeCreditableTaxPaise
                - $netBeforeRoundPaise
                - $separateChargeTotalPaise
            ),
            'net_before_round' => self::fromPaise($netBeforeRoundPaise),
            'round_off' => self::fromPaise($roundOffPaise),
            'grand_total' => self::fromPaise($grandTotalPaise),
            'is_inter_state' => $isInterState,
            'store_state' => $storeState,
            'place_of_supply' => $posState,
            'is_composition' => $isComposition,
            'gst_type' => $gstType,
            'document_title' => $documentTitle,
            'lines' => $calculatedLines,
            'charges' => $calculatedCharges,
            'hsn_summary' => $hsnSummary,
        ];
    }
}
