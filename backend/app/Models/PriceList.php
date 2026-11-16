<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PriceList extends Model
{
    protected $fillable = [
        'store_id',
        'name',
        'description',
        'is_active',
        'valid_from',
        'valid_to',
        'priority',
        'created_by',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'valid_from' => 'date:Y-m-d',
        'valid_to' => 'date:Y-m-d',
        'priority' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(PriceListItem::class);
    }
}
