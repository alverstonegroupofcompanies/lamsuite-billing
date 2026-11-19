<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductCopyRun extends Model
{
    protected $fillable = [
        'source_store_id',
        'target_store_id',
        'product_map',
        'copied_count',
        'skipped_count',
        'created_by',
        'reversed_at',
        'reversed_by',
    ];

    protected $casts = [
        'product_map' => 'array',
    ];

    public function sourceStore()
    {
        return $this->belongsTo(Store::class, 'source_store_id');
    }

    public function targetStore()
    {
        return $this->belongsTo(Store::class, 'target_store_id');
    }
}
