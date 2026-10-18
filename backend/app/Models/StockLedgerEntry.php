<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockLedgerEntry extends Model
{
    protected $fillable = [
        'store_id',
        'product_id',
        'batch_id',
        'counter_id',
        'counter_code',
        'location_name',
        'event_type',
        'qty_delta',
        'reference_type',
        'reference_id',
        'is_reconciled_negative',
        'balance_after',
        'idempotency_key',
        'staff_user_id',
    ];

    protected $casts = [
        'qty_delta' => 'decimal:3',
        'balance_after' => 'decimal:3',
        'is_reconciled_negative' => 'boolean',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(ProductBatch::class);
    }

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }
}
