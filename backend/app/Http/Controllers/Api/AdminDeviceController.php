<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminDeviceController
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $storeId = $request->get('active_store_id');

        $query = Device::with('store:id,name,code');

        if ($storeId) {
            $query->where('store_id', $storeId);
        } elseif (!$user->isSuperAdmin()) {
            $allowed = $user->allowed_store_ids ?? [];
            if ($user->store_id) {
                $allowed[] = $user->store_id;
            }
            $query->whereIn('store_id', array_unique($allowed));
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('device_name', 'like', "%{$search}%")
                  ->orWhere('device_uuid', 'like', "%{$search}%")
                  ->orWhere('ip_address', 'like', "%{$search}%");
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $query->orderBy('last_seen_at', 'desc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        return response()->json($query->paginate(20));
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $device = Device::findOrFail($id);
        $validated = $request->validate([
            'status' => 'required|in:active,revoked,pending',
            'reason' => 'required_if:status,revoked|nullable|string',
        ]);

        $oldStatus = $device->status;
        $device->update([
            'status' => $validated['status'],
            'revoke_reason' => $validated['status'] === 'revoked' ? $validated['reason'] : null,
        ]);

        AuditLog::log(
            'device_status_change',
            'Device',
            (string)$device->id,
            ['status' => $oldStatus],
            ['status' => $device->status, 'reason' => $validated['reason'] ?? null],
            $device->store_id
        );

        return response()->json([
            'success' => true,
            'device' => $device,
            'message' => "Device '{$device->device_name}' marked as {$device->status}.",
        ]);
    }

    public function forceResync(Request $request, string $id): JsonResponse
    {
        $device = Device::findOrFail($id);
        $device->update(['force_resync' => true]);

        AuditLog::log('force_device_resync', 'Device', (string)$device->id, null, ['force_resync' => true], $device->store_id);

        return response()->json([
            'success' => true,
            'message' => "Forced re-sync triggered for device '{$device->device_name}'. The client will initiate full delta re-sync on next heartbeat.",
        ]);
    }
}
