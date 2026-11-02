<?php

namespace App\Http\Controllers\Api;

use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\StoreDayClose;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ReportController
{
    /**
     * Resolve active store ID from request header, query parameter, or authenticated user.
     */
    protected function resolveStoreId(Request $request): ?int
    {
        $storeParam = $request->header('X-Store-Id')
            ?: $request->query('store_id')
            ?: $request->input('store_id')
            ?: $request->get('active_store_id');

        if ($storeParam) {
            $store = is_numeric($storeParam)
                ? Store::find($storeParam)
                : Store::where('code', $storeParam)->first();
            if ($store) {
                return (int)$store->id;
            }
        }

        if ($user = $request->user()) {
            if ($user->store_id) {
                return (int)$user->store_id;
            }
        }

        return null;
    }

    /**
     * Daily collection summary breakdown by tender.
     */
    public function dailyCollection(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $startDate = $request->query('start_date', date('Y-m-d'));
        $endDate = $request->query('end_date', date('Y-m-d'));
        $counterId = $request->query('counter_id');

        $query = Invoice::whereDate('invoice_date', '>=', $startDate)
            ->whereDate('invoice_date', '<=', $endDate)
            ->where('status', '!=', 'cancelled');

        if ($storeId) {
            $query->where('store_id', $storeId);
        }

        if (!empty($counterId)) {
            $query->where('counter_id', $counterId);
        }

        $invoices = $query->with('payments')->get();

        $grossSales = (float)$invoices->where('module_key', 'invoice')->sum('grand_total');
        $returns = (float)$invoices->where('module_key', 'credit_note')->sum('grand_total');
        $netSales = $grossSales - $returns;

        $cashTender = 0.0;
        $upiTender = 0.0;
        $cardTender = 0.0;
        $bankTender = 0.0;
        $creditTender = 0.0;
        $otherTender = 0.0;

        foreach ($invoices as $inv) {
            $isReturn = $inv->module_key === 'credit_note';
            $sign = $isReturn ? -1 : 1;

            if ($inv->payments && $inv->payments->isNotEmpty()) {
                foreach ($inv->payments as $p) {
                    if ($p->status === 'refunded' || $p->status === 'bounced') continue;
                    $m = strtolower(trim($p->payment_mode ?? ''));
                    $amt = (float)$p->amount * $sign;
                    if (str_contains($m, 'cash')) $cashTender += $amt;
                    elseif (str_contains($m, 'upi')) $upiTender += $amt;
                    elseif (str_contains($m, 'card')) $cardTender += $amt;
                    elseif (str_contains($m, 'bank') || str_contains($m, 'neft') || str_contains($m, 'imps')) $bankTender += $amt;
                    elseif (str_contains($m, 'credit') || str_contains($m, 'udhari')) $creditTender += $amt;
                    else $otherTender += $amt;
                }
            } else {
                $m = strtolower(trim($inv->payment_mode ?: 'cash'));
                $amt = (float)$inv->grand_total * $sign;
                if (str_contains($m, 'cash')) $cashTender += $amt;
                elseif (str_contains($m, 'upi')) $upiTender += $amt;
                elseif (str_contains($m, 'card')) $cardTender += $amt;
                elseif (str_contains($m, 'bank') || str_contains($m, 'neft') || str_contains($m, 'imps')) $bankTender += $amt;
                elseif (str_contains($m, 'credit') || str_contains($m, 'udhari')) $creditTender += $amt;
                else $otherTender += $amt;
            }
        }

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'total_invoices_count' => $invoices->where('module_key', 'invoice')->count(),
            'gross_sales' => round($grossSales, 2),
            'total_returns' => round($returns, 2),
            'net_sales' => round($netSales, 2),
            'total_taxable' => round((float)$invoices->sum('subtotal'), 2),
            'total_tax' => round((float)$invoices->sum('tax_total'), 2),
            'by_tender' => [
                'Cash' => round($cashTender, 2),
                'UPI' => round($upiTender, 2),
                'Card' => round($cardTender, 2),
                'Bank Transfer' => round($bankTender, 2),
                'Credit' => round($creditTender, 2),
                'Other' => round($otherTender, 2),
            ],
        ]);
    }

    /**
     * Top selling items ranked by volume and revenue.
     */
    public function topSelling(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $period = $request->query('period', 'this_month');
        $limit = max(1, min(50, (int)$request->query('limit', 10)));

        $startDate = match ($period) {
            'today' => Carbon::today()->toDateString(),
            'yesterday' => Carbon::yesterday()->toDateString(),
            'this_week' => Carbon::now()->startOfWeek()->toDateString(),
            'last_month' => Carbon::now()->subMonth()->startOfMonth()->toDateString(),
            default => Carbon::now()->startOfMonth()->toDateString(),
        };

        $endDate = match ($period) {
            'yesterday' => Carbon::yesterday()->toDateString(),
            'last_month' => Carbon::now()->subMonth()->endOfMonth()->toDateString(),
            default => Carbon::today()->toDateString(),
        };

        if ($request->filled('start_date') && $request->filled('end_date')) {
            $startDate = $request->query('start_date');
            $endDate = $request->query('end_date');
        }

        $items = DB::table('invoice_items')
            ->join('invoices', 'invoice_items.invoice_id', '=', 'invoices.id')
            ->leftJoin('products', 'invoice_items.product_id', '=', 'products.id')
            ->where('invoices.status', '!=', 'cancelled')
            ->whereDate('invoices.invoice_date', '>=', $startDate)
            ->whereDate('invoices.invoice_date', '<=', $endDate)
            ->when($storeId, fn($q) => $q->where('invoices.store_id', $storeId))
            ->select(
                'invoice_items.product_name as name',
                'invoice_items.product_id',
                DB::raw('COALESCE(SUM(invoice_items.qty), 0) as qty_sold'),
                DB::raw('COALESCE(SUM(invoice_items.total_amount), 0) as revenue'),
                DB::raw('COALESCE(SUM(invoice_items.qty * COALESCE(products.ptr, products.sel_rate * 0.75, 0)), 0) as total_cost')
            )
            ->groupBy('invoice_items.product_name', 'invoice_items.product_id')
            ->orderByDesc('revenue')
            ->limit($limit)
            ->get()
            ->map(function ($it) {
                $rev = (float)$it->revenue;
                $cost = (float)$it->total_cost;
                $marginPct = $rev > 0 ? round((($rev - $cost) / $rev) * 100, 1) : 0.0;
                return [
                    'name' => $it->name,
                    'product_id' => $it->product_id,
                    'qty_sold' => (int)$it->qty_sold,
                    'revenue' => round($rev, 2),
                    'margin_percent' => $marginPct,
                ];
            });

        return response()->json($items);
    }

    /**
     * Cash book ledger showing opening cash, daily cash collections, expenses, and closing balance.
     */
    public function cashBook(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $date = $request->query('date', date('Y-m-d'));
        $paymentMode = $request->query('payment_mode', 'All');

        // 1. Opening cash from previous day closing or zero
        $prevClose = StoreDayClose::whereDate('close_date', '<', $date)
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderByDesc('close_date')
            ->first();
        $openingCash = $prevClose ? (float)$prevClose->net_cash_in_hand : 0.0;

        // 2. Invoices & tender collections on that date
        $invoices = Invoice::with('payments')
            ->whereDate('invoice_date', $date)
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get();

        $cashSales = 0.0;
        $upiCollections = 0.0;
        $cardCollections = 0.0;

        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $sign = $isReturn ? -1 : 1;

            if ($inv->payments && $inv->payments->isNotEmpty()) {
                foreach ($inv->payments as $p) {
                    if ($p->status === 'refunded' || $p->status === 'bounced') continue;
                    $m = strtolower(trim($p->payment_mode ?? ''));
                    $amt = (float)$p->amount * $sign;
                    if (str_contains($m, 'cash')) $cashSales += $amt;
                    elseif (str_contains($m, 'upi')) $upiCollections += $amt;
                    elseif (str_contains($m, 'card')) $cardCollections += $amt;
                }
            } else {
                $m = strtolower(trim($inv->payment_mode ?: 'cash'));
                $amt = (float)$inv->grand_total * $sign;
                if (str_contains($m, 'cash')) $cashSales += $amt;
                elseif (str_contains($m, 'upi')) $upiCollections += $amt;
                elseif (str_contains($m, 'card')) $cardCollections += $amt;
            }
        }

        // 3. Expenses on that date
        $expensesQuery = Expense::whereDate('expense_date', $date)
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if (strtolower($paymentMode) === 'cash') {
            $expensesQuery->where('payment_mode', 'like', '%cash%');
        } elseif (strtolower($paymentMode) === 'upi') {
            $expensesQuery->where('payment_mode', 'like', '%upi%');
        } elseif (strtolower($paymentMode) === 'card') {
            $expensesQuery->where('payment_mode', 'like', '%card%');
        }

        $totalExpenses = (float)$expensesQuery->sum('amount');
        $cashExpenses = (float)Expense::whereDate('expense_date', $date)
            ->where('payment_mode', 'like', '%cash%')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->sum('amount');

        $closingCash = round($openingCash + $cashSales - $cashExpenses, 2);

        return response()->json([
            'date' => $date,
            'opening_cash' => round($openingCash, 2),
            'cash_sales' => round($cashSales, 2),
            'upi_collections' => round($upiCollections, 2),
            'card_collections' => round($cardCollections, 2),
            'expenses' => round($totalExpenses, 2),
            'closing_cash' => $closingCash,
        ]);
    }

    /**
     * Store daily closing summary.
     */
    public function dailySummary(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $date = $request->query('date', date('Y-m-d'));

        $invoices = Invoice::with('payments')
            ->whereDate('invoice_date', $date)
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get();

        $grossSales = (float)$invoices->where('module_key', 'invoice')->sum('grand_total');
        $returns = (float)$invoices->where('module_key', 'credit_note')->sum('grand_total');
        $totalSales = $grossSales - $returns;

        $cash = 0.0;
        $upi = 0.0;
        $card = 0.0;
        $credit = 0.0;

        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $sign = $isReturn ? -1 : 1;

            if ($inv->payments && $inv->payments->isNotEmpty()) {
                foreach ($inv->payments as $p) {
                    if ($p->status === 'refunded' || $p->status === 'bounced') continue;
                    $m = strtolower(trim($p->payment_mode ?? ''));
                    $amt = (float)$p->amount * $sign;
                    if (str_contains($m, 'cash')) $cash += $amt;
                    elseif (str_contains($m, 'upi')) $upi += $amt;
                    elseif (str_contains($m, 'card')) $card += $amt;
                    elseif (str_contains($m, 'credit') || str_contains($m, 'udhari')) $credit += $amt;
                }
            } else {
                $m = strtolower(trim($inv->payment_mode ?: 'cash'));
                $amt = (float)$inv->grand_total * $sign;
                if (str_contains($m, 'cash')) $cash += $amt;
                elseif (str_contains($m, 'upi')) $upi += $amt;
                elseif (str_contains($m, 'card')) $card += $amt;
                elseif (str_contains($m, 'credit') || str_contains($m, 'udhari')) $credit += $amt;
            }
        }

        $lowStockCount = Product::where('is_active', true)
            ->whereColumn('current_stock', '<=', 'reorder_level')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->count();

        $nearExpiryThreshold = Carbon::now()->addDays(60)->toDateString();
        $nearExpiryCount = ProductBatch::where('stock_qty', '>', 0)
            ->whereDate('expiry_date', '<=', $nearExpiryThreshold)
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->count();

        return response()->json([
            'date' => $date,
            'total_sales' => round($totalSales, 2),
            'gross_sales' => round($grossSales, 2),
            'returns' => round($returns, 2),
            'invoice_count' => $invoices->where('module_key', 'invoice')->count(),
            'cash_collection' => round($cash, 2),
            'upi_collection' => round($upi, 2),
            'card_collection' => round($card, 2),
            'credit_collection' => round($credit, 2),
            'low_stock_count' => $lowStockCount,
            'near_expiry_count' => $nearExpiryCount,
        ]);
    }

    /**
     * Profit and margin report calculating revenue, COGS, and gross profit.
     */
    public function profit(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $startDate = $request->query('start_date', Carbon::today()->startOfMonth()->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());
        $groupBy = $request->query('group_by', 'item');

        $invoices = Invoice::with(['items.product'])
            ->whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get();

        $totalRevenue = 0.0;
        $totalCogs = 0.0;
        $breakdown = [];

        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $sign = $isReturn ? -1 : 1;

            foreach ($inv->items as $item) {
                $qty = (float)$item->qty * $sign;
                $rev = (float)$item->total_amount * $sign;

                // Purchase cost basis: purchase_rate > ptr > fallback selling rate * 0.75
                $costPerUnit = (float)($item->purchase_rate ?? $item->product?->ptr ?? ($item->unit_price * 0.75));
                $cogs = $qty * $costPerUnit;

                $totalRevenue += $rev;
                $totalCogs += $cogs;

                $key = match ($groupBy) {
                    'invoice' => $inv->invoice_number,
                    'category' => $item->product?->category ?? 'General',
                    default => $item->product_name,
                };

                if (!isset($breakdown[$key])) {
                    $breakdown[$key] = [
                        'group_key' => $key,
                        'revenue' => 0.0,
                        'cogs' => 0.0,
                        'gross_profit' => 0.0,
                        'qty' => 0,
                    ];
                }

                $breakdown[$key]['revenue'] += $rev;
                $breakdown[$key]['cogs'] += $cogs;
                $breakdown[$key]['qty'] += $qty;
                $breakdown[$key]['gross_profit'] += ($rev - $cogs);
            }
        }

        $grossProfit = $totalRevenue - $totalCogs;
        $grossMarginPercent = $totalRevenue > 0 ? round(($grossProfit / $totalRevenue) * 100, 2) : 0.0;

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'total_revenue' => round($totalRevenue, 2),
            'total_cogs' => round($totalCogs, 2),
            'gross_profit' => round($grossProfit, 2),
            'gross_margin_percent' => $grossMarginPercent,
            'breakdown' => array_values(array_map(function ($b) {
                $rev = (float)$b['revenue'];
                $gp = (float)$b['gross_profit'];
                return [
                    'group_key' => $b['group_key'],
                    'qty' => round($b['qty'], 2),
                    'revenue' => round($rev, 2),
                    'cogs' => round((float)$b['cogs'], 2),
                    'gross_profit' => round($gp, 2),
                    'margin_percent' => $rev > 0 ? round(($gp / $rev) * 100, 2) : 0.0,
                ];
            }, $breakdown)),
        ]);
    }

    /**
     * HSN-wise tax summary table (Table 12 GSTR-1).
     */
    public function hsnSummary(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $startDate = $request->query('start_date', Carbon::today()->startOfMonth()->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());

        $invoices = Invoice::with(['items.product'])
            ->whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get();

        $hsnMap = [];

        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $sign = $isReturn ? -1 : 1;

            foreach ($inv->items as $item) {
                $hsn = trim($item->hsn_code ?? $item->product?->hsn_sac_code ?? 'OTHER');
                if (empty($hsn)) $hsn = 'OTHER';

                $rate = (float)($item->gst_percent ?? 0);
                $key = "{$hsn}_{$rate}";

                if (!isset($hsnMap[$key])) {
                    $hsnMap[$key] = [
                        'hsn_code' => $hsn,
                        'rate' => $rate,
                        'description' => $item->product?->name ?? $item->product_name,
                        'total_qty' => 0.0,
                        'taxable_value' => 0.0,
                        'cgst_amount' => 0.0,
                        'sgst_amount' => 0.0,
                        'igst_amount' => 0.0,
                        'cess_amount' => 0.0,
                        'total_tax' => 0.0,
                    ];
                }

                $taxable = (float)($item->taxable_amount ?? ($item->total_amount - ($item->tax_amount ?? 0))) * $sign;
                $cgst = (float)($item->cgst_amount ?? 0) * $sign;
                $sgst = (float)($item->sgst_amount ?? 0) * $sign;
                $igst = (float)($item->igst_amount ?? 0) * $sign;
                $cess = (float)($item->cess_amount ?? 0) * $sign;
                $totTax = (float)($item->tax_amount ?? ($cgst + $sgst + $igst + $cess)) * $sign;

                $hsnMap[$key]['total_qty'] += (float)$item->qty * $sign;
                $hsnMap[$key]['taxable_value'] += $taxable;
                $hsnMap[$key]['cgst_amount'] += $cgst;
                $hsnMap[$key]['sgst_amount'] += $sgst;
                $hsnMap[$key]['igst_amount'] += $igst;
                $hsnMap[$key]['cess_amount'] += $cess;
                $hsnMap[$key]['total_tax'] += $totTax;
            }
        }

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'hsn_records' => array_values(array_map(function ($h) {
                return [
                    'hsn_code' => $h['hsn_code'],
                    'rate' => $h['rate'],
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
        ]);
    }

    /**
     * Customer Outstanding & Real Unpaid Invoice Aging (0-30, 31-60, 61-90, 90+ days).
     */
    public function customerAging(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $today = Carbon::today();

        $parties = Party::where('type', 'customer')
            ->where('current_balance', '>', 0)
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderByDesc('current_balance')
            ->get();

        $customers = $parties->map(function ($party) use ($today) {
            $totalOutstanding = (float)$party->current_balance;

            // Find invoices with pending dues for this customer
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
                // If specific unpaid invoices not tracked, assign to 0-30 days bracket
                $b0_30 = $totalOutstanding;
            }

            return [
                'id' => $party->id,
                'name' => $party->name,
                'phone' => $party->phone,
                'credit_limit' => (float)$party->credit_limit,
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
     * Stock Movement Ledger.
     */
    public function stockLedger(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $productId = $request->query('product_id');
        $batchId = $request->query('batch_id');
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');
        $limit = max(1, min(200, (int)$request->query('limit', 50)));

        $query = StockLedgerEntry::with(['product:id,name,barcode', 'store:id,name'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->when($productId, fn($q) => $q->where('product_id', $productId))
            ->when($batchId, fn($q) => $q->where('batch_id', $batchId))
            ->when($startDate, fn($q) => $q->whereDate('created_at', '>=', $startDate))
            ->when($endDate, fn($q) => $q->whereDate('created_at', '<=', $endDate))
            ->orderByDesc('id');

        $entries = $query->limit($limit)->get();

        return response()->json([
            'total' => $entries->count(),
            'entries' => $entries->map(fn($e) => [
                'id' => $e->id,
                'created_at' => $e->created_at?->toIso8601String(),
                'product_name' => $e->product?->name ?? 'Unknown Item',
                'event_type' => $e->event_type,
                'qty_delta' => (float)$e->qty_delta,
                'balance_after' => (float)$e->balance_after,
                'reference_type' => $e->reference_type,
                'reference_id' => $e->reference_id,
            ]),
        ]);
    }

    /**
     * GSTR-1 Compliance Summary (B2B, B2CL, B2CS, Table 12 HSN, Table 13 Docs).
     */
    public function gstr1(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $startDate = $request->query('start_date', date('Y-m-01'));
        $endDate = $request->query('end_date', date('Y-m-t'));
        $storeState = $request->query('store_state_code', '32');

        $s = strlen($startDate) === 10 ? $startDate . ' 00:00:00' : $startDate;
        $e = strlen($endDate) === 10 ? $endDate . ' 23:59:59' : $endDate;

        $invoicesQuery = Invoice::with('items')
            ->whereBetween('invoice_date', [$s, $e])
            ->where('status', '!=', 'cancelled');
        if ($storeId) {
            $invoicesQuery->where('store_id', $storeId);
        }
        $invoices = $invoicesQuery->get();

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
        $storeId = $this->resolveStoreId($request);
        $startDate = $request->query('start_date', date('Y-m-d'));
        $endDate = $request->query('end_date', date('Y-m-d'));

        $query = Invoice::whereDate('invoice_date', '>=', $startDate)
            ->whereDate('invoice_date', '<=', $endDate)
            ->where('status', '!=', 'cancelled');
        if ($storeId) {
            $query->where('store_id', $storeId);
        }

        $invoices = $query->with('payments')->get();

        $grossSales = (float)$invoices->where('module_key', 'invoice')->sum('grand_total');
        $totalReturns = (float)$invoices->where('module_key', 'credit_note')->sum('grand_total');
        $netSales = $grossSales - $totalReturns;

        $billsCount = $invoices->where('module_key', 'invoice')->count();
        $avgTicket = $billsCount > 0 ? round($grossSales / $billsCount, 2) : 0.0;

        $cash = 0.0;
        $upi = 0.0;
        $card = 0.0;
        $credit = 0.0;

        foreach ($invoices as $inv) {
            $isReturn = $inv->module_key === 'credit_note';
            $sign = $isReturn ? -1 : 1;

            if ($inv->payments && $inv->payments->isNotEmpty()) {
                foreach ($inv->payments as $p) {
                    if ($p->status === 'refunded' || $p->status === 'bounced') continue;
                    $m = strtolower(trim($p->payment_mode ?? ''));
                    $amt = (float)$p->amount * $sign;
                    if (str_contains($m, 'cash')) $cash += $amt;
                    elseif (str_contains($m, 'upi')) $upi += $amt;
                    elseif (str_contains($m, 'card')) $card += $amt;
                    elseif (str_contains($m, 'credit') || str_contains($m, 'udhari')) $credit += $amt;
                }
            } else {
                $m = strtolower(trim($inv->payment_mode ?: 'cash'));
                $amt = (float)$inv->grand_total * $sign;
                if (str_contains($m, 'cash')) $cash += $amt;
                elseif (str_contains($m, 'upi')) $upi += $amt;
                elseif (str_contains($m, 'card')) $card += $amt;
                elseif (str_contains($m, 'credit') || str_contains($m, 'udhari')) $credit += $amt;
            }
        }

        $digitalTotal = $upi + $card;
        $totalCollected = $cash + $digitalTotal + $credit;
        $digitalPercent = $totalCollected > 0 ? round(($digitalTotal / $totalCollected) * 100, 1) : 0.0;

        $slabs = [0, 5, 12, 18, 28];
        $slabMap = [];
        foreach ($slabs as $s) {
            $slabMap[$s] = [
                'rate' => $s,
                'taxable_value' => 0.0,
                'cgst_amount' => 0.0,
                'sgst_amount' => 0.0,
                'igst_amount' => 0.0,
                'total_tax' => 0.0,
            ];
        }

        $totalTaxAccrued = 0.0;
        foreach ($invoices as $inv) {
            $isReturn = $inv->module_key === 'credit_note';
            $sign = $isReturn ? -1 : 1;

            if ($inv->items) {
                foreach ($inv->items as $it) {
                    $r = (int)$it->gst_percent;
                    if (isset($slabMap[$r])) {
                        $slabMap[$r]['taxable_value'] += (float)($it->taxable_amount ?? 0) * $sign;
                        $slabMap[$r]['cgst_amount'] += (float)($it->cgst_amount ?? 0) * $sign;
                        $slabMap[$r]['sgst_amount'] += (float)($it->sgst_amount ?? 0) * $sign;
                        $slabMap[$r]['igst_amount'] += (float)($it->igst_amount ?? 0) * $sign;
                        $slabMap[$r]['total_tax'] += (float)($it->tax_amount ?? 0) * $sign;
                    }
                    $totalTaxAccrued += (float)($it->tax_amount ?? 0) * $sign;
                }
            }
        }

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
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
        $storeId = $this->resolveStoreId($request);

        $s = strlen($startDate) === 10 ? $startDate . ' 00:00:00' : $startDate;
        $e = strlen($endDate) === 10 ? $endDate . ' 23:59:59' : $endDate;

        $invoicesQuery = Invoice::with('items')
            ->whereBetween('invoice_date', [$s, $e])
            ->where('status', '!=', 'cancelled');
        if ($storeId) {
            $invoicesQuery->where('store_id', $storeId);
        }
        $invoices = $invoicesQuery->get();

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
