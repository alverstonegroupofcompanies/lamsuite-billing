<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CatalogPublication extends Model
{
    protected $fillable = [
        'source_product_id',
        'target_store_id',
        'target_product_id',
        'family_id',
        'status',
        'snapshot',
        'published_by',
        'published_at',
    ];

    protected $casts = [
        'snapshot' => 'array',
        'published_at' => 'datetime',
    ];

    public function sourceProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'source_product_id');
    }

    public function targetProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'target_product_id');
    }

    public function targetStore(): BelongsTo
    {
        return $this->belongsTo(Store::class, 'target_store_id');
    }

    public function publisher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'published_by');
    }
}
