<?php

namespace Tests\Unit;

use App\Services\Auth\PinPolicy;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\TestCase;
use ReflectionClass;
use ReflectionMethod;

/**
 * PRF-006 / B6 — one PIN policy behind every credential the store issues.
 * The four counter domains (counter unlock, approver, salesperson, pharmacist)
 * are strict; the legacy staff domain keeps the 4-digit floor so PINs already
 * in the field stay valid until Wave B7 replaces that login.
 */
class PinPolicyTest extends TestCase
{
    public const STRICT_DOMAINS = [PinPolicy::DOMAIN_COUNTER, PinPolicy::DOMAIN_APPROVER, PinPolicy::DOMAIN_SALESPERSON, PinPolicy::DOMAIN_PHARMACIST];

    public function test_repeated_and_trivial_pins_are_rejected_in_every_domain(): void
    {
        foreach (self::STRICT_DOMAINS as $domain) {
            foreach (['0000', '1111', '222222', '1234', '4321', '0123', '3210', '12345', '54321', '123456', '654321', '012345', '543210'] as $weak) {
                $this->assertNotNull(
                    PinPolicy::validate($weak, $domain),
                    "{$domain} must reject the weak PIN {$weak}"
                );
            }
        }
    }

    public function test_a_whole_length_sequence_is_rejected_not_only_the_listed_ones(): void
    {
        // Neither value was ever in the old hard-coded list, and both are pure runs.
        $this->assertNotNull(PinPolicy::validate('234567', PinPolicy::DOMAIN_COUNTER));
        $this->assertNotNull(PinPolicy::validate('987654', PinPolicy::DOMAIN_COUNTER));
    }

    public function test_a_pin_that_wraps_past_nine_is_not_a_sequence_and_stays_usable(): void
    {
        // Field PINs like 7890 must not be refused by the sequence rule.
        $this->assertNull(PinPolicy::validate('7890', PinPolicy::DOMAIN_STAFF));
        $this->assertNull(PinPolicy::validate('908123', PinPolicy::DOMAIN_COUNTER));
    }

    public function test_the_counter_domains_need_six_digits_and_no_more(): void
    {
        foreach (self::STRICT_DOMAINS as $domain) {
            $this->assertNotNull(PinPolicy::validate('12345', $domain), "{$domain} must refuse 5 digits");
            $this->assertNotNull(PinPolicy::validate('1234567', $domain), "{$domain} must refuse 7 digits");
            $this->assertNull(PinPolicy::validate('582912', $domain), "{$domain} must accept a strong 6-digit PIN");
        }
    }

    public function test_digits_only_and_an_unknown_domain_fails_closed(): void
    {
        $this->assertNotNull(PinPolicy::validate('58a912', PinPolicy::DOMAIN_COUNTER));
        $this->assertNotNull(PinPolicy::validate('', PinPolicy::DOMAIN_COUNTER));
        $this->assertNotNull(PinPolicy::validate(' 582912', PinPolicy::DOMAIN_COUNTER));
        $this->assertNotNull(PinPolicy::validate('582912', 'guest'));
    }

    public function test_the_legacy_staff_domain_keeps_its_four_digit_floor_and_words(): void
    {
        $this->assertNull(PinPolicy::validate('5829', PinPolicy::DOMAIN_STAFF));
        $this->assertNotNull(PinPolicy::validate('582', PinPolicy::DOMAIN_STAFF));

        $this->assertSame(
            'PIN must be between 4 and 6 numeric digits.',
            PinPolicy::validate('582', PinPolicy::DOMAIN_STAFF)
        );
        $this->assertSame(
            'PIN cannot consist of repeated digits (e.g. 1111).',
            PinPolicy::validate('1111', PinPolicy::DOMAIN_STAFF)
        );
        $this->assertSame(
            'Trivial sequential PINs are not allowed for security reasons.',
            PinPolicy::validate('1234', PinPolicy::DOMAIN_STAFF)
        );
    }

    public function test_the_fifth_wrong_attempt_is_when_a_credential_locks(): void
    {
        $this->assertSame(5, PinPolicy::MAX_FAILED_ATTEMPTS);
        $this->assertSame(15, PinPolicy::LOCKOUT_MINUTES);

        $this->assertSame(5, PinPolicy::attemptsAllowed(null));
        $this->assertSame(3, PinPolicy::attemptsAllowed(3));
        $this->assertSame(5, PinPolicy::attemptsAllowed(5));

        $this->assertNull(PinPolicy::lockoutUntil(4, null), 'the fourth failure must not lock');
        $this->assertNotNull(PinPolicy::lockoutUntil(5, null), 'the fifth failure must lock');
        $this->assertNull(PinPolicy::lockoutUntil(2, 3), 'a store can lower the bar');
        $this->assertNotNull(PinPolicy::lockoutUntil(3, 3));
    }

    public function test_the_lockout_window_is_measured_in_the_instant_it_starts(): void
    {
        $start = Carbon::parse('2026-11-21 10:00:00');

        $this->assertSame('2026-11-21 10:15:00', PinPolicy::lockoutUntil(5, null, $start)->format('Y-m-d H:i:s'));
        $this->assertSame(
            '2026-11-21 10:00:00',
            $start->format('Y-m-d H:i:s'),
            'the policy never advances the caller\'s clock'
        );

        $ends = PinPolicy::lockoutUntil(5, null, Carbon::parse('2026-11-21 10:00:00'));

        $this->assertTrue(PinPolicy::isLocked($ends, Carbon::parse('2026-11-21 10:14:59')));
        $this->assertFalse(PinPolicy::isLocked($ends, Carbon::parse('2026-11-21 10:15:00')), 'the window is half open');
        $this->assertFalse(PinPolicy::isLocked(null, Carbon::parse('2026-11-21 10:00:00')), 'no stored window means no lock');
    }

    public function test_remaining_attempts_never_goes_negative(): void
    {
        $this->assertSame(4, PinPolicy::remainingAttempts(1, null));
        $this->assertSame(0, PinPolicy::remainingAttempts(5, null));
        $this->assertSame(0, PinPolicy::remainingAttempts(9, null), 'a stale counter cannot promise attempts');
    }

    public function test_the_policy_hands_back_no_credential(): void
    {
        $public = array_map(
            static fn (ReflectionMethod $m) => $m->getName(),
            (new ReflectionClass(PinPolicy::class))->getMethods(ReflectionMethod::IS_PUBLIC)
        );

        sort($public);

        $this->assertSame(
            ['attemptsAllowed', 'isLocked', 'lockoutUntil', 'maxLength', 'minLength', 'remainingAttempts', 'validate'],
            $public,
            'PinPolicy exposes judgement only — nothing that stores or returns a PIN'
        );

        foreach ((new ReflectionClass(PinPolicy::class))->getProperties() as $property) {
            $this->assertTrue($property->isStatic(), "an instance property could hold a PIN for {$property->getName()}");
        }
    }
}
