<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GiftCardTransaction extends Model
{
    public const TYPE_ISSUE = 'issue';
    public const TYPE_REDEEM = 'redeem';
    public const TYPE_REFUND = 'refund';
    public const TYPE_ADJUST = 'adjust';
    public const TYPE_EXPIRE = 'expire';

    protected $table = 'gift_card_transactions';

    protected $fillable = [
        'gift_card_id',
        'store_id',
        'type',
        'amount',
        'balance_after',
        'reference_type',
        'reference_id',
        'invoice_id',
        'notes',
        'created_by',
    ];

    protected $casts = [
        'gift_card_id' => 'integer',
        'store_id' => 'integer',
        'amount' => 'decimal:2',
        'balance_after' => 'decimal:2',
        'invoice_id' => 'integer',
    ];

    public function giftCard(): BelongsTo
    {
        return $this->belongsTo(GiftCard::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }
}
