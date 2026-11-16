<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockAdjustmentLine extends Model
{
    protected $fillable = [
        'stock_adjustment_document_id',
        'product_id',
        'batch_id',
        'batch_no',
        'product_name',
        'system_qty',
        'counted_qty',
        'adjustment_qty',
        'unit_cost',
        'reason',
        'notes',
    ];

    protected $casts = [
        'system_qty' => 'decimal:3',
        'counted_qty' => 'decimal:3',
        'adjustment_qty' => 'decimal:3',
        'unit_cost' => 'decimal:2',
    ];

    public function document(): BelongsTo
    {
        return $this->belongsTo(StockAdjustmentDocument::class, 'stock_adjustment_document_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(ProductBatch::class, 'batch_id');
    }
}
