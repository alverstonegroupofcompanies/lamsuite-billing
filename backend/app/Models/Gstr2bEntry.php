<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Gstr2bEntry extends Model
{
    protected $table = 'gstr2b_entries';

    public const MATCH_MATCHED = 'matched';
    public const MATCH_MISMATCH = 'mismatch';
    public const MATCH_UNMATCHED = 'unmatched';

    protected $fillable = [
        'gstr2b_import_id',
        'supplier_gstin',
        'supplier_name',
        'invoice_number',
        'invoice_date',
        'taxable_value',
        'igst_amount',
        'cgst_amount',
        'sgst_amount',
        'cess_amount',
        'total_value',
        'itc_eligible',
        'match_status',
        'matched_purchase_id',
        'notes',
    ];

    protected $casts = [
        'invoice_date' => 'date',
        'itc_eligible' => 'boolean',
        'taxable_value' => 'decimal:2',
        'igst_amount' => 'decimal:2',
        'cgst_amount' => 'decimal:2',
        'sgst_amount' => 'decimal:2',
        'cess_amount' => 'decimal:2',
        'total_value' => 'decimal:2',
    ];

    public function import(): BelongsTo
    {
        return $this->belongsTo(Gstr2bImport::class, 'gstr2b_import_id');
    }

    public function matchedPurchase(): BelongsTo
    {
        return $this->belongsTo(Purchase::class, 'matched_purchase_id');
    }
}
