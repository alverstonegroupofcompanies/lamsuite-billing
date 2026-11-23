<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\User;
use App\Models\UserSession;
use App\Services\Auth\PinPolicy;
use App\Services\PermissionMap;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\PersonalAccessToken;

class AdminUserController
{
    /**
     * POS terminals authenticate with a staff_session_token or, since the CR
     * made the counter the tenant principal, with the claimed counter's device
     * token and nobody signed in. Either way they may only manage the branch
     * they are registered to; multi-branch and global accounts are created from
     * the admin panel.
     */
    private function isTerminalRequest(Request $request): bool
    {
        $token = $request->user()?->currentAccessToken();

        if ($token instanceof PersonalAccessToken && $token->name === 'staff_session_token') {
            return true;
        }

        return $request->attributes->get('device_store_id') !== null;
    }

    private function terminalStoreId(Request $request): ?int
    {
        $activeStoreId = $request->attributes->get('active_store_id')
            ?? $request->attributes->get('device_store_id');

        return $activeStoreId ? (int) $activeStoreId : null;
    }

    /**
     * Who to name in the audit trail. A counter has no email address, and
     * naming a person who never signed in would invent a trail that does not
     * exist — so the counter is named as itself.
     */
    private function actorLabel(Request $request): string
    {
        $user = $request->user();
        if ($user) {
            return (string) $user->email;
        }

        $counterId = $request->attributes->get('device_counter_id');

        if ($counterId) {
            $counter = Counter::find($counterId);

            return $counter
                ? "counter:{$counter->counter_code} ({$counter->counter_name})"
                : "counter:{$counterId}";
        }

        $deviceId = $request->attributes->get('device_id');

        return $deviceId ? "device:{$deviceId}" : 'terminal';
    }

    /**
     * Blocks a terminal from touching an account outside its signed-in branch.
     * Global accounts (null store) and other branches belong to the admin panel.
     */
    private function guardTerminalTarget(Request $request, User $user): ?JsonResponse
    {
        if (!$this->isTerminalRequest($request)) {
            return null;
        }

        $terminalStoreId = $this->terminalStoreId($request);

        if (!$terminalStoreId) {
            return response()->json([
                'message' => 'Register this terminal to a store before managing staff accounts.',
            ], 422);
        }

        if ((int) $user->store_id !== $terminalStoreId) {
            return response()->json([
                'message' => 'Staff outside this store can only be managed from the admin panel.',
            ], 403);
        }

        return null;
    }

    /**
     * No caller may hand out branch access it does not hold itself. ScopeStore
     * validates the store context of a request, never the store ids inside the
     * payload, so an admin-panel caller with users:edit could otherwise grant
     * another tenant's branch through allowed_store_ids.
     */
    private function denyGrantOutsideCallerScope(array $validated, User $currentUser): ?JsonResponse
    {
        if ($currentUser->isSuperAdmin()) {
            return null;
        }

        foreach ((array) ($validated['allowed_store_ids'] ?? []) as $storeId) {
            if (!$currentUser->canAccessStore((int) $storeId)) {
                return response()->json([
                    'message' => "Branch {$storeId} is outside your access scope, so it cannot be granted.",
                ], 403);
            }
        }

        return null;
    }

