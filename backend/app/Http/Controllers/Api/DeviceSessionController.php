<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceSession;
use App\Models\Store;
use App\Models\UserSession;
use App\Services\Counter\CounterPresenceService;
use App\Support\RequestTenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

class DeviceSessionController
{
    /**
     * Retrieve all logged-in devices and their real-time connection status for the store.
     */
    public function index(Request $request): JsonResponse
    {
        // G1-SEC: "all stores" is only what ScopeStore granted a person with
        // access to every store; otherwise the roster is the tenant's own store.
        $isAllStores = $request->attributes->get('store_scope_all') === true;
        $storeId = $isAllStores ? null : $this->resolveStoreId($request);

        if (!$isAllStores && $storeId === null) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_REQUIRED',
                'message' => 'store_id is required to list device sessions.',
            ], 422);
        }

        DeviceSession::expireStale($isAllStores ? null : $storeId);

        // If no device session records exist for this store yet, bootstrap from registered counters/devices
        if ($storeId && DeviceSession::where('store_id', $storeId)->count() === 0) {
            $this->bootstrapFromCounters($storeId);
        }

        $query = DeviceSession::with([
            'user:id,name,username,role,is_admin',
            'counter:id,counter_name,counter_code,location_name',
            'store:id,name,code',
        ]);

        if (!$isAllStores && $storeId) {
            $query->where('store_id', $storeId);
        }

        // Search filter
        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('device_name', 'like', "%{$search}%")
                  ->orWhere('counter_name', 'like', "%{$search}%")
                  ->orWhere('counter_code', 'like', "%{$search}%")
                  ->orWhere('ip_address', 'like', "%{$search}%")
                  ->orWhere('public_ip', 'like', "%{$search}%")
                  ->orWhere('location', 'like', "%{$search}%")
                  ->orWhere('user_role', 'like', "%{$search}%")
                  ->orWhereHas('user', function ($uq) use ($search) {
                      $uq->where('name', 'like', "%{$search}%");
                  })
                  ->orWhereHas('store', function ($sq) use ($search) {
                      $sq->where('name', 'like', "%{$search}%")
                        ->orWhere('code', 'like', "%{$search}%");
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

        $minRequiredVersion = $minSetting ? ($minSetting->value['version'] ?? '2.0.21') : '2.0.21';
        $latestSetting = CompanySetting::where('key', 'latest_desktop_release_version')->latest()->first();
        $latestVersion = $latestSetting ? ($latestSetting->value['version'] ?? '2.0.21') : '2.0.21';

        $callerPublicIp = DeviceSession::resolvePublicIp($request);

        $devices = $sessions->map(function (DeviceSession $s) use ($currentDeviceUuid, $minRequiredVersion, $latestVersion, $callerPublicIp) {
            $status = $s->computeStatus();
            $userRole = $s->user_role ?: ($s->user?->role ?: ($s->user?->is_admin ? 'Admin' : 'Cashier'));
            $appVer = $s->app_version;
            $isOutOfDate = $appVer ? version_compare($appVer, $minRequiredVersion, '<') : false;

            // Resolve public IP for this device
            $devicePublicIp = $s->public_ip;
            if (!$devicePublicIp && $s->ip_address && filter_var($s->ip_address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                $devicePublicIp = $s->ip_address;
            }
            // If this is the current caller device, backfill caller public IP
            $isThisDevice = !empty($currentDeviceUuid) && $s->device_uuid === $currentDeviceUuid;
            if (!$devicePublicIp && $isThisDevice && $callerPublicIp) {
                $devicePublicIp = $callerPublicIp;
            }

            $cleanIpv4 = $s->ip_address ? DeviceSession::normalizeIpv4($s->ip_address) : null;

            return [
                'id' => (string)$s->id,
                'session_id' => $s->session_id,
                'store_id' => (string)$s->store_id,
                'store_name' => $s->store?->name ?: null,
                'store_code' => $s->store?->code ?: null,
                'device_uuid' => $s->device_uuid,
                'device_name' => $s->device_name ?: 'Workstation',
                'counter_name' => $s->counter_name ?: 'Counter 1',
                'counter_code' => $s->counter_code ?: null,
                'user_name' => $s->user?->name ?: null,
                'user_role' => $userRole,
                'ip_address' => $cleanIpv4,
                'device_ipv4' => $cleanIpv4,
                'public_ip' => $devicePublicIp ?: null,
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
                'is_this_device' => $isThisDevice,
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

        // Count active sessions on other stores to assist multi-store users
        $otherStoresActiveCount = 0;
        $otherActiveStores = [];
        if ($storeId) {
            $otherSessions = DeviceSession::with('store:id,name,code')
                ->where('store_id', '!=', $storeId)
                ->where('is_active', true)
                ->where('last_active_at', '>=', now()->subMinutes(10))
                ->get();
            $otherStoresActiveCount = $otherSessions->count();
            $otherActiveStores = $otherSessions->map(function ($os) {
                return [
                    'store_id' => (string)$os->store_id,
                    'store_name' => $os->store?->name,
                    'store_code' => $os->store?->code,
                    'device_name' => $os->device_name,
                    'counter_name' => $os->counter_name,
                ];
            })->values()->all();
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
            'caller_public_ip' => $callerPublicIp,
            'other_stores_active_count' => $otherStoresActiveCount,
            'other_active_stores' => $otherActiveStores,
            // Backwards compatibility keys
            'online_count' => $devices->where('status', 'Active')->count(),
        ]);
    }

    /**
     * Public IP echo endpoint for client workstation self-discovery.
     */
    public function publicIp(Request $request): JsonResponse
    {
        $resolved = DeviceSession::resolvePublicIp($request);
        return response()->json([
            'success' => true,
            'ip' => $resolved ?: $request->ip(),
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
            'counter_id' => 'nullable',
            'counter_code' => 'nullable|string|max:30',
            'user_id' => 'nullable',
            'app_version' => 'nullable|string|max:30',
            'unsynced_items_count' => 'nullable|integer',
            'status' => 'nullable|string|in:Active,active,Idle,idle,Locked,locked',
            'user_role' => 'nullable|string|max:50',
            'store_id' => 'nullable',
            'public_ip' => 'nullable|string|max:45',
            'device_ipv4' => 'nullable|string|max:45',
            'local_ip' => 'nullable|string|max:45',
        ]);

        $deviceUuid = $validated['device_uuid'];
        $reportedIpv4 = $validated['device_ipv4'] ?? $validated['local_ip'] ?? null;
        $ip = $reportedIpv4 ?: $request->ip();
        $publicIp = DeviceSession::resolvePublicIp($request, $validated['public_ip'] ?? null);

        // G1-SEC: the heartbeat lands in the authenticated tenant's store only.
        $requestedStore = $validated['store_id'] ?? $request->header('X-Store-Id');
        $targetStoreId = $this->resolveStoreId($request);

        if ($requestedStore !== null && trim((string)$requestedStore) !== '' && $targetStoreId === null) {
            return response()->json([
                'success' => false,
                'valid' => false,
                'error' => 'STORE_NOT_FOUND',
                'message' => "Unknown store '{$requestedStore}'.",
            ], 404);
        }

        $counter = $this->resolveHeartbeatCounter($deviceUuid, $validated, $targetStoreId);

        $session = DeviceSession::recordHeartbeat(
            $deviceUuid,
            $ip,
            $validated['device_name'] ?? null,
            $validated['counter_name'] ?? null,
            $validated['app_version'] ?? null,
            isset($validated['unsynced_items_count']) ? (int)$validated['unsynced_items_count'] : null,
            $validated['status'] ?? null,
            $validated['user_role'] ?? null,
            $publicIp,
            $targetStoreId,
            $reportedIpv4,
            $validated['user_id'] ?? null,
            $counter?->id,
            $counter?->counter_code
        );

        if (!$session) {
            $latest = DeviceSession::where('device_uuid', $deviceUuid)
                ->orderByDesc('id')
                ->first();

            $counterStatus = $counter?->status;
            $deviceStatus = Device::where('device_uuid', $deviceUuid)->value('status');
            if ($latest?->status === 'revoked' || $counterStatus === 'revoked' || $deviceStatus === 'revoked') {
                return response()->json([
                    'success' => false,
                    'valid' => false,
                    'status' => 'revoked',
                    'action' => 'lock_and_reset',
                    'message' => 'This workstation has been revoked by the store owner.',
                ], 403);
            }

            if ($latest?->force_logged_out_at) {
                return response()->json([
                    'success' => false,
                    'valid' => false,
                    'status' => 'expired',
                    'action' => 'sign_in_required',
                    'force_logged_out' => true,
                    'reason' => $latest->force_logout_reason,
                    'message' => $latest->force_logout_reason
                        ? "This session was ended: {$latest->force_logout_reason}. Sign in again."
                        : 'This session was ended by an administrator. Sign in again.',
                ], 409);
            }

            // A signed-out workstation stays offline until someone signs in.
            // Never fabricate an active row from a bare heartbeat.
            if ($latest || !$counter || !$targetStoreId) {
                return response()->json([
                    'success' => false,
                    'valid' => false,
                    'status' => 'offline',
                    'action' => 'sign_in_required',
                    'error' => 'SESSION_NOT_ESTABLISHED',
                    'message' => 'No active workstation session. Sign in on this device to restore presence.',
                ], 409);
            }

            $session = DeviceSession::recordLogin(
                $targetStoreId,
                $deviceUuid,
                $validated['device_name'] ?? $counter->device_name,
                $counter->id,
                $validated['counter_name'] ?? $counter->counter_name,
                $counter->counter_code,
                $validated['user_id'] ?? $request->user()?->id,
                $ip,
                $counter->location_name ?: $this->detectLocation($request),
                $request->userAgent(),
                $validated['app_version'] ?? null,
                $validated['user_role'] ?? null,
                $publicIp,
                $reportedIpv4
            );

            // The first beat of a workstation is also a login, and it carries
            // the same backlog the recurring beat does (CNT-01).
            if (isset($validated['unsynced_items_count'])) {
                $session->update(['unsynced_items_count' => max(0, (int) $validated['unsynced_items_count'])]);
            }
        }

        $store = Store::find($session->store_id);
        $lastReset = AuditLog::where('store_id', $session->store_id)
            ->where('action', 'remote_store_reset')
            ->latest('id')
            ->first();

        // CNT-01: a heartbeat is the only moment the store hears from a counter,
        // so it is what the counter's presence history is built from.
        if ($counter) {
            app(CounterPresenceService::class)->beat($counter);
        }

        return response()->json([
            'success' => true,
            'status' => $session->computeStatus(),
            'store_id' => (string)$session->store_id,
            'store_active' => $store ? (bool)$store->is_active : true,
            'store_version' => $store ? (int)$store->version : 1,
            // PRF-004: the watermark the till compares against the document it
            // is working inside. A heartbeat that answers with a different one
            // is the attached counter's notice that its surface just changed.
            'permission_profile_version' => $counter
                ? (int) ($counter->permission_profile_version ?? \App\Support\Counter\CounterProfile::VERSION)
                : null,
            'last_reset_at' => $lastReset ? $lastReset->created_at->toIso8601String() : null,
            'last_reset_options' => $lastReset ? ($lastReset->new_values['options'] ?? null) : null,
            'public_ip' => $session->public_ip,
            'last_seen' => $session->last_active_at?->toIso8601String(),
            'last_active' => $session->last_active_at?->toIso8601String(),
            'timestamp' => now()->toIso8601String(),
        ]);
    }

    /**
     * Resolve the counter identity a heartbeat belongs to.
     */
    protected function resolveHeartbeatCounter(string $deviceUuid, array $validated, ?int $storeId): ?Counter
    {
        $counter = null;

        if (!empty($validated['counter_id'])) {
            $reference = $validated['counter_id'];
            $counter = is_numeric($reference)
                ? Counter::find((int)$reference)
                : Counter::where('counter_code', $reference)
                    ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
                    ->first();
        }

        if (!$counter) {
            // CNT-008: one machine can sit on a counter in several stores, so a
            // heartbeat naming only the machine must resolve within the store it
            // is beating for — never whichever counter the lookup reached first.
            $counter = Counter::where('device_uuid', $deviceUuid)
                ->when($storeId, fn ($query) => $query->where('store_id', $storeId))
                ->first();
        }

        return $counter;
    }

    /**
     * Rename workstation or counter name.
     */
    public function rename(Request $request, string $id): JsonResponse
    {
        $session = $this->findStoreSession($request, $id);
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

        if (!empty($updates['counter_name'])) {
            $conflict = Counter::nameConflict(
                (int)$session->store_id,
                $updates['counter_name'],
                $session->counter_id ? (int)$session->counter_id : null
            );
            if ($conflict) {
                return response()->json([
                    'success' => false,
                    'error' => 'COUNTER_NAME_TAKEN',
                    'message' => "Counter name '{$conflict->counter_name}' is already used by workstation "
                        . "'{$conflict->device_name}' ({$conflict->device_uuid}). Release or rename that counter first.",
                    'conflict' => [
                        'id' => (string)$conflict->id,
                        'counter_name' => $conflict->counter_name,
                        'counter_code' => $conflict->counter_code,
                        'device_uuid' => $conflict->device_uuid,
                        'device_name' => $conflict->device_name,
                        'status' => $conflict->status,
                    ],
                ], 422);
            }
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
        $session = $this->findStoreSession($request, $id);
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
        $session = $this->findStoreSession($request, $id);
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
        $session = $this->findStoreSession($request, $id);
        $session->update([
            'status' => 'revoked',
            'is_active' => false,
            'last_active_at' => now(),
        ]);

        if ($session->counter_id) {
            Counter::where('id', $session->counter_id)->update(['status' => 'revoked']);
        }
        // A query update skips the model hook, so the revocation time is stamped
        // here; a row already revoked keeps the moment it was first retired.
        Device::where('device_uuid', $session->device_uuid)
            ->where('status', '!=', 'revoked')
            ->update([
                'status' => 'revoked',
                'revoke_reason' => $request->input('reason', 'Revoked from devices console'),
                'revoked_at' => now(),
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
        $session = $this->findStoreSession($request, $id);
        $reason = $request->input('reason', 'Force-logged out by administrator');
        $session->update([
            'is_active' => false,
            'status' => 'expired',
            'last_active_at' => now(),
            'force_logged_out_at' => now(),
            'force_logout_reason' => $reason,
        ]);

        // Invalidate the credential used by that workstation. Because the
        // one-active-counter policy is account-wide, all live tokens for the
        // user are revoked; a fresh sign-in issues a new token.
        if ($session->user_id) {
            PersonalAccessToken::where('tokenable_id', $session->user_id)->delete();
            UserSession::where('user_id', $session->user_id)
                ->where('is_active', true)
                ->update(['is_active' => false, 'last_activity' => now()]);
        }

        AuditLog::log(
            'device_session_force_logout',
            'DeviceSession',
            (string)$session->id,
            null,
            [
                'device_uuid' => $session->device_uuid,
                'device_name' => $session->device_name,
                'reason' => $reason,
                'user_id' => $session->user_id,
            ],
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

        // G1-SEC: only a session of the caller's own store can be ended here.
        $inStore = DeviceSession::where('store_id', RequestTenant::requireStoreId($request))
            ->where(fn ($q) => $q->where('device_uuid', $identifier)->orWhere('session_id', $identifier))
            ->exists();
        if (!$inStore) {
            return response()->json(['success' => false, 'message' => 'No such session in this store.'], 404);
        }

        DeviceSession::recordLogout($identifier);

        return response()->json([
            'success' => true,
            'message' => 'Device session ended successfully.',
        ]);
    }

    /**
     * Resolve store ID from request header, query, or authenticated user.
     *
     * Returns null when the caller named a store that does not exist. Callers
     * must treat that as an error instead of assuming another branch.
     */
    protected function resolveStoreId(Request $request): ?int
    {
        // G1-SEC: the authenticated tenant only (device token or ScopeStore).
        return RequestTenant::storeId($request);
    }

    /** G1-SEC: a workstation session is only ever acted on inside the caller's store. */
    protected function findStoreSession(Request $request, string $id): DeviceSession
    {
        return DeviceSession::where('store_id', RequestTenant::requireStoreId($request))->findOrFail($id);
    }

    /**
     * Resolve the store that the presented device token was issued for.
     *
     * This is the tenant authority for a paired workstation: the raw token is
     * hashed the same way AuthenticateDevice does, then matched against a
     * device or counter registration.
     */
    protected function resolveStoreIdFromDeviceToken(Request $request): ?int
    {
        $token = trim((string) (
            $request->header('X-Device-Token')
            ?: $request->input('device_token', '')
        ));

        if ($token === '') {
            return null;
        }

        $hash = hash('sha256', $token);

        $device = Device::where('device_token_hash', $hash)->first()
            ?? Device::where('device_token', $token)->first();

        if ($device && $device->store_id) {
            return Store::whereKey((int)$device->store_id)->exists() ? (int)$device->store_id : null;
        }

        $counter = Counter::where('device_token_hash', $hash)->first()
            ?? Counter::where('device_token', $token)->first();

        if ($counter && $counter->store_id) {
            return Store::whereKey((int)$counter->store_id)->exists() ? (int)$counter->store_id : null;
        }

        return null;
    }

    /**
     * Strictly resolve a numeric store id or store code. Never guesses.
     */
    protected function resolveStoreValue(mixed $storeParam): ?int
    {
        $value = trim((string)$storeParam);
        if ($value === '' || strtolower($value) === 'all') {
            return null;
        }

        if (is_numeric($value)) {
            return Store::whereKey((int)$value)->exists() ? (int)$value : null;
        }

        $store = Store::where('code', $value)->first();
        return $store ? (int)$store->id : null;
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
                'app_version' => null,
                'unsynced_items_count' => 0,
                'user_role' => 'Cashier',
                'is_active' => !$isRevoked,
            ]);
        }
    }
}
