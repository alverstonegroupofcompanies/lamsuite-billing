<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ComplianceEvent extends Model
{
    protected $table = 'compliance_events';

    protected $fillable = [
        'store_id',
        'entity_type',
        'entity_id',
        'event',
        'status',
        'payload',
        'message',
        'created_by',
    ];

    protected $casts = [
        'payload' => 'array',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
