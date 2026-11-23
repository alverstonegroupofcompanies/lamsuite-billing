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
        // PRF-007: which credential moved the drawer, since a till has no person.
        'opened_via',
        'closed_via',
        'opening_float',
        'cash_sales',
        'digital_sales',
        'cash_refunds',
        'cash_in',
        'cash_drops',
        'closing_cash_actual',
        'expected_cash',
        'closing_discrepancy',
        'status',
        'opened_at',
        'closed_at',
        'notes',
        'reconciliation_json',
        // The till's own id for the shift, so a replayed push updates rather than duplicates.
        'external_id',
    ];

    protected $casts = [
        'opening_float' => 'decimal:2',
        'cash_sales' => 'decimal:2',
        'digital_sales' => 'decimal:2',
        'cash_refunds' => 'decimal:2',
        'cash_in' => 'decimal:2',
        'cash_drops' => 'decimal:2',
        'closing_cash_actual' => 'decimal:2',
        'expected_cash' => 'decimal:2',
        'closing_discrepancy' => 'decimal:2',
        'opened_at' => 'datetime',
        'closed_at' => 'datetime',
        'reconciliation_json' => 'array',
    ];

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function openedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by_user_id');
    }

    public function closedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by_user_id');
    }
}
