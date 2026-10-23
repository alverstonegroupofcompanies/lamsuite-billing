<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Counter extends Model
{
    protected $fillable = [
        'store_id',
        'counter_code',
        'counter_name',
        'device_name',
        'location_name',
        'is_remote',
        'is_hub',
        'is_digital_only',
        'status',
        'device_uuid',
        'mac_address',
        'ip_address',
        'role_profile',
        'manager_pin',
        'allowed_user_ids',
        'printer_profile',
        'receipt_customization',
        'visible_menus',
        'last_seen_at',
        'last_sync_at',
        'last_synced_watermark',
        'revoke_reason',
    ];

    protected $casts = [
        'is_remote' => 'boolean',
        'is_hub' => 'boolean',
        'is_digital_only' => 'boolean',
        'role_profile' => 'array',
        'allowed_user_ids' => 'array',
        'printer_profile' => 'array',
        'receipt_customization' => 'array',
        'visible_menus' => 'array',
        'last_seen_at' => 'datetime',
        'last_sync_at' => 'datetime',
        'last_synced_watermark' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function sequences(): HasMany
    {
        return $this->hasMany(CounterSequence::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(CounterShift::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function isPendingApproval(): bool
    {
        return $this->status === 'pending_approval';
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function isRevoked(): bool
    {
        return $this->status === 'revoked';
    }
}
