<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class ActivationKey extends Model
{
    protected $table = 'activation_keys';

    protected $fillable = [
        'store_id',
        'key_hash',
        'key_prefix',
        'max_devices',
        'devices_activated_count',
        'is_single_use',
        'expires_at',
        'is_revoked',
        'revoked_at',
        'revoke_reason',
        'created_by',
    ];

    protected $casts = [
        'is_single_use' => 'boolean',
        'is_revoked' => 'boolean',
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
        'max_devices' => 'integer',
        'devices_activated_count' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    /**
     * Compute SHA-256 hash of activation key for secure storage and comparison.
     */
    public static function hashKey(string $key): string
    {
        return hash('sha256', trim(strtoupper($key)));
    }

    /**
     * Generate a new high-entropy activation key tied to a store.
     * Generates a key with 128-bit cryptographic entropy:
     * Format: LAM-{STORE_CODE}-{16_HEX_CHARS} (e.g. LAM-MAIN-7F3A9C82B14D6E05)
     * Returns: ['raw_key' => $rawKey, 'model' => $activationKey]
     */
    public static function generateKey(Store $store, array $options = []): array
    {
        $code = strtoupper(preg_replace('/[^A-Z0-9]/', '', $store->code ?: 'STORE'));
        $code = substr($code, 0, 8);
        $randomPart = strtoupper(bin2hex(random_bytes(8))); // 16 random hex characters (64 bits random)
        $suffix = strtoupper(bin2hex(random_bytes(4)));     // another 8 chars
        $rawKey = "LAM-{$code}-{$randomPart}-{$suffix}";
        $keyHash = self::hashKey($rawKey);
        $prefix = substr($rawKey, 0, 14) . '****';

        $activationKey = self::create([
            'store_id' => $store->id,
            'key_hash' => $keyHash,
            'key_prefix' => $prefix,
            'max_devices' => $options['max_devices'] ?? 5,
            'devices_activated_count' => 0,
            'is_single_use' => (bool)($options['is_single_use'] ?? false),
            'expires_at' => $options['expires_at'] ?? now()->addYear(),
            'is_revoked' => false,
            'created_by' => $options['created_by'] ?? null,
        ]);

        // Keep stores.activation_key_hash updated for fast lookup
        $store->update(['activation_key_hash' => $keyHash]);

        return [
            'raw_key' => $rawKey,
            'model' => $activationKey,
        ];
    }

    /**
     * Check if key is valid for new device enrollment.
     */
    public function isValid(): bool
    {
        if ($this->is_revoked) {
            return false;
        }

        if ($this->expires_at && $this->expires_at->isPast()) {
            return false;
        }

        if ($this->is_single_use && $this->devices_activated_count >= 1) {
            return false;
        }

        if ($this->max_devices !== null && $this->devices_activated_count >= $this->max_devices) {
            return false;
        }

        if (!$this->store || !$this->store->is_active) {
            return false;
        }

        return true;
    }

    /**
     * Revoke key with reason.
     */
    public function revoke(?string $reason = null): void
    {
        $this->update([
            'is_revoked' => true,
            'revoked_at' => now(),
            'revoke_reason' => $reason ?? 'Revoked by administrator',
        ]);
    }

    /**
     * Record device enrollment against this key.
     */
    public function incrementActivation(): void
    {
        $this->increment('devices_activated_count');
    }
}
