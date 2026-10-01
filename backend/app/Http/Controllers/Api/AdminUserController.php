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
            'password' => 'required|string|min:6',
            'role' => 'required|in:super_admin,store_owner,manager,accountant,support',
            'store_id' => 'nullable|exists:stores,id',
            'allowed_store_ids' => 'nullable|array',
            'permissions' => 'nullable|array',
            'idle_timeout_minutes' => 'nullable|integer|min:1|max:120',
            'max_failed_logins' => 'nullable|integer|min:3|max:20',
            'ip_allowlist' => 'nullable|string',
            'is_biometric_enabled' => 'nullable|boolean',
        ]);

        $validated['password'] = Hash::make($validated['password']);
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
            'role' => 'sometimes|required|in:super_admin,store_owner,manager,accountant,support',
            'store_id' => 'nullable|exists:stores,id',
            'allowed_store_ids' => 'nullable|array',
            'permissions' => 'nullable|array',
            'idle_timeout_minutes' => 'nullable|integer|min:1|max:120',
            'max_failed_logins' => 'nullable|integer|min:3|max:20',
            'ip_allowlist' => 'nullable|string',
            'is_biometric_enabled' => 'nullable|boolean',
        ]);

        $oldValues = $user->only(['name', 'email', 'role', 'permissions', 'store_id']);
        $user->update($validated);

        AuditLog::log('update_user', 'User', (string)$user->id, $oldValues, $user->only(['name', 'email', 'role', 'permissions', 'store_id']), $user->store_id);

        return response()->json($user);
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
