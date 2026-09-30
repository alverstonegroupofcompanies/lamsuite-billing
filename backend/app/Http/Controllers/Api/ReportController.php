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
}
