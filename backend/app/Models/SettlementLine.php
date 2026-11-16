<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SettlementLine extends Model
{
    public const STATUS_MATCHED = 'matched';
    public const STATUS_UNMATCHED = 'unmatched';
    public const STATUS_EXCEPTION = 'exception';
    public const STATUS_IGNORED = 'ignored';
    public const STATUS_RESOLVED = 'resolved';

    protected $table = 'settlement_lines';

    protected $fillable = [
        'settlement_batch_id',
        'store_id',
        'txn_date',
        'reference',
        'amount',
        'mode',
        'payer_ref',
        'status',
        'match_type',
        'match_id',
        'invoice_number',
        'note',
    ];

    protected $casts = [
        'settlement_batch_id' => 'integer',
        'store_id' => 'integer',
        'txn_date' => 'date',
        'amount' => 'decimal:2',
        'match_id' => 'integer',
    ];

    public function batch(): BelongsTo
    {
        return $this->belongsTo(SettlementBatch::class, 'settlement_batch_id');
    }
}
