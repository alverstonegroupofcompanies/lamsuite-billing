<?php

namespace App\Http\Controllers\Api;

use App\Models\Device;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\SyncEvent;
use App\Services\Reports\OutwardSalesService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminDashboardController
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $storeId = $request->get('active_store_id');

        // Multi-tenant store scoping query builder
        $productScope = Product::where('is_active', true);
        $batchScope = ProductBatch::where('stock_qty', '>', 0);
        $deviceScope = Device::query();
        $syncScope = SyncEvent::query();
        $storesScope = Store::query();

        if ($storeId) {
            $productScope->where('store_id', $storeId);
            $batchScope->where('store_id', $storeId);
            $deviceScope->where('store_id', $storeId);
            $syncScope->where('store_id', $storeId);
            $storesScope->where('id', $storeId);
        }

        // Invoice dates are store-local calendar dates, so "today" must be
        // evaluated in the store's timezone, not the server default.
        $timezone = $storeId
            ? (Store::whereKey($storeId)->value('timezone') ?: config('app.timezone'))
            : config('app.timezone');
        try {
            $now = Carbon::now($timezone);
        } catch (\Throwable $e) {
            $timezone = config('app.timezone');
            $now = Carbon::now($timezone);
        }
        $today = $now->toDateString();
        $startOfWeek = $now->copy()->startOfWeek()->toDateString();
        $startOfMonth = $now->copy()->startOfMonth()->toDateString();

        // 1. Sales metrics — read through the same outward-sales service as the
        // store reports, so the tiles are net of credit notes and returns and
        // count only sale bills (never the return documents themselves).
        $scopeStoreId = $storeId ? (int) $storeId : null;
        $todaySales = OutwardSalesService::forWindow($scopeStoreId, $today, $today);
        $weekSales = OutwardSalesService::forWindow($scopeStoreId, $startOfWeek, $today);
        $monthSales = OutwardSalesService::forWindow($scopeStoreId, $startOfMonth, $today);

        // 2. Purchases metrics — a supplier bill counts once even when sync
        // delivered it twice, and purchase returns reduce the spend.
        $purchaseTotals = $this->purchaseTotals($storeId, $today, [
            'today' => $today,
            'week' => $startOfWeek,
            'month' => $startOfMonth,
        ]);

        // 3. Customer outstanding receivables — derived from open documents so
        // the tile works for stores that never kept Party balances.
        $openInvoiceQuery = Invoice::query()
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId));

        $openBalances = Money::paise(
            (clone $openInvoiceQuery)
                ->whereIn('module_key', ['invoice', 'pos'])
                ->sum(DB::raw('CASE WHEN grand_total > paid_amount THEN grand_total - paid_amount ELSE 0 END'))
        );
        // Only the part of a credit note that was not refunded is still owed
        // back to the customer; a note settled in cash at the counter must not
        // shrink what other customers owe.
        $documentCredits = Money::paise(
            (clone $openInvoiceQuery)
                ->whereIn('module_key', OutwardSalesService::RETURN_MODULES)
                ->sum(DB::raw('CASE WHEN grand_total > paid_amount THEN grand_total - paid_amount ELSE 0 END'))
        );
        $outstandingReceivables = Money::toFloat(max(0, $openBalances - $documentCredits));

        // 4. Low stock & Near expiry
        $lowStockCount = (clone $productScope)->whereColumn('current_stock', '<=', 'reorder_level')->count();
        $nearExpiryThreshold = $now->copy()->addDays(60)->toDateString();
        $nearExpiryCount = (clone $batchScope)->whereDate('expiry_date', '<=', $nearExpiryThreshold)->count();

        // 5. Top 5 selling items — return lines subtract, so a returned item is
        // never ranked (or summed) as if it were a fresh sale.
        $returnSign = "CASE WHEN invoices.module_key IN ('credit_note', 'sales_return') THEN -1 ELSE 1 END";
        $topItems = DB::table('invoice_items')
            ->join('invoices', 'invoice_items.invoice_id', '=', 'invoices.id')
            ->when($storeId, fn($q) => $q->where('invoices.store_id', $storeId))
            ->where('invoices.status', '!=', 'cancelled')
            ->whereIn('invoices.module_key', array_merge(OutwardSalesService::SALES_MODULES, OutwardSalesService::RETURN_MODULES))
            ->select(
                'invoice_items.product_name',
                DB::raw("SUM(invoice_items.qty * ({$returnSign})) as total_qty"),
                DB::raw("SUM(invoice_items.total_amount * ({$returnSign})) as total_revenue")
            )
            ->groupBy('invoice_items.product_name')
            ->orderByDesc('total_revenue')
            ->limit(5)
            ->get()
            ->map(fn ($row) => [
                'product_name' => $row->product_name,
                'total_qty' => round((float) $row->total_qty, 4),
                'total_revenue' => Money::round2($row->total_revenue),
            ]);

        // 6. Store-wise comparison
        $storeComparison = Store::withCount(['invoices', 'devices'])
            ->when($storeId, fn($q) => $q->where('id', $storeId))
            ->get()
            ->map(function ($s) use ($startOfMonth, $today) {
                // Month sales, net of returns, through the same reading as the tiles.
                $monthSales = OutwardSalesService::forWindow((int) $s->id, $startOfMonth, $today)->netSales();
                $pendingSync = SyncEvent::where('store_id', $s->id)->where('status', 'pending')->count();
                $failedSync = SyncEvent::where('store_id', $s->id)->where('status', 'failed')->count();
                $devicesActive = Device::where('store_id', $s->id)->where('status', 'active')->count();

                return [
                    'store_id' => $s->id,
                    'name' => $s->name,
                    'code' => $s->code,
                    'is_active' => $s->is_active,
                    'total_sales' => round($monthSales, 2),
                    'invoices_count' => $s->invoices_count,
                    'active_devices' => $devicesActive,
                    'pending_sync' => $pendingSync,
                    'failed_sync' => $failedSync,
                    'sync_status' => $failedSync > 0 ? 'warning' : 'healthy',
                ];
            });

        // 7. Sync health metrics
        $storesOnline = Device::where('status', 'active')->where('last_seen_at', '>=', $now->copy()->subMinutes(15))->distinct('store_id')->count('store_id');
        $totalStores = Store::where('is_active', true)->count();
        $lastSyncTime = Device::max('last_sync_at');
        $pendingQueueCount = (clone $syncScope)->where('status', 'pending')->count();
        $failedSyncCount = (clone $syncScope)->where('status', 'failed')->count();
        $conflictsCount = (clone $syncScope)->where('status', 'conflict')->count();

        return response()->json([
            'timezone' => $timezone,
            'sales' => [
                'today' => ['amount' => $todaySales->netSales(), 'count' => $todaySales->billsCount()],
                'week' => ['amount' => $weekSales->netSales(), 'count' => $weekSales->billsCount()],
                'month' => ['amount' => $monthSales->netSales(), 'count' => $monthSales->billsCount()],
            ],
            'purchases' => [
                'today' => $purchaseTotals['today'],
                'week' => $purchaseTotals['week'],
                'month' => $purchaseTotals['month'],
            ],
            'receivables' => [
                'total_outstanding' => $outstandingReceivables,
            ],
            'alerts' => [
                'low_stock_count' => $lowStockCount,
                'near_expiry_count' => $nearExpiryCount,
            ],
            'top_items' => $topItems,
            'store_comparison' => $storeComparison,
            'sync_health' => [
                'stores_online' => $storesOnline,
                'total_active_stores' => $totalStores,
                'last_sync_at' => $lastSyncTime,
                'pending_queue' => $pendingQueueCount,
                'failed_syncs' => $failedSyncCount,
                'conflicts_count' => $conflictsCount,
                'status' => $failedSyncCount > 0 ? 'degraded' : 'healthy',
            ],
        ]);
    }

    /**
     * Supplier spend per window, counting a synced duplicate once per
     * (store, supplier, invoice number) and netting purchase returns.
     *
     * @param  array<string, string>  $windows  label => inclusive start date
     * @return array<string, float>
     */
    private function purchaseTotals(mixed $storeId, string $endDate, array $windows): array
    {
        $rows = Purchase::query()
            ->where('status', '!=', 'cancelled')
            ->whereNotIn('module_key', ['purchase_order', 'order'])
            ->whereDate('invoice_date', '>=', min(array_values($windows)))
            ->whereDate('invoice_date', '<=', $endDate)
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->get(['id', 'store_id', 'supplier_id', 'invoice_number', 'module_key', 'grand_total', 'invoice_date']);

        $seen = [];
        $bills = [];
        $returns = [];

        foreach ($rows as $row) {
            $date = substr((string) $row->invoice_date, 0, 10);
            $paise = Money::paise($row->grand_total);

            if (in_array($row->module_key, ['purchase_return', 'debit_note'], true)) {
                $returns[] = ['date' => $date, 'paise' => $paise];
                continue;
            }

            $number = trim((string) $row->invoice_number);
            $identity = $number !== ''
                ? ($row->store_id ?? 0) . '|' . ($row->supplier_id ?? 0) . '|' . strtolower($number)
                : 'id|' . $row->id;

            if (isset($seen[$identity])) {
                continue;
            }
            $seen[$identity] = true;
            $bills[] = ['date' => $date, 'paise' => $paise];
        }

        $totals = [];
        foreach ($windows as $label => $start) {
            $start = substr((string) $start, 0, 10);
            $paise = 0;
            foreach ($bills as $bill) {
                if ($bill['date'] >= $start) {
                    $paise += $bill['paise'];
                }
            }
            foreach ($returns as $return) {
                if ($return['date'] >= $start) {
                    $paise -= $return['paise'];
                }
            }
            $totals[$label] = Money::toFloat($paise);
        }

        return $totals;
    }
}
