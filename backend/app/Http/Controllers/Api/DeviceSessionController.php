<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\CompanySetting;
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

        $query = DeviceSession::with(['user:id,name,username,role,is_admin', 'counter:id,counter_name,counter_code,location_name'])
            ->where('store_id', $storeId);

        // Search filter
        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('device_name', 'like', "%{$search}%")
                  ->orWhere('counter_name', 'like', "%{$search}%")
                  ->orWhere('counter_code', 'like', "%{$search}%")
                  ->orWhere('ip_address', 'like', "%{$search}%")
                  ->orWhere('location', 'like', "%{$search}%")
                  ->orWhere('user_role', 'like', "%{$search}%")
                  ->orWhereHas('user', function ($uq) use ($search) {
                      $uq->where('name', 'like', "%{$search}%");
                  });
            });
        }

        $sessions = $query->orderBy('is_active', 'desc')
            ->orderBy('last_active_at', 'desc')
            ->get();

        $currentDeviceUuid = $request->header('X-Device-Uuid')
            ?: $request->query('current_device_uuid')
            ?: $request->query('device_uuid');

        $minSetting = CompanySetting::where('key', 'min_required_desktop_version')
            ->where(function ($q) use ($storeId) {
                if ($storeId) {
                    $q->where('store_id', $storeId)->orWhereNull('store_id');
                } else {
                    $q->whereNull('store_id');
                }
            })
            ->latest()
            ->first();

        $minRequiredVersion = $minSetting ? ($minSetting->value['version'] ?? '2.0.20') : '2.0.20';
        $latestSetting = CompanySetting::where('key', 'latest_desktop_release_version')->latest()->first();
        $latestVersion = $latestSetting ? ($latestSetting->value['version'] ?? '2.0.20') : '2.0.20';

        $devices = $sessions->map(function (DeviceSession $s) use ($currentDeviceUuid, $minRequiredVersion, $latestVersion) {
            $status = $s->computeStatus();
            $userRole = $s->user_role ?: ($s->user?->role ?: ($s->user?->is_admin ? 'Admin' : 'Cashier'));
            $appVer = $s->app_version ?: '2.0.20';
            $isOutOfDate = version_compare($appVer, $minRequiredVersion, '<');

            return [
                'id' => (string)$s->id,
                'session_id' => $s->session_id,
                'device_uuid' => $s->device_uuid,
                'device_name' => $s->device_name ?: 'Workstation',
                'counter_name' => $s->counter_name ?: 'Counter 1',
                'counter_code' => $s->counter_code ?: null,
                'user_name' => $s->user?->name ?: null,
                'user_role' => $userRole,
                'ip_address' => $s->ip_address ?: null,
                'location' => $s->location ?: null,
                'status' => $status, // Active, Idle, Offline, Locked, Revoked
                'sign_in_time' => $s->login_time ? $s->login_time->toIso8601String() : null,
                'login_time' => $s->login_time ? $s->login_time->toIso8601String() : null,
                'last_seen' => $s->last_active_at ? $s->last_active_at->toIso8601String() : null,
                'last_active' => $s->last_active_at ? $s->last_active_at->toIso8601String() : null,
                'app_version' => $appVer,
                'is_out_of_date' => $isOutOfDate,
                'min_required_version' => $minRequiredVersion,
                'latest_version' => $latestVersion,
                'unsynced_items_count' => (int)($s->unsynced_items_count ?? 0),
                'is_this_device' => !empty($currentDeviceUuid) && $s->device_uuid === $currentDeviceUuid,
                'is_active' => (bool)$s->is_active,
            ];
        });

        // Filter by computed status if requested
        if ($filterStatus = $request->query('status')) {
            $statusNormalized = strtolower(trim($filterStatus));
            if ($statusNormalized !== 'all') {
                $devices = $devices->filter(function ($d) use ($statusNormalized) {
                    return strtolower($d['status']) === $statusNormalized;
                })->values();
            }
        }

        return response()->json([
            'success' => true,
            'devices' => $devices,
            'total' => $devices->count(),
            'active_count' => $devices->where('status', 'Active')->count(),
            'idle_count' => $devices->where('status', 'Idle')->count(),
            'offline_count' => $devices->where('status', 'Offline')->count(),
            'locked_count' => $devices->where('status', 'Locked')->count(),
            'revoked_count' => $devices->where('status', 'Revoked')->count(),
            'out_of_date_count' => $devices->where('is_out_of_date', true)->count(),
            'min_required_version' => $minRequiredVersion,
            'latest_version' => $latestVersion,
            // Backwards compatibility keys
            'online_count' => $devices->where('status', 'Active')->count(),
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
            'app_version' => 'nullable|string|max:30',
            'unsynced_items_count' => 'nullable|integer',
            'status' => 'nullable|string|in:Active,active,Idle,idle,Locked,locked',
            'user_role' => 'nullable|string|max:50',
            'store_id' => 'nullable',
        ]);

        $deviceUuid = $validated['device_uuid'];
        $ip = $request->ip();

        $session = DeviceSession::recordHeartbeat(
            $deviceUuid,
            $ip,
            $validated['device_name'] ?? null,
            $validated['counter_name'] ?? null,
            $validated['app_version'] ?? null,
            isset($validated['unsynced_items_count']) ? (int)$validated['unsynced_items_count'] : null,
            $validated['status'] ?? null,
            $validated['user_role'] ?? null
        );

        if (!$session) {
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
                $this->detectLocation($request),
                $request->userAgent(),
                $validated['app_version'] ?? null,
                $validated['user_role'] ?? null
            );
        }

        return response()->json([
            'success' => true,
            'status' => $session->computeStatus(),
            'last_seen' => $session->last_active_at?->toIso8601String(),
            'last_active' => $session->last_active_at?->toIso8601String(),
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Rename workstation or counter name.
     */
    public function rename(Request $request, string $id): JsonResponse
    {
        $session = DeviceSession::findOrFail($id);
        $validated = $request->validate([
            'counter_name' => 'nullable|string|max:100',
            'device_name' => 'nullable|string|max:100',
        ]);

        $updates = [];
        if (!empty($validated['counter_name'])) {
            $updates['counter_name'] = trim($validated['counter_name']);
        }
        if (!empty($validated['device_name'])) {
            $updates['device_name'] = trim($validated['device_name']);
        }

        if (empty($updates)) {
            return response()->json(['message' => 'No names provided to update.'], 422);
        }

        $session->update($updates);

        if ($session->counter_id && !empty($updates['counter_name'])) {
            Counter::where('id', $session->counter_id)->update(['counter_name' => $updates['counter_name']]);
        }
        if (!empty($updates['device_name'])) {
            Device::where('device_uuid', $session->device_uuid)->update(['device_name' => $updates['device_name']]);
        }

        AuditLog::log(
            'device_session_renamed',
            'DeviceSession',
            (string)$session->id,
            null,
            $updates,
            $session->store_id,
            $request->user()?->id
        );

        return response()->json([
            'success' => true,
            'message' => 'Device / Counter renamed successfully.',
            'device' => [
                'id' => (string)$session->id,
                'counter_name' => $session->counter_name,
                'device_name' => $session->device_name,
            ],
        ]);
    }

    /**
     * Lock device session.
     */
    public function lock(Request $request, string $id): JsonResponse
    {
        $session = DeviceSession::findOrFail($id);
        $session->update([
            'status' => 'locked',
        ]);

        AuditLog::log(
            'device_session_locked',
            'DeviceSession',
            (string)$session->id,
            null,
            ['device_uuid' => $session->device_uuid],
            $session->store_id,
            $request->user()?->id
        );

        return response()->json([
            'success' => true,
            'message' => "Workstation '{$session->device_name}' locked.",
            'status' => 'Locked',
        ]);
    }

    /**
     * Unlock device session.
     */
    public function unlock(Request $request, string $id): JsonResponse
    {
        $session = DeviceSession::findOrFail($id);
        $session->update([
            'status' => 'active',
            'last_active_at' => now(),
        ]);

        AuditLog::log(
            'device_session_unlocked',
            'DeviceSession',
            (string)$session->id,
            null,
            ['device_uuid' => $session->device_uuid],
            $session->store_id,
            $request->user()?->id
        );

        return response()->json([
            'success' => true,
            'message' => "Workstation '{$session->device_name}' unlocked.",
            'status' => 'Active',
        ]);
    }

    /**
     * Revoke device / counter permanently.
     */
    public function revoke(Request $request, string $id): JsonResponse
    {
        $session = DeviceSession::findOrFail($id);
        $session->update([
            'status' => 'revoked',
            'is_active' => false,
            'last_active_at' => now(),
        ]);

        if ($session->counter_id) {
            Counter::where('id', $session->counter_id)->update(['status' => 'revoked']);
        }
        Device::where('device_uuid', $session->device_uuid)->update([
            'status' => 'revoked',
            'revoke_reason' => $request->input('reason', 'Revoked from devices console'),
        ]);

        AuditLog::log(
            'device_session_revoked',
            'DeviceSession',
            (string)$session->id,
            null,
            ['device_uuid' => $session->device_uuid, 'reason' => $request->input('reason')],
            $session->store_id,
            $request->user()?->id
        );

        return response()->json([
            'success' => true,
            'message' => "Device '{$session->device_name}' revoked permanently.",
            'status' => 'Revoked',
        ]);
    }

    /**
     * Force-expire or log out an active device session.
     */
    public function forceLogout(Request $request, string $id): JsonResponse
    {
        $session = DeviceSession::findOrFail($id);
        $session->update([
            'is_active' => false,
            'status' => 'expired',
            'last_active_at' => now(),
        ]);

        AuditLog::log(
            'device_session_force_logout',
            'DeviceSession',
            (string)$session->id,
            null,
            ['device_uuid' => $session->device_uuid, 'device_name' => $session->device_name],
            $session->store_id,
            $request->user()?->id
        );

        return response()->json([
            'success' => true,
            'message' => "Session for '{$session->device_name}' terminated.",
            'status' => 'Offline',
            'is_active' => false,
        ]);
    }

    /**
     * Alias for forceLogout / expireSession.
     */
    public function expireSession(Request $request, string $id): JsonResponse
    {
        return $this->forceLogout($request, $id);
    }

    /**
     * Terminate / log out an active device session via device_uuid or session_id.
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
                'device_name' => $c->device_name ?: 'Workstation ' . $c->id,
                'counter_name' => $c->counter_name ?: 'Counter ' . $c->id,
                'counter_code' => $c->counter_code ?: null,
                'ip_address' => $c->ip_address ?: '127.0.0.1',
                'location' => $c->location_name ?: null,
                'login_time' => $c->last_seen_at ?: $c->created_at ?: now()->subMinutes(10),
                'last_active_at' => $c->last_seen_at ?: now()->subMinutes(10),
                'status' => $isRevoked ? 'revoked' : ($isActive ? 'active' : 'offline'),
                'app_version' => '2.0.20',
                'unsynced_items_count' => 0,
                'user_role' => 'Cashier',
                'is_active' => !$isRevoked,
            ]);
        }
    }
}
