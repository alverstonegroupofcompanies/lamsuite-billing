<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Gstr2bImport extends Model
{
    protected $table = 'gstr2b_imports';

    protected $fillable = [
        'store_id',
        'period',
        'file_name',
        'source',
        'total_entries',
        'matched_count',
        'mismatch_count',
        'unmatched_count',
        'itc_available',
        'imported_by',
    ];

    protected $casts = [
        'itc_available' => 'decimal:2',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function importer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'imported_by');
    }

    public function entries(): HasMany
    {
        return $this->hasMany(Gstr2bEntry::class);
    }
}
