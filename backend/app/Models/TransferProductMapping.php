<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TransferProductMapping extends Model
{
    protected $fillable = [
        'from_store_id',
        'to_store_id',
        'source_product_id',
        'dest_product_id',
        'matched_by',
        'created_by',
    ];

    public function sourceProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'source_product_id');
    }

    public function destProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'dest_product_id');
    }

    public function fromStore(): BelongsTo
    {
        return $this->belongsTo(Store::class, 'from_store_id');
    }

    public function toStore(): BelongsTo
    {
        return $this->belongsTo(Store::class, 'to_store_id');
    }
}
