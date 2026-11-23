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
        'salesperson_id',
        'salesperson_name',
        'pharmacist_id',
        'pharmacist_name',
        'pharmacist_reg_no',
        'pharmacist_confirmed_at',
        'module_key',
        'invoice_number',
        'invoice_date',
        'due_date',
        'customer_id',
        'customer_name',
        'customer_phone',
        'customer_gstin',
        'place_of_supply',
        'subtotal',
        'taxable_subtotal',
        'discount_total',
        'tax_total',
        'cgst_total',
        'sgst_total',
        'igst_total',
        'cess_total',
        'round_off',
        'grand_total',
        'paid_amount',
        'payment_mode',
        'payment_status',
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
        'store_state_code',
        'original_invoice_id',
        'original_invoice_number',
        'locked_by_counter_id',
        'locked_until',
        'irn',
        'irn_ack_no',
        'irn_ack_date',
        'irn_qr',
        'irn_status',
        'irn_cancelled_at',
        'irn_cancel_reason',
        'irn_error',
        'ewb_number',
        'ewb_date',
        'ewb_valid_until',
        'ewb_status',
        'ewb_part_a',
        'ewb_part_b',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'taxable_subtotal' => 'decimal:2',
        'discount_total' => 'decimal:2',
        'tax_total' => 'decimal:2',
        'cgst_total' => 'decimal:2',
        'sgst_total' => 'decimal:2',
        'igst_total' => 'decimal:2',
        'cess_total' => 'decimal:2',
        'round_off' => 'decimal:2',
        'grand_total' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'invoice_date' => 'date:Y-m-d',
        'due_date' => 'date:Y-m-d',
        'cancelled_at' => 'datetime',
        'pharmacist_confirmed_at' => 'datetime',
        'synced_at' => 'datetime',
        'locked_until' => 'datetime',
        'irn_ack_date' => 'datetime',
        'irn_cancelled_at' => 'datetime',
        'ewb_date' => 'datetime',
        'ewb_valid_until' => 'datetime',
        'ewb_part_a' => 'array',
        'ewb_part_b' => 'array',
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

    public function getCustomerPhoneAttribute($value): ?string
    {
        if (!empty($value)) {
            return $value;
        }

        return $this->customer ? $this->customer->phone : null;
    }

    public function payments(): HasMany
    {
        return $this->hasMany(InvoicePayment::class);
    }

    protected static function booted(): void
    {
        static::creating(function (Invoice $invoice) {
            // Quotations carry no money movement, so a reconciled day must not block them.
            if (! $invoice->store_id || ! $invoice->invoice_date || $invoice->module_key === 'quotation') {
                return;
            }

            app(\App\Services\DayClose\StoreDayCloseService::class)
                ->assertDayOpen((int) $invoice->store_id, (string) $invoice->invoice_date);
        });
    }
}
