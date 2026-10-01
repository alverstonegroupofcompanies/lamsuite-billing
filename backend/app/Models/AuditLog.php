<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuditLog extends Model
{
    protected $table = 'audit_logs';

    public $timestamps = false;

    protected $fillable = [
        'store_id',
        'user_id',
        'impersonator_id',
        'action',
        'entity_type',
        'entity_id',
        'old_values',
        'new_values',
        'ip_address',
        'user_agent',
        'created_at',
    ];

    protected $casts = [
        'old_values' => 'array',
        'new_values' => 'array',
        'created_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function impersonator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'impersonator_id');
    }

    public static function log(
        string $action,
        ?string $entityType = null,
        ?string $entityId = null,
        ?array $oldValues = null,
        ?array $newValues = null,
        ?int $storeId = null,
        ?int $userId = null,
        ?int $impersonatorId = null
    ): self {
        $request = request();

        return self::create([
            'store_id' => $storeId ?? (auth()->check() ? auth()->user()->store_id : null),
            'user_id' => $userId ?? (auth()->check() ? auth()->id() : null),
            'impersonator_id' => $impersonatorId ?? (session('impersonator_id') ?? null),
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => (string) $entityId,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'ip_address' => $request ? $request->ip() : '127.0.0.1',
            'user_agent' => $request ? substr($request->userAgent() ?? '', 0, 255) : 'System',
            'created_at' => now(),
        ]);
    }
}
