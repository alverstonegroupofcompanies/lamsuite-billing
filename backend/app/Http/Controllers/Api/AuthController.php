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

        // CNT-011: the counter is read on every handshake, not only when no
        // device matched. A claim writes its token to both rows, so a device
        // row that still says "active" must never speak for a revoked counter.
        $counter = Counter::where('device_token_hash', $tokenHash)
            ->orWhere('device_token', $token)
            ->first()
            ?? ($device?->counter_id ? Counter::find($device->counter_id) : null);

        if (!$device && $counter) {
            // CNT-008: the machine may be registered in other stores; this
            // counter only ever speaks for its own store's device row.
            $device = Device::where('store_id', $counter->store_id)
                ->where('device_uuid', $counter->device_uuid)
                ->first();
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

        // CNT-011: this is the connection a revoked counter is locked on. The
        // answer refuses without repeating the credential it was given.
        if ($counter && $counter->isRevoked()) {
            return response()->json([
                'valid' => false,
                'status' => 'revoked',
                'action' => 'lock_and_reset',
                'message' => 'This counter has been retired by the store owner.',
                'reason' => $counter->revoke_reason ?? 'Revoked by owner',
            ], 403);
        }

        // A lock pauses a counter; wiping the claim would turn a pause into a
        // re-provisioning the owner never asked for.
        if ($counter && $counter->status === Counter::STATUS_LOCKED) {
            return response()->json([
                'valid' => false,
                'status' => 'locked',
                'action' => 'counter_locked',
                'message' => 'This counter is locked by the store owner. Connect again once it is unlocked.',
            ], 403);
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

        $answered = [
            'valid' => true,
            'status' => 'active',
            'store_id' => (string)$store->id,
            'store_name' => $store->name,
            'store_code' => $store->code,
            'device_id' => $device ? 'dev_' . $device->id : 'cntr_' . $counter->id,
            'wipe_on_revocation' => (bool)$store->wipe_on_revocation,
            // CNT-011: every clean handshake is a renewal. The till re-arms its
            // offline window from this deadline instead of trusting its own calendar.
            'server_time' => now()->toIso8601String(),
        ];

        if ($counter) {
            $answered['offline'] = $counter->offlinePayload();
        }

        return response()->json($answered);
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
        $storeCandidate = $request->header('X-Store-Id') ?: $request->header('Store-Id') ?: $request->query('store_id');
        if (!empty($storeCandidate)) {
            $store = is_numeric($storeCandidate) ? Store::find((int)$storeCandidate) : Store::where('code', $storeCandidate)->first();
            if ($store) {
                $lastReset = \App\Models\AuditLog::where('store_id', $store->id)
                    ->where('action', 'remote_store_reset')
                    ->latest('id')
                    ->first();
                return response()->json([
                    'valid' => (bool)$store->is_active,
                    'is_active' => (bool)$store->is_active,
                    'status' => $store->is_active ? 'active' : 'disabled',
                    'store_version' => (int)$store->version,
                    'last_reset_at' => $lastReset ? $lastReset->created_at->toIso8601String() : null,
                    'last_reset_options' => $lastReset ? ($lastReset->new_values['options'] ?? null) : null,
                    'license_plan' => $store->license_plan ?? 'Enterprise Retail & Pharmacy Chain',
                    'license_expires_at' => $store->license_expires_at ? $store->license_expires_at->toIso8601String() : '2027-12-31T23:59:59Z',
                    'features' => ['pos', 'purchases', 'stock', 'reports', 'multi_counter', 'lan_sync'],
                ]);
            }
        }

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

}
