<?php

namespace App\Casts;

use App\Services\StoreClock;
use Carbon\CarbonInterface;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Contracts\Database\Eloquent\SerializesCastableAttributes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A date with no time of day, such as a batch expiry or manufacturing date (UI-03, G8-UI).
 *
 * Laravel's plain `date` cast treats the value as an instant. It serialises 31-03-2027 as
 * "2027-03-30T18:30:00.000000Z" (midnight IST in UTC). When that string came back with a return,
 * it was stored as "2027-03-30 18:30:00", one day early, and every later round trip lost
 * another day.
 *
 * This cast:
 * - stores and serialises the calendar day as `Y-m-d`;
 * - reads a timestamp in the store's time zone before taking its day, because it stands for
 *   midnight there;
 * - still returns a Carbon at the start of that day, so callers keep `->toDateString()`,
 *   comparisons and `->format()`.
 */
class CalendarDate implements CastsAttributes, SerializesCastableAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): ?Carbon
    {
        $day = self::toDay($value);

        return $day === null ? null : Carbon::createFromFormat('Y-m-d', $day)->startOfDay();
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        return self::toDay($value);
    }

    public function serialize(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        return $value instanceof CarbonInterface ? $value->toDateString() : self::toDay($value);
    }

    /**
     * The calendar day (`Y-m-d`) a stored or incoming value stands for, or null when empty.
     *
     * - "2027-03-31" and "2027-03-31 00:00:00" are already a day.
     * - A timestamp with a time of day, like "2027-03-30T18:30:00.000000Z", or a row the old cast
     *   wrote as "2027-03-30 18:30:00" (UTC), is read as an instant and turned into its day in the
     *   store's time zone.
     */
    public static function toDay(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $tz = StoreClock::timezone();

        if ($value instanceof \DateTimeInterface) {
            $instant = Carbon::instance($value);
            // A Carbon that is already midnight in its own zone is a day, not an instant.
            return $instant->format('H:i:s') === '00:00:00'
                ? $instant->toDateString()
                : $instant->setTimezone($tz)->toDateString();
        }

        $s = trim((string) $value);
        if (preg_match('/^(\d{4}-\d{2}-\d{2})(?:[ T]00:00(?::00(?:\.0+)?)?)?$/', $s, $m)) {
            return $m[1];
        }

        // The old cast stored "Y-m-d H:i:s" from a UTC instant; a zone-less timestamp is UTC.
        $instant = preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $s)
            ? Carbon::parse($s, 'UTC')
            : Carbon::parse($s);

        return $instant->setTimezone($tz)->toDateString();
    }
}
