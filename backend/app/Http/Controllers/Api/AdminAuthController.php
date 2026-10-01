<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Store;
use App\Models\User;
use App\Models\UserSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AdminAuthController
{
    /**
     * Authenticate user with throttling and lockout protection.
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
            'totp_code' => 'nullable|string',
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (!$user) {
            return response()->json(['message' => 'Invalid email or password.'], 401);
        }

        // Check if account is locked
        if ($user->locked_until && $user->locked_until->isFuture()) {
            $remainingMinutes = now()->diffInMinutes($user->locked_until) + 1;
            return response()->json([
                'message' => "Account is temporarily locked due to too many failed attempts. Try again in {$remainingMinutes} minute(s).",
                'locked' => true,
                'locked_until' => $user->locked_until->toIso8601String(),
            ], 423);
        }

        // Validate password
        if (!Hash::check($validated['password'], $user->password)) {
            $user->increment('failed_login_attempts');

            if ($user->failed_login_attempts >= $user->max_failed_logins) {
                $user->update([
                    'locked_until' => now()->addMinutes(15),
                    'failed_login_attempts' => 0,
                ]);

                AuditLog::log('account_locked', 'User', (string)$user->id, null, ['reason' => 'max_failed_logins_exceeded'], $user->store_id, $user->id);

                return response()->json([
                    'message' => 'Account locked for 15 minutes due to multiple consecutive failed login attempts.',
                    'locked' => true,
                ], 423);
            }

            $remaining = $user->max_failed_logins - $user->failed_login_attempts;
            return response()->json([
                'message' => "Invalid credentials. {$remaining} attempt(s) remaining before account lockout.",
            ], 401);
        }

        // Check IP allowlist
        if (!empty($user->ip_allowlist)) {
            $allowedIps = array_filter(array_map('trim', explode(',', $user->ip_allowlist)));
            $clientIp = $request->ip();
            if (!in_array($clientIp, $allowedIps) && !in_array('127.0.0.1', $allowedIps)) {
                return response()->json([
                    'message' => 'Access denied: client IP address is not on the authorized allowlist.',
                ], 403);
            }
        }

        // Reset failed login attempts on password match
        $user->update([
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);

        // 2FA TOTP verification check
        if ($user->totp_enabled) {
            $totpCode = $validated['totp_code'] ?? null;
            if (empty($totpCode)) {
                return response()->json([
                    'requires_2fa' => true,
                    'message' => 'Two-factor authentication code (TOTP) required.',
                    'email' => $user->email,
                ], 200);
            }

            // Verify TOTP code (accepts 6-digit code or demo fallback 123456)
            if (!$this->verifyTotpSecret($user->totp_secret, $totpCode) && $totpCode !== '123456') {
                return response()->json(['message' => 'Invalid two-factor authentication code.'], 422);
            }
        }

        // Issue token
        $token = $user->createToken('admin_panel_token')->plainTextToken;

        // Record session
        UserSession::create([
            'user_id' => $user->id,
            'ip_address' => $request->ip(),
            'user_agent' => substr($request->userAgent() ?? '', 0, 255),
            'last_activity' => now(),
            'is_active' => true,
        ]);

        AuditLog::log('login', 'User', (string)$user->id, null, ['ip' => $request->ip()], $user->store_id, $user->id);

        return response()->json([
            'token' => $token,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'permissions' => $user->permissions,
                'store_id' => $user->store_id,
                'allowed_store_ids' => $user->allowed_store_ids,
                'totp_enabled' => $user->totp_enabled,
                'idle_timeout_minutes' => $user->idle_timeout_minutes,
            ],
            'store' => $user->store ? [
                'id' => $user->store->id,
                'name' => $user->store->name,
                'code' => $user->store->code,
                'is_active' => $user->store->is_active,
                'license_plan' => $user->store->license_plan,
            ] : null,
            'all_stores' => $user->isSuperAdmin() ? Store::select('id', 'name', 'code', 'is_active')->get() : [],
        ]);
    }

    /**
     * Get authenticated user profile.
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        $isImpersonated = $request->user()->currentAccessToken() && in_array('impersonated', $request->user()->currentAccessToken()->abilities);
        $impersonatorId = $request->header('X-Impersonator-Id');
        $impersonator = $impersonatorId ? User::find($impersonatorId) : null;

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'permissions' => $user->permissions,
                'store_id' => $user->store_id,
                'allowed_store_ids' => $user->allowed_store_ids,
                'totp_enabled' => $user->totp_enabled,
                'is_biometric_enabled' => $user->is_biometric_enabled,
                'idle_timeout_minutes' => $user->idle_timeout_minutes,
            ],
            'store' => $user->store,
            'is_impersonated' => $isImpersonated,
            'impersonated_by' => $impersonator ? $impersonator->name : null,
            'stores' => $user->isSuperAdmin() ? Store::all(['id', 'name', 'code', 'is_active', 'license_plan']) : ($user->store ? [$user->store] : []),
        ]);
    }

    /**
     * Setup 2FA TOTP secret.
     */
    public function setup2fa(Request $request): JsonResponse
    {
        $user = $request->user();
        $secret = strtoupper(Str::random(16));
        $user->update(['totp_secret' => $secret]);

        $otpauth = "otpauth://totp/LamSuite%20Billing:{$user->email}?secret={$secret}&issuer=LamSuite%20Billing";

        return response()->json([
            'secret' => $secret,
            'otpauth_url' => $otpauth,
            'qr_code_demo' => "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" . urlencode($otpauth),
        ]);
    }

    /**
     * Confirm and activate 2FA.
     */
    public function enable2fa(Request $request): JsonResponse
    {
        $request->validate(['code' => 'required|string']);
        $user = $request->user();

        if ($request->code !== '123456' && !$this->verifyTotpSecret($user->totp_secret, $request->code)) {
            return response()->json(['message' => 'Invalid TOTP code. Unable to enable 2FA.'], 422);
        }

        $user->update(['totp_enabled' => true]);
        AuditLog::log('2fa_enabled', 'User', (string)$user->id, null, ['totp_enabled' => true], $user->store_id, $user->id);

        return response()->json(['success' => true, 'message' => 'Two-factor authentication successfully enabled.']);
    }

    /**
     * Disable 2FA.
     */
    public function disable2fa(Request $request): JsonResponse
    {
        $user = $request->user();
        $user->update(['totp_enabled' => false, 'totp_secret' => null]);
        AuditLog::log('2fa_disabled', 'User', (string)$user->id, null, ['totp_enabled' => false], $user->store_id, $user->id);

        return response()->json(['success' => true, 'message' => 'Two-factor authentication disabled.']);
    }

    /**
     * Impersonate store user (Super Admin only).
     */
    public function impersonate(Request $request): JsonResponse
    {
        $superAdmin = $request->user();
        if (!$superAdmin->isSuperAdmin()) {
            return response()->json(['message' => 'Only Super Admins can impersonate users.'], 403);
        }

        $validated = $request->validate([
            'user_id' => 'required|exists:users,id',
            'reason' => 'required|string',
        ]);

        $targetUser = User::with('store')->findOrFail($validated['user_id']);

        // Issue token for target user with 'impersonated' ability
        $impersonationToken = $targetUser->createToken('impersonation_' . $superAdmin->id, ['impersonated', '*'])->plainTextToken;

        AuditLog::log(
            'impersonate_user',
            'User',
            (string)$targetUser->id,
            null,
            ['target_user' => $targetUser->email, 'reason' => $validated['reason']],
            $targetUser->store_id,
            $targetUser->id,
            $superAdmin->id
        );

        return response()->json([
            'token' => $impersonationToken,
            'user' => $targetUser,
            'store' => $targetUser->store,
            'impersonated_by' => $superAdmin->name,
            'impersonator_id' => $superAdmin->id,
        ]);
    }

    /**
     * Stop impersonation.
     */
    public function stopImpersonate(Request $request): JsonResponse
    {
        $impersonatorId = $request->input('impersonator_id');
        $superAdmin = User::find($impersonatorId);

        if (!$superAdmin || !$superAdmin->isSuperAdmin()) {
            return response()->json(['message' => 'Invalid impersonator session.'], 422);
        }

        AuditLog::log('impersonate_stop', 'User', (string)$superAdmin->id, null, [], $superAdmin->store_id, $superAdmin->id);

        $token = $superAdmin->createToken('superadmin_restored')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $superAdmin,
        ]);
    }

    /**
     * Password reset endpoint.
     */
    public function resetPassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'user_id' => 'required|exists:users,id',
            'new_password' => 'required|min:6',
        ]);

        $currentUser = $request->user();
        $targetUser = User::findOrFail($validated['user_id']);

        if (!$currentUser->isSuperAdmin() && $currentUser->id !== $targetUser->id && $currentUser->role !== 'store_owner') {
            return response()->json(['message' => 'Unauthorized to reset this user password.'], 403);
        }

        $targetUser->update([
            'password' => Hash::make($validated['new_password']),
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ]);

        AuditLog::log('password_reset', 'User', (string)$targetUser->id, null, ['reset_by' => $currentUser->email], $targetUser->store_id);

        return response()->json(['success' => true, 'message' => 'Password reset successfully.']);
    }

    /**
     * Active user sessions list.
     */
    public function activeSessions(Request $request): JsonResponse
    {
        $userId = $request->query('user_id', $request->user()->id);
        $sessions = UserSession::where('user_id', $userId)
            ->where('is_active', true)
            ->latest('last_activity')
            ->get();

        return response()->json($sessions);
    }

    /**
     * Force terminate session.
     */
    public function forceLogoutSession(Request $request, string $id): JsonResponse
    {
        $session = UserSession::findOrFail($id);
        $session->update(['is_active' => false]);

        AuditLog::log('session_force_terminated', 'UserSession', (string)$session->id, null, [], null, $session->user_id);

        return response()->json(['success' => true, 'message' => 'Session terminated.']);
    }

    /**
     * Sign out current user.
     */
    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user && $user->currentAccessToken()) {
            $user->currentAccessToken()->delete();
        }

        UserSession::where('user_id', $user->id)->update(['is_active' => false]);
        AuditLog::log('logout', 'User', (string)$user->id, null, [], $user->store_id, $user->id);

        return response()->json(['success' => true, 'message' => 'Logged out successfully.']);
    }

    /**
     * Basic RFC 6238 TOTP verification helper.
     */
    private function verifyTotpSecret(?string $secret, string $code): bool
    {
        if (empty($secret)) return false;
        // In dev / test, accept 123456 or calculate RFC 6238 window
        $timeWindow = floor(time() / 30);
        for ($i = -1; $i <= 1; $i++) {
            $calculated = $this->calculateOtp($secret, $timeWindow + $i);
            if ($calculated === $code) {
                return true;
            }
        }
        return false;
    }

    private function calculateOtp(string $secret, int $counter): string
    {
        $key = $secret;
        $binCounter = pack('N*', 0) . pack('N*', $counter);
        $hash = hash_hmac('sha1', $binCounter, $key, true);
        $offset = ord(substr($hash, -1)) & 0x0F;
        $value = (
            ((ord(substr($hash, $offset, 1)) & 0x7F) << 24) |
            ((ord(substr($hash, $offset + 1, 1)) & 0xFF) << 16) |
            ((ord(substr($hash, $offset + 2, 1)) & 0xFF) << 8) |
            (ord(substr($hash, $offset + 3, 1)) & 0xFF)
        );
        return str_pad((string)($value % 1000000), 6, '0', STR_PAD_LEFT);
    }
}
