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
        'allowed_user_ids',
        'printer_profile',
        'receipt_customization',
        'visible_menus',
        'last_seen_at',
        'last_sync_at',
        'last_synced_watermark',
        'revoke_reason',
        'pairing_code',
        'pairing_expires_at',
        'device_token',
        'device_token_hash',
        'approved_at',
        'approved_by',
    ];

    protected $hidden = [
        'device_token_hash',
        'manager_pin',
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
        'pairing_expires_at' => 'datetime',
        'approved_at' => 'datetime',
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

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /**
     * Counters that hold a visible name in the store. Revoked counters release
     * their name so it can be reused by a replacement workstation.
     */
    public static function nameConflict(int $storeId, string $name, ?int $ignoreId = null): ?self
    {
        $normalized = mb_strtolower(trim($name));
        if ($normalized === '') {
            return null;
        }

        return self::where('store_id', $storeId)
            ->whereIn('status', ['active', 'locked', 'pending_approval'])
            ->whereRaw('LOWER(TRIM(counter_name)) = ?', [$normalized])
            ->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->orderBy('id')
            ->first();
    }

    /**
     * Return a store-unique counter name, suffixing the code when taken.
     */
    public static function uniqueNameForStore(int $storeId, string $desiredName, ?int $ignoreId = null): string
    {
        $base = trim($desiredName) ?: 'Counter';
        if (!self::nameConflict($storeId, $base, $ignoreId)) {
            return $base;
        }

        for ($suffix = 2; $suffix <= 99; $suffix++) {
            $candidate = "{$base} ({$suffix})";
            if (!self::nameConflict($storeId, $candidate, $ignoreId)) {
                return $candidate;
            }
        }

        return "{$base} (" . substr((string)microtime(true), -6) . ")";
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

    /**
     * Generate a fresh 6-character pairing code e.g. "LK-8421" valid for 15 minutes.
     */
    public function generatePairingCode(): string
    {
        $letters = chr(random_int(65, 90)) . chr(random_int(65, 90));
        $digits = str_pad((string)random_int(1000, 9999), 4, '0', STR_PAD_LEFT);
        $code = "{$letters}-{$digits}";
        
        $this->update([
            'pairing_code' => $code,
            'pairing_expires_at' => now()->addMinutes(15),
            'status' => 'pending_approval',
        ]);

        return $code;
    }

    /**
     * Issue and persist a device access token.
     */
    public function issueDeviceToken(): string
    {
        $rawToken = 'lsd_' . \Illuminate\Support\Str::random(40);
        $this->update([
            'device_token' => $rawToken,
            'device_token_hash' => hash('sha256', $rawToken),
            'pairing_code' => null,
            'pairing_expires_at' => null,
            'status' => 'active',
            'approved_at' => now(),
        ]);
        return $rawToken;
    }
}
