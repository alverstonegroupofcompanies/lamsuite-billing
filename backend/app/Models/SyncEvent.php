<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SyncEvent extends Model
{
    protected $table = 'sync_events';

    protected $fillable = [
        'store_id',
        'device_id',
        'entity_type',
        'entity_id',
        'action',
        'client_version',
        'server_version',
        'client_data',
        'server_data',
        'status',
        'conflict_reason',
        'resolution',
        'resolved_by',
        'error_message',
    ];

    protected $casts = [
        'client_data' => 'array',
        'server_data' => 'array',
        'client_version' => 'integer',
        'server_version' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function resolvedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }
}
