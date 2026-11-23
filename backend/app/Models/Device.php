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
        'revoked_at',
    ];

    protected $hidden = [
        'device_token',
        'device_token_hash',
    ];

    protected $casts = [
        'force_resync' => 'boolean',
        'approved_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'last_sync_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    /**
     * SYNC-02: every revocation records when it happened, whichever screen or
     * command did it, so bills a retired till sold before that moment can still
     * be told apart from anything it wrote afterwards. Reinstating clears it.
     */
    protected static function booted(): void
    {
        static::saving(function (Device $device) {
            if (!$device->isDirty('status')) {
                return;
            }

            if ($device->status === 'revoked') {
                $device->revoked_at = $device->revoked_at ?? now();
            } else {
                $device->revoked_at = null;
            }
        });
    }

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
