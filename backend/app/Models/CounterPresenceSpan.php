<?php

namespace App\Models;

use App\Services\Counter\CounterPresenceService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * CNT-01 — one unbroken stretch during which a counter kept beating. A gap
 * between two spans, or between the last span and now, is the counter's
 * offline period.
 */
class CounterPresenceSpan extends Model
{
    protected $table = 'counter_presence_spans';

    protected $fillable = [
        'store_id',
        'counter_id',
        'started_at',
        'last_beat_at',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'last_beat_at' => 'datetime',
    ];

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    /** Still inside the quiet window, so the counter is present right now. */
    public function isLive(): bool
    {
        return $this->last_beat_at !== null
            && $this->last_beat_at->gte(now()->subMinutes(CounterPresenceService::OFFLINE_AFTER_MINUTES));
    }
}
