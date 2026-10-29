<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceSession;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceSessionController
{
    /**
     * Retrieve all logged-in devices and their real-time connection status for the store.
     */
    public function index(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);

        // If no device session records exist for this store yet, bootstrap from registered counters/devices
        if (DeviceSession::where('store_id', $storeId)->count() === 0) {
            $this->bootstrapFromCounters($storeId);
        }

        $query = DeviceSession::with(['user:id,name,username', 'counter:id,counter_name,counter_code,location_name'])
            ->where('store_id', $storeId);

        // Search filter
        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('device_name', 'like', "%{$search}%")
                  ->orWhere('counter_name', 'like', "%{$search}%")
                  ->orWhere('counter_code', 'like', "%{$search}%")
                  ->orWhere('ip_address', 'like', "%{$search}%")
                  ->orWhere('location', 'like', "%{$search}%");
            });
        }

        $sessions = $query->orderBy('is_active', 'desc')
            ->orderBy('last_active_at', 'desc')
            ->get();

        $devices = $sessions->map(function (DeviceSession $s) {
            $status = $s->computeStatus();
            return [
                'id' => (string)$s->id,
                'session_id' => $s->session_id,
                'device_uuid' => $s->device_uuid,
                'device_name' => $s->device_name ?: null,
                'counter_name' => $s->counter_name ?: null,
                'counter_code' => $s->counter_code ?: null,
                'ip_address' => $s->ip_address ?: null,
                'location' => $s->location ?: null,
                'login_time' => $s->login_time ? $s->login_time->toIso8601String() : null,
                'last_active' => $s->last_active_at ? $s->last_active_at->toIso8601String() : null,
                'status' => $status,
                'is_active' => (bool)$s->is_active,
                'user_name' => $s->user?->name ?: null,
            ];
        });

        // Filter by computed status if requested
        if ($filterStatus = $request->query('status')) {
            $statusNormalized = strtolower(trim($filterStatus));
            $devices = $devices->filter(function ($d) use ($statusNormalized) {
                if ($statusNormalized === 'all') return true;
                if ($statusNormalized === 'online') return $d['status'] === 'Online';
                if ($statusNormalized === 'offline') return $d['status'] === 'Offline';
                if (in_array($statusNormalized, ['expired', 'session expired'])) return $d['status'] === 'Session Expired';
                return strtolower($d['status']) === $statusNormalized;
            })->values();
        }

        return response()->json([
            'success' => true,
            'devices' => $devices,
            'total' => $devices->count(),
            'online_count' => $devices->where('status', 'Online')->count(),
            'offline_count' => $devices->where('status', 'Offline')->count(),
        ]);
    }

    /**
     * Heartbeat endpoint for connected workstations.
     */
    public function heartbeat(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'device_uuid' => 'required|string',
            'device_name' => 'nullable|string|max:100',
            'counter_name' => 'nullable|string|max:100',
            'store_id' => 'nullable',
        ]);

        $deviceUuid = $validated['device_uuid'];
        $ip = $request->ip();

        $session = DeviceSession::recordHeartbeat(
            $deviceUuid,
            $ip,
            $validated['device_name'] ?? null,
            $validated['counter_name'] ?? null
        );

        if (!$session) {
            // If active session not found, create one if device or counter exists
            $storeId = $this->resolveStoreId($request);
            $session = DeviceSession::recordLogin(
                $storeId,
                $deviceUuid,
                $validated['device_name'] ?? null,
                null,
                $validated['counter_name'] ?? null,
                null,
                $request->user()?->id,
                $ip,
                $this->detectLocation($request)
            );
        }

        return response()->json([
            'success' => true,
            'status' => $session->computeStatus(),
            'last_active' => $session->last_active_at?->toIso8601String(),
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Terminate / log out an active device session.
     */
    public function logout(Request $request): JsonResponse
    {
        $identifier = $request->input('device_uuid') ?: $request->input('session_id');
        if (empty($identifier)) {
            return response()->json(['message' => 'device_uuid or session_id is required.'], 422);
        }

        DeviceSession::recordLogout($identifier);

        return response()->json([
            'success' => true,
            'message' => 'Device session ended successfully.',
        ]);
    }

    /**
     * Force-expire or revoke an active session from the admin panel / logged-in devices table.
     */
    public function expireSession(Request $request, string $id): JsonResponse
    {
        $session = DeviceSession::findOrFail($id);
        $session->update([
            'is_active' => false,
            'status' => 'expired',
            'last_active_at' => now(),
        ]);

        AuditLog::log(
            'device_session_expired_by_admin',
            'DeviceSession',
            (string)$session->id,
            null,
            ['device_uuid' => $session->device_uuid, 'device_name' => $session->device_name],
            $session->store_id,
            $request->user()?->id
        );

        return response()->json([
            'success' => true,
            'message' => "Session for '{$session->device_name}' expired.",
            'device' => [
                'id' => (string)$session->id,
                'status' => 'Session Expired',
                'is_active' => false,
            ],
        ]);
    }

    /**
     * Resolve store ID from request header, query, or authenticated user.
     */
    protected function resolveStoreId(Request $request): int
    {
        $storeParam = $request->header('X-Store-Id')
            ?: $request->query('store_id')
            ?: $request->input('store_id');

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

        $defaultStore = Store::first();
        return $defaultStore ? (int)$defaultStore->id : 1;
    }

    /**
     * Detect approximate location from request headers or counter location.
     */
    protected function detectLocation(Request $request): ?string
    {
        $city = $request->header('CF-IPCity')
            ?: $request->header('X-Geo-City')
            ?: $request->header('X-AppEngine-City');

        $country = $request->header('CF-IPCountry') ?: $request->header('X-Geo-Country');

        if ($city && $country) {
            return "{$city}, {$country}";
        }
        if ($city) {
            return $city;
        }

        return null;
    }

    /**
     * Bootstrap device sessions from existing counters and devices for seamless upgrade.
     */
    protected function bootstrapFromCounters(int $storeId): void
    {
        $counters = Counter::where('store_id', $storeId)->get();
        foreach ($counters as $c) {
            $deviceUuid = $c->device_uuid ?: ('dev_counter_' . $c->id);
            $isActive = $c->status === 'active';
            $isRevoked = $c->status === 'revoked';

            DeviceSession::create([
                'store_id' => $storeId,
                'counter_id' => $c->id,
                'device_uuid' => $deviceUuid,
                'session_id' => 'ds_bootstrap_' . $c->id . '_' . bin2hex(random_bytes(6)),
                'device_name' => $c->device_name ?: null,
                'counter_name' => $c->counter_name ?: null,
                'counter_code' => $c->counter_code ?: null,
                'ip_address' => $c->ip_address ?: null,
                'location' => $c->location_name ?: null,
                'login_time' => $c->last_seen_at ?: $c->created_at ?: now()->subMinutes(10),
                'last_active_at' => $c->last_seen_at ?: now()->subMinutes(10),
                'status' => $isRevoked ? 'revoked' : ($isActive ? 'online' : 'offline'),
                'is_active' => !$isRevoked,
            ]);
        }
    }
}
