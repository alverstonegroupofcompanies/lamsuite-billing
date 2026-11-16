<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Purchase extends Model
{
    protected $table = 'purchases';

    protected $fillable = [
        'store_id',
        'supplier_id',
        'supplier_name',
        'supplier_gstin',
        'invoice_number',
        'invoice_date',
        'expected_delivery_date',
        'module_key',
        'subtotal',
        'tax_total',
        'cgst_total',
        'sgst_total',
        'igst_total',
        'cess_total',
        'is_interstate',
        'is_rcm',
        'itc_eligibility',
        'freight_charges',
        'bill_discount_type',
        'bill_discount',
        'round_off',
        'grand_total',
        'paid_amount',
        'status',
        'cancel_reason',
        'notes',
        'version',
    ];

    protected $casts = [
        'invoice_date' => 'date:Y-m-d',
        'expected_delivery_date' => 'date:Y-m-d',
        'subtotal' => 'decimal:2',
        'tax_total' => 'decimal:2',
        'cgst_total' => 'decimal:2',
        'sgst_total' => 'decimal:2',
        'igst_total' => 'decimal:2',
        'cess_total' => 'decimal:2',
        'is_interstate' => 'boolean',
        'is_rcm' => 'boolean',
        'freight_charges' => 'decimal:2',
        'bill_discount' => 'decimal:2',
        'round_off' => 'decimal:2',
        'grand_total' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'version' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'supplier_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(PurchaseItem::class);
    }
}
