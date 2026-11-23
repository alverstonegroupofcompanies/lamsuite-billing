<?php

namespace App\Services\Counter;

use App\Models\Counter;
use App\Models\CounterPresenceSpan;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * CNT-01 — the counter list has to answer "when was it last here, and when was
 * it dark?" A session row only remembers its latest beat, so this service keeps
 * presence as spans: one beat extends the current span while it is still warm,
 * and a beat after the quiet window opens a new one. The gaps are the counter's
 * offline periods, and the last one stays open while the counter is away.
 */
class CounterPresenceService
{
    /** A counter that has not been heard from for this long is dark. */
    public const OFFLINE_AFTER_MINUTES = 5;

    /** The panel explains the last day of gaps; older history is not a picture. */
    public const LOOKBACK_HOURS = 24;

    public const MAX_PERIODS = 10;

    /**
     * Record that the counter is present right now. Returns the span the beat
     * belongs to, extending it or opening a new one as the gap demands.
     */
    public function beat(Counter $counter, ?CarbonInterface $at = null): CounterPresenceSpan
    {
        $at = $at !== null ? Carbon::instance($at) : now();

        $open = CounterPresenceSpan::where('counter_id', $counter->id)
            ->where('last_beat_at', '>=', $at->copy()->subMinutes(self::OFFLINE_AFTER_MINUTES))
            ->orderByDesc('last_beat_at')
            ->first();

        if ($open) {
            if ($at->gt($open->last_beat_at)) {
                $open->update(['last_beat_at' => $at]);
            }

            return $open;
        }

        return CounterPresenceSpan::create([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'started_at' => $at,
            'last_beat_at' => $at,
        ]);
    }

    /**
     * Presence facts for a whole roster, in one pair of queries.
     *
     * @param Collection<int, Counter> $counters
     * @return array<int, array{last_beat_at:?string, online:bool, offline_since:?string, offline_periods:array<int, array{started_at:string, ended_at:?string, minutes:int}>}>
     */
    public function summaries(Collection $counters, ?CarbonInterface $now = null): array
    {
        $now = $now !== null ? Carbon::instance($now) : now();
        $ids = $counters->pluck('id')->map(fn ($id) => (int) $id)->all();

        if ($ids === []) {
            return [];
        }

        $lookback = $now->copy()->subHours(self::LOOKBACK_HOURS);

        $spans = CounterPresenceSpan::whereIn('counter_id', $ids)
            ->where('last_beat_at', '>=', $lookback)
            ->orderBy('started_at')
            ->get()
            ->groupBy('counter_id');

        $latestBeats = CounterPresenceSpan::whereIn('counter_id', $ids)
            ->selectRaw('counter_id, MAX(last_beat_at) as last_beat_at')
            ->groupBy('counter_id')
            ->pluck('last_beat_at', 'counter_id');

        $summaries = [];
        foreach ($ids as $id) {
            $summaries[$id] = $this->summarise(
                $spans->get($id, collect()),
                isset($latestBeats[$id]) ? Carbon::parse($latestBeats[$id]) : null,
                $lookback,
                $now
            );
        }

        return $summaries;
    }

    /**
     * @param Collection<int, CounterPresenceSpan> $spans
     * @return array{last_beat_at:?string, online:bool, offline_since:?string, offline_periods:array<int, array{started_at:string, ended_at:?string, minutes:int}>}
     */
    private function summarise(Collection $spans, ?Carbon $lastBeat, Carbon $lookback, Carbon $now): array
    {
        $offlineAfter = $now->copy()->subMinutes(self::OFFLINE_AFTER_MINUTES);
        $online = $lastBeat !== null && $lastBeat->gte($offlineAfter);

        if ($lastBeat === null) {
            // No presence history yet: the counter was never heard from, so
            // there is no gap to describe rather than a full day of one.
            return [
                'last_beat_at' => null,
                'online' => false,
                'offline_since' => null,
                'offline_periods' => [],
            ];
        }

        $periods = [];
        $cursor = null;

        foreach ($spans as $span) {
            // Only a gap between two spans the store actually heard is an
            // offline period; time before the first span is simply unknown.
            if ($cursor !== null && $span->started_at->gt($cursor)) {
                $periods[] = $this->period($cursor, $span->started_at);
            }

            if ($cursor === null || $span->last_beat_at->gt($cursor)) {
                $cursor = $span->last_beat_at;
            }
        }

        $offlineSince = null;
        if (! $online) {
            $offlineSince = $lastBeat->toIso8601String();
            $periods[] = $this->period($cursor ?? $lookback, null, $now);
        }

        return [
            'last_beat_at' => $lastBeat->toIso8601String(),
            'online' => $online,
            'offline_since' => $offlineSince,
            'offline_periods' => array_slice($periods, -self::MAX_PERIODS),
        ];
    }

    /** @return array{started_at:string, ended_at:?string, minutes:int} */
    private function period(Carbon $start, ?Carbon $end, ?Carbon $now = null): array
    {
        $closedAt = $end ?? $now ?? now();

        return [
            'started_at' => $start->toIso8601String(),
            'ended_at' => $end?->toIso8601String(),
            'minutes' => max(0, (int) round($start->diffInSeconds($closedAt) / 60)),
        ];
    }
}
