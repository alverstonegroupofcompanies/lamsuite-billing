<?php

namespace App\Services\Auth;

use Illuminate\Support\Carbon;

/**
 * PRF-006 — the one PIN policy every credential the store issues is judged by.
 *
 * The counter, approver, salesperson and pharmacist domains are the CR's four
 * credential domains (plan-delta §4.5): 6 digits, no trivial values. `staff` is
 * the legacy till login, which still accepts 4 digits so PINs already issued in
 * the field stay valid until B8 removes that login.
 *
 * Lockouts are recorded per subject (a counter, an approver) in that subject's
 * own attempt/locked_until columns; this class only decides what those numbers
 * mean. Reset is an admin-panel action and the plaintext PIN never leaves the
 * browser, so nothing here stores or returns one.
 */
class PinPolicy
{
    public const DOMAIN_COUNTER = 'counter';
    public const DOMAIN_APPROVER = 'approver';
    public const DOMAIN_SALESPERSON = 'salesperson';
    public const DOMAIN_PHARMACIST = 'pharmacist';
    public const DOMAIN_STAFF = 'staff';

    /** PRF-006: five wrong attempts, then the credential waits for an owner. */
    public const MAX_FAILED_ATTEMPTS = 5;
    public const LOCKOUT_MINUTES = 15;

    /** @var array<string, array{int, int}> domain => [min length, max length] */
    private const LENGTHS = [
        self::DOMAIN_COUNTER => [6, 6],
        self::DOMAIN_APPROVER => [6, 6],
        self::DOMAIN_SALESPERSON => [6, 6],
        self::DOMAIN_PHARMACIST => [6, 6],
        self::DOMAIN_STAFF => [4, 6],
    ];

    public static function minLength(string $domain): ?int
    {
        return self::LENGTHS[$domain][0] ?? null;
    }

    public static function maxLength(string $domain): ?int
    {
        return self::LENGTHS[$domain][1] ?? null;
    }

    /**
     * @param  string  $subject  what the refusal calls the credential, so an
     *                           owner editing a pharmacist is told so plainly
     * @return string|null the operator-facing refusal, or null when the PIN is acceptable
     */
    public static function validate(?string $pin, string $domain, string $subject = 'PIN'): ?string
    {
        $min = self::minLength($domain);
        $max = self::maxLength($domain);

        if ($min === null || $max === null) {
            return 'Unknown PIN domain.';
        }

        if (!preg_match('/^\d{' . $min . ',' . $max . '}$/', (string) $pin)) {
            return $min === $max
                ? "{$subject} must be {$min} numeric digits."
                : "{$subject} must be between {$min} and {$max} numeric digits.";
        }

        if (preg_match('/^(.)\1+$/', $pin)) {
            return "{$subject} cannot consist of repeated digits (e.g. 1111).";
        }

        if (self::isSequential($pin)) {
            return "Trivial sequential {$subject}s are not allowed for security reasons.";
        }

        return null;
    }

    /** A subject may lower its own bar; the policy supplies the default. */
    public static function attemptsAllowed(?int $perSubject): int
    {
        return $perSubject ?? self::MAX_FAILED_ATTEMPTS;
    }

    public static function remainingAttempts(int $failed, ?int $perSubject): int
    {
        return max(0, self::attemptsAllowed($perSubject) - $failed);
    }

    /** @return Carbon|null the instant the lockout ends, when this failure triggers one */
    public static function lockoutUntil(int $failed, ?int $perSubject, ?Carbon $now = null): ?Carbon
    {
        if ($failed < self::attemptsAllowed($perSubject)) {
            return null;
        }

        // copy(): Carbon is mutable, and a caller's clock is not ours to advance.
        return ($now ?? Carbon::now())->copy()->addMinutes(self::LOCKOUT_MINUTES);
    }

    public static function isLocked(?Carbon $lockedUntil, ?Carbon $now = null): bool
    {
        if ($lockedUntil === null) {
            return false;
        }

        return $lockedUntil->gt($now ?? Carbon::now());
    }

    /** A whole-length run up or down (123456, 4321) — a run that wraps past 9 is not one. */
    private static function isSequential(string $pin): bool
    {
        $digits = array_map('intval', str_split($pin));

        $ascending = true;
        $descending = true;
        for ($i = 1, $count = count($digits); $i < $count; $i++) {
            if ($digits[$i] !== $digits[$i - 1] + 1) {
                $ascending = false;
            }
            if ($digits[$i] !== $digits[$i - 1] - 1) {
                $descending = false;
            }
        }

        return $ascending || $descending;
    }
}
