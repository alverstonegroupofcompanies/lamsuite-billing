<?php

namespace App\Models;

use App\Services\Auth\PinPolicy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Hash;

/**
 * SPR-001..003, 017 — a person of one store who earns the sales credit on a
 * bill. The master is the panel's; a till only reads the people its own
 * counter may carry, and a bill keeps the name the person had when sold.
 */
class Salesperson extends Model
{
    protected $fillable = [
        'store_id',
        'name',
        'code',
        'phone',
        'counter_ids',
        'pin',
        'is_pharmacist',
        'reg_no',
        'reg_valid_from',
        'reg_valid_until',
        'is_active',
        'archived_at',
        'version',
    ];

    protected $hidden = [
        'pin_hash',
    ];

    protected $casts = [
        'counter_ids' => 'array',
        'is_active' => 'boolean',
        'is_pharmacist' => 'boolean',
        'reg_valid_from' => 'date',
        'reg_valid_until' => 'date',
        'archived_at' => 'datetime',
        'version' => 'integer',
    ];

    protected $appends = [
        'has_pin',
    ];

    /**
     * SPR-001: the digits a person carries are never stored, and clearing the
     * PIN is a blank, not a missing key.
     */
    public function setPinAttribute(?string $value): void
    {
        $this->attributes['pin_hash'] = $value === null || $value === ''
            ? null
            : Hash::make($value);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    /**
     * The PIN domain of the shared policy: a salesperson's own credential is
     * six digits and is judged the same way a counter's or an approver's is.
     */
    public static function validatePinPolicy(string $pin): ?string
    {
        return PinPolicy::validate($pin, PinPolicy::DOMAIN_SALESPERSON);
    }

    /** @param  Builder<static>  $query */
    public function scopeOfStore(Builder $query, int $storeId): Builder
    {
        return $query->where('store_id', $storeId);
    }

    /** The people a bill may still name: live, and never an archived record. */
    public function scopeSelectable(Builder $query): Builder
    {
        return $query->where('is_active', true)->whereNull('archived_at');
    }

    /** SPR-002: no restriction means every counter of the store. */
    public function mayBeSelectedAt(?int $counterId): bool
    {
        $allowed = array_map('intval', (array) ($this->counter_ids ?? []));

        if ($allowed === []) {
            return true;
        }

        return $counterId !== null && in_array($counterId, $allowed, true);
    }

    public function getHasPinAttribute(): bool
    {
        return !empty($this->pin_hash);
    }
}
