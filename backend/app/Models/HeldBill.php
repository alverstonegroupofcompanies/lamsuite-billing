<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HeldBill extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'store_id',
        'held_by_counter_id',
        'held_by_counter_name',
        'held_by_user_name',
        'customer_name',
        'items_count',
        'grand_total',
        'held_at',
        'cart_payload',
        'status',
        'claimed_by_counter_id',
        'claimed_at',
    ];

    protected $casts = [
        'grand_total' => 'decimal:2',
        'cart_payload' => 'array',
        'held_at' => 'integer',
        'claimed_at' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
