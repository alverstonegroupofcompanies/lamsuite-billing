<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WebhookOutbox extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_DELIVERED = 'delivered';
    public const STATUS_FAILED = 'failed';

    protected $table = 'webhook_outbox';

    protected $fillable = [
        'store_id',
        'event',
        'object_type',
        'object_id',
        'payload',
        'status',
        'attempts',
        'next_attempt_at',
        'delivered_at',
        'response_status',
        'last_error',
    ];

    protected $casts = [
        'store_id' => 'integer',
        'payload' => 'array',
        'attempts' => 'integer',
        'next_attempt_at' => 'datetime',
        'delivered_at' => 'datetime',
        'response_status' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
