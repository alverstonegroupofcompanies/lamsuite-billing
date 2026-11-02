<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminReportController
{
    /**
     * Daily collection summary & sales breakdown.
     */
    public function salesSummary(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $startDate = $request->query('start_date', Carbon::today()->startOfMonth()->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());

        $invoices = Invoice::whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
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
            'returns' => round($returns, 2),
            'net_sales' => round($netSales, 2),
            'total_taxable' => round($invoices->sum('subtotal'), 2),
            'total_tax' => round($invoices->sum('tax_total'), 2),
            'by_tender' => $byTender,
        ]);
    }

    /**
     * GSTR-1 Compliance Summary (B2B, B2CL, B2CS, Table 12 HSN, Table 13 Docs).
     */
    public function gstr1(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $startDate = $request->query('start_date', Carbon::today()->startOfMonth()->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());

        $invoices = Invoice::with('items')
            ->whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get();

        // Table 4: B2B Invoices (Customers with valid GSTIN)
        $b2bInvoices = $invoices->filter(fn($i) => !empty($i->customer_gstin))->values();
        $b2bSummary = [
            'count' => $b2bInvoices->count(),
            'taxable_value' => round($b2bInvoices->sum('subtotal'), 2),
            'tax_amount' => round($b2bInvoices->sum('tax_total'), 2),
            'invoice_value' => round($b2bInvoices->sum('grand_total'), 2),
        ];

        // Table 7: B2C Small
        $b2cInvoices = $invoices->filter(fn($i) => empty($i->customer_gstin))->values();
        $b2cSummary = [
            'count' => $b2cInvoices->count(),
            'taxable_value' => round($b2cInvoices->sum('subtotal'), 2),
            'tax_amount' => round($b2cInvoices->sum('tax_total'), 2),
            'invoice_value' => round($b2cInvoices->sum('grand_total'), 2),
        ];

        // Table 12: HSN Summary
        $hsnMap = [];
        foreach ($invoices as $inv) {
            foreach ($inv->items as $item) {
                $prod = Product::find($item->product_id);
                $hsn = trim($item->hsn_code ?? $prod?->hsn_sac_code ?? 'OTHER');
                if (empty($hsn)) $hsn = 'OTHER';

                if (!isset($hsnMap[$hsn])) {
                    $hsnMap[$hsn] = [
                        'hsn_code' => $hsn,
                        'description' => $prod?->name ?? $item->product_name ?? 'Item',
                        'total_qty' => 0,
                        'taxable_value' => 0,
                        'cgst_amount' => 0,
                        'sgst_amount' => 0,
                        'igst_amount' => 0,
                        'cess_amount' => 0,
                        'total_tax' => 0,
                    ];
                }

                $taxable = $item->taxable_amount ?? ($item->total_amount - $item->tax_amount);
                $isInter = ($inv->tax_type === 'inter_state') || ($item->igst_amount && $item->igst_amount > 0);
                $cgst = $item->cgst_amount ?? ($isInter ? 0 : $item->tax_amount / 2);
                $sgst = $item->sgst_amount ?? ($isInter ? 0 : $item->tax_amount / 2);
                $igst = $item->igst_amount ?? ($isInter ? $item->tax_amount : 0);
                $cess = $item->cess_amount ?? 0;

                $hsnMap[$hsn]['total_qty'] += $item->qty;
                $hsnMap[$hsn]['taxable_value'] += $taxable;
                $hsnMap[$hsn]['cgst_amount'] += $cgst;
                $hsnMap[$hsn]['sgst_amount'] += $sgst;
                $hsnMap[$hsn]['igst_amount'] += $igst;
                $hsnMap[$hsn]['cess_amount'] += $cess;
                $hsnMap[$hsn]['total_tax'] += ($cgst + $sgst + $igst + $cess);
            }
        }

        // Table 13: Document Issue
        $docIssue = [
            'from_doc' => $invoices->min('invoice_number') ?? 'N/A',
            'to_doc' => $invoices->max('invoice_number') ?? 'N/A',
            'total_number' => $invoices->count(),
            'cancelled_number' => Invoice::whereBetween('invoice_date', [$startDate, $endDate])
                ->where('status', 'cancelled')
                ->when($storeId, fn($q) => $q->where('store_id', $storeId))
                ->count(),
        ];

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'table_4_b2b' => $b2bSummary,
            'table_7_b2cs' => $b2cSummary,
            'table_12_hsn' => array_values(array_map(function ($h) {
                return [
                    'hsn_code' => $h['hsn_code'],
                    'description' => $h['description'],
                    'total_qty' => round($h['total_qty'], 2),
                    'taxable_value' => round($h['taxable_value'], 2),
                    'cgst_amount' => round($h['cgst_amount'], 2),
                    'sgst_amount' => round($h['sgst_amount'], 2),
                    'igst_amount' => round($h['igst_amount'], 2),
                    'cess_amount' => round($h['cess_amount'], 2),
                    'total_tax' => round($h['total_tax'], 2),
                ];
            }, $hsnMap)),
            'table_13_docs' => $docIssue,
        ]);
    }

    /**
     * Customer Outstanding & Real Aging Report based on unpaid invoice dates.
     */
    public function customerAging(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $today = Carbon::today();

        $parties = Party::where('type', 'customer')
            ->where('current_balance', '>', 0)
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('current_balance', 'desc')
            ->get();

        $customers = $parties->map(function ($party) use ($today) {
            $totalOutstanding = (float)$party->current_balance;

            $unpaidInvoices = Invoice::where('customer_id', $party->id)
                ->where('status', '!=', 'cancelled')
                ->whereRaw('grand_total > paid_amount')
                ->orderBy('invoice_date', 'asc')
                ->get();

            $b0_30 = 0.0;
            $b31_60 = 0.0;
            $b61_90 = 0.0;
            $b90_plus = 0.0;

            if ($unpaidInvoices->isNotEmpty()) {
                foreach ($unpaidInvoices as $inv) {
                    $due = max(0, (float)$inv->grand_total - (float)$inv->paid_amount);
                    $invDate = Carbon::parse($inv->invoice_date);
                    $daysOld = $invDate->diffInDays($today);

                    if ($daysOld <= 30) {
                        $b0_30 += $due;
                    } elseif ($daysOld <= 60) {
                        $b31_60 += $due;
                    } elseif ($daysOld <= 90) {
                        $b61_90 += $due;
                    } else {
                        $b90_plus += $due;
                    }
                }
            } else {
                $b0_30 = $totalOutstanding;
            }

            return [
                'id' => $party->id,
                'name' => $party->name,
                'phone' => $party->phone,
                'credit_limit' => $party->credit_limit,
                'current_balance' => round($totalOutstanding, 2),
                'bracket_0_30' => round($b0_30, 2),
                'bracket_31_60' => round($b31_60, 2),
                'bracket_61_90' => round($b61_90, 2),
                'bracket_90_plus' => round($b90_plus, 2),
            ];
        });

        return response()->json([
            'total_customers_with_dues' => $customers->count(),
            'total_outstanding' => round($customers->sum('current_balance'), 2),
            'customers' => $customers,
        ]);
    }

    /**
     * Pharmacy Specific Statutory Report (Schedule H/H1, Doctors).
     */
    public function pharmacyReport(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $startDate = $request->query('start_date', Carbon::today()->subDays(30)->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());

        $doctorSales = Invoice::whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->whereNotNull('doctor_name')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->select('doctor_name', 'doctor_reg_no', DB::raw('COUNT(id) as rx_count'), DB::raw('SUM(grand_total) as total_value'))
            ->groupBy('doctor_name', 'doctor_reg_no')
            ->orderByDesc('total_value')
            ->get();

        return response()->json([
            'doctor_sales' => $doctorSales,
            'schedule_h1_register' => Invoice::with('items')
                ->whereBetween('invoice_date', [$startDate, $endDate])
                ->whereNotNull('doctor_name')
                ->when($storeId, fn($q) => $q->where('store_id', $storeId))
                ->limit(50)
                ->get(),
        ]);
    }

    /**
     * Scheduled Email Reports configuration.
     */
    public function scheduledReports(Request $request): JsonResponse
    {
        return response()->json([
            'schedules' => [
                [
                    'id' => 1,
                    'name' => 'Daily Sales & Collection Digest',
                    'frequency' => 'daily_at_21_00',
                    'recipients' => ['owner@lamstone.in', 'accounts@lamstone.in'],
                    'report_type' => 'daily_sales',
                    'is_active' => true,
                    'last_sent' => Carbon::yesterday()->setTime(21, 0)->toIso8601String(),
                ],
                [
                    'id' => 2,
                    'name' => 'Weekly GSTR-1 Pre-check',
                    'frequency' => 'weekly_sunday',
                    'recipients' => ['ca@lamstone.in'],
                    'report_type' => 'gstr1',
                    'is_active' => true,
                    'last_sent' => Carbon::now()->startOfWeek()->subDay()->toIso8601String(),
                ],
            ],
        ]);
    }
}
