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
            $query->where('store_id', $storeId);
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
            'pin' => 'nullable|string|min:4|max:6',
            'role' => 'required|in:super_admin,store_owner,manager,cashier,operator,pharmacist,accountant,support,admin',
            'store_id' => 'nullable|exists:stores,id',
            'allowed_store_ids' => 'nullable|array',
            'permissions' => 'nullable|array',
            'idle_timeout_minutes' => 'nullable|integer|min:1|max:120',
            'max_failed_logins' => 'nullable|integer|min:3|max:20',
            'ip_allowlist' => 'nullable|string',
            'is_biometric_enabled' => 'nullable|boolean',
        ]);

        $validated['password'] = Hash::make($validated['password']);
        if (!empty($validated['pin'])) {
            $validated['pin_hash'] = Hash::make($validated['pin']);
        }
        unset($validated['pin']);

        if (empty($validated['username'])) {
            $validated['username'] = explode('@', $validated['email'])[0];
        }

        $validated['idle_timeout_minutes'] = $validated['idle_timeout_minutes'] ?? 15;
        $validated['max_failed_logins'] = $validated['max_failed_logins'] ?? 5;

        $user = User::create($validated);

        AuditLog::log('create_user', 'User', (string)$user->id, null, [
            'email' => $user->email,
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
            'pin' => 'nullable|string|min:4|max:6',
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

        if (!empty($validated['password'])) {
            $validated['password'] = Hash::make($validated['password']);
        } else {
            unset($validated['password']);
        }

        if (!empty($validated['pin'])) {
            $validated['pin_hash'] = Hash::make($validated['pin']);
        }
        unset($validated['pin']);

        if (empty($user->username) && empty($validated['username'])) {
            $validated['username'] = explode('@', $user->email)[0];
        }

        $oldValues = $user->only(['name', 'email', 'role', 'permissions', 'store_id', 'username']);
        $user->update($validated);

        AuditLog::log('update_user', 'User', (string)$user->id, $oldValues, $user->only(['name', 'email', 'role', 'permissions', 'store_id', 'username']), $user->store_id);

        return response()->json($user);
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
