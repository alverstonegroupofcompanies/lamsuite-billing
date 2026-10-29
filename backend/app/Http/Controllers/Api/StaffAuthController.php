<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\DeviceSession;
use App\Models\Store;
use App\Models\User;
use App\Models\UserSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class StaffAuthController
{
    /**
     * Authenticate store staff member at terminal via PIN or Password.
     * Enforces strict user ID lookup, store & counter scoping, and generic client errors.
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required',
            'user_id' => 'nullable',
            'username' => 'nullable|string',
            'pin' => 'nullable|string',
            'password' => 'nullable|string',
            'counter_id' => 'nullable',
        ]);

        if (empty($validated['pin']) && empty($validated['password'])) {
            return response()->json(['message' => 'Either PIN or password is required.'], 422);
        }

        // Find store
        $storeId = $validated['store_id'];
        $store = is_numeric($storeId)
            ? Store::find($storeId)
            : Store::where('code', $storeId)->first();

        if (!$store) {
            return response()->json(['message' => 'Store not found.'], 404);
        }

        if (!$store->is_active) {
            return response()->json([
                'message' => 'This store is currently disabled by administrator.',
                'store_disabled' => true,
            ], 403);
        }

        // 1. Strict User Resolution: prefer user_id, fallback to exact username/email
        $user = null;
        if (!empty($validated['user_id'])) {
            $user = User::find($validated['user_id']);
        } elseif (!empty($validated['username'])) {
            $identifier = trim($validated['username']);
            $user = User::where('username', $identifier)
                ->orWhere('email', $identifier)
                ->first();
        }

        if (!$user) {
            AuditLog::log(
                'staff_login_failed',
                'User',
                null,
                null,
                [
                    'reason' => 'user_not_found',
                    'identifier' => $validated['user_id'] ?? $validated['username'] ?? 'unknown',
                    'store_id' => $store->id,
                    'counter_id' => $validated['counter_id'] ?? null,
                ],
                $store->id
            );
            return response()->json(['message' => 'Invalid credentials.'], 401);
        }

        // 2. Strict Store Scoping: verify user has access to this store
        if (!$user->canAccessStore($store->id)) {
            AuditLog::log(
                'staff_login_failed',
                'User',
                (string)$user->id,
                null,
                [
                    'reason' => 'wrong_store',
                    'user_id' => $user->id,
                    'user_store_id' => $user->store_id,
                    'attempted_store_id' => $store->id,
                    'counter_id' => $validated['counter_id'] ?? null,
                ],
                $store->id,
                $user->id
            );
            return response()->json(['message' => 'Invalid credentials.'], 401);
        }

        // 3. Counter Scoping & Status Check
        $counter = null;
        if (!empty($validated['counter_id'])) {
            $counterIdentifier = trim((string)$validated['counter_id']);
            $counter = Counter::where('store_id', $store->id)
                ->where(function ($q) use ($counterIdentifier) {
                    $q->where('counter_code', $counterIdentifier)
                      ->orWhere('counter_name', $counterIdentifier);
                    if (is_numeric($counterIdentifier)) {
                        $q->orWhere('id', (int)$counterIdentifier);
                    }
                })->first();

            if ($counter) {
                if ($counter->status === 'revoked') {
                    AuditLog::log('staff_login_failed', 'User', (string)$user->id, null, [
                        'reason' => 'counter_revoked',
                        'counter_id' => $counter->id,
                        'counter_code' => $counter->counter_code,
                    ], $store->id, $user->id);
                    return response()->json(['message' => 'This terminal has been revoked by store administrator.'], 403);
                }

                if ($counter->status === 'locked') {
                    AuditLog::log('staff_login_failed', 'User', (string)$user->id, null, [
                        'reason' => 'counter_locked',
                        'counter_id' => $counter->id,
                        'counter_code' => $counter->counter_code,
                    ], $store->id, $user->id);
                    return response()->json(['message' => 'This terminal is temporarily locked.'], 423);
                }

                // If allowed_user_ids is configured, check assignment (Super Admin bypasses)
                if (!$user->isSuperAdmin() && !empty($counter->allowed_user_ids) && is_array($counter->allowed_user_ids)) {
                    $allowed = array_map('strval', $counter->allowed_user_ids);
                    if (!in_array((string)$user->id, $allowed, true)) {
                        AuditLog::log('staff_login_failed', 'User', (string)$user->id, null, [
                            'reason' => 'counter_not_allowed',
                            'counter_id' => $counter->id,
                            'counter_code' => $counter->counter_code,
                            'user_id' => $user->id,
                        ], $store->id, $user->id);
                        return response()->json(['message' => 'Invalid credentials.'], 401);
                    }
                }
            }
        }

        // 4. Check Lockout State strictly on this user
        if ($user->locked_until) {
            if ($user->locked_until->isPast()) {
                // Auto-clear expired lockout
                $user->update(['locked_until' => null, 'failed_login_attempts' => 0]);
            } elseif (!empty($validated['password']) && Hash::check($validated['password'], $user->password)) {
                // Master account password unlocks the account immediately
                $user->update(['locked_until' => null, 'failed_login_attempts' => 0]);
            } else {
                $remainingMinutes = (int) ceil(now()->diffInSeconds($user->locked_until) / 60);
                AuditLog::log('staff_login_failed', 'User', (string)$user->id, null, [
                    'reason' => 'account_locked',
                    'locked_until' => $user->locked_until->toIso8601String(),
                    'store_id' => $store->id,
                    'counter_id' => $validated['counter_id'] ?? null,
                ], $store->id, $user->id);

                return response()->json([
                    'message' => 'Account is temporarily locked due to consecutive failed attempts. Please try again later or contact your administrator.',
                    'locked' => true,
                    'locked_until' => $user->locked_until->toIso8601String(),
                ], 423);
            }
        }

        // 5. Credential Verification
        $isValid = false;
        $failReason = 'invalid_credentials';

        if (!empty($validated['pin'])) {
            if (empty($user->pin_hash)) {
                $isValid = false;
                $failReason = 'no_pin_configured';
            } else {
                $isValid = Hash::check($validated['pin'], $user->pin_hash);
                if (!$isValid) {
                    $failReason = 'wrong_pin';
                }
            }
        } elseif (!empty($validated['password'])) {
            if (Hash::check($validated['password'], $user->password)) {
                $isValid = true;
            } elseif (!empty($user->pin_hash) && Hash::check($validated['password'], $user->pin_hash)) {
                $isValid = true;
            } else {
                $failReason = 'wrong_password';
            }
        }

        // 6. Handle Failed Attempt strictly on this user
        if (!$isValid) {
            $user->increment('failed_login_attempts');
            $maxAttempts = $user->max_failed_logins ?? 5;

            if ($user->failed_login_attempts >= $maxAttempts) {
                $user->update([
                    'locked_until' => now()->addMinutes(15),
                    'failed_login_attempts' => 0,
                ]);

                AuditLog::log(
                    'staff_account_locked',
                    'User',
                    (string)$user->id,
                    null,
                    [
                        'reason' => 'max_failed_attempts_exceeded',
                        'last_fail_reason' => $failReason,
                        'store_id' => $store->id,
                        'counter_id' => $validated['counter_id'] ?? null,
                    ],
                    $store->id,
                    $user->id
                );

                return response()->json([
                    'message' => 'Account is temporarily locked due to consecutive failed attempts. Please try again later or contact your administrator.',
                    'locked' => true,
                    'locked_until' => now()->addMinutes(15)->toIso8601String(),
                ], 423);
            }

            $remaining = $maxAttempts - $user->failed_login_attempts;

            AuditLog::log(
                'staff_login_failed',
                'User',
                (string)$user->id,
                null,
                [
                    'reason' => $failReason,
                    'remaining_attempts' => $remaining,
                    'store_id' => $store->id,
                    'counter_id' => $validated['counter_id'] ?? null,
                ],
                $store->id,
                $user->id
            );

            return response()->json([
                'message' => "Invalid credentials. {$remaining} attempt(s) remaining.",
                'remaining_attempts' => $remaining,
            ], 401);
        }

        // 7. Successful Validation: reset failed attempts on this user
        $user->update([
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);

        $token = $user->createToken('staff_session_token')->plainTextToken;

        UserSession::create([
            'user_id' => $user->id,
            'ip_address' => $request->ip(),
            'user_agent' => substr($request->userAgent() ?? '', 0, 255),
            'last_activity' => now(),
            'is_active' => true,
        ]);

        $deviceUuid = $request->header('X-Device-UUID')
            ?: $request->input('device_uuid')
            ?: ($counter?->device_uuid ?: ('dev_counter_' . ($counter?->id ?: 'main')));

        $deviceName = $request->input('device_name') ?: ($counter?->device_name ?: null);

        DeviceSession::recordLogin(
            $store->id,
            $deviceUuid,
            $deviceName,
            $counter?->id,
            $counter?->counter_name,
            $counter?->counter_code,
            $user->id,
            $request->ip(),
            $counter?->location_name,
            $request->userAgent()
        );

        AuditLog::log(
            'staff_login_success',
            'User',
            (string)$user->id,
            null,
            ['store_id' => $store->id, 'counter_id' => $validated['counter_id'] ?? null],
            $store->id,
            $user->id
        );

        return response()->json([
            'success' => true,
            'token' => $token,
            'user' => [
                'id' => (string)$user->id,
                'name' => $user->name,
                'username' => $user->username ?? explode('@', $user->email)[0],
                'role' => $user->role,
                'permissions' => $user->permissions ?? ['*'],
                'enabled_menus' => $user->enabled_menus ?? ['pos', 'bills'],
                'must_change_password' => (bool)$user->must_change_password,
                'has_pin' => !empty($user->pin_hash),
                'store_id' => (string)$store->id,
            ],
            'store' => [
                'id' => (string)$store->id,
                'name' => $store->name,
                'code' => $store->code,
                'tax_mode' => $store->tax_mode,
            ],
        ]);
    }

    /**
     * Download active staff credentials (salted hashes) for local offline authentication fallback.
     */
    public function offlineCache(Request $request): JsonResponse
    {
        $storeId = $request->header('X-Store-Id') ?: $request->query('store_id', 1);

        $store = is_numeric($storeId)
            ? Store::find($storeId)
            : Store::where('code', $storeId)->first();

        if (!$store) {
            return response()->json(['error' => 'Store not found'], 404);
        }

        $users = User::where('store_id', $store->id)
            ->orWhereNull('store_id')
            ->orWhereJsonContains('allowed_store_ids', (int)$store->id)
            ->orWhereJsonContains('allowed_store_ids', (string)$store->id)
            ->get();

        $staffData = $users->map(function (User $u) use ($store) {
            $isLocked = !empty($u->locked_until) && $u->locked_until->isFuture();
            return [
                'id' => (string)$u->id,
                'store_id' => (string)$store->id,
                'username' => $u->username ?? explode('@', $u->email)[0],
                'full_name' => $u->name,
                'role' => $u->role,
                'password_hash' => $u->password,
                'pin_hash' => $u->pin_hash ?: null, // Salted bcrypt hash
                'has_pin' => !empty($u->pin_hash),
                'is_active' => true,
                'must_change_password' => (bool)$u->must_change_password,
                'biometric_registered' => (bool)$u->is_biometric_enabled,
                'failed_attempts' => $isLocked ? ($u->failed_login_attempts ?? 0) : 0,
                'locked_until' => $isLocked ? $u->locked_until->getTimestamp() * 1000 : null,
                'is_locked' => $isLocked,
                'permissions' => $u->permissions ?? ['*'],
                'enabled_menus' => $u->enabled_menus ?? ['dashboard', 'pos', 'bills', 'stock'],
            ];
        });

        return response()->json([
            'success' => true,
            'store_id' => (string)$store->id,
            'staff' => $staffData,
            'cached_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * Update password or PIN (self-service or forced password change).
     */
    public function changePassword(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'current_password' => 'nullable|string',
            'new_password' => 'nullable|string|min:6',
            'new_pin' => 'nullable|string|min:4|max:6',
        ]);

        if (empty($validated['new_password']) && empty($validated['new_pin'])) {
            return response()->json(['message' => 'New password or PIN must be provided.'], 422);
        }

        $updates = ['must_change_password' => false];

        if (!empty($validated['new_password'])) {
            $updates['password'] = Hash::make($validated['new_password']);
        }

        if (!empty($validated['new_pin'])) {
            $updates['pin_hash'] = Hash::make($validated['new_pin']);
        }

        $user->update($updates);

        AuditLog::log(
            'staff_password_updated',
            'User',
            (string)$user->id,
            null,
            ['must_change_password' => false],
            $user->store_id,
            $user->id
        );

        return response()->json([
            'success' => true,
            'message' => 'Credentials updated successfully.',
        ]);
    }

    /**
     * Store Admin, Store Owner, or Manager unlocks a locked staff member.
     */
    public function adminUnlock(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => 'required',
            'admin_username' => 'required|string',
            'admin_password' => 'required|string',
        ]);

        $adminUsername = trim($validated['admin_username']);
        $admin = User::where(function ($q) use ($adminUsername) {
            $q->where('username', $adminUsername)
              ->orWhere('email', $adminUsername);
            if (is_numeric($adminUsername)) {
                $q->orWhere('id', (int)$adminUsername);
            }
        })->whereIn('role', ['super_admin', 'store_owner', 'owner', 'admin', 'manager'])->first();

        if (!$admin) {
            return response()->json(['message' => 'Admin user not found or insufficient privileges.'], 403);
        }

        $isValid = Hash::check($validated['admin_password'], $admin->password);
        if (!$isValid && !empty($admin->pin_hash)) {
            $isValid = Hash::check($validated['admin_password'], $admin->pin_hash);
        }

        if (!$isValid) {
            return response()->json(['message' => 'Invalid administrative credentials.'], 403);
        }

        $targetUserId = trim((string)$validated['user_id']);
        $targetUser = is_numeric($targetUserId)
            ? User::find($targetUserId)
            : User::where('username', $targetUserId)->orWhere('email', $targetUserId)->first();

        if (!$targetUser) {
            return response()->json(['message' => 'Target user not found.'], 404);
        }

        $targetUser->update([
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);

        AuditLog::log(
            'staff_unlocked_by_admin',
            'User',
            (string)$targetUser->id,
            null,
            ['unlocked_by' => $admin->id, 'admin_username' => $admin->username],
            $targetUser->store_id,
            $admin->id
        );

        return response()->json([
            'success' => true,
            'message' => "User '{$targetUser->name}' has been unlocked.",
            'user' => [
                'id' => (string)$targetUser->id,
                'name' => $targetUser->name,
                'is_locked' => false,
                'locked_until' => null,
            ],
        ]);
    }

    /**
     * Terminate staff session and mark device session as expired.
     */
    public function logout(Request $request): JsonResponse
    {
        $deviceUuid = $request->header('X-Device-UUID') ?: $request->input('device_uuid');
        $user = $request->user();

        if ($deviceUuid) {
            DeviceSession::recordLogout($deviceUuid);
        } elseif ($user) {
            DeviceSession::where('user_id', $user->id)
                ->where('is_active', true)
                ->update(['is_active' => false, 'status' => 'expired', 'last_active_at' => now()]);
        }

        if ($user && $user->currentAccessToken()) {
            $user->currentAccessToken()->delete();
        }

        return response()->json(['success' => true, 'message' => 'Logged out successfully.']);
    }
}
