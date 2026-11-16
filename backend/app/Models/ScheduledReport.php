<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

class ScheduledReport extends Model
{
    use HasFactory;

    public const REPORT_TYPES = ['daily_sales', 'gstr1', 'customer_aging', 'pharmacy'];
    public const FREQUENCIES = ['daily', 'weekly', 'monthly'];

    protected $fillable = [
        'store_id',
        'name',
        'report_type',
        'frequency',
        'send_time',
        'day_of_week',
        'day_of_month',
        'recipients',
        'is_active',
        'last_sent_at',
        'last_status',
        'last_error',
        'created_by',
    ];

    protected $casts = [
        'store_id' => 'integer',
        'day_of_week' => 'integer',
        'day_of_month' => 'integer',
        'recipients' => 'array',
        'is_active' => 'boolean',
        'last_sent_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Whether this schedule should fire at the given moment.
     * Missed runs are skipped rather than replayed on a later day.
     */
    public function isDueAt(Carbon $now): bool
    {
        if (!$this->is_active) {
            return false;
        }

        [$hour, $minute] = array_pad(
            array_map('intval', explode(':', (string) $this->send_time)),
            2,
            0
        );
        $scheduledFor = $now->copy()->setTime($hour, $minute, 0);

        if ($this->frequency === 'weekly' && (int) $now->dayOfWeek !== (int) $this->day_of_week) {
            return false;
        }

        if ($this->frequency === 'monthly' && (int) $now->day !== (int) $this->day_of_month) {
            return false;
        }

        if ($now->lt($scheduledFor)) {
            return false;
        }

        if ($this->last_sent_at && $this->last_sent_at->greaterThanOrEqualTo($scheduledFor)) {
            return false;
        }

        return true;
    }

    public function frequencyLabel(): string
    {
        return match ($this->frequency) {
            'weekly' => 'Weekly on ' . ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][(int) $this->day_of_week] . ' at ' . $this->send_time,
            'monthly' => 'Monthly on day ' . (int) $this->day_of_month . ' at ' . $this->send_time,
            default => 'Daily at ' . $this->send_time,
        };
    }
}
