<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceActivationAttempt extends Model
{
    protected $table = 'device_activation_attempts';

    protected $fillable = [
        'ip_address',
        'device_uuid',
        'device_name',
        'attempted_key_prefix',
        'store_id',
        'success',
        'failure_reason',
    ];

    protected $casts = [
        'success' => 'boolean',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    /**
     * Get count of failed activation attempts for this IP or device UUID within the given window (minutes).
     */
    public static function countRecentFailures(string $ipAddress, ?string $deviceUuid = null, int $windowMinutes = 15): int
    {
        $since = now()->subMinutes($windowMinutes);

        return self::where('success', false)
            ->where('created_at', '>=', $since)
            ->where(function ($q) use ($ipAddress, $deviceUuid) {
                $q->where('ip_address', $ipAddress);
                if (!empty($deviceUuid)) {
                    $q->orWhere('device_uuid', $deviceUuid);
                }
            })
            ->count();
    }
}
