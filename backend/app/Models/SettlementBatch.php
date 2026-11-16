<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SettlementBatch extends Model
{
    public const STATUS_IMPORTED = 'imported';
    public const STATUS_PARTIAL = 'partial';
    public const STATUS_RECONCILED = 'reconciled';

    protected $table = 'settlement_batches';

    protected $fillable = [
        'store_id',
        'source',
        'file_name',
        'period_start',
        'period_end',
        'total_amount',
        'line_count',
        'matched_count',
        'exception_count',
        'status',
        'imported_by',
        'notes',
    ];

    protected $casts = [
        'store_id' => 'integer',
        'period_start' => 'date',
        'period_end' => 'date',
        'total_amount' => 'decimal:2',
        'line_count' => 'integer',
        'matched_count' => 'integer',
        'exception_count' => 'integer',
        'imported_by' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function lines(): HasMany
    {
        return $this->hasMany(SettlementLine::class);
    }
}
