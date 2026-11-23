<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockAdjustmentDocument extends Model
{
    protected $fillable = [
        'document_id',
        'store_id',
        'counter_id',
        'mode',
        'reason',
        'notes',
        'document_date',
        'status',
        'requires_approval',
        'blocking_rule',
        'lines_count',
        'total_qty',
        'total_value',
        'metadata',
        'created_by',
        'approved_by',
        'approved_at',
    ];

    protected $casts = [
        'requires_approval' => 'boolean',
        'lines_count' => 'integer',
        'total_qty' => 'decimal:3',
        'total_value' => 'decimal:2',
        'metadata' => 'array',
        'approved_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }

    public function lines(): HasMany
    {
        return $this->hasMany(StockAdjustmentLine::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
