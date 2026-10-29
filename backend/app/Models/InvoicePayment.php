<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InvoicePayment extends Model
{
    protected $table = 'invoice_payments';

    protected $fillable = [
        'store_id',
        'invoice_id',
        'counter_id',
        'counter_code',
        'payment_mode',
        'amount',
        'reference_no',
        'status',
        'extra_fields',
        'notes',
        'received_by',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'extra_fields' => 'array',
    ];

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
