<?php

namespace App\Http\Controllers\Api;

use App\Mail\PasswordResetMail;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\Auth\PasswordResetService;
use App\Services\Notifications\StoreSmtpConfigurator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class PasswordResetController
{
    public function __construct(private PasswordResetService $resets)
    {
    }

    /**
     * Issue a single-use reset code. Responses are deliberately generic so
     * callers cannot probe which email addresses have accounts.
     */
    public function forgot(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|string|max:255',
        ]);

        $user = $this->findUser(trim($validated['email']));

        if (!$user) {
            return response()->json([
                'success' => true,
                'message' => 'If an account exists for this address, password reset instructions have been sent.',
                'delivery' => 'email',
            ]);
        }

        $token = $this->resets->issue($user);
        $resetUrl = $this->resets->resetUrl($user, $token);
        $delivered = $this->sendEmail($user, $resetUrl, $token);

        AuditLog::log('password_reset_requested', 'User', (string) $user->id, null, [
            'delivery' => $delivered ? 'email' : 'manual',
        ], $user->store_id, $user->id);

        $payload = [
            'success' => true,
            'message' => $delivered
                ? 'Password reset instructions have been emailed to you.'
                : 'Email delivery is not configured. Ask your administrator to run "php artisan auth:reset-link" on the server.',
            'delivery' => $delivered ? 'email' : 'manual',
        ];

        // Local installs without SMTP still need a workable end-to-end path.
        if (!$delivered && config('app.debug')) {
            $payload['reset_token'] = $token;
            $payload['reset_url'] = $resetUrl;
            $payload['expires_in_minutes'] = PasswordResetService::TOKEN_TTL_MINUTES;
        }

        return response()->json($payload);
    }

    /**
     * Complete a reset with the emailed code, revoking any existing sessions.
     */
    public function reset(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|string|email|max:255',
            'token' => 'required|string|max:255',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (!$user || !$this->resets->isValid($user, trim($validated['token']))) {
            return response()->json([
                'message' => 'This reset code is invalid or has expired. Request a new one.',
            ], 422);
        }

        $user->forceFill([
            'password' => Hash::make($validated['password']),
            'must_change_password' => false,
            'failed_login_attempts' => 0,
            'locked_until' => null,
        ])->save();

        $user->tokens()->delete();
        $this->resets->consume($user);

        AuditLog::log('password_reset_completed', 'User', (string) $user->id, null, [
            'source' => 'self_service',
        ], $user->store_id, $user->id);

        return response()->json([
            'success' => true,
            'message' => 'Password updated. Sign in with your new password.',
        ]);
    }

    private function findUser(string $identifier): ?User
    {
        $user = User::where('email', $identifier)->orWhere('username', $identifier)->first();

        if ($user) {
            return $user;
        }

        $domains = ['@alverstone.in', '@lamstone.in', '@lamsuite.com'];
        foreach ($domains as $from) {
            if (!str_ends_with(strtolower($identifier), $from)) {
                continue;
            }
            foreach ($domains as $to) {
                if ($from === $to) {
                    continue;
                }
                $alias = substr($identifier, 0, -strlen($from)) . $to;
                $user = User::where('email', $alias)->first();
                if ($user) {
                    return $user;
                }
            }
        }

        return null;
    }

    private function sendEmail(User $user, string $resetUrl, string $token): bool
    {
        try {
            if (!StoreSmtpConfigurator::configure($user->store_id)) {
                return false;
            }

            Mail::to($user->email)->send(new PasswordResetMail(
                $user->name ?: ($user->username ?: $user->email),
                $resetUrl,
                $token,
                PasswordResetService::TOKEN_TTL_MINUTES,
            ));

            return true;
        } catch (\Throwable $e) {
            Log::warning('Password reset email failed', [
                'user_id' => $user->id,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }
}
