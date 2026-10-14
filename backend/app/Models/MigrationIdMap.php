<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MigrationIdMap extends Model
{
    protected $fillable = [
        'store_id',
        'migration_run_uuid',
        'entity_type',
        'old_id',
        'new_id',
        'old_uuid',
        'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
