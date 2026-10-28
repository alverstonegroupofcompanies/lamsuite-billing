<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
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
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required',
            'username' => 'required|string',
            'pin' => 'nullable|string',
            'password' => 'nullable|string',
            'counter_id' => 'nullable',
        ]);

        if (empty($validated['pin']) && empty($validated['password'])) {
            return response()->json(['message' => 'Either PIN or password is required.'], 422);
        }

        // Verify Device Token if header is provided
        $deviceToken = $request->header('X-Device-Token');
        if ($deviceToken) {
            $counter = Counter::where('device_token', $deviceToken)->first();
            if ($counter) {
                if ($counter->status === 'revoked') {
                    return response()->json([
                        'message' => 'This terminal has been revoked by store administrator.',
                        'device_revoked' => true,
                    ], 403);
                }
                if ($counter->status === 'locked') {
                    return response()->json([
                        'message' => 'This terminal is temporarily locked.',
                        'device_locked' => true,
                    ], 423);
                }
            }
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

        // Find user by username, email, or id within this store (or super admin / multi-store owner)
        $username = trim($validated['username']);
        $user = User::where(function ($q) use ($username) {
                $q->where('username', $username)
                  ->orWhere('email', $username);
                if (is_numeric($username)) {
                    $q->orWhere('id', (int)$username);
                }
            })
            ->where(function ($q) use ($store) {
                $q->where('store_id', $store->id)
                  ->orWhereNull('store_id')
                  ->orWhereJsonContains('allowed_store_ids', (int)$store->id)
                  ->orWhereJsonContains('allowed_store_ids', (string)$store->id)
                  ->orWhereIn('role', ['super_admin', 'store_owner']);
            })
            ->first();

        if (!$user) {
            return response()->json(['message' => 'Staff user not found in this store.'], 401);
        }

        // Check Lockout
        if ($user->locked_until) {
            if ($user->locked_until->isPast()) {
                // Auto-clear expired lockout
                $user->update(['locked_until' => null, 'failed_login_attempts' => 0]);
            } elseif (!empty($validated['password']) && Hash::check($validated['password'], $user->password)) {
                // Master account password unlocks the account immediately
                $user->update(['locked_until' => null, 'failed_login_attempts' => 0]);
            } else {
                $remainingMinutes = (int) ceil(now()->diffInSeconds($user->locked_until) / 60);
                return response()->json([
                    'message' => "Account is temporarily locked due to consecutive failed attempts. Try again in {$remainingMinutes} minute(s) or request Admin Unlock.",
                    'locked' => true,
                    'locked_until' => $user->locked_until->toIso8601String(),
                ], 423);
            }
        }

        // Verify PIN or Password
        $isValid = false;
        if (!empty($validated['pin'])) {
            if (!empty($user->pin_hash)) {
                // If a PIN is configured, it must match the updated PIN hash
                $isValid = Hash::check($validated['pin'], $user->pin_hash);
            } else {
                // No Quick PIN is configured for this user; reject any PIN attempt (never allow 1234 fallback)
                $isValid = false;
            }
        } elseif (!empty($validated['password'])) {
            if (Hash::check($validated['password'], $user->password)) {
                $isValid = true;
            } elseif (!empty($user->pin_hash) && Hash::check($validated['password'], $user->pin_hash)) {
                $isValid = true;
            }
        }

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
                    ['reason' => 'max_failed_attempts_exceeded', 'store_id' => $store->id],
                    $store->id,
                    $user->id
                );

                return response()->json([
                    'message' => 'Account locked for 15 minutes due to consecutive failed attempts.',
                    'locked' => true,
                ], 423);
            }

            $remaining = $maxAttempts - $user->failed_login_attempts;
            return response()->json([
                'message' => "Invalid credentials. {$remaining} attempt(s) remaining before lockout.",
                'remaining_attempts' => $remaining,
            ], 401);
        }

        // Successful validation: reset failed attempts
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

        AuditLog::log(
            'staff_login',
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
}
