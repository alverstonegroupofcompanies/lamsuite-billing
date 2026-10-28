<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\User;
use App\Models\UserSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AdminUserController
{
    public function index(Request $request): JsonResponse
    {
        $currentUser = $request->user();
        $storeId = $request->get('active_store_id');

        $query = User::with('store:id,name,code');

        if ($storeId) {
            $query->where(function ($q) use ($storeId) {
                $q->where('store_id', $storeId)
                  ->orWhereNull('store_id')
                  ->orWhereJsonContains('allowed_store_ids', (int)$storeId)
                  ->orWhereJsonContains('allowed_store_ids', (string)$storeId);
            });
        } elseif (!$currentUser->isSuperAdmin()) {
            $allowed = $currentUser->allowed_store_ids ?? [];
            if ($currentUser->store_id) {
                $allowed[] = $currentUser->store_id;
            }
            $query->whereIn('store_id', array_unique($allowed));
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%")
                  ->orWhere('role', 'like', "%{$search}%");
            });
        }

        if ($role = $request->query('role')) {
            $query->where('role', $role);
        }

        $query->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        return response()->json($query->paginate(15));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users,email',
            'username' => 'nullable|string|max:50|unique:users,username',
            'password' => 'required|string|min:6',
            'pin' => 'nullable|string',
            'role' => 'required|in:super_admin,store_owner,manager,cashier,operator,pharmacist,accountant,support,admin',
            'store_id' => 'nullable|exists:stores,id',
            'allowed_store_ids' => 'nullable|array',
            'permissions' => 'nullable|array',
            'idle_timeout_minutes' => 'nullable|integer|min:1|max:120',
            'max_failed_logins' => 'nullable|integer|min:3|max:20',
            'ip_allowlist' => 'nullable|string',
            'is_biometric_enabled' => 'nullable|boolean',
        ]);

        if (empty($validated['username'])) {
            $validated['username'] = explode('@', $validated['email'])[0];
        }

        // Cross-uniqueness check: username cannot collide with any user's email, and email cannot collide with any username
        $usernameExistsAsEmail = User::where('email', $validated['username'])->exists();
        if ($usernameExistsAsEmail) {
            return response()->json(['message' => "Username '{$validated['username']}' cannot match an existing user's email."], 422);
        }

        $emailExistsAsUsername = User::where('username', $validated['email'])->exists();
        if ($emailExistsAsUsername) {
            return response()->json(['message' => "Email '{$validated['email']}' cannot match an existing user's username/handle."], 422);
        }

        $validated['password'] = Hash::make($validated['password']);
        if (!empty($validated['pin'])) {
            $pinError = User::validatePinPolicy($validated['pin']);
            if ($pinError) {
                return response()->json(['message' => $pinError], 422);
            }
            $validated['pin_hash'] = Hash::make($validated['pin']);
        }
        unset($validated['pin']);

        $validated['idle_timeout_minutes'] = $validated['idle_timeout_minutes'] ?? 15;
        $validated['max_failed_logins'] = $validated['max_failed_logins'] ?? 5;

        $user = User::create($validated);

        AuditLog::log('create_user', 'User', (string)$user->id, null, [
            'email' => $user->email,
            'username' => $user->username,
            'role' => $user->role,
            'store_id' => $user->store_id,
        ], $user->store_id);

        return response()->json($user, 201);
    }

    public function show(string $id): JsonResponse
    {
        $user = User::with(['store', 'sessions' => fn($q) => $q->where('is_active', true)])->findOrFail($id);
        return response()->json($user);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'email' => 'sometimes|required|email|unique:users,email,' . $user->id,
            'username' => 'nullable|string|max:50|unique:users,username,' . $user->id,
            'password' => 'nullable|string|min:6',
            'pin' => 'nullable|string',
            'role' => 'sometimes|required|in:super_admin,store_owner,manager,cashier,operator,pharmacist,accountant,support,admin',
            'store_id' => 'nullable',
            'allowed_store_ids' => 'nullable|array',
            'permissions' => 'nullable|array',
            'idle_timeout_minutes' => 'nullable|integer|min:1|max:120',
            'max_failed_logins' => 'nullable|integer|min:3|max:20',
            'ip_allowlist' => 'nullable|string',
            'is_biometric_enabled' => 'nullable|boolean',
        ]);

        if (array_key_exists('store_id', $validated)) {
            $validated['store_id'] = empty($validated['store_id']) ? null : (int)$validated['store_id'];
        }

        $checkUsername = $validated['username'] ?? $user->username;
        $checkEmail = $validated['email'] ?? $user->email;

        // Cross-uniqueness check
        if (!empty($checkUsername)) {
            $usernameExistsAsEmail = User::where('email', $checkUsername)->where('id', '!=', $user->id)->exists();
            if ($usernameExistsAsEmail) {
                return response()->json(['message' => "Username '{$checkUsername}' cannot match an existing user's email."], 422);
            }
        }

        if (!empty($checkEmail)) {
            $emailExistsAsUsername = User::where('username', $checkEmail)->where('id', '!=', $user->id)->exists();
            if ($emailExistsAsUsername) {
                return response()->json(['message' => "Email '{$checkEmail}' cannot match an existing user's username/handle."], 422);
            }
        }

        if (!empty($validated['password'])) {
            $validated['password'] = Hash::make($validated['password']);
        } else {
            unset($validated['password']);
        }

        if (!empty($validated['pin'])) {
            $pinError = User::validatePinPolicy($validated['pin']);
            if ($pinError) {
                return response()->json(['message' => $pinError], 422);
            }
            $validated['pin_hash'] = Hash::make($validated['pin']);
        }
        unset($validated['pin']);

        if (empty($user->username) && empty($validated['username'])) {
            $validated['username'] = explode('@', $user->email)[0];
        }

        // Updating a user in admin panel clears any active lockout and resets failed attempts
        $validated['failed_login_attempts'] = 0;
        $validated['locked_until'] = null;

        $oldValues = $user->only(['name', 'email', 'role', 'permissions', 'store_id', 'username']);
        $user->update($validated);

        AuditLog::log('update_user', 'User', (string)$user->id, $oldValues, $user->only(['name', 'email', 'role', 'permissions', 'store_id', 'username']), $user->store_id);

        return response()->json($user->fresh());
    }

    public function resetPin(Request $request, string $id): JsonResponse
    {
        $currentUser = $request->user();
        $user = User::findOrFail($id);

        $validated = $request->validate([
            'pin' => 'required|string',
        ]);

        $pinError = User::validatePinPolicy($validated['pin']);
        if ($pinError) {
            return response()->json(['message' => $pinError], 422);
        }

        $user->update([
            'pin_hash' => Hash::make($validated['pin']),
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);

        AuditLog::log('reset_user_pin', 'User', (string)$user->id, null, ['reset_by' => $currentUser->email], $user->store_id);

        return response()->json([
            'success' => true,
            'message' => "PIN for user '{$user->name}' has been reset successfully. It will never be shown again.",
            'user' => $user->fresh(),
        ]);
    }

    public function loginDiagnostics(Request $request): JsonResponse
    {
        $currentUser = $request->user();
        $query = AuditLog::with('user:id,name,username,email,role', 'store:id,name,code')
            ->whereIn('action', ['staff_login_failed', 'staff_account_locked', 'staff_login_success', 'staff_unlocked_by_admin'])
            ->orderBy('id', 'desc');

        if (!$currentUser->isSuperAdmin() && $currentUser->store_id) {
            $query->where('store_id', $currentUser->store_id);
        }

        $logs = $query->limit(50)->get()->map(function ($log) {
            return [
                'id' => $log->id,
                'action' => $log->action,
                'timestamp' => $log->created_at?->toIso8601String(),
                'user' => $log->user ? [
                    'id' => $log->user->id,
                    'name' => $log->user->name,
                    'username' => $log->user->username,
                    'email' => $log->user->email,
                    'role' => $log->user->role,
                ] : null,
                'store' => $log->store ? [
                    'id' => $log->store->id,
                    'name' => $log->store->name,
                    'code' => $log->store->code,
                ] : null,
                'reason' => $log->new_values['reason'] ?? $log->new_values['diagnostic'] ?? ($log->action === 'staff_login_success' ? 'Authorized' : 'failed'),
                'counter' => $log->new_values['counter_id'] ?? $log->new_values['counter_name'] ?? 'Counter Station',
                'ip' => $log->ip_address,
            ];
        });

        return response()->json([
            'success' => true,
            'diagnostics' => $logs,
        ]);
    }

    public function unlock(Request $request, string $id): JsonResponse
    {
        $currentUser = $request->user();
        $user = User::findOrFail($id);

        $user->update([
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);

        AuditLog::log('unlock_user', 'User', (string)$user->id, null, ['unlocked_by' => $currentUser->email], $user->store_id);

        return response()->json([
            'success' => true,
            'message' => "User account '{$user->name}' unlocked successfully.",
            'user' => $user->fresh(),
        ]);
    }

    public function lock(Request $request, string $id): JsonResponse
    {
        $currentUser = $request->user();
        $user = User::findOrFail($id);

        if ($currentUser && $currentUser->id === $user->id) {
            return response()->json(['message' => 'You cannot lock your own account.'], 400);
        }

        $user->update([
            'locked_until' => now()->addMinutes(60),
            'failed_login_attempts' => $user->max_failed_logins ?? 5,
        ]);

        AuditLog::log('lock_user', 'User', (string)$user->id, null, ['locked_by' => $currentUser->email], $user->store_id);

        return response()->json([
            'success' => true,
            'message' => "User account '{$user->name}' locked successfully.",
            'user' => $user->fresh(),
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $currentUser = $request->user();
        $user = User::findOrFail($id);

        if ($currentUser && $currentUser->id === $user->id) {
            return response()->json(['message' => 'You cannot delete your own account.'], 422);
        }

        if ($currentUser && !$currentUser->isSuperAdmin() && $user->role === 'super_admin') {
            return response()->json(['message' => 'Only Super Admins can delete Super Admin accounts.'], 403);
        }

        $user->tokens()->delete();
        UserSession::where('user_id', $user->id)->delete();

        $userName = $user->name;
        $userEmail = $user->email;
        $storeId = $user->store_id;

        $user->delete();

        AuditLog::log('delete_user', 'User', (string)$id, ['name' => $userName, 'email' => $userEmail], null, $storeId);

        return response()->json([
            'success' => true,
            'message' => "User '{$userName}' has been deleted successfully.",
        ]);
    }

    public function toggleBiometric(Request $request, string $id): JsonResponse
    {
        $user = User::findOrFail($id);
        $user->update(['is_biometric_enabled' => !$user->is_biometric_enabled]);

        AuditLog::log('toggle_biometric', 'User', (string)$user->id, null, ['is_biometric_enabled' => $user->is_biometric_enabled], $user->store_id);

        return response()->json([
            'success' => true,
            'is_biometric_enabled' => $user->is_biometric_enabled,
            'message' => $user->is_biometric_enabled ? 'Biometric login enabled.' : 'Biometric login disabled.',
        ]);
    }

    public function forceLogout(Request $request, string $id): JsonResponse
    {
        $user = User::findOrFail($id);
        $user->tokens()->delete();
        UserSession::where('user_id', $user->id)->update(['is_active' => false]);

        AuditLog::log('force_logout_user', 'User', (string)$user->id, null, [], $user->store_id);

        return response()->json([
            'success' => true,
            'message' => "All active sessions and tokens for user '{$user->name}' have been terminated.",
        ]);
    }
}
