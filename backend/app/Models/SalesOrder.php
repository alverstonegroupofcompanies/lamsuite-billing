<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SalesOrder extends Model
{
    protected $fillable = [
        'store_id',
        'order_number',
        'order_date',
        'expected_delivery_date',
        'customer_id',
        'customer_name',
        'customer_phone',
        'customer_gstin',
        'place_of_supply',
        'status',
        'subtotal',
        'discount_total',
        'tax_total',
        'round_off',
        'grand_total',
        'notes',
        'cancel_reason',
        'created_by',
    ];

    protected $casts = [
        'order_date' => 'date:Y-m-d',
        'expected_delivery_date' => 'date:Y-m-d',
        'subtotal' => 'decimal:2',
        'discount_total' => 'decimal:2',
        'tax_total' => 'decimal:2',
        'round_off' => 'decimal:2',
        'grand_total' => 'decimal:2',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'customer_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(SalesOrderItem::class);
    }

    public function challans(): HasMany
    {
        return $this->hasMany(DeliveryChallan::class);
    }
}
