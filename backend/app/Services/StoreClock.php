<?php

namespace App\Services;

use App\Models\Store;
use Illuminate\Support\Carbon;

/**
 * Single source of truth for store-time calculations on the server.
 * Timestamps are stored in UTC; document dates and period boundaries are
 * computed in the store's configured timezone (default Asia/Kolkata).
 */
class StoreClock
{
    public const DEFAULT_TIMEZONE = 'Asia/Kolkata';

    public static function timezone(?Store $store = null): string
    {
        $tz = $store?->timezone;
        return is_string($tz) && trim($tz) !== '' ? $tz : self::DEFAULT_TIMEZONE;
    }

    public static function now(?Store $store = null): Carbon
    {
        return Carbon::now(self::timezone($store));
    }

    public static function today(?Store $store = null): Carbon
    {
        return self::now($store)->startOfDay();
    }

    /** Calendar date (YYYY-MM-DD) for an instant in the store timezone. */
    public static function storeDate($value, ?Store $store = null): string
    {
        $tz = self::timezone($store);
        if ($value instanceof Carbon || $value instanceof \DateTimeInterface) {
            return Carbon::instance($value)->setTimezone($tz)->toDateString();
        }
        if (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($value))) {
            return trim($value);
        }
        return Carbon::parse($value)->setTimezone($tz)->toDateString();
    }

    /** Local midnight for a date-only value, expressed as a UTC instant. */
    public static function parseDate(string $date, ?Store $store = null): Carbon
    {
        return Carbon::parse($date, self::timezone($store))->startOfDay()->utc();
    }

    /**
     * @return array{startDate:?string,endDate:?string,startUtc:?Carbon,endUtc:?Carbon}
     */
    public static function periodRange(string $period, ?Store $store = null, ?Carbon $now = null): array
    {
        $tz = self::timezone($store);
        $now = $now ? $now->copy()->setTimezone($tz) : Carbon::now($tz);
        $today = $now->toDateString();

        if ($period === 'all_time' || $period === 'all') {
            return ['startDate' => null, 'endDate' => null, 'startUtc' => null, 'endUtc' => null];
        }

        $start = $today;
        switch ($period) {
            case 'today':
                break;
            case 'yesterday':
                $start = $now->copy()->subDay()->toDateString();
                break;
            case 'last7':
            case 'last_7_days':
                $start = $now->copy()->subDays(6)->toDateString();
                break;
            case 'this_week':
                $start = $now->copy()->startOfWeek(Carbon::MONDAY)->toDateString();
                break;
            case 'this_month':
                $start = $now->copy()->startOfMonth()->toDateString();
                break;
            default:
                $start = $today;
        }

        $endDate = $period === 'yesterday'
            ? $now->copy()->subDay()->toDateString()
            : $today;

        return [
            'startDate' => $start,
            'endDate' => $endDate,
            'startUtc' => self::parseDate($start, $store),
            'endUtc' => self::parseDate(Carbon::parse($endDate, $tz)->addDay()->toDateString(), $store),
        ];
    }

    public static function utcIso($value): string
    {
        return Carbon::instance($value)->utc()->toIso8601String();
    }
}
