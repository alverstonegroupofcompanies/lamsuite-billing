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

        $invoices = Invoice::whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->get();

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
        $table7B2cSmall = [];
        $table9CreditNotes = [];

        foreach ($invoices as $inv) {
            $hasGstin = !empty($inv->customer_gstin) && strlen(trim($inv->customer_gstin)) === 15;
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $targetState = !empty($inv->customer_gstin) ? substr(trim($inv->customer_gstin), 0, 2) : ($inv->place_of_supply ?? $storeState);

            if ($isReturn) {
                $table9CreditNotes[] = [
                    'note_number' => $inv->invoice_number,
                    'note_date' => $inv->invoice_date->format('Y-m-d'),
                    'customer_name' => $inv->customer_name,
                    'note_value' => (float) $inv->grand_total,
                    'taxable_value' => (float) $inv->subtotal,
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
                    'taxable_value' => (float) $inv->subtotal,
                ];
            } elseif ($targetState !== $storeState && $inv->grand_total > 250000) {
                $table5B2cLarge[] = [
                    'invoice_number' => $inv->invoice_number,
                    'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                    'invoice_value' => (float) $inv->grand_total,
                    'place_of_supply' => $targetState,
                    'taxable_value' => (float) $inv->subtotal,
                ];
            } else {
                $table7B2cSmall[] = [
                    'place_of_supply' => $targetState,
                    'taxable_value' => (float) $inv->subtotal,
                    'tax_amount' => (float) $inv->tax_total,
                ];
            }
        }

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
}
