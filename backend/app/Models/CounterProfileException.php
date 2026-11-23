<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Q1 (b) — one offline document that sits outside the permission document its
 * counter holds today. The document itself is never reversed by this row: the
 * register is what the owner reviews, not a second gate.
 */
class CounterProfileException extends Model
{
    public const STATUS_OPEN = 'open';
    public const STATUS_REVIEWED = 'reviewed';
    public const STATUS_DISMISSED = 'dismissed';

    protected $fillable = [
        'store_id',
        'counter_id',
        'document_type',
        'document_id',
        'document_reference',
        'profile_version',
        'profile_version_at_review',
        'violations',
        'status',
        'times_filed',
        'detected_at',
        'reviewed_at',
        'reviewed_by',
        'note',
    ];

    protected $casts = [
        'violations' => 'array',
        'profile_version' => 'integer',
        'profile_version_at_review' => 'integer',
        'times_filed' => 'integer',
        'detected_at' => 'datetime',
        'reviewed_at' => 'datetime',
    ];

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    /** True when the rules were written after the document, so a flag may be hindsight. */
    public function ruleMayPostdateDocument(): bool
    {
        return $this->profile_version !== null
            && $this->profile_version < $this->profile_version_at_review;
    }

    public function present(): array
    {
        return [
            'id' => (int) $this->id,
            'counter_id' => (int) $this->counter_id,
            'counter_code' => $this->counter?->counter_code,
            'counter_name' => $this->counter?->counter_name,
            'document_type' => $this->document_type,
            'document_id' => $this->document_id,
            'document_reference' => $this->document_reference,
            'profile_version' => $this->profile_version,
            'profile_version_at_review' => $this->profile_version_at_review,
            'rule_may_postdate_document' => $this->ruleMayPostdateDocument(),
            'violations' => $this->violations ?? [],
            'status' => $this->status,
            'times_filed' => (int) $this->times_filed,
            'detected_at' => $this->detected_at?->toIso8601String(),
            'reviewed_at' => $this->reviewed_at?->toIso8601String(),
            'reviewed_by' => $this->reviewedBy?->name,
            'note' => $this->note,
        ];
    }
}
