<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Coupon extends Model
{
    protected $fillable = [
        'store_id',
        'code',
        'description',
        'discount_type',
        'value',
        'min_bill_amount',
        'max_discount',
        'valid_from',
        'valid_to',
        'usage_limit',
        'used_count',
        'is_active',
        'created_by',
    ];

    protected $casts = [
        'value' => 'decimal:2',
        'min_bill_amount' => 'decimal:2',
        'max_discount' => 'decimal:2',
        'valid_from' => 'date:Y-m-d',
        'valid_to' => 'date:Y-m-d',
        'usage_limit' => 'integer',
        'used_count' => 'integer',
        'is_active' => 'boolean',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function redemptions(): HasMany
    {
        return $this->hasMany(CouponRedemption::class);
    }

    public function isCurrentlyValid(): bool
    {
        if (!$this->is_active) {
            return false;
        }
        $today = now()->startOfDay();
        if ($this->valid_from && $this->valid_from->startOfDay()->gt($today)) {
            return false;
        }
        if ($this->valid_to && $this->valid_to->endOfDay()->lt($today)) {
            return false;
        }
        if ($this->usage_limit !== null && $this->used_count >= $this->usage_limit) {
            return false;
        }

        return true;
    }

    public function discountFor(float $billAmount): float
    {
        if ($billAmount <= 0) {
            return 0.0;
        }
        if ($this->discount_type === 'amount') {
            return round(min($billAmount, (float) $this->value), 2);
        }
        $discount = $billAmount * ((float) $this->value / 100);
        if ($this->max_discount !== null) {
            $discount = min($discount, (float) $this->max_discount);
        }

        return round(min($billAmount, $discount), 2);
    }
}
