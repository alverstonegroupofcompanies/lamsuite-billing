<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StoreDayClose extends Model
{
    protected $fillable = [
        'store_id',
        'close_date',
        'total_gross_sales',
        'total_tax_collected',
        'total_cash_collected',
        'total_digital_collected',
        'total_refunds',
        'net_cash_in_hand',
        'total_bills_count',
        'counter_breakdowns',
        'closed_by_user_id',
        'reconciliation_notes',
    ];

    protected $casts = [
        'close_date' => 'date',
        'total_gross_sales' => 'decimal:2',
        'total_tax_collected' => 'decimal:2',
        'total_cash_collected' => 'decimal:2',
        'total_digital_collected' => 'decimal:2',
        'total_refunds' => 'decimal:2',
        'net_cash_in_hand' => 'decimal:2',
        'total_bills_count' => 'integer',
        'counter_breakdowns' => 'array',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
