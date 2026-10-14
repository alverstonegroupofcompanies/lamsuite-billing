<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class MigrationRun extends Model
{
    protected $fillable = [
        'store_id',
        'user_id',
        'run_uuid',
        'source_type',
        'source_reference',
        'status',
        'is_dry_run',
        'source_manifest',
        'precheck_results',
        'mapping_config',
        'progress_stats',
        'reconciliation_summary',
        'cutover_confirmation',
        'cutover_at',
        'backup_path',
        'error_message',
    ];

    protected $casts = [
        'is_dry_run' => 'boolean',
        'source_manifest' => 'array',
        'precheck_results' => 'array',
        'mapping_config' => 'array',
        'progress_stats' => 'array',
        'reconciliation_summary' => 'array',
        'cutover_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function idMaps(): HasMany
    {
        return $this->hasMany(MigrationIdMap::class, 'migration_run_uuid', 'run_uuid');
    }

    public function unresolvedItems(): HasMany
    {
        return $this->hasMany(MigrationUnresolvedItem::class, 'migration_run_uuid', 'run_uuid');
    }

    public function reconciliationReport(): HasOne
    {
        return $this->hasOne(MigrationReconciliationReport::class, 'migration_run_uuid', 'run_uuid');
    }
}