    public function index(Request $request): JsonResponse
    {
        $currentUser = $request->user();
        $activeStoreId = $request->attributes->get('active_store_id');
        $storeFilter = $request->query('store_id');

        $query = User::with('store:id,name,code');

        if (!$currentUser) {
            // A16b: a counter reads exactly its own branch. Global accounts and
            // other branches never leave the admin panel.
            $counterStoreId = $this->terminalStoreId($request);

            if (!$counterStoreId) {
                return response()->json([
                    'message' => 'Claim this terminal to a counter before managing staff accounts.',
                ], 422);
            }

            $query->where('store_id', $counterStoreId);
        } elseif ($currentUser->isSuperAdmin()) {
            // Super Admin can view all staff users across all branches, or filter by a specific store
            if ($storeFilter && $storeFilter !== 'all') {
                $query->where(function ($q) use ($storeFilter) {
                    $q->where('store_id', (int)$storeFilter)
                      ->orWhereNull('store_id')
                      ->orWhereJsonContains('allowed_store_ids', (int)$storeFilter)
                      ->orWhereJsonContains('allowed_store_ids', (string)$storeFilter);
                });
            }
        } else {
            $effectiveStoreId = ($storeFilter && $storeFilter !== 'all') ? (int)$storeFilter : $activeStoreId;
            if ($effectiveStoreId) {
                $query->where(function ($q) use ($effectiveStoreId) {
                    $q->where('store_id', $effectiveStoreId)
                      ->orWhereNull('store_id')
                      ->orWhereJsonContains('allowed_store_ids', (int)$effectiveStoreId)
                      ->orWhereJsonContains('allowed_store_ids', (string)$effectiveStoreId);
                });
            } else {
                $allowed = $currentUser->allowed_store_ids ?? [];
                if ($currentUser->store_id) {
                    $allowed[] = $currentUser->store_id;
                }
                $query->where(function ($q) use ($allowed) {
                    $q->whereIn('store_id', array_unique($allowed))
                      ->orWhereNull('store_id');
                });
            }
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

        $perPage = (int) ($request->query('per_page', 50));
        $perPage = min(max($perPage, 10), 100);

        return response()->json($query->paginate($perPage));
    }

    public function store(Request $request): JsonResponse
    {
        $currentUser = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|unique:users,email',
            'username' => 'nullable|string|max:50|unique:users,username',
            'password' => 'required|string|min:8',
            'pin' => 'nullable|string',
            'role' => 'required|in:super_admin,store_owner,manager,cashier,operator,pharmacist,accountant,support,admin',
            'store_id' => 'nullable|exists:stores,id',
            'allowed_store_ids' => 'nullable|array',
            'permissions' => 'nullable|array',
            'idle_timeout_minutes' => 'nullable|integer|min:1|max:120',
            'max_failed_logins' => 'nullable|integer|min:3|max:20',
            'ip_allowlist' => 'nullable|string',
            'is_biometric_enabled' => 'nullable|boolean',
            // APR-001 / Q6: who may hold the approval PIN is the owner's choice.
            'is_approver' => 'nullable|boolean',
        ]);

        if ($validated['role'] === 'super_admin' && !$currentUser?->isSuperAdmin()) {
            return response()->json(['message' => 'Only Super Admins can create Super Admin accounts.'], 403);
        }

        if ($this->isTerminalRequest($request)) {
            // A counter may manage its staff, not decide who approves for it.
            unset($validated['is_approver']);
        }

        if ($this->isTerminalRequest($request)) {
            $terminalStoreId = $this->terminalStoreId($request);
            if (!$terminalStoreId) {
                return response()->json([
                    'message' => 'Register this terminal to a store before creating staff accounts.',
                ], 422);
            }
            if (array_key_exists('allowed_store_ids', $validated)) {
                return response()->json([
                    'message' => 'Multi-branch access can only be granted from the admin panel.',
                ], 422);
            }
            if (!empty($validated['store_id']) && (int) $validated['store_id'] !== $terminalStoreId) {
                return response()->json([
                    'message' => "Terminal staff accounts can only be assigned to store {$terminalStoreId}.",
                ], 422);
            }
            $validated['store_id'] = $terminalStoreId;
        } else {
            if ($denied = $this->denyGrantOutsideCallerScope($validated, $currentUser)) {
                return $denied;
            }
        }

        // Omitted store_id means "the caller's store", never a global account.
        // A global account must be requested explicitly with store_id null by a
        // super admin.
        if (!array_key_exists('store_id', $validated) && $currentUser?->store_id) {
            $validated['store_id'] = $currentUser->store_id;
        }

        if (array_key_exists('permissions', $validated)) {
            $validated['permissions'] = $validated['permissions'] === null
                ? null
                : PermissionMap::normalize($validated['permissions']);
        }

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
        $validated['max_failed_logins'] = $validated['max_failed_logins'] ?? PinPolicy::MAX_FAILED_ATTEMPTS;

        $user = User::create($validated);

