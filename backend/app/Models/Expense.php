<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Expense extends Model
{
    protected $table = 'expenses';

    protected $fillable = [
        'store_id',
        'counter_id',
        'expense_number',
        'external_id',
        'expense_head',
        'amount',
        'payment_mode',
        'reference_no',
        'notes',
        'expense_date',
        'purchase_id',
        'purchase_charge_id',
        'gst_percent',
        'cgst_amount',
        'sgst_amount',
        'igst_amount',
        'itc_eligibility',
        'paid_separately',
        'created_by',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'expense_date' => 'date',
        'gst_percent' => 'decimal:2',
        'cgst_amount' => 'decimal:2',
        'sgst_amount' => 'decimal:2',
        'igst_amount' => 'decimal:2',
        'paid_separately' => 'boolean',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    /** One numbering rule, whether the panel or a till books the expense. */
    public static function nextNumberForStore(int $storeId): string
    {
        $sequence = self::where('store_id', $storeId)->count();

        do {
            $sequence++;
            $number = 'EXP-' . str_pad((string) $sequence, 5, '0', STR_PAD_LEFT);
        } while (self::where('store_id', $storeId)->where('expense_number', $number)->exists());

        return $number;
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * A charge booked as an expense stays traceable to the bill it came from (PUR-012).
     */
    public function purchase(): BelongsTo
    {
        return $this->belongsTo(Purchase::class);
    }

    public function purchaseCharge(): BelongsTo
    {
        return $this->belongsTo(PurchaseCharge::class, 'purchase_charge_id');
    }
}
