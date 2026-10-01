<?php

namespace App\Http\Controllers\Api;

use App\Models\Device;
use App\Models\Notification;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\SyncEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AdminNotificationController
{
    public function index(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = Notification::when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($request->query('unread_only') === 'true') {
            $query->where('is_read', false);
        }

        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }

        $query->orderBy('created_at', 'desc');

        return response()->json([
            'unread_count' => (clone $query)->where('is_read', false)->count(),
            'notifications' => $query->paginate(20),
        ]);
    }

    public function markAsRead(Request $request, string $id): JsonResponse
    {
        $notification = Notification::findOrFail($id);
        $notification->update(['is_read' => true]);

        return response()->json(['success' => true]);
    }

    public function markAllAsRead(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        Notification::when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->update(['is_read' => true]);

        return response()->json(['success' => true]);
    }

    /**
     * Check and evaluate system alerts (low stock, near expiry, offline stores > 2h, sync failures, license expiry).
     */
    public function checkAlerts(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $createdAlerts = 0;

        // 1. Low stock alert check
        $lowStockProducts = Product::where('is_active', true)
            ->whereColumn('current_stock', '<=', 'reorder_level')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->limit(5)
            ->get();

        foreach ($lowStockProducts as $p) {
            $existing = Notification::where('type', 'stock_low')
                ->where('data->product_id', $p->id)
                ->where('created_at', '>=', now()->subHours(24))
                ->exists();

            if (!$existing) {
                Notification::create([
                    'store_id' => $p->store_id,
                    'title' => "Low Stock Alert: {$p->name}",
                    'message' => "Current stock ({$p->current_stock}) has dropped below or reached reorder level ({$p->reorder_level}).",
                    'type' => 'stock_low',
                    'data' => ['product_id' => $p->id, 'current_stock' => $p->current_stock],
                ]);
                $createdAlerts++;
            }
        }

        // 2. Near expiry batch alerts
        $expiringBatches = ProductBatch::with('product')
            ->where('stock_qty', '>', 0)
            ->whereDate('expiry_date', '<=', Carbon::now()->addDays(30))
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->limit(5)
            ->get();

        foreach ($expiringBatches as $b) {
            $existing = Notification::where('type', 'expiry')
                ->where('data->batch_id', $b->id)
                ->where('created_at', '>=', now()->subHours(24))
                ->exists();

            if (!$existing) {
                $pName = $b->product ? $b->product->name : 'Unknown Item';
                Notification::create([
                    'store_id' => $b->store_id,
                    'title' => "Expiry Warning: {$pName} (Batch {$b->batch_no})",
                    'message' => "Batch expires on {$b->expiry_date->toDateString()}. Remaining stock: {$b->stock_qty} units.",
                    'type' => 'expiry',
                    'data' => ['batch_id' => $b->id, 'expiry_date' => $b->expiry_date],
                ]);
                $createdAlerts++;
            }
        }

        // 3. Store offline for > 2 hours alert
        $offlineDevices = Device::where('status', 'active')
            ->where('last_seen_at', '<=', Carbon::now()->subHours(2))
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->get();

        foreach ($offlineDevices as $d) {
            $existing = Notification::where('type', 'store_offline')
                ->where('data->device_id', $d->id)
                ->where('created_at', '>=', now()->subHours(12))
                ->exists();

            if (!$existing) {
                Notification::create([
                    'store_id' => $d->store_id,
                    'title' => "Workstation Offline Alert",
                    'message' => "Device '{$d->device_name}' has been offline for over 2 hours. Last seen: {$d->last_seen_at}.",
                    'type' => 'store_offline',
                    'data' => ['device_id' => $d->id],
                ]);
                $createdAlerts++;
            }
        }

        // 4. Sync failure alerts
        $syncFailures = SyncEvent::where('status', 'failed')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->where('created_at', '>=', now()->subHours(24))
            ->count();

        if ($syncFailures > 0) {
            $existing = Notification::where('type', 'sync_failure')
                ->where('created_at', '>=', now()->subHours(6))
                ->exists();

            if (!$existing) {
                Notification::create([
                    'store_id' => $storeId,
                    'title' => "Cloud Sync Failures Detected",
                    'message' => "{$syncFailures} sync operations have failed in the last 24 hours. Please review the Sync Center.",
                    'type' => 'sync_failure',
                    'data' => ['failed_count' => $syncFailures],
                ]);
                $createdAlerts++;
            }
        }

        return response()->json([
            'success' => true,
            'alerts_generated' => $createdAlerts,
        ]);
    }
}
