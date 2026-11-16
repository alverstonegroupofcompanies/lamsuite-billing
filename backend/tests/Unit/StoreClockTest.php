<?php

namespace Tests\Unit;

use App\Services\StoreClock;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\TestCase;

class StoreClockTest extends TestCase
{
    public function test_parses_date_only_values_in_store_timezone(): void
    {
        $instant = StoreClock::parseDate('2026-10-30');
        $this->assertSame('2026-10-29T18:30:00+00:00', $instant->toIso8601String());
    }

    public function test_store_date_uses_store_calendar_for_timestamps(): void
    {
        $this->assertSame('2026-10-30', StoreClock::storeDate('2026-10-29T18:30:00Z'));
        $this->assertSame('2026-10-29', StoreClock::storeDate('2026-10-29T18:15:00Z'));
        $this->assertSame('2026-10-30', StoreClock::storeDate(new Carbon('2026-10-29T19:00:00Z')));
        $this->assertSame('2026-10-29', StoreClock::storeDate('2026-10-29'));
    }

    public function test_today_range_is_half_open_in_store_timezone(): void
    {
        $now = Carbon::parse('2026-10-29T18:45:00Z');
        $range = StoreClock::periodRange('today', null, $now);

        $this->assertSame('2026-10-30', $range['startDate']);
        $this->assertSame('2026-10-30', $range['endDate']);
        $this->assertSame('2026-10-29T18:30:00+00:00', $range['startUtc']->toIso8601String());
        $this->assertSame('2026-10-30T18:30:00+00:00', $range['endUtc']->toIso8601String());
    }

    public function test_yesterday_week_month_and_all_time_ranges(): void
    {
        $now = Carbon::parse('2026-10-29T12:00:00Z');
        $this->assertSame('2026-10-28', StoreClock::periodRange('yesterday', null, $now)['startDate']);
        $this->assertSame('2026-10-23', StoreClock::periodRange('last7', null, $now)['startDate']);
        $this->assertSame('2026-10-01', StoreClock::periodRange('this_month', null, $now)['startDate']);
        $this->assertSame('2026-10-26', StoreClock::periodRange('this_week', null, $now)['startDate']);
        $this->assertSame(
            ['startDate' => null, 'endDate' => null, 'startUtc' => null, 'endUtc' => null],
            StoreClock::periodRange('all_time', null, $now)
        );
    }

    public function test_utc_iso_output(): void
    {
        $instant = Carbon::parse('2026-10-30T00:30:00+05:30');
        $this->assertSame('2026-10-29T19:00:00+00:00', StoreClock::utcIso($instant));
    }
}
