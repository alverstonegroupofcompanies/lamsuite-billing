<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CouponRedemption extends Model
{
    protected $fillable = [
        'coupon_id',
        'store_id',
        'invoice_id',
        'customer_id',
        'code',
        'bill_amount',
        'discount_amount',
    ];

    protected $casts = [
        'bill_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
    ];

    public function coupon(): BelongsTo
    {
        return $this->belongsTo(Coupon::class);
    }
}
