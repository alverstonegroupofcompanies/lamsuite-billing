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
use App\Services\Reports\ExpenseRegisterService;
use App\Services\Reports\OutwardSalesService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Services\StoreClock;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ReportController
{
    /**
     * Resolve active store ID from request header, query parameter, or authenticated user.
     */
    protected function resolveStoreId(Request $request): ?int
    {
        // All Stores consolidated scope: never fall back to the user's home store
        if ($request->attributes->get('store_scope_all')) {
            return null;
        }

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
     * The same scope as `resolveStoreId`, as the list some reports filter with `whereIn`.
     *
     * @return array<int>|null  null means every store the caller is allowed to see
     */
    protected function resolveStoreIds(Request $request): ?array
    {
        $storeId = $this->resolveStoreId($request);

        return $storeId === null ? null : [$storeId];
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

        $service = OutwardSalesService::forWindow($storeId, $startDate, $endDate, $counterId);
        $gst = $service->gst();
        $tenders = $service->tenders();

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'total_invoices_count' => $service->billsCount(),
            'gross_sales' => $service->grossSales(),
            'total_returns' => $service->totalReturns(),
            'net_sales' => $service->netSales(),
            'total_taxable' => $gst['taxable_value'],
            'total_tax' => $gst['tax_amount'],
            'by_tender' => [
                'Cash' => $tenders['cash'],
                'UPI' => $tenders['upi'],
                'Card' => $tenders['card'],
                'Bank Transfer' => $tenders['bank_transfer'],
                'Credit' => $tenders['credit'],
                'Other' => $tenders['other'],
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

        // 2. Invoices & tender collections on that date, counting only the
        // amount applied to each bill (a note's change never entered the till).
        $tenders = OutwardSalesService::forWindow($storeId, $date, $date)->tenders();
        $cashSales = $tenders['cash'];
        $upiCollections = $tenders['upi'];
        $cardCollections = $tenders['card'];

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
     * REP-008 — the Expense Register: every manual expense plus every expense-treated charge
     * on a supplier bill, with the tax columns and ITC flag that decide how each was booked.
     */
    public function expenseRegister(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'head' => 'nullable|string|max:100',
            'source' => 'nullable|in:all,manual,purchase_charge',
        ]);

        return response()->json(
            (new ExpenseRegisterService())->register([
                'from' => $validated['start_date'] ?? null,
                'to' => $validated['end_date'] ?? null,
                'store_ids' => $this->resolveStoreIds($request),
                'head' => $validated['head'] ?? null,
                'source' => $validated['source'] ?? ExpenseRegisterService::SOURCE_ALL,
            ])
        );
    }

    /**
     * Store daily closing summary.
     */
    public function dailySummary(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $date = $request->query('date', date('Y-m-d'));

        $service = OutwardSalesService::forWindow($storeId, $date, $date);
        $tenders = $service->tenders();
        $grossSales = $service->grossSales();
        $returns = $service->totalReturns();
        $totalSales = $service->netSales();
        $cash = $tenders['cash'];
        $upi = $tenders['upi'];
        $card = $tenders['card'];
        $credit = $tenders['credit'];

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
            'total_sales' => $totalSales,
            'gross_sales' => $grossSales,
            'returns' => $returns,
            'invoice_count' => $service->billsCount(),
            'cash_collection' => $cash,
            'upi_collection' => $upi,
            'card_collection' => $card,
            'credit_collection' => $credit,
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
            ->whereDate('invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoice_date', '<=', substr($endDate, 0, 10))
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get();

        // REP-009: a charge taken into cost has to be in the margin too, otherwise the two
        // treatments of the same rupee stop being comparable.
        $batchRates = $this->batchCostRates($storeId);
        $usedLandedCost = false;

        $totalRevenue = 0.0;
        $totalCogs = 0.0;
        $breakdown = [];

        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $sign = $isReturn ? -1 : 1;

            foreach ($inv->items as $item) {
                $qty = (float)$item->qty * $sign;
                $rev = (float)$item->total_amount * $sign;

                // Cost basis: the batch's landed rate when a charge moved it, otherwise the
                // rate this report has always booked the line at.
                $batchKey = $item->product_id . '|' . trim((string) ($item->batch_no ?? ''));
                $landed = $batchRates['landed'][$batchKey] ?? null;

                if ($landed !== null && $landed > 0) {
                    $costPerUnit = $landed;
                    $usedLandedCost = true;
                } else {
                    $costPerUnit = (float)($item->purchase_rate ?? $item->product?->ptr ?? ($item->unit_price * 0.75));
                }

                // PUR-011 keeps the supplier rate untouched, so it can still be shown beside it.
                $bookedPerUnit = $batchRates['booked'][$batchKey] ?? $costPerUnit;
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
                        'landed_cost' => 0.0,
                        'booked_cost' => 0.0,
                    ];
                }

                $breakdown[$key]['revenue'] += $rev;
                $breakdown[$key]['cogs'] += $cogs;
                $breakdown[$key]['qty'] += $qty;
                $breakdown[$key]['gross_profit'] += ($rev - $cogs);
                $breakdown[$key]['landed_cost'] += $qty * $costPerUnit;
                $breakdown[$key]['booked_cost'] += $qty * $bookedPerUnit;
            }
        }

        $grossProfit = $totalRevenue - $totalCogs;
        $grossMarginPercent = $totalRevenue > 0 ? round(($grossProfit / $totalRevenue) * 100, 2) : 0.0;

        $chargeExpenses = (new ExpenseRegisterService())->register([
            'from' => substr($startDate, 0, 10),
            'to' => substr($endDate, 0, 10),
            'store_ids' => $storeId === null ? null : [$storeId],
            'source' => ExpenseRegisterService::SOURCE_CHARGE,
        ])['totals']['postings'];

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'total_revenue' => round($totalRevenue, 2),
            'total_cogs' => round($totalCogs, 2),
            'gross_profit' => round($grossProfit, 2),
            'gross_margin_percent' => $grossMarginPercent,
            'cost_basis' => $usedLandedCost ? 'landed_cost' : 'purchase_rate',
            'expense_charge_postings' => round($chargeExpenses, 2),
            'breakdown' => array_values(array_map(function ($b) {
                $rev = (float)$b['revenue'];
                $gp = (float)$b['gross_profit'];
                $qty = (float)$b['qty'];
                return [
                    'group_key' => $b['group_key'],
                    'qty' => round($qty, 2),
                    'revenue' => round($rev, 2),
                    'cogs' => round((float)$b['cogs'], 2),
                    'gross_profit' => round($gp, 2),
                    'margin_percent' => $rev > 0 ? round(($gp / $rev) * 100, 2) : 0.0,
                    'cost_per_unit' => $qty != 0 ? round($b['landed_cost'] / $qty, 4) : 0.0,
                    'supplier_cost_per_unit' => $qty != 0 ? round($b['booked_cost'] / $qty, 4) : 0.0,
                ];
            }, $breakdown)),
        ]);
    }

    /**
     * Unit rates keyed by `product|batch`.
     *
     * `landed` is what the batch really cost once an add-to-cost charge joined it (PUR-011);
     * `booked` is the supplier rate the receipt was booked at, which the charge never rewrites.
     * A batch with no landed rate stays out of the first map, so the sale keeps the rate this
     * report has always costed it at.
     *
     * @return array{landed: array<string, float>, booked: array<string, float>}
     */
    private function batchCostRates(?int $storeId): array
    {
        $batches = ProductBatch::query()
            ->where(fn($q) => $q->whereNotNull('landed_cost_rate')->orWhere('purchase_rate', '>', 0))
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get(['product_id', 'batch_no', 'landed_cost_rate', 'purchase_rate']);

        $landed = [];
        $booked = [];

        foreach ($batches as $batch) {
            $key = $batch->product_id . '|' . trim((string) $batch->batch_no);

            if ($batch->landed_cost_rate !== null) {
                $landed[$key] = round((float) $batch->landed_cost_rate, 4);
            }
            if ((float) $batch->purchase_rate > 0) {
                $booked[$key] = round((float) $batch->purchase_rate, 4);
            }
        }

        return ['landed' => $landed, 'booked' => $booked];
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
            ->whereDate('invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoice_date', '<=', substr($endDate, 0, 10))
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

        // GSTR-1 must not lose the bills whose invoice_date is a bare date: this column is TEXT
        // and holds both shapes, so the window is compared on the date part.
        $invoicesQuery = Invoice::with(['items', 'payments'])
            ->whereDate('invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoice_date', '<=', substr($endDate, 0, 10))
            ->where('status', '!=', 'cancelled')
            ->orderBy('invoice_date')
            ->orderBy('id');
        if ($storeId) {
            $invoicesQuery->where('store_id', $storeId);
        }
        $invoices = $invoicesQuery->get();
        $service = OutwardSalesService::fromInvoices($invoices);

        $table4B2b = [];
        $table5B2cLarge = [];
        $table7B2cMap = [];
        $table9CreditNotes = [];

        foreach ($invoices as $inv) {
            $isReturn = OutwardSalesService::isReturn($inv);
            if (! $isReturn && ! OutwardSalesService::isSale($inv)) {
                continue;
            }

            $hasGstin = !empty($inv->customer_gstin) && strlen(trim($inv->customer_gstin)) === 15;
            $targetState = !empty($inv->customer_gstin) ? substr(trim($inv->customer_gstin), 0, 2) : ($inv->place_of_supply ?? $storeState);
            $taxable = $service->taxableBase($inv);

            if ($isReturn) {
                $table9CreditNotes[] = [
                    'note_number' => $inv->invoice_number,
                    'note_date' => $inv->invoice_date->format('Y-m-d'),
                    'customer_name' => $inv->customer_name,
                    'customer_gstin' => $inv->customer_gstin ?? '-',
                    'note_value' => Money::round2($inv->grand_total),
                    'taxable_value' => $taxable,
                    'cgst_amount' => Money::round2($inv->cgst_total),
                    'sgst_amount' => Money::round2($inv->sgst_total),
                    'igst_amount' => Money::round2($inv->igst_total),
                    'cess_amount' => Money::round2($inv->cess_total),
                ];
                continue;
            }

            if ($hasGstin) {
                $table4B2b[] = [
                    'gstin' => $inv->customer_gstin,
                    'customer_name' => $inv->customer_name,
                    'invoice_number' => $inv->invoice_number,
                    'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                    'invoice_value' => Money::round2($inv->grand_total),
                    'place_of_supply' => $targetState,
                    'taxable_value' => $taxable,
                    'cgst_amount' => Money::round2($inv->cgst_total),
                    'sgst_amount' => Money::round2($inv->sgst_total),
                    'igst_amount' => Money::round2($inv->igst_total),
                    'cess_amount' => Money::round2($inv->cess_total),
                ];
            } elseif ($targetState !== $storeState && $inv->grand_total > 250000) {
                $table5B2cLarge[] = [
                    'invoice_number' => $inv->invoice_number,
                    'invoice_date' => $inv->invoice_date->format('Y-m-d'),
                    'invoice_value' => Money::round2($inv->grand_total),
                    'place_of_supply' => $targetState,
                    'taxable_value' => $taxable,
                    'igst_amount' => Money::round2($inv->igst_total ?? $inv->tax_total),
                    'cess_amount' => Money::round2($inv->cess_total),
                ];
            } else {
                if (!isset($table7B2cMap[$targetState])) {
                    $table7B2cMap[$targetState] = [
                        'place_of_supply' => $targetState,
                        'taxable_value' => 0,
                        'cgst_amount' => 0,
                        'sgst_amount' => 0,
                        'igst_amount' => 0,
                        'cess_amount' => 0,
                        'tax_amount' => 0,
                    ];
                }
                $table7B2cMap[$targetState]['taxable_value'] += Money::paise($taxable);
                $table7B2cMap[$targetState]['cgst_amount'] += Money::paise($inv->cgst_total);
                $table7B2cMap[$targetState]['sgst_amount'] += Money::paise($inv->sgst_total);
                $table7B2cMap[$targetState]['igst_amount'] += Money::paise($inv->igst_total);
                $table7B2cMap[$targetState]['cess_amount'] += Money::paise($inv->cess_total);
                $table7B2cMap[$targetState]['tax_amount'] += Money::paise($inv->tax_total);
            }
        }

        $table7B2cSmall = array_values(array_map(function ($row) {
            return [
                'place_of_supply' => $row['place_of_supply'],
                'taxable_value' => Money::toFloat($row['taxable_value']),
                'cgst_amount' => Money::toFloat($row['cgst_amount']),
                'sgst_amount' => Money::toFloat($row['sgst_amount']),
                'igst_amount' => Money::toFloat($row['igst_amount']),
                'cess_amount' => Money::toFloat($row['cess_amount']),
                'tax_amount' => Money::toFloat($row['tax_amount']),
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
        $store = $storeId ? Store::find($storeId) : null;

        // Defaults are calendar dates in the store's timezone, never the
        // server timezone: a bill rung up at 00:30 IST belongs to that IST day
        // even when the server clock is still on the previous UTC day.
        $storeToday = StoreClock::today($store)->toDateString();
        $startDate = $request->query('start_date', $storeToday);
        $endDate = $request->query('end_date', $storeToday);

        $service = OutwardSalesService::forWindow($storeId, $startDate, $endDate);
        $gst = $service->gst();
        $tenders = $service->tenders();

        $grossSales = $service->grossSales();
        $totalReturns = $service->totalReturns();
        $netSales = $service->netSales();
        $billsCount = $service->billsCount();
        $avgTicket = $billsCount > 0 ? Money::round2($grossSales / $billsCount) : 0.0;

        $digitalTotal = Money::sum([$tenders['upi'], $tenders['card'], $tenders['bank_transfer']]);
        $totalCollected = Money::sum(array_values($tenders));
        $digitalPercent = $totalCollected > 0 ? round(($digitalTotal / $totalCollected) * 100, 1) : 0.0;

        $slabs = [];
        foreach ([0, 5, 12, 18, 28] as $rate) {
            $slabs[$rate] = [
                'rate' => $rate,
                'taxable_value' => 0.0,
                'cgst_amount' => 0.0,
                'sgst_amount' => 0.0,
                'igst_amount' => 0.0,
                'total_tax' => 0.0,
            ];
        }
        foreach ($gst['slabs'] as $row) {
            $slabs[(int) $row['rate']] = [
                'rate' => (int) $row['rate'],
                'taxable_value' => $row['taxable_value'],
                'cgst_amount' => $row['cgst_amount'],
                'sgst_amount' => $row['sgst_amount'],
                'igst_amount' => $row['igst_amount'],
                'total_tax' => $row['total_tax'],
            ];
        }
        ksort($slabs);

        $totalTaxAccrued = Money::sum([$gst['cgst_amount'], $gst['sgst_amount'], $gst['igst_amount']]);

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'timezone' => StoreClock::timezone($store),
            'net_sales' => $netSales,
            'gross_sales' => $grossSales,
            'total_returns' => $totalReturns,
            'bills_count' => $billsCount,
            'average_ticket' => $avgTicket,
            'payments' => [
                'cash' => Money::round2(max(0, $tenders['cash'])),
                'upi' => Money::round2(max(0, $tenders['upi'])),
                'card' => Money::round2(max(0, $tenders['card'])),
                'bank_transfer' => Money::round2(max(0, $tenders['bank_transfer'])),
                'credit' => Money::round2(max(0, $tenders['credit'])),
                'other' => Money::round2(max(0, $tenders['other'])),
                'digital_total' => $digitalTotal,
                'digital_percent' => $digitalPercent,
                'total_collected' => $totalCollected,
            ],
            'gst' => [
                'slabs' => array_values($slabs),
                'total_taxable' => $gst['taxable_value'],
                'total_cgst' => $gst['cgst_amount'],
                'total_sgst' => $gst['sgst_amount'],
                'total_igst' => $gst['igst_amount'],
                'total_round_off' => $service->roundOff(),
                'total_tax_accrued' => $totalTaxAccrued,
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

        $invoicesQuery = Invoice::with('items')
            ->whereDate('invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoice_date', '<=', substr($endDate, 0, 10))
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
