<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoyaltyLedger extends Model
{
    protected $table = 'loyalty_ledger';

    protected $fillable = [
        'store_id',
        'customer_id',
        'invoice_id',
        'type',
        'points_delta',
        'balance_after',
        'note',
        'created_by',
    ];

    protected $casts = [
        'points_delta' => 'decimal:2',
        'balance_after' => 'decimal:2',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'customer_id');
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }
}
