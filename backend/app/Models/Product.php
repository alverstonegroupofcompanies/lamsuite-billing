<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
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
    ];

    protected $casts = [
        'mrp' => 'decimal:2',
        'sel_rate' => 'decimal:2',
        'gst_percent' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    public function batches(): HasMany
    {
        return $this->hasMany(ProductBatch::class)->orderBy('expiry_date', 'asc');
    }
}
