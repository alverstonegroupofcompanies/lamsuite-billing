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
        'device_token',
        'device_token_hash',
        'counter_id',
        'registered_via',
        'activation_key_id',
        'app_version',
        'status',
        'ip_address',
        'approved_at',
        'approved_by',
        'last_seen_at',
        'last_sync_at',
        'force_resync',
        'revoke_reason',
    ];

    protected $hidden = [
        'device_token_hash',
    ];

    protected $casts = [
        'force_resync' => 'boolean',
        'approved_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'last_sync_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function activationKey(): BelongsTo
    {
        return $this->belongsTo(ActivationKey::class);
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
