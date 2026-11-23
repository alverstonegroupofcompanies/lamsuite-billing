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
        'counter_id',
        'activation_key_id',
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

    /** CNT-005: refusals that belong to the workstation that typed them. */
    public static function countRecentDeviceFailures(string $deviceUuid, int $windowMinutes = 15): int
    {
        return self::where('success', false)
            ->where('device_uuid', $deviceUuid)
            ->where('created_at', '>=', now()->subMinutes($windowMinutes))
            ->count();
    }

    /**
     * CNT-005: the high IP ceiling that still catches a caller rotating device
     * UUIDs from one address. A shared shop network must never reach it by
     * ordinary mistyping.
     */
    public static function countRecentIpFailures(string $ipAddress, int $windowMinutes = 15): int
    {
        $ipAddress = trim($ipAddress);
        if ($ipAddress === '' || $ipAddress === '0.0.0.0') {
            return 0;
        }

        return self::where('success', false)
            ->where('ip_address', $ipAddress)
            ->where('created_at', '>=', now()->subMinutes($windowMinutes))
            ->count();
    }
}
