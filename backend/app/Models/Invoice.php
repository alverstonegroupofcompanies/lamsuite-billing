<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    protected $table = 'invoices';

    protected $fillable = [
        'store_id',
        'counter_id',
        'user_id',
        'module_key',
        'invoice_number',
        'invoice_date',
        'due_date',
        'customer_id',
        'customer_name',
        'customer_gstin',
        'place_of_supply',
        'subtotal',
        'discount_total',
        'tax_total',
        'round_off',
        'grand_total',
        'paid_amount',
        'payment_mode',
        'status',
        'cancel_reason',
        'cancelled_at',
        'cancelled_by',
        'patient_name',
        'doctor_name',
        'doctor_reg_no',
        'external_id',
        'synced_at',
        'version',
        'counter_code',
        'location_name',
        'locked_by_counter_id',
        'locked_until',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'discount_total' => 'decimal:2',
        'tax_total' => 'decimal:2',
        'round_off' => 'decimal:2',
        'grand_total' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'invoice_date' => 'date',
        'due_date' => 'date',
        'cancelled_at' => 'datetime',
        'synced_at' => 'datetime',
        'locked_until' => 'datetime',
        'version' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'customer_id');
    }

    public function cancelledByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cancelled_by');
    }

    public function items(): HasMany
    {
        return $this->hasMany(InvoiceItem::class);
    }
}
