<?php

namespace App\Support;

use App\Models\MasterLookup;
use App\Models\Store;
use Illuminate\Support\Collection;

/**
 * GAP-02 / PHR-001 — what a drug schedule means.
 *
 * The owner writes the list; the server reads it. A schedule is a per-store
 * lookup row (`master_lookups.type = 'drug_schedule'`) whose config says two
 * things: whether a bill containing it needs a pharmacist, and whether it
 * needs prescription details. Nothing else in the codebase gets to decide that,
 * so moving one row off the restricted list changes the next bill and leaves
 * every bill already saved exactly as it was written.
 *
 * A store that sells no medicines has no list, so every question here answers
 * "no" — which is what keeps the pharmacist rule out of a grocery till.
 */
final class DrugSchedule
{
    public const TYPE = 'drug_schedule';

    /** The two marks an owner can set, and the shape a saved config takes. */
    public const CONFIG_KEYS = ['restricted', 'prescription_required'];

    /**
     * This store's schedules, active first, in the order the owner sees them.
     *
     * @return Collection<int, MasterLookup>
     */
    public static function forStore(int $storeId, bool $activeOnly = true): Collection
    {
        return MasterLookup::query()
            ->where('store_id', $storeId)
            ->where('type', self::TYPE)
            ->when($activeOnly, fn ($q) => $q->where('is_active', true))
            ->orderBy('code')
            ->orderBy('name')
            ->get();
    }

    public static function find(string $code, int $storeId): ?MasterLookup
    {
        $clean = strtoupper(trim($code));

        if ($clean === '') {
            return null;
        }

        return MasterLookup::query()
            ->where('store_id', $storeId)
            ->where('type', self::TYPE)
            ->where('is_active', true)
            ->where(fn ($q) => $q->whereRaw('UPPER(code) = ?', [$clean])->orWhereRaw('UPPER(name) = ?', [$clean]))
            ->first();
    }

    /** The codes this store marks restricted — what the pharmacist gate reads. */
    public static function restrictedCodes(int $storeId): array
    {
        return self::codesWhere($storeId, 'restricted');
    }

    /** The codes that need a doctor and patient named on the bill. */
    public static function prescriptionCodes(int $storeId): array
    {
        return self::codesWhere($storeId, 'prescription_required');
    }

    public static function isRestricted(?string $code, ?int $storeId): bool
    {
        return self::marked($code, $storeId, 'restricted');
    }

    public static function requiresPrescription(?string $code, ?int $storeId): bool
    {
        return self::marked($code, $storeId, 'prescription_required');
    }

    public static function showsFor(?Store $store): bool
    {
        return $store !== null && (string) ($store->store_type ?? '') === 'pharmacy';
    }

    /**
     * Only the two marks survive a save, so a stray key in a payload can never
     * become a rule the server later reads.
     *
     * @param  array<string,mixed>  $config
     * @return array<string,bool>
     */
    public static function cleanConfig(array $config, array $existing = []): array
    {
        $clean = [];

        foreach (self::CONFIG_KEYS as $key) {
            $value = array_key_exists($key, $config) ? $config[$key] : ($existing[$key] ?? false);
            $clean[$key] = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
        }

        // Anything the owner already stored that is not one of the marks is
        // kept: a schedule row may carry notes the panel showed them.
        foreach ($existing as $key => $value) {
            if (!is_string($key) || in_array($key, self::CONFIG_KEYS, true) || is_array($value)) {
                continue;
            }
            $clean[$key] = $value;
        }

        return $clean;
    }

    /**
     * @return list<string>
     */
    private static function codesWhere(int $storeId, string $mark): array
    {
        $codes = [];

        foreach (self::forStore($storeId) as $schedule) {
            if (self::markedIn((array) ($schedule->config ?? []), $mark)) {
                $codes[] = strtoupper((string) ($schedule->code ?: $schedule->name));
            }
        }

        return array_values(array_unique(array_filter($codes)));
    }

    private static function marked(?string $code, ?int $storeId, string $mark): bool
    {
        if ($code === null || $storeId === null || trim($code) === '') {
            return false;
        }

        $schedule = self::find($code, $storeId);

        return $schedule !== null && self::markedIn((array) ($schedule->config ?? []), $mark);
    }

    /** @param array<string,mixed> $config */
    private static function markedIn(array $config, string $mark): bool
    {
        return filter_var($config[$mark] ?? false, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) === true;
    }
}
