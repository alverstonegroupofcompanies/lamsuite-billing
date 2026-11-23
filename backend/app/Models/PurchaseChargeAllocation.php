<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * CR-C: the paisa-exact share of one charge that a goods line absorbed. Without these
 * rows a return could not reverse a charge proportionally and the four-way
 * reconciliation could not be proved (specs/02-plan.md 6.2.2).
 */
class PurchaseChargeAllocation extends Model
{
    protected $table = 'purchase_charge_allocations';

    protected $fillable = [
        'store_id',
        'purchase_charge_id',
        'purchase_item_id',
        'batch_id',
        'basis_amount',
        'basis_share',
        'allocated_amount',
        'is_remainder_paisa',
    ];

    protected $casts = [
        'basis_amount' => 'decimal:4',
        'basis_share' => 'decimal:6',
        'allocated_amount' => 'decimal:2',
        'is_remainder_paisa' => 'boolean',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function charge(): BelongsTo
    {
        return $this->belongsTo(PurchaseCharge::class, 'purchase_charge_id');
    }

    public function purchaseItem(): BelongsTo
    {
        return $this->belongsTo(PurchaseItem::class, 'purchase_item_id');
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(ProductBatch::class, 'batch_id');
    }
}
