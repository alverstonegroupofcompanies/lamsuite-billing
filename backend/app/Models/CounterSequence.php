<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CounterSequence extends Model
{
    protected $fillable = [
        'store_id',
        'counter_id',
        'doc_type',
        'financial_year',
        'prefix',
        'range_start',
        'range_end',
        'next_number',
    ];

    protected $casts = [
        'range_start' => 'integer',
        'range_end' => 'integer',
        'next_number' => 'integer',
    ];

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
