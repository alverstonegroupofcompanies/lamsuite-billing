<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MigrationReconciliationReport extends Model
{
    protected $fillable = [
        'store_id',
        'migration_run_uuid',
        'is_passed',
        'counts_comparison',
        'financial_comparison',
        'tax_slab_comparison',
        'stock_comparison',
        'balance_comparison',
        'discrepancies',
    ];

    protected $casts = [
        'is_passed' => 'boolean',
        'counts_comparison' => 'array',
        'financial_comparison' => 'array',
        'tax_slab_comparison' => 'array',
        'stock_comparison' => 'array',
        'balance_comparison' => 'array',
        'discrepancies' => 'array',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
