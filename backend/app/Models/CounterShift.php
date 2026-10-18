<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CounterShift extends Model
{
    protected $fillable = [
        'store_id',
        'counter_id',
        'opened_by_user_id',
        'closed_by_user_id',
        'opening_float',
        'cash_sales',
        'digital_sales',
        'cash_refunds',
        'cash_drops',
        'closing_cash_actual',
        'closing_discrepancy',
        'status',
        'opened_at',
        'closed_at',
        'notes',
    ];

    protected $casts = [
        'opening_float' => 'decimal:2',
        'cash_sales' => 'decimal:2',
        'digital_sales' => 'decimal:2',
        'cash_refunds' => 'decimal:2',
        'cash_drops' => 'decimal:2',
        'closing_cash_actual' => 'decimal:2',
        'closing_discrepancy' => 'decimal:2',
        'opened_at' => 'datetime',
        'closed_at' => 'datetime',
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
