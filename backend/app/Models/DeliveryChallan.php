<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DeliveryChallan extends Model
{
    protected $fillable = [
        'store_id',
        'challan_number',
        'challan_date',
        'sales_order_id',
        'invoice_id',
        'customer_id',
        'customer_name',
        'customer_phone',
        'customer_gstin',
        'place_of_supply',
        'status',
        'transporter_name',
        'vehicle_no',
        'notes',
        'subtotal',
        'tax_total',
        'grand_total',
        'created_by',
    ];

    protected $casts = [
        'challan_date' => 'date:Y-m-d',
        'subtotal' => 'decimal:2',
        'tax_total' => 'decimal:2',
        'grand_total' => 'decimal:2',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function salesOrder(): BelongsTo
    {
        return $this->belongsTo(SalesOrder::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(DeliveryChallanItem::class);
    }
}
