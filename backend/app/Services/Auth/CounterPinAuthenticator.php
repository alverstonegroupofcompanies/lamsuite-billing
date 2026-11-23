<?php

namespace App\Services\Auth;

use App\Models\AuditLog;
use App\Models\Counter;
use Illuminate\Support\Facades\Hash;

/**
 * PRF-006 / PRF-007 — one place a counter's own PIN is checked.
 *
 * The unlock screen (B7) and the drawer (B9) present the same credential, so
 * they must fail the same way: the same five attempts, the same lockout, the
 * same refusal, and the same rule that only an owner can reset it. Keeping the
 * comparison here means a second caller cannot quietly invent a weaker path to
 * the counter's money.
 *
 * A submitted PIN is only ever compared, never policy-checked: a typo is wrong,
 * it is not a policy violation. Nothing here stores, returns or logs one.
 */
final class CounterPinAuthenticator
{
    public const NOT_SET = 'counter_unlock_pin_not_set';
    public const LOCKED = 'counter_unlock_locked';
    public const WRONG = 'INVALID_UNLOCK_PIN';
    public const MISSING = 'counter_pin_required';

    /**
     * @return array{ok: bool, code: string, message: string, status: int, remaining_attempts?: int, locked_until?: string}
     */
    public function verify(Counter $counter, ?string $pin): array
    {
        if ($pin === null || trim($pin) === '') {
            return $this->refusal(self::MISSING, 'Enter this counter\'s PIN to continue.', 422);
        }

        if (!$counter->unlock_pin_hash) {
            return $this->refusal(
                self::NOT_SET,
                'This counter has no unlock PIN yet. Ask the store owner to set one in Admin Panel → Counters.',
                409
            );
        }

        if (PinPolicy::isLocked($counter->unlock_locked_until)) {
            return $this->refusal(
                self::LOCKED,
                'Too many wrong attempts on this counter. The store owner must reset its unlock PIN.',
                423,
                ['locked_until' => $counter->unlock_locked_until->toIso8601String()]
            );
        }

        if (Hash::check($pin, $counter->unlock_pin_hash)) {
            $counter->update(['unlock_failed_attempts' => 0, 'unlock_locked_until' => null]);

            return ['ok' => true, 'code' => 'ok', 'message' => 'Counter PIN verified.', 'status' => 200];
        }

        $counter->increment('unlock_failed_attempts');
        $attempts = (int) $counter->unlock_failed_attempts;
        $lockedUntil = PinPolicy::lockoutUntil($attempts, null);

        if ($lockedUntil !== null) {
            $counter->update(['unlock_locked_until' => $lockedUntil]);

            AuditLog::log('counter_unlock_locked', 'Counter', (string) $counter->id, null, [
                'reason' => 'max_failed_attempts_exceeded',
                'locked_until' => $lockedUntil->toIso8601String(),
            ], $counter->store_id);

            return $this->refusal(
                self::LOCKED,
                'Too many wrong attempts on this counter. The store owner must reset its unlock PIN.',
                423,
                ['locked_until' => $lockedUntil->toIso8601String(), 'remaining_attempts' => 0]
            );
        }

        AuditLog::log('counter_unlock_failed', 'Counter', (string) $counter->id, null, [
            'reason' => 'wrong_pin',
            'failed_attempts' => $attempts,
            'remaining_attempts' => PinPolicy::remainingAttempts($attempts, null),
        ], $counter->store_id);

        return $this->refusal(
            self::WRONG,
            'That is not this counter\'s unlock PIN.',
            422,
            ['remaining_attempts' => PinPolicy::remainingAttempts($attempts, null)]
        );
    }

    /** @param array<string,mixed> $extra */
    private function refusal(string $code, string $message, int $status, array $extra = []): array
    {
        return ['ok' => false, 'code' => $code, 'message' => $message, 'status' => $status] + $extra;
    }
}
