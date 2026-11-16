<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class PasswordResetService
{
    public const TOKEN_TTL_MINUTES = 60;

    /**
     * Issue a fresh single-use reset token, replacing any previous one.
     */
    public function issue(User $user): string
    {
        $token = Str::random(64);

        DB::table('password_reset_tokens')->updateOrInsert(
            ['email' => $user->email],
            ['token' => Hash::make($token), 'created_at' => now()]
        );

        return $token;
    }

    /**
     * Check a plain reset code against the stored hash and expiry window.
     */
    public function isValid(User $user, string $token): bool
    {
        $row = DB::table('password_reset_tokens')->where('email', $user->email)->first();

        if (!$row || !$row->created_at || !$row->token) {
            return false;
        }

        if (Carbon::parse($row->created_at)->addMinutes(self::TOKEN_TTL_MINUTES)->isPast()) {
            return false;
        }

        return Hash::check($token, $row->token);
    }

    public function consume(User $user): void
    {
        DB::table('password_reset_tokens')->where('email', $user->email)->delete();
    }

    public function resetUrl(User $user, string $token): string
    {
        $base = rtrim((string) config('app.admin_url', config('app.url')), '/');

        return sprintf(
            '%s/reset-password?email=%s&token=%s',
            $base,
            urlencode($user->email),
            urlencode($token)
        );
    }
}
