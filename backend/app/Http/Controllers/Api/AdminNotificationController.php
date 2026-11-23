<?php

namespace App\Http\Controllers\Api;

use App\Models\Notification;
use App\Services\Alerts\OperationalAlertService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
     * Evaluate system alerts on demand (low stock, near expiry, offline devices,
     * offline counters, sync failures). The same sweep runs on a schedule so the
     * inbox is populated even when the drawer is never opened.
     */
    public function checkAlerts(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');

        $created = app(OperationalAlertService::class)->sweep($storeId ? (int) $storeId : null);

        return response()->json([
            'success' => true,
            'alerts_generated' => $created,
        ]);
    }
}
