<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    protected $table = 'products';

    protected $fillable = [
        'store_id',
        'barcode',
        'name',
        'print_name',
        'generic_name',
        'hsn_sac_code',
        'category_id',
        'brand_id',
        'manufacturer_id',
        'unit_id',
        'mrp',
        'sel_rate',
        'ptr',
        'pts',
        'gst_percent',
        'units_per_pack',
        'rack_location',
        'shelf_location',
        'reorder_level',
        'current_stock',
        'is_active',
        'external_id',
        'version',
    ];

    protected $casts = [
        'mrp' => 'decimal:2',
        'sel_rate' => 'decimal:2',
        'ptr' => 'decimal:2',
        'pts' => 'decimal:2',
        'gst_percent' => 'decimal:2',
        'reorder_level' => 'decimal:2',
        'current_stock' => 'decimal:2',
        'is_active' => 'boolean',
        'version' => 'integer',
        'units_per_pack' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function batches(): HasMany
    {
        return $this->hasMany(ProductBatch::class)->orderBy('expiry_date', 'asc');
    }
}
