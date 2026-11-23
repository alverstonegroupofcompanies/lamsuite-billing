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
        'counter_id',
        'label',
        'key_hash',
        'key_prefix',
        'max_devices',
        'devices_activated_count',
        'consumed_at',
        'consumed_device_uuid',
        'ttl_hours',
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
        'consumed_at' => 'datetime',
        'revoked_at' => 'datetime',
        'max_devices' => 'integer',
        'ttl_hours' => 'integer',
        'devices_activated_count' => 'integer',
    ];

    /** IS5: a code hash is as good as the code to anyone who can brute force it. */
    protected $hidden = [
        'key_hash',
    ];

    /** CNT-003: the owner-set lifetime of a code, when they do not choose one. */
    public const DEFAULT_TTL_HOURS = 24;

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

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }

    /**
     * Compute SHA-256 hash of activation key for secure storage and comparison.
     */
    public static function hashKey(string $key): string
    {
        return hash('sha256', trim(strtoupper($key)));
    }

    /**
     * CNT-003 / CNT-004: mint a one-time code for exactly one counter.
     * The raw code exists only in the returned array — never in a column.
     */
    public static function generateForCounter(Counter $counter, array $options = []): array
    {
        $ttlHours = max(1, (int) ($options['ttl_hours'] ?? self::DEFAULT_TTL_HOURS));
        $tag = strtoupper((string) preg_replace('/[^A-Z0-9]/', '', $counter->counter_code));

        // 128 bits of randomness, in two typed groups.
        $rawKey = sprintf(
            'LAM-%s-%s-%s',
            $tag,
            strtoupper(bin2hex(random_bytes(8))),
            strtoupper(bin2hex(random_bytes(8)))
        );

        $key = self::create([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'label' => $options['label'] ?? null,
            'key_hash' => self::hashKey($rawKey),
            'key_prefix' => substr($rawKey, 0, 14) . '****',
            'max_devices' => 1,
            'devices_activated_count' => 0,
            'is_single_use' => true,
            'ttl_hours' => $ttlHours,
            'expires_at' => now()->addHours($ttlHours),
            'created_by' => $options['created_by'] ?? null,
        ]);

        return [
            'raw_key' => $rawKey,
            'model' => $key,
            'qr_payload' => [
                'v' => 1,
                'kind' => 'lam_suite_counter_claim',
                'code' => $rawKey,
                'store_id' => $counter->store_id,
                'counter_id' => $counter->id,
            ],
        ];
    }

    /** CNT-003: the only lookup path — the hash of whatever was typed or scanned. */
    public static function findByCode(string $rawKey): ?self
    {
        return self::where('key_hash', self::hashKey($rawKey))->first();
    }

    /** CNT-003 / IS2: look a typed or scanned code up inside exactly one store. */
    public static function resolveForClaim(string $rawKey, int $storeId): ?self
    {
        $key = self::findByCode($rawKey);

        if (!$key
            || (int) $key->store_id !== $storeId
            || $key->counter_id === null
            || !$key->isValid()) {
            return null;
        }

        return $key;
    }

    /** CNT-007: one code binds one device, once. */
    public function markConsumed(?string $deviceUuid = null): void
    {
        $this->consumed_at = now();
        $this->consumed_device_uuid = $deviceUuid;
        $this->save();

        $this->increment('devices_activated_count');
    }

    /** CNT-005: the internal reason a code was refused, never shown to the till. */
    public function whyInvalid(): ?string
    {
        if ($this->is_revoked) {
            return 'revoked';
        }

        if ($this->consumed_at !== null || ($this->is_single_use && $this->devices_activated_count >= 1)) {
            return 'consumed';
        }

        if ($this->expires_at && $this->expires_at->isPast()) {
            return 'expired';
        }

        if ($this->max_devices !== null && $this->devices_activated_count >= $this->max_devices) {
            return 'device_limit';
        }

        if (!$this->store || !$this->store->is_active) {
            return 'store_suspended';
        }

        return null;
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

        // CNT-003: a counter code binds exactly one device, whatever max_devices says.
        if ($this->consumed_at !== null) {
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
