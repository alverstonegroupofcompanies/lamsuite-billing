<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MigrationUnresolvedItem extends Model
{
    protected $fillable = [
        'store_id',
        'migration_run_uuid',
        'entity_type',
        'old_id',
        'reason',
        'raw_payload',
        'resolution_status',
    ];

    protected $casts = [
        'raw_payload' => 'array',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
