<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GiftCard extends Model
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_DISABLED = 'disabled';
    public const STATUS_EXHAUSTED = 'exhausted';
    public const STATUS_EXPIRED = 'expired';

    protected $table = 'gift_cards';

    protected $fillable = [
        'store_id',
        'code',
        'initial_balance',
        'balance',
        'status',
        'issued_to_name',
        'issued_to_phone',
        'customer_id',
        'expires_at',
        'notes',
        'created_by',
    ];

    protected $casts = [
        'store_id' => 'integer',
        'initial_balance' => 'decimal:2',
        'balance' => 'decimal:2',
        'customer_id' => 'integer',
        'expires_at' => 'date',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'customer_id');
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(GiftCardTransaction::class)->orderByDesc('id');
    }
}
