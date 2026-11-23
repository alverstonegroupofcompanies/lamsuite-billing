<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PaymentAllocation extends Model
{
    public const TYPE_CUSTOMER_PAYMENT = 'customer_payment';
    public const TYPE_SUPPLIER_PAYMENT = 'supplier_payment';

    public const DOCUMENT_INVOICE = 'invoice';
    public const DOCUMENT_PURCHASE = 'purchase';

    protected $fillable = [
        'store_id',
        'payment_type',
        'payment_id',
        'document_type',
        'document_id',
        'amount',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
