<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    protected $table = 'invoices';

    protected $fillable = [
        'store_id',
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
        'patient_name',
        'doctor_name',
        'doctor_reg_no',
        'external_id',
        'synced_at',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'tax_total' => 'decimal:2',
        'round_off' => 'decimal:2',
        'grand_total' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'invoice_date' => 'date',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(InvoiceItem::class);
    }
}
