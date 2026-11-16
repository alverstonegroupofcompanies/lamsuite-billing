<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeliveryChallanItem extends Model
{
    protected $fillable = [
        'delivery_challan_id',
        'sales_order_item_id',
        'product_id',
        'product_name',
        'hsn_code',
        'batch_no',
        'expiry_date',
        'qty',
        'loose_qty',
        'units_per_pack',
        'unit_price',
        'discount_percent',
        'gst_percent',
        'taxable_amount',
        'tax_amount',
        'total_amount',
    ];

    protected $casts = [
        'expiry_date' => 'date:Y-m-d',
        'qty' => 'decimal:3',
        'loose_qty' => 'decimal:3',
        'units_per_pack' => 'integer',
        'unit_price' => 'decimal:2',
        'discount_percent' => 'decimal:2',
        'gst_percent' => 'decimal:2',
        'taxable_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
    ];

    public function deliveryChallan(): BelongsTo
    {
        return $this->belongsTo(DeliveryChallan::class);
    }

    public function salesOrderItem(): BelongsTo
    {
        return $this->belongsTo(SalesOrderItem::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
