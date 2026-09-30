<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductBatch extends Model
{
    protected $table = 'product_batches';

    protected $fillable = [
        'product_id',
        'batch_no',
        'mfg_date',
        'expiry_date',
        'stock_qty',
        'mrp',
        'purchase_rate',
        'selling_rate',
        'rack_location',
        'shelf_location',
        'external_id',
    ];

    protected $casts = [
        'expiry_date' => 'date',
        'stock_qty' => 'decimal:2',
        'mrp' => 'decimal:2',
        'purchase_rate' => 'decimal:2',
        'selling_rate' => 'decimal:2',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
