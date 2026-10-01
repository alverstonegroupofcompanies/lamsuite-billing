<?php

namespace App\Http\Controllers\Api;

use App\Models\Device;
use App\Models\Invoice;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\SyncEvent;
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
        $invoiceScope = Invoice::where('status', '!=', 'cancelled');
        $purchaseScope = Purchase::where('status', '!=', 'cancelled');
        $partyScope = Party::query();
        $productScope = Product::where('is_active', true);
        $batchScope = ProductBatch::where('stock_qty', '>', 0);
        $deviceScope = Device::query();
        $syncScope = SyncEvent::query();
        $storesScope = Store::query();

        if ($storeId) {
            $invoiceScope->where('store_id', $storeId);
            $purchaseScope->where('store_id', $storeId);
            $partyScope->where('store_id', $storeId);
            $productScope->where('store_id', $storeId);
            $batchScope->where('store_id', $storeId);
            $deviceScope->where('store_id', $storeId);
            $syncScope->where('store_id', $storeId);
            $storesScope->where('id', $storeId);
        }

        $today = Carbon::today()->toDateString();
        $startOfWeek = Carbon::now()->startOfWeek()->toDateString();
        $startOfMonth = Carbon::now()->startOfMonth()->toDateString();

        // 1. Sales metrics
        $todaySales = (clone $invoiceScope)->whereDate('invoice_date', $today)->sum('grand_total');
        $todayInvoicesCount = (clone $invoiceScope)->whereDate('invoice_date', $today)->count();

        $weekSales = (clone $invoiceScope)->whereDate('invoice_date', '>=', $startOfWeek)->sum('grand_total');
        $weekInvoicesCount = (clone $invoiceScope)->whereDate('invoice_date', '>=', $startOfWeek)->count();

        $monthSales = (clone $invoiceScope)->whereDate('invoice_date', '>=', $startOfMonth)->sum('grand_total');
        $monthInvoicesCount = (clone $invoiceScope)->whereDate('invoice_date', '>=', $startOfMonth)->count();

        // 2. Purchases metrics
        $todayPurchases = (clone $purchaseScope)->whereDate('invoice_date', $today)->sum('grand_total');
        $weekPurchases = (clone $purchaseScope)->whereDate('invoice_date', '>=', $startOfWeek)->sum('grand_total');
        $monthPurchases = (clone $purchaseScope)->whereDate('invoice_date', '>=', $startOfMonth)->sum('grand_total');

        // 3. Customer outstanding receivables
        $outstandingReceivables = (clone $partyScope)->where('type', 'customer')->sum('current_balance');

        // 4. Low stock & Near expiry
        $lowStockCount = (clone $productScope)->whereColumn('current_stock', '<=', 'reorder_level')->count();
        $nearExpiryThreshold = Carbon::now()->addDays(60)->toDateString();
        $nearExpiryCount = (clone $batchScope)->whereDate('expiry_date', '<=', $nearExpiryThreshold)->count();

        // 5. Top 5 selling items
        $topItems = DB::table('invoice_items')
            ->join('invoices', 'invoice_items.invoice_id', '=', 'invoices.id')
            ->when($storeId, fn($q) => $q->where('invoices.store_id', $storeId))
            ->where('invoices.status', '!=', 'cancelled')
            ->select('invoice_items.product_name', DB::raw('SUM(invoice_items.qty) as total_qty'), DB::raw('SUM(invoice_items.total_amount) as total_revenue'))
            ->groupBy('invoice_items.product_name')
            ->orderByDesc('total_revenue')
            ->limit(5)
            ->get();

        // 6. Store-wise comparison
        $storeComparison = Store::withCount(['invoices', 'devices'])
            ->when($storeId, fn($q) => $q->where('id', $storeId))
            ->get()
            ->map(function ($s) {
                $monthSales = Invoice::where('store_id', $s->id)->where('status', '!=', 'cancelled')->sum('grand_total');
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
        $storesOnline = Device::where('status', 'active')->where('last_seen_at', '>=', Carbon::now()->subMinutes(15))->distinct('store_id')->count('store_id');
        $totalStores = Store::where('is_active', true)->count();
        $lastSyncTime = Device::max('last_sync_at');
        $pendingQueueCount = (clone $syncScope)->where('status', 'pending')->count();
        $failedSyncCount = (clone $syncScope)->where('status', 'failed')->count();
        $conflictsCount = (clone $syncScope)->where('status', 'conflict')->count();

        return response()->json([
            'sales' => [
                'today' => ['amount' => round($todaySales, 2), 'count' => $todayInvoicesCount],
                'week' => ['amount' => round($weekSales, 2), 'count' => $weekInvoicesCount],
                'month' => ['amount' => round($monthSales, 2), 'count' => $monthInvoicesCount],
            ],
            'purchases' => [
                'today' => round($todayPurchases, 2),
                'week' => round($weekPurchases, 2),
                'month' => round($monthPurchases, 2),
            ],
            'receivables' => [
                'total_outstanding' => round($outstandingReceivables, 2),
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
}
