<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InvoiceApproval extends Model
{
    protected $fillable = [
        'store_id',
        'invoice_id',
        'action',
        'mode',
        'status',
        'requested_by_user_id',
        'requested_by_name',
        'requested_by_counter',
        'approved_by_user_id',
        'approved_by_name',
        'pin_hash',
        'token_hash',
        'reason',
        'expires_at',
        'used_at',
        'meta',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'used_at' => 'datetime',
        'meta' => 'array',
    ];

    protected $hidden = [
        'pin_hash',
        'token_hash',
    ];

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }
}
