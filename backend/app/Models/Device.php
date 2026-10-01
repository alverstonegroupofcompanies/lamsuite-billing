<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Device extends Model
{
    protected $table = 'devices';

    protected $fillable = [
        'store_id',
        'device_name',
        'device_uuid',
        'app_version',
        'status',
        'ip_address',
        'last_seen_at',
        'last_sync_at',
        'force_resync',
        'revoke_reason',
    ];

    protected $casts = [
        'force_resync' => 'boolean',
        'last_seen_at' => 'datetime',
        'last_sync_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
