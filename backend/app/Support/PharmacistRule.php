<?php

namespace App\Support;

use App\Models\Counter;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use App\Services\Auth\PinPolicy;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

/**
 * PHR-002, PHR-003, PHR-008 — who may confirm a restricted-drug bill.
 *
 * The right to confirm is not a permission and not a login: it is a live
 * registration with the council, held by a person the store has recorded. So
 * every question here is answered from the registration itself and the moment
 * the bill is written — an expired window refuses today and allows tomorrow if
 * the owner renews it, and a person who has left the staff list can never
 * confirm again, however valid their number still reads.
 *
 * The PIN that proves the pharmacist is standing at the till belongs to the
 * pharmacist domain, which is the CR's one cross-domain rule: the digits that
 * unlock a counter or approve a bill may not also confirm a restricted drug.
 * Two jobs, two secrets.
 */
final class PharmacistRule
{
    /** What the refusal calls the credential, so the message can name the job. */
    public const PIN_SUBJECT = 'pharmacist PIN';

    public static function shows(?Store $store): bool
    {
        return DrugSchedule::showsFor($store);
    }

    /**
     * Why this person may not confirm a bill right now, in the words an owner
     * or a cashier needs; null when they may.
     */
    public static function refusal(?Salesperson $person, ?Carbon $at = null): ?string
    {
        if ($person === null) {
            return 'No pharmacist was named on this bill.';
        }

        $now = ($at ?? Carbon::now())->copy();

        if (!$person->is_pharmacist) {
            return "\"{$person->name}\" is not registered as a pharmacist.";
        }

        if ($person->archived_at !== null) {
            return "\"{$person->name}\" has left the store, so their registration cannot confirm a bill.";
        }

        if (!$person->is_active) {
            return "\"{$person->name}\" is switched off in the staff list, so they cannot confirm a bill.";
        }

        $regNo = trim((string) ($person->reg_no ?? ''));

        if ($regNo === '') {
            return "\"{$person->name}\" has no registration number recorded.";
        }

        $from = $person->reg_valid_from;
        $until = $person->reg_valid_until;

        if ($from === null || $until === null) {
            return "Registration {$regNo} has no validity window, so it cannot be trusted.";
        }

        if ($now->lt($from->copy()->startOfDay())) {
            return "Registration {$regNo} starts on {$from->toDateString()}, not before.";
        }

        if ($now->gt($until->copy()->endOfDay())) {
            return "Registration {$regNo} expired on {$until->toDateString()}.";
        }

        if (!$person->has_pin) {
            return "\"{$person->name}\" has no personal PIN, so they cannot confirm a bill.";
        }

        return null;
    }

    public static function canConfirm(?Salesperson $person, ?Carbon $at = null): bool
    {
        return self::refusal($person, $at) === null;
    }

    /** The policy this credential is judged by — six digits, nothing trivial. */
    public static function pinRefusal(?string $pin): ?string
    {
        return PinPolicy::validate($pin, PinPolicy::DOMAIN_PHARMACIST, self::PIN_SUBJECT);
    }

    /**
     * PHR-008: the same digits may not serve two jobs in one store.
     *
     * @return string|null which other credential already carries this PIN
     */
    public static function pinCollision(int $storeId, string $pin, ?int $ignoreSalespersonId = null): ?string
    {
        $people = User::query()
            ->where('store_id', $storeId)
            ->where('is_approver', true)
            ->whereNotNull('pin_hash')
            ->pluck('pin_hash');

        if ($people->contains(fn (string $hash): bool => Hash::check($pin, $hash))) {
            return 'approver';
        }

        $counters = Counter::query()
            ->where('store_id', $storeId)
            ->whereNotNull('unlock_pin_hash')
            ->pluck('unlock_pin_hash');

        if ($counters->contains(fn (string $hash): bool => Hash::check($pin, $hash))) {
            return 'counter';
        }

        $other = Salesperson::query()
            ->where('store_id', $storeId)
            ->where('is_pharmacist', true)
            ->whereNotNull('pin_hash')
            ->when($ignoreSalespersonId, fn ($q) => $q->where('id', '!=', $ignoreSalespersonId))
            ->pluck('pin_hash');

        if ($other->contains(fn (string $hash): bool => Hash::check($pin, $hash))) {
            return 'pharmacist';
        }

        return null;
    }

    public static function pinCollisionRefusal(?string $domain, int $storeId): ?string
    {
        if ($domain === null) {
            return null;
        }

        return match ($domain) {
            'approver' => 'This PIN is already an approver PIN in this store. A pharmacist needs a PIN of their own.',
            'counter' => 'This PIN is already the unlock PIN of a counter in this store. A pharmacist needs a PIN of their own.',
            default => 'This PIN is already another pharmacist\'s PIN in this store.',
        };
    }
}
