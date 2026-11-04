<?php

namespace App\Http\Controllers\Api;

use App\Models\ActivationKey;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceActivationAttempt;
use App\Models\DeviceSession;
use App\Models\Store;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AuthController
{
    /**
     * Authenticate staff or owner credentials securely.
     */
    public function login(Request $request): JsonResponse
    {
        $adminAuthController = app(AdminAuthController::class);
        return $adminAuthController->login($request);
    }

    /**
     * Register a workstation counter device via server-verified Activation Key.
     */
    public function registerDevice(Request $request): JsonResponse
    {
        $rawActivationKey = (string)$request->input('activation_key');
        $deviceUuid = (string)$request->input('device_uuid', '');
        $deviceName = (string)$request->input('device_name', 'Counter Station');
        $isHub = (bool)$request->input('is_hub', false);
        $clientIp = substr($request->ip() ?: '127.0.0.1', 0, 45);

        // 1. Basic format / requirement validation
        if (empty(trim($deviceUuid))) {
            return response()->json(['message' => 'Device UUID is required.'], 422);
        }

        if (empty(trim($rawActivationKey)) || strlen(trim($rawActivationKey)) < 6) {
            DeviceActivationAttempt::create([
                'ip_address' => $clientIp,
                'device_uuid' => $deviceUuid,
                'device_name' => $deviceName,
                'attempted_key_prefix' => substr($rawActivationKey, 0, 10),
                'success' => false,
                'failure_reason' => 'malformed_key',
            ]);

            return response()->json(['message' => 'Invalid, expired, or revoked activation key.'], 422);
        }

        // 2. Rate limiting & Brute-force lockout (per IP and per device)
        $recentFailures = DeviceActivationAttempt::countRecentFailures($clientIp, $deviceUuid, 15);
        if ($recentFailures >= 5) {
            AuditLog::log(
                'activation_lockout_triggered',
                'Device',
                $deviceUuid,
                null,
                [
                    'ip' => $clientIp,
                    'device_uuid' => $deviceUuid,
                    'recent_failures' => $recentFailures,
                    'reason' => 'rate_limit_exceeded',
                ],
                null
            );

            return response()->json([
                'message' => 'Too many failed activation attempts. Workstation enrollment is temporarily locked. An alert has been sent to the store owner.',
                'locked' => true,
            ], 429);
        }

        // 3. Activation key lookup by SHA-256 hash
        $keyHash = ActivationKey::hashKey($rawActivationKey);
        $activationKey = ActivationKey::where('key_hash', $keyHash)->first();

        // Fallback: check legacy stores.activation_key and auto-migrate if valid
        if (!$activationKey) {
            $legacyStore = Store::where('activation_key', trim($rawActivationKey))->first();
            if ($legacyStore) {
                $activationKey = ActivationKey::create([
                    'store_id' => $legacyStore->id,
                    'key_hash' => $keyHash,
                    'key_prefix' => substr($rawActivationKey, 0, 12) . '****',
                    'max_devices' => 5,
                    'devices_activated_count' => 0,
                    'is_single_use' => false,
                    'expires_at' => now()->addYear(),
                    'is_revoked' => !$legacyStore->is_active,
                ]);
            }
        }

        // 4. Verify validity: key must exist, be unrevoked, unexpired, within device limit, and store active
        if (!$activationKey || !$activationKey->isValid()) {
            DeviceActivationAttempt::create([
                'ip_address' => $clientIp,
                'device_uuid' => $deviceUuid,
                'device_name' => $deviceName,
                'attempted_key_prefix' => substr($rawActivationKey, 0, 10),
                'store_id' => $activationKey?->store_id,
                'success' => false,
                'failure_reason' => $activationKey ? ($activationKey->is_revoked ? 'revoked' : ($activationKey->expires_at && $activationKey->expires_at->isPast() ? 'expired' : 'limit_reached')) : 'not_found',
            ]);

            AuditLog::log(
                'device_activation_failed',
                'Device',
                $deviceUuid,
                null,
                [
                    'ip' => $clientIp,
                    'device_uuid' => $deviceUuid,
                    'device_name' => $deviceName,
                    'key_prefix' => substr($rawActivationKey, 0, 8) . '****',
                    'reason' => 'invalid_or_expired_key',
                ],
                $activationKey?->store_id
            );

            // Generic error message to prevent enumeration or status probing
            return response()->json(['message' => 'Invalid, expired, or revoked activation key.'], 422);
        }

        $store = $activationKey->store;
        if (!$store || !$store->is_active) {
            DeviceActivationAttempt::create([
                'ip_address' => $clientIp,
                'device_uuid' => $deviceUuid,
                'device_name' => $deviceName,
                'store_id' => $store?->id,
                'success' => false,
                'failure_reason' => 'store_inactive',
            ]);

            return response()->json(['message' => 'Invalid, expired, or revoked activation key.'], 422);
        }

        // 5. Successful validation - Determine device approval status
        $status = $store->require_device_approval ? 'pending_approval' : 'active';

        // 6. Generate cryptographically secure device token and hash
        $rawDeviceToken = 'lsd_' . Str::random(48);
        $deviceTokenHash = hash('sha256', $rawDeviceToken);
        $rawRefreshToken = 'ref_' . Str::random(48);

        // Derive counter code
        $num = preg_replace('/[^0-9]/', '', $deviceName);
        $counterCode = $num ? 'C' . str_pad($num, 2, '0', STR_PAD_LEFT) : 'C01';

        // 7. Persist device record
        $device = Device::updateOrCreate(
            ['device_uuid' => $deviceUuid],
            [
                'store_id' => $store->id,
                'device_name' => $deviceName,
                'device_token' => $rawDeviceToken,
                'device_token_hash' => $deviceTokenHash,
                'registered_via' => 'activation_key',
                'activation_key_id' => $activationKey->id,
                'status' => $status,
                'ip_address' => $clientIp,
                'app_version' => $request->input('app_version', '2.0.0'),
                'approved_at' => $status === 'active' ? now() : null,
                'last_seen_at' => now(),
            ]
        );

        // 8. Persist counter record with conflict-free matching
        $counter = $this->resolveCounterForDevice(
            $store,
            $deviceUuid,
            $deviceName,
            $counterCode,
            $request->input('location_name', 'Workstation Desk'),
            $isHub,
            $status,
            $clientIp,
            $rawDeviceToken,
            $deviceTokenHash
        );

        $device->update(['counter_id' => (string)$counter->id]);

        // 9. Increment activation count on key
        $activationKey->incrementActivation();

        // 10. Record successful attempt and audit log
        DeviceActivationAttempt::create([
            'ip_address' => $clientIp,
            'device_uuid' => $deviceUuid,
            'device_name' => $deviceName,
            'attempted_key_prefix' => $activationKey->key_prefix,
            'store_id' => $store->id,
            'success' => true,
        ]);

        $publicIp = DeviceSession::resolvePublicIp($request, $request->input('public_ip'));

        DeviceSession::recordLogin(
            $store->id,
            $deviceUuid,
            $deviceName,
            $counter->id,
            $counter->counter_name,
            $counter->counter_code,
            null,
            $clientIp,
            $counter->location_name,
            $request->userAgent(),
            $request->input('app_version', '2.0.31'),
            'Cashier',
            $publicIp
        );

        AuditLog::log(
            'device_activated',
            'Device',
            (string)$device->id,
            null,
            [
                'device_uuid' => $deviceUuid,
                'device_name' => $deviceName,
                'counter_code' => $counter->counter_code,
                'status' => $status,
                'key_prefix' => $activationKey->key_prefix,
                'registered_via' => 'activation_key',
            ],
            $store->id
        );

        $hasAdminStaff = User::where('store_id', $store->id)
            ->whereIn('role', ['admin', 'store_owner', 'super_admin'])
            ->exists();

        return response()->json([
            'success' => true,
            'device_id' => 'dev_' . $device->id,
            'counter_id' => 'cntr_' . $counter->id,
            'counter_name' => $counter->counter_name,
            'counter_code' => $counter->counter_code,
            'store_id' => (string)$store->id,
            'store_name' => $store->name,
            'store_code' => $store->code,
            'is_hub' => (bool)$counter->is_hub,
            'device_token' => $rawDeviceToken,
            'refresh_token' => $rawRefreshToken,
            'license_plan' => $store->license_plan ?? 'Enterprise Retail & Pharmacy Chain',
            'license_status' => $store->is_active ? 'active' : 'revoked',
            'license_expires_at' => $store->license_expires_at ? ($store->license_expires_at instanceof \Carbon\CarbonInterface ? $store->license_expires_at->toDateString() : (string)$store->license_expires_at) : '2027-12-31',
            'status' => $status,
            'requires_approval' => $status === 'pending_approval',
            'admin_staff_present' => $hasAdminStaff,
            'registered_at' => $device->created_at ? $device->created_at->toIso8601String() : now()->toIso8601String(),
        ]);
    }

    /**
     * Register a workstation device via authenticated Store Owner / Admin account with 2FA.
     */
    public function registerDeviceWithOwner(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
            'store_id' => 'required',
            'device_uuid' => 'required|string',
            'device_name' => 'required|string',
            'totp_code' => 'nullable|string',
            'is_hub' => 'nullable|boolean',
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            AuditLog::log(
                'device_owner_login_failed',
                'User',
                $user ? (string)$user->id : 'unknown',
                null,
                ['email' => $validated['email'], 'ip' => $request->ip(), 'reason' => 'bad_credentials'],
                null
            );

            return response()->json(['message' => 'Invalid email or password.'], 401);
        }

        if ($user->locked_until && $user->locked_until->isFuture()) {
            return response()->json(['message' => 'Account is temporarily locked. Try again later.'], 423);
        }

        // Verify 2FA TOTP if enabled on user account
        if ($user->totp_enabled) {
            $totpCode = $validated['totp_code'] ?? null;
            if (empty($totpCode)) {
                return response()->json([
                    'requires_2fa' => true,
                    'message' => 'Two-factor authentication code required.',
                ], 200);
            }

            $adminAuth = app(AdminAuthController::class);
            if (!$adminAuth->verifyTotpSecret($user->totp_secret, $totpCode)) {
                return response()->json(['message' => 'Invalid two-factor authentication code.'], 422);
            }
        }

        // Find and authorize target store
        $store = is_numeric($validated['store_id'])
            ? Store::find($validated['store_id'])
            : Store::where('code', $validated['store_id'])->first();

        if (!$store || !$store->is_active) {
            return response()->json(['message' => 'Store not found or deactivated.'], 404);
        }

        // Verify authorization for this store
        $allowed = $user->allowed_store_ids ?? [];
        if ($user->store_id) {
            $allowed[] = (string)$user->store_id;
        }

        $isAuthorized = $user->isSuperAdmin() || in_array((string)$store->id, array_map('strval', $allowed));
        if (!$isAuthorized) {
            return response()->json(['message' => 'Access denied: account not authorized for this store.'], 403);
        }

        // Generate tokens
        $rawDeviceToken = 'lsd_' . Str::random(48);
        $deviceTokenHash = hash('sha256', $rawDeviceToken);
        $rawRefreshToken = 'ref_' . Str::random(48);

        $deviceName = $validated['device_name'];
        $num = preg_replace('/[^0-9]/', '', $deviceName);
        $counterCode = $num ? 'C' . str_pad($num, 2, '0', STR_PAD_LEFT) : 'C01';

        $clientIp = substr($request->ip() ?: '127.0.0.1', 0, 45);

        $device = Device::updateOrCreate(
            ['device_uuid' => $validated['device_uuid']],
            [
                'store_id' => $store->id,
                'device_name' => $deviceName,
                'device_token' => $rawDeviceToken,
                'device_token_hash' => $deviceTokenHash,
                'registered_via' => 'owner_login',
                'status' => 'active',
                'approved_at' => now(),
                'approved_by' => $user->id,
                'ip_address' => $clientIp,
                'last_seen_at' => now(),
            ]
        );

        $counter = $this->resolveCounterForDevice(
            $store,
            $validated['device_uuid'],
            $deviceName,
            $counterCode,
            'Owner Provisioned Counter',
            (bool)($validated['is_hub'] ?? false),
            'active',
            $clientIp,
            $rawDeviceToken,
            $deviceTokenHash,
            $user->id
        );

        $device->update(['counter_id' => (string)$counter->id]);

        $publicIp = DeviceSession::resolvePublicIp($request, $request->input('public_ip'));

        DeviceSession::recordLogin(
            $store->id,
            $validated['device_uuid'],
            $device->device_name,
            $counter->id,
            $counter->counter_name,
            $counter->counter_code,
            $user->id,
            $clientIp,
            $counter->location_name,
            $request->userAgent(),
            $request->input('app_version', '2.0.31'),
            $user->role ?: 'Store Owner',
            $publicIp
        );

        AuditLog::log(
            'device_activated_by_owner',
            'Device',
            (string)$device->id,
            null,
            ['user_id' => $user->id, 'store_id' => $store->id, 'device_uuid' => $validated['device_uuid']],
            $store->id,
            $user->id
        );

        return response()->json([
            'success' => true,
            'device_id' => 'dev_' . $device->id,
            'counter_id' => 'cntr_' . $counter->id,
            'counter_name' => $counter->counter_name,
            'counter_code' => $counter->counter_code,
            'store_id' => (string)$store->id,
            'store_name' => $store->name,
            'store_code' => $store->code,
            'is_hub' => (bool)$counter->is_hub,
            'device_token' => $rawDeviceToken,
            'refresh_token' => $rawRefreshToken,
            'license_plan' => $store->license_plan ?? 'Enterprise Retail & Pharmacy Chain',
            'license_status' => $store->is_active ? 'active' : 'revoked',
            'license_expires_at' => $store->license_expires_at ? ($store->license_expires_at instanceof \Carbon\CarbonInterface ? $store->license_expires_at->toDateString() : (string)$store->license_expires_at) : '2027-12-31',
            'status' => 'active',
            'admin_staff_present' => true,
            'registered_at' => $device->created_at ? $device->created_at->toIso8601String() : now()->toIso8601String(),
        ]);
    }

    /**
     * Validate device token on workstation launch and periodic heartbeat.
     */
    public function validateToken(Request $request): JsonResponse
    {
        $token = $request->header('X-Device-Token') ?: $request->input('device_token');
        $deviceUuid = $request->header('X-Device-UUID') ?: $request->input('device_uuid');

        if (empty($token)) {
            return response()->json([
                'valid' => false,
                'status' => 'unrecognized',
                'action' => 'lock_and_reset',
                'message' => 'Missing device token.',
            ], 401);
        }

        $tokenHash = hash('sha256', trim($token));

        // Lookup in devices table
        $device = Device::where('device_token_hash', $tokenHash)
            ->orWhere('device_token', $token)
            ->first();

        // Also check counters table
        $counter = null;
        if (!$device) {
            $counter = Counter::where('device_token_hash', $tokenHash)
                ->orWhere('device_token', $token)
                ->first();
            if ($counter) {
                $device = Device::where('device_uuid', $counter->device_uuid)->first();
            }
        }

        if (!$device && !$counter) {
            return response()->json([
                'valid' => false,
                'status' => 'unrecognized',
                'action' => 'lock_and_reset',
                'message' => 'Device token is unrecognized or expired.',
            ], 401);
        }

        $status = $device ? $device->status : $counter->status;
        $store = $device ? $device->store : $counter->store;

        if (!$store || !$store->is_active) {
            return response()->json([
                'valid' => false,
                'status' => 'store_inactive',
                'action' => 'lock_and_reset',
                'message' => 'Store license is suspended or deactivated.',
            ], 403);
        }

        if ($status === 'revoked') {
            return response()->json([
                'valid' => false,
                'status' => 'revoked',
                'action' => 'lock_and_reset',
                'message' => 'This workstation device authorization has been revoked by store owner.',
                'reason' => $device?->revoke_reason ?? $counter?->revoke_reason ?? 'Revoked by owner',
            ], 403);
        }

        if ($status === 'pending_approval') {
            return response()->json([
                'valid' => false,
                'status' => 'pending_approval',
                'action' => 'wait_for_approval',
                'message' => 'Workstation is pending approval from store owner.',
            ], 200);
        }

        // Active and verified: update heartbeat
        if ($device) {
            $device->update([
                'last_seen_at' => now(),
                'ip_address' => $request->ip(),
            ]);
        }
        if ($counter) {
            $counter->update([
                'last_seen_at' => now(),
                'ip_address' => $request->ip(),
            ]);
        }

        $activeUuid = $device?->device_uuid ?: $counter?->device_uuid ?: $deviceUuid;
        if ($activeUuid) {
            DeviceSession::recordHeartbeat(
                $activeUuid,
                $request->ip(),
                $device?->device_name,
                $counter?->counter_name
            );
        }

        return response()->json([
            'valid' => true,
            'status' => 'active',
            'store_id' => (string)$store->id,
            'store_name' => $store->name,
            'store_code' => $store->code,
            'device_id' => $device ? 'dev_' . $device->id : 'cntr_' . $counter->id,
            'wipe_on_revocation' => (bool)$store->wipe_on_revocation,
        ]);
    }

    /**
     * Get active store branches.
     */
    public function branches(): JsonResponse
    {
        $stores = Store::where('is_active', true)
            ->get()
            ->map(function ($s) {
                return [
                    'id' => (string)$s->id,
                    'name' => $s->name,
                    'code' => $s->code,
                    'phone' => $s->phone ?? '',
                    'email' => $s->email,
                    'address' => $s->address ?? '',
                    'city' => $s->address ? (trim(explode(',', $s->address)[0]) ?? '') : '',
                    'state_code' => $s->state_code ?? '32',
                    'gstin' => $s->gstin ?? '',
                    'drug_license_numbers' => $s->drug_license_numbers ?? [],
                    'fssai_no' => $s->fssai_no,
                    'is_main' => $s->code === 'MAIN' || $s->code === 'STORE-01',
                    'is_active' => (bool)$s->is_active,
                ];
            });

        return response()->json(['data' => $stores]);
    }

    /**
     * Check license status for store.
     */
    public function checkLicense(Request $request): JsonResponse
    {
        $token = $request->header('X-Device-Token') ?: $request->input('device_token');
        if (!empty($token)) {
            $tokenHash = hash('sha256', trim($token));
            $device = Device::where('device_token_hash', $tokenHash)->first();
            if ($device && $device->store) {
                $store = $device->store;
                return response()->json([
                    'valid' => $store->is_active && $device->status === 'active',
                    'status' => $device->status === 'active' ? ($store->is_active ? 'active' : 'revoked') : $device->status,
                    'license_plan' => $store->license_plan ?? 'Enterprise Retail & Pharmacy Chain',
                    'license_expires_at' => $store->license_expires_at ? $store->license_expires_at->toIso8601String() : '2027-12-31T23:59:59Z',
                    'features' => ['pos', 'purchases', 'stock', 'reports', 'multi_counter', 'lan_sync'],
                ]);
            }
        }

        // Default platform licensing feature query
        return response()->json([
            'valid' => true,
            'status' => 'active',
            'license_plan' => 'Enterprise Retail & Pharmacy Chain',
            'license_expires_at' => '2027-12-31T23:59:59Z',
            'features' => ['pos', 'purchases', 'stock', 'reports', 'multi_counter', 'lan_sync'],
        ]);
    }

    /**
     * Resolve or allocate a counter record without violating unique constraints.
     */
    protected function resolveCounterForDevice(
        Store $store,
        string $deviceUuid,
        string $deviceName,
        string $counterCode,
        string $locationName,
        bool $isHub,
        string $status,
        string $clientIp,
        string $rawDeviceToken,
        string $deviceTokenHash,
        ?int $approvedByUserId = null
    ): Counter {
        // 1. Locate existing counter by device_uuid within store
        $counter = Counter::where('store_id', $store->id)
            ->where('device_uuid', $deviceUuid)
            ->first();

        // 2. If not found by device_uuid, match by (store_id, counter_code)
        if (!$counter) {
            $counter = Counter::where('store_id', $store->id)
                ->where('counter_code', $counterCode)
                ->first();
        }

        // 3. Clear this device_uuid from any other counter in the system to avoid global unique violation
        Counter::where('device_uuid', $deviceUuid)
            ->when($counter, fn($q) => $q->where('id', '!=', $counter->id))
            ->update(['device_uuid' => null]);

        // 4. If no existing counter found, allocate a unique counter code if requested is taken
        if (!$counter) {
            $codeCandidate = $counterCode;
            $counterNum = 2;
            while (Counter::where('store_id', $store->id)->where('counter_code', $codeCandidate)->exists()) {
                $codeCandidate = sprintf('C%02d', $counterNum++);
            }
            $counterCode = $codeCandidate;

            $counter = Counter::create([
                'store_id' => $store->id,
                'counter_code' => $counterCode,
                'counter_name' => $deviceName,
                'device_name' => $deviceName,
                'location_name' => $locationName,
                'is_hub' => $isHub,
                'status' => $status,
                'ip_address' => $clientIp,
                'device_uuid' => $deviceUuid,
                'device_token' => $rawDeviceToken,
                'device_token_hash' => $deviceTokenHash,
                'approved_at' => $status === 'active' ? now() : null,
                'approved_by' => $approvedByUserId,
                'last_seen_at' => now(),
            ]);
        } else {
            $counter->update([
                'counter_name' => $deviceName,
                'device_name' => $deviceName,
                'location_name' => $locationName ?: $counter->location_name,
                'is_hub' => $isHub,
                'status' => $status,
                'ip_address' => $clientIp,
                'device_uuid' => $deviceUuid,
                'device_token' => $rawDeviceToken,
                'device_token_hash' => $deviceTokenHash,
                'approved_at' => $status === 'active' ? ($counter->approved_at ?: now()) : null,
                'approved_by' => $approvedByUserId ?? $counter->approved_by,
                'last_seen_at' => now(),
            ]);
        }

        return $counter;
    }
}
