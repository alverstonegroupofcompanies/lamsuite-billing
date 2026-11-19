<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InvoiceItem extends Model
{
    protected $table = 'invoice_items';

    protected $fillable = [
        'invoice_id',
        'product_id',
        'product_name',
        'batch_no',
        'expiry_date',
        'qty',
        'loose_qty',
        'free_qty',
        'free_loose_qty',
        'units_per_pack',
        'unit_price',
        'mrp',
        'stock_action',
        'discount_percent',
        'discount_amount',
        'allocated_discount',
        'taxable_amount',
        'gst_percent',
        'cgst_amount',
        'sgst_amount',
        'igst_amount',
        'cess_rate',
        'cess_amount',
        'tax_amount',
        'total_amount',
    ];

    protected $casts = [
        'expiry_date' => 'date',
        'qty' => 'decimal:2',
        'loose_qty' => 'decimal:2',
        'free_qty' => 'decimal:2',
        'free_loose_qty' => 'decimal:2',
        'units_per_pack' => 'integer',
        'unit_price' => 'decimal:2',
        'mrp' => 'decimal:2',
        'discount_percent' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'allocated_discount' => 'decimal:2',
        'taxable_amount' => 'decimal:2',
        'gst_percent' => 'decimal:2',
        'cgst_amount' => 'decimal:2',
        'sgst_amount' => 'decimal:2',
        'igst_amount' => 'decimal:2',
        'cess_rate' => 'decimal:2',
        'cess_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
    ];

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    /**
     * A credit-note line the till logged as damaged or quarantined never went back onto the
     * shelf, so nothing about that line may move stock on either the booking or the void.
     */
    public function restocksShelf(): bool
    {
        return !in_array(
            strtolower(trim((string) $this->stock_action)),
            ['damaged_discard', 'quarantine'],
            true
        );
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
