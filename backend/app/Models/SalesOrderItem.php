<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SalesOrderItem extends Model
{
    protected $fillable = [
        'sales_order_id',
        'product_id',
        'product_name',
        'hsn_code',
        'qty',
        'loose_qty',
        'units_per_pack',
        'unit_price',
        'discount_percent',
        'discount_amount',
        'gst_percent',
        'taxable_amount',
        'tax_amount',
        'total_amount',
        'fulfilled_base_units',
    ];

    protected $casts = [
        'qty' => 'decimal:3',
        'loose_qty' => 'decimal:3',
        'fulfilled_base_units' => 'decimal:3',
        'units_per_pack' => 'integer',
        'unit_price' => 'decimal:2',
        'discount_percent' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'gst_percent' => 'decimal:2',
        'taxable_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
    ];

    public function salesOrder(): BelongsTo
    {
        return $this->belongsTo(SalesOrder::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function orderedBaseUnits(): float
    {
        $upp = max(1, (int) $this->units_per_pack);
        return ((float) $this->qty * $upp) + (float) $this->loose_qty;
    }
}
