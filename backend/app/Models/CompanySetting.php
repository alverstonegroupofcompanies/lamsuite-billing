<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CompanySetting extends Model
{
    protected $table = 'company_settings';

    protected $fillable = [
        'store_id',
        'key',
        'value',
        'is_secret',
    ];

    protected $casts = [
        'value' => 'array',
        'is_secret' => 'boolean',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
