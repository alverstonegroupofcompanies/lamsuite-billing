<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoyaltyProgram extends Model
{
    protected $fillable = [
        'store_id',
        'is_active',
        'earn_points_per_100',
        'redeem_value_per_point',
        'min_redeem_points',
        'expiry_days',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'earn_points_per_100' => 'decimal:2',
        'redeem_value_per_point' => 'decimal:4',
        'min_redeem_points' => 'integer',
        'expiry_days' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
