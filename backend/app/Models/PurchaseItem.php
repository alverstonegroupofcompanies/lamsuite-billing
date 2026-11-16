<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PurchaseItem extends Model
{
    protected $table = 'purchase_items';

    protected $fillable = [
        'purchase_id',
        'product_id',
        'product_name',
        'hsn_code',
        'batch_no',
        'mfg_date',
        'expiry_date',
        'pack_qty',
        'loose_qty',
        'free_qty',
        'free_loose_qty',
        'units_per_pack',
        'qty',
        'purchase_rate',
        'ptr',
        'pts',
        'ptss',
        'discount_type',
        'discount_percent',
        'discount_amount',
        'effective_unit_cost',
        'taxable_amount',
        'mrp',
        'selling_rate',
        'gst_percent',
        'cgst_amount',
        'sgst_amount',
        'igst_amount',
        'cess_amount',
        'tax_amount',
        'total_amount',
    ];

    protected $casts = [
        'mfg_date' => 'date',
        'expiry_date' => 'date',
        'pack_qty' => 'decimal:2',
        'loose_qty' => 'decimal:2',
        'free_qty' => 'decimal:2',
        'free_loose_qty' => 'decimal:2',
        'units_per_pack' => 'integer',
        'qty' => 'decimal:2',
        'purchase_rate' => 'decimal:2',
        'ptr' => 'decimal:2',
        'pts' => 'decimal:2',
        'ptss' => 'decimal:2',
        'discount_percent' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'effective_unit_cost' => 'decimal:2',
        'taxable_amount' => 'decimal:2',
        'mrp' => 'decimal:2',
        'selling_rate' => 'decimal:2',
        'gst_percent' => 'decimal:2',
        'cgst_amount' => 'decimal:2',
        'sgst_amount' => 'decimal:2',
        'igst_amount' => 'decimal:2',
        'cess_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
    ];

    public function purchase(): BelongsTo
    {
        return $this->belongsTo(Purchase::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
