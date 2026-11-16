<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class PortalAccessToken extends Model
{
    protected $fillable = [
        'party_id',
        'store_id',
        'token_hash',
        'expires_at',
        'last_used_at',
        'revoked_at',
        'created_by',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'last_used_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    /**
     * @return array{0: self, 1: string}
     */
    public static function issue(Party $party, ?User $user = null, int $days = 30): array
    {
        $plain = 'lmp_' . Str::random(48);

        $record = static::create([
            'party_id' => $party->id,
            'store_id' => $party->store_id,
            'token_hash' => hash('sha256', $plain),
            'expires_at' => now()->addDays(max(1, $days)),
            'created_by' => $user?->id,
        ]);

        return [$record, $plain];
    }

    public function isUsable(): bool
    {
        return $this->revoked_at === null
            && ($this->expires_at === null || $this->expires_at->isFuture());
    }

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
