<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Invoice;

class ReportController
{
    /**
     * Daily collection summary breakdown by tender.
     */
    public function dailyCollection(Request $request): JsonResponse
    {
        $startDate = $request->query('start_date', date('Y-m-d'));
        $endDate = $request->query('end_date', date('Y-m-d'));

        $counterId = $request->query('counter_id');

        $query = Invoice::whereDate('invoice_date', '>=', $startDate)
            ->whereDate('invoice_date', '<=', $endDate)
            ->where('status', '!=', 'cancelled');

        if (!empty($counterId)) {
            $query->where('counter_id', $counterId);
        }

        $invoices = $query->get();

        $grossSales = $invoices->where('module_key', 'invoice')->sum('grand_total');
        $returns = $invoices->where('module_key', 'credit_note')->sum('grand_total');
        $netSales = $grossSales - $returns;

        $byTender = [
            'cash' => $invoices->where('payment_mode', 'Cash')->sum('grand_total'),
            'upi' => $invoices->where('payment_mode', 'UPI')->sum('grand_total'),
            'card' => $invoices->where('payment_mode', 'Card')->sum('grand_total'),
            'credit' => $invoices->where('payment_mode', 'Credit')->sum('grand_total'),
        ];

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'total_invoices_count' => $invoices->where('module_key', 'invoice')->count(),
            'gross_sales' => round($grossSales, 2),
            'total_returns' => round($returns, 2),
            'net_sales' => round($netSales, 2),
            'by_tender' => $byTender,
            'total_taxable' => round($invoices->sum('subtotal'), 2),
            'total_tax' => round($invoices->sum('tax_total'), 2),
            'total_round_off' => round($invoices->sum('round_off'), 2),
        ]);
    }

    /**
     * GSTR-1 Compliance Summary (Tables 4, 5, 7, 9).
     */
    public function gstr1(Request $request): JsonResponse
    {
        $startDate = $request->query('start_date', date('Y-m-01'));
        $endDate = $request->query('end_date', date('Y-m-t'));
        $storeState = $request->query('store_state_code', '32');

        $invoices = Invoice::with('items')
            ->whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->get();

        $table4B2b = [];
        $table5B2cLarge = [];
        $table7B2cMap = [];
        $table9CreditNotes = [];

        foreach ($invoices as $inv) {
            $hasGstin = !empty($inv->customer_gstin) && strlen(trim($inv->customer_gstin)) === 15;
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $targetState = !empty($inv->customer_gstin) ? substr(trim($inv->customer_gstin), 0, 2) : ($inv->place_of_supply ?? $storeState);
            $taxable = (float) ($inv->taxable_subtotal ?? $inv->subtotal);

            if ($isReturn) {
                $table9CreditNotes[] = [
                    'note_number' => $inv->invoice_number,
                    'note_date' => $inv->invoice_date->format('Y-m-d'),
                    'customer_name' => $inv->customer_name,
                    'customer_gstin' => $inv->customer_gstin ?? '-',
                    'note_value' => (float) $inv->grand_total,
                    'taxable_value' => $taxable,
                    'cgst_amount' => (float) ($inv->cgst_total ?? 0),
                    'sgst_amount' => (float) ($inv->sgst_total ?? 0),
                    'igst_amount' => (float) ($inv->igst_total ?? 0),
                    'cess_amount' => (float) ($inv->cess_total ?? 0),
                ];
                continue;
            }

            if ($hasGstin) {
                $table4B2b[] = [
                    'gstin' => $inv->customer_gstin,
                    'customer_name' => $inv->customer_name,
                    'invoice_number' => $inv->invoice_number,
                    'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                    'invoice_value' => (float) $inv->grand_total,
                    'place_of_supply' => $targetState,
                    'taxable_value' => $taxable,
                    'cgst_amount' => (float) ($inv->cgst_total ?? 0),
                    'sgst_amount' => (float) ($inv->sgst_total ?? 0),
                    'igst_amount' => (float) ($inv->igst_total ?? 0),
                    'cess_amount' => (float) ($inv->cess_total ?? 0),
                ];
            } elseif ($targetState !== $storeState && $inv->grand_total > 250000) {
                $table5B2cLarge[] = [
                    'invoice_number' => $inv->invoice_number,
                    'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                    'invoice_value' => (float) $inv->grand_total,
                    'place_of_supply' => $targetState,
                    'taxable_value' => $taxable,
                    'igst_amount' => (float) ($inv->igst_total ?? $inv->tax_total ?? 0),
                    'cess_amount' => (float) ($inv->cess_total ?? 0),
                ];
            } else {
                // Table 7: Consolidated B2CS by place of supply
                if (!isset($table7B2cMap[$targetState])) {
                    $table7B2cMap[$targetState] = [
                        'place_of_supply' => $targetState,
                        'taxable_value' => 0.0,
                        'cgst_amount' => 0.0,
                        'sgst_amount' => 0.0,
                        'igst_amount' => 0.0,
                        'cess_amount' => 0.0,
                        'tax_amount' => 0.0,
                    ];
                }
                $table7B2cMap[$targetState]['taxable_value'] += $taxable;
                $table7B2cMap[$targetState]['cgst_amount'] += (float) ($inv->cgst_total ?? 0);
                $table7B2cMap[$targetState]['sgst_amount'] += (float) ($inv->sgst_total ?? 0);
                $table7B2cMap[$targetState]['igst_amount'] += (float) ($inv->igst_total ?? 0);
                $table7B2cMap[$targetState]['cess_amount'] += (float) ($inv->cess_total ?? 0);
                $table7B2cMap[$targetState]['tax_amount'] += (float) ($inv->tax_total ?? 0);
            }
        }

        $table7B2cSmall = array_values(array_map(function ($row) {
            return [
                'place_of_supply' => $row['place_of_supply'],
                'taxable_value' => round($row['taxable_value'], 2),
                'cgst_amount' => round($row['cgst_amount'], 2),
                'sgst_amount' => round($row['sgst_amount'], 2),
                'igst_amount' => round($row['igst_amount'], 2),
                'cess_amount' => round($row['cess_amount'], 2),
                'tax_amount' => round($row['tax_amount'], 2),
            ];
        }, $table7B2cMap));

        return response()->json([
            'tax_period' => ['start_date' => $startDate, 'end_date' => $endDate],
            'table_4_b2b' => $table4B2b,
            'table_5_b2c_large' => $table5B2cLarge,
            'table_7_b2c_small' => $table7B2cSmall,
            'table_9_credit_debit_notes' => $table9CreditNotes,
        ]);
    }

    /**
     * Store dashboard live metrics endpoint for POS/Admin API parity.
     */
    public function dashboardMetrics(Request $request): JsonResponse
    {
        $startDate = $request->query('start_date', date('Y-m-d'));
        $endDate = $request->query('end_date', date('Y-m-d'));

        $invoices = Invoice::with('items')
            ->whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->get();

        $grossSales = 0;
        $totalReturns = 0;
        $billsCount = 0;

        $cash = 0;
        $upi = 0;
        $card = 0;
        $credit = 0;
        $other = 0;

        $slabMap = [];
        $totalTaxAccrued = 0;

        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']) || str_starts_with($inv->invoice_number, 'SR-');
            $val = (float) $inv->grand_total;
            $sign = $isReturn ? -1 : 1;

            if (!$isReturn) {
                $billsCount++;
                $grossSales += $val;
            } else {
                $totalReturns += $val;
            }

            $mode = strtolower(trim($inv->payment_mode ?? 'cash'));
            if (str_contains($mode, 'cash')) $cash += ($sign * $val);
            elseif (str_contains($mode, 'upi')) $upi += ($sign * $val);
            elseif (str_contains($mode, 'card')) $card += ($sign * $val);
            elseif (str_contains($mode, 'credit')) $credit += ($sign * $val);
            else $other += ($sign * $val);

            foreach ($inv->items as $item) {
                $rate = (int) $item->gst_percent;
                $cgst = (float) ($item->cgst_amount ?? 0) * $sign;
                $sgst = (float) ($item->sgst_amount ?? 0) * $sign;
                $igst = (float) ($item->igst_amount ?? 0) * $sign;
                $lineTax = $cgst + $sgst + $igst;
                $lineTaxable = ((float) $item->total_amount * $sign) - $lineTax;

                if (!isset($slabMap[$rate])) {
                    $slabMap[$rate] = ['rate' => $rate, 'taxable' => 0, 'cgst' => 0, 'sgst' => 0, 'igst' => 0, 'tax' => 0];
                }
                $slabMap[$rate]['taxable'] += $lineTaxable;
                $slabMap[$rate]['cgst'] += $cgst;
                $slabMap[$rate]['sgst'] += $sgst;
                $slabMap[$rate]['igst'] += $igst;
                $slabMap[$rate]['tax'] += $lineTax;
                $totalTaxAccrued += $lineTax;
            }
        }

        $netSales = max(0, $grossSales - $totalReturns);
        $avgTicket = $billsCount > 0 ? round($netSales / $billsCount, 2) : 0;
        $digitalTotal = max(0, $upi + $card + $other);
        $totalCollected = max(0, $cash + $digitalTotal);
        $digitalPercent = $totalCollected > 0 ? round(($digitalTotal / $totalCollected) * 100) : 0;

        return response()->json([
            'net_sales' => round($netSales, 2),
            'gross_sales' => round($grossSales, 2),
            'total_returns' => round($totalReturns, 2),
            'bills_count' => $billsCount,
            'average_ticket' => $avgTicket,
            'payments' => [
                'cash' => round(max(0, $cash), 2),
                'upi' => round(max(0, $upi), 2),
                'card' => round(max(0, $card), 2),
                'credit' => round(max(0, $credit), 2),
                'digital_total' => round($digitalTotal, 2),
                'digital_percent' => $digitalPercent,
            ],
            'gst' => [
                'slabs' => array_values($slabMap),
                'total_tax_accrued' => round(max(0, $totalTaxAccrued), 2),
            ],
        ]);
    }

    /**
     * Statutory Tax Reconciliation Diagnostic Audit
     */
    public function taxReconciliation(Request $request): JsonResponse
    {
        $startDate = $request->query('start_date', date('Y-m-01'));
        $endDate = $request->query('end_date', date('Y-m-t'));
        $storeStateCode = $request->query('store_state_code', '32');

        $invoices = Invoice::with('items')
            ->whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->get();

        $statutoryRates = [0, 0.25, 3, 5, 12, 18, 28];
        $gstinChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        $anomalies = [];
        $cleanCount = 0;

        $sumTaxable = 0.0;
        $sumCgst = 0.0;
        $sumSgst = 0.0;
        $sumIgst = 0.0;
        $sumCess = 0.0;
        $sumTax = 0.0;
        $sumRoundOff = 0.0;
        $sumGrand = 0.0;

        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $sign = $isReturn ? -1 : 1;

            $invGrand = (float) $inv->grand_total;
            $invTax = (float) $inv->tax_total;
            $invTaxable = (float) ($inv->taxable_subtotal ?? $inv->subtotal);
            $invRoundOff = (float) ($inv->round_off ?? 0);
            $invCgst = (float) ($inv->cgst_total ?? 0);
            $invSgst = (float) ($inv->sgst_total ?? 0);
            $invIgst = (float) ($inv->igst_total ?? 0);
            $invCess = (float) ($inv->cess_total ?? 0);

            $sumTaxable += $invTaxable * $sign;
            $sumCgst += $invCgst * $sign;
            $sumSgst += $invSgst * $sign;
            $sumIgst += $invIgst * $sign;
            $sumCess += $invCess * $sign;
            $sumTax += $invTax * $sign;
            $sumRoundOff += $invRoundOff * $sign;
            $sumGrand += $invGrand * $sign;

            $hasAnomaly = false;

            // 1. Line Sums vs Header
            if ($inv->items->isNotEmpty()) {
                $lineSumTotal = 0.0;
                foreach ($inv->items as $item) {
                    $lTot = (float) $item->total_amount;
                    $lineSumTotal += $lTot;

                    // HSN check
                    $hsn = trim($item->hsn_code ?? '');
                    if (empty($hsn) || strlen($hsn) < 4) {
                        $hasAnomaly = true;
                        $anomalies[] = [
                            'invoice_id' => (string) $inv->id,
                            'invoice_number' => $inv->invoice_number,
                            'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                            'anomaly_type' => 'MISSING_HSN',
                            'severity' => 'warning',
                            'description' => "Item '{$item->product_name}' has missing or incomplete HSN/SAC code ('{$hsn}')",
                        ];
                    }

                    // Rate check
                    $rate = (float) $item->gst_percent;
                    if (!in_array($rate, $statutoryRates, true)) {
                        $hasAnomaly = true;
                        $anomalies[] = [
                            'invoice_id' => (string) $inv->id,
                            'invoice_number' => $inv->invoice_number,
                            'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                            'anomaly_type' => 'INVALID_GST_RATE',
                            'severity' => 'error',
                            'description' => "Item '{$item->product_name}' has non-statutory GST rate ({$rate}%)",
                        ];
                    }
                }

                $expectedGrand = round($lineSumTotal + $invRoundOff, 2);
                if (abs($expectedGrand - $invGrand) > 0.05) {
                    $hasAnomaly = true;
                    $anomalies[] = [
                        'invoice_id' => (string) $inv->id,
                        'invoice_number' => $inv->invoice_number,
                        'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                        'anomaly_type' => 'TOTAL_MISMATCH',
                        'severity' => 'error',
                        'description' => "Sum of lines (₹{$lineSumTotal}) + round-off (₹{$invRoundOff}) differs from grand total (₹{$invGrand})",
                        'expected' => $expectedGrand,
                        'actual' => $invGrand,
                    ];
                }
            }

            // 2. Place of Supply vs Tax Heads
            $posState = !empty($inv->place_of_supply) ? substr(trim($inv->place_of_supply), 0, 2) : $storeStateCode;
            $isInterState = $posState !== $storeStateCode;

            if ($isInterState) {
                if ($invCgst > 0 || $invSgst > 0) {
                    $hasAnomaly = true;
                    $anomalies[] = [
                        'invoice_id' => (string) $inv->id,
                        'invoice_number' => $inv->invoice_number,
                        'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                        'anomaly_type' => 'PLACE_OF_SUPPLY_MISMATCH',
                        'severity' => 'error',
                        'description' => "Inter-state supply to State {$posState} contains Central/State GST instead of IGST",
                    ];
                }
            } else {
                if ($invIgst > 0) {
                    $hasAnomaly = true;
                    $anomalies[] = [
                        'invoice_id' => (string) $inv->id,
                        'invoice_number' => $inv->invoice_number,
                        'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                        'anomaly_type' => 'PLACE_OF_SUPPLY_MISMATCH',
                        'severity' => 'error',
                        'description' => "Intra-state supply within State {$storeStateCode} contains IGST instead of CGST+SGST",
                    ];
                }
            }

            // 3. Customer GSTIN Checksum
            if (!empty($inv->customer_gstin)) {
                $cleanGstin = strtoupper(trim($inv->customer_gstin));
                if (strlen($cleanGstin) !== 15 || !preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/', $cleanGstin)) {
                    $hasAnomaly = true;
                    $anomalies[] = [
                        'invoice_id' => (string) $inv->id,
                        'invoice_number' => $inv->invoice_number,
                        'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                        'anomaly_type' => 'INVALID_GSTIN',
                        'severity' => 'error',
                        'description' => "Customer GSTIN '{$cleanGstin}' does not match statutory 15-character format",
                    ];
                } else {
                    // Check Luhn Mod-36
                    $sum = 0;
                    for ($i = 0; $i < 14; $i++) {
                        $cp = strpos($gstinChars, $cleanGstin[$i]);
                        $factor = ($i % 2 === 0) ? 1 : 2;
                        $product = $cp * $factor;
                        $sum += intdiv($product, 36) + ($product % 36);
                    }
                    $checkCode = (36 - ($sum % 36)) % 36;
                    $expectedChar = $gstinChars[$checkCode];
                    if ($cleanGstin[14] !== $expectedChar) {
                        $hasAnomaly = true;
                        $anomalies[] = [
                            'invoice_id' => (string) $inv->id,
                            'invoice_number' => $inv->invoice_number,
                            'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                            'anomaly_type' => 'INVALID_GSTIN',
                            'severity' => 'error',
                            'description' => "Customer GSTIN '{$cleanGstin}' has invalid checksum (expected '{$expectedChar}', got '{$cleanGstin[14]}')",
                        ];
                    }

                    // Check State Code matching
                    $gstinState = substr($cleanGstin, 0, 2);
                    if (!empty($inv->place_of_supply) && substr(trim($inv->place_of_supply), 0, 2) !== $gstinState) {
                        $hasAnomaly = true;
                        $anomalies[] = [
                            'invoice_id' => (string) $inv->id,
                            'invoice_number' => $inv->invoice_number,
                            'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                            'anomaly_type' => 'STATE_CODE_MISMATCH',
                            'severity' => 'warning',
                            'description' => "GSTIN state code ({$gstinState}) does not match invoice Place of Supply ({$inv->place_of_supply})",
                        ];
                    }
                }
            }

            if (!$hasAnomaly) {
                $cleanCount++;
            }
        }

        return response()->json([
            'generated_at' => now()->toIso8601String(),
            'period' => ['start_date' => $startDate, 'end_date' => $endDate],
            'total_invoices_audited' => $invoices->count(),
            'clean_invoices_count' => $cleanCount,
            'anomalies_count' => count($anomalies),
            'financial_summary' => [
                'total_taxable' => round($sumTaxable, 2),
                'total_cgst' => round($sumCgst, 2),
                'total_sgst' => round($sumSgst, 2),
                'total_igst' => round($sumIgst, 2),
                'total_cess' => round($sumCess, 2),
                'total_tax' => round($sumTax, 2),
                'total_round_off' => round($sumRoundOff, 2),
                'total_grand' => round($sumGrand, 2),
            ],
            'anomalies' => $anomalies,
        ]);
    }
}
