<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * PRF-002 — a named permission document an owner hands to more than one
 * counter. A template is not a permission: nothing at a till consults it, and
 * applying one is an ordinary profile save on the counter that receives it.
 */
class PermissionProfileTemplate extends Model
{
    protected $fillable = [
        'store_id',
        'name',
        'profile',
        'is_default',
        'version',
    ];

    protected $casts = [
        'profile' => 'array',
        'is_default' => 'boolean',
        'version' => 'integer',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    /** One default per store, so "the default profile" never names two. */
    public function makeDefault(): void
    {
        static::where('store_id', $this->store_id)
            ->where('id', '!=', $this->id)
            ->update(['is_default' => false]);

        $this->update(['is_default' => true]);
    }
}