        AuditLog::log('create_user', 'User', (string)$user->id, null, [
            'email' => $user->email,
            'username' => $user->username,
            'role' => $user->role,
            'store_id' => $user->store_id,
            'created_by' => $this->actorLabel($request),
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
        $currentUser = $request->user();
        $user = User::findOrFail($id);

        if ($user->role === 'super_admin' && !$currentUser?->isSuperAdmin()) {
            return response()->json(['message' => 'Only Super Admins can modify Super Admin accounts.'], 403);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'email' => 'sometimes|required|email|unique:users,email,' . $user->id,
            'username' => 'nullable|string|max:50|unique:users,username,' . $user->id,
            'password' => 'nullable|string|min:8',
            'pin' => 'nullable|string',
            'role' => 'sometimes|required|in:super_admin,store_owner,manager,cashier,operator,pharmacist,accountant,support,admin',
            'store_id' => 'nullable',
            'allowed_store_ids' => 'nullable|array',
            'permissions' => 'nullable|array',
            'idle_timeout_minutes' => 'nullable|integer|min:1|max:120',
            'max_failed_logins' => 'nullable|integer|min:3|max:20',
            'ip_allowlist' => 'nullable|string',
            'is_biometric_enabled' => 'nullable|boolean',
            'is_approver' => 'nullable|boolean',
        ]);

        if ($this->isTerminalRequest($request)) {
            unset($validated['is_approver']);
        }

        if (($validated['role'] ?? null) === 'super_admin' && !$currentUser?->isSuperAdmin()) {
            return response()->json(['message' => 'Only Super Admins can assign the Super Admin role.'], 403);
        }

        if (array_key_exists('permissions', $validated)) {
            $validated['permissions'] = $validated['permissions'] === null
                ? null
                : PermissionMap::normalize($validated['permissions']);
        }

        if ($denied = $this->guardTerminalTarget($request, $user)) {
            return $denied;
        }

        if ($this->isTerminalRequest($request)) {
            $terminalStoreId = (int) $this->terminalStoreId($request);
            if (array_key_exists('allowed_store_ids', $validated)) {
                return response()->json([
                    'message' => 'Multi-branch access can only be granted from the admin panel.',
                ], 422);
            }
            if (array_key_exists('store_id', $validated) && !empty($validated['store_id'])
                && (int) $validated['store_id'] !== $terminalStoreId) {
                return response()->json([
                    'message' => "Terminal staff accounts can only be assigned to store {$terminalStoreId}.",
                ], 422);
            }
            $validated['store_id'] = $terminalStoreId;
        } else {
            if ($denied = $this->denyGrantOutsideCallerScope($validated, $currentUser)) {
                return $denied;
            }
        }

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
            $validated['must_change_password'] = false;
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

        AuditLog::log('update_user', 'User', (string)$user->id, $oldValues, $user->only(['name', 'email', 'role', 'permissions', 'store_id', 'username']) + [
            'updated_by' => $this->actorLabel($request),
        ], $user->store_id);

        return response()->json($user->fresh());
    }

    public function resetPin(Request $request, string $id): JsonResponse
    {
        $user = User::findOrFail($id);

        if ($denied = $this->guardTerminalTarget($request, $user)) {
            return $denied;
        }

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

        AuditLog::log('reset_user_pin', 'User', (string)$user->id, null, ['reset_by' => $this->actorLabel($request)], $user->store_id);

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
        $user = User::findOrFail($id);

        if ($denied = $this->guardTerminalTarget($request, $user)) {
            return $denied;
        }

        $user->update([
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);

        AuditLog::log('unlock_user', 'User', (string)$user->id, null, ['unlocked_by' => $this->actorLabel($request)], $user->store_id);

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

        if ($denied = $this->guardTerminalTarget($request, $user)) {
            return $denied;
        }

        $user->update([
            'locked_until' => now()->addMinutes(60),
            'failed_login_attempts' => PinPolicy::attemptsAllowed($user->max_failed_logins),
        ]);

        AuditLog::log('lock_user', 'User', (string)$user->id, null, ['locked_by' => $this->actorLabel($request)], $user->store_id);

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

        if ($denied = $this->guardTerminalTarget($request, $user)) {
            return $denied;
        }

        if (!$currentUser?->isSuperAdmin() && $user->role === 'super_admin') {
            return response()->json(['message' => 'Only Super Admins can delete Super Admin accounts.'], 403);
        }

        $user->tokens()->delete();
        UserSession::where('user_id', $user->id)->delete();

        $userName = $user->name;
        $userEmail = $user->email;
        $storeId = $user->store_id;

        $user->delete();

        AuditLog::log('delete_user', 'User', (string)$id, ['name' => $userName, 'email' => $userEmail], [
            'deleted_by' => $this->actorLabel($request),
        ], $storeId);

        return response()->json([
            'success' => true,
            'message' => "User '{$userName}' has been deleted successfully.",
        ]);
    }

    public function toggleBiometric(Request $request, string $id): JsonResponse
    {
        $user = User::findOrFail($id);

        if ($denied = $this->guardTerminalTarget($request, $user)) {
            return $denied;
        }

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

        if ($denied = $this->guardTerminalTarget($request, $user)) {
            return $denied;
        }

        $user->tokens()->delete();
        UserSession::where('user_id', $user->id)->update(['is_active' => false]);

        AuditLog::log('force_logout_user', 'User', (string)$user->id, null, [], $user->store_id);

        return response()->json([
            'success' => true,
            'message' => "All active sessions and tokens for user '{$user->name}' have been terminated.",
        ]);
    }
}
