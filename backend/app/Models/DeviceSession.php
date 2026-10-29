<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class DeviceSession extends Model
{
    protected $table = 'device_sessions';

    protected $fillable = [
        'store_id',
        'user_id',
        'counter_id',
        'device_uuid',
        'session_id',
        'device_name',
        'counter_name',
        'counter_code',
        'ip_address',
        'location',
        'login_time',
        'last_active_at',
        'status',
        'is_active',
        'user_agent',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'login_time' => 'datetime',
        'last_active_at' => 'datetime',
    ];

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Counter::class);
    }

    /**
     * Compute device online status dynamically based on heartbeat freshness.
     * Default timeout is 120 seconds (2 minutes).
     */
    public function computeStatus(int $timeoutSeconds = 120): string
    {
        if (!$this->is_active || in_array(strtolower((string)$this->status), ['expired', 'logged_out', 'revoked'])) {
            return 'Session Expired';
        }

        if (empty($this->last_active_at)) {
            return 'Offline';
        }

        $lastActive = Carbon::parse($this->last_active_at);
        if ($lastActive->diffInSeconds(now()) > $timeoutSeconds) {
            return 'Offline';
        }

        return 'Online';
    }

    /**
     * Record a new authenticated device login session.
     * Deactivates any existing active session for the same device UUID to prevent duplicate active entries.
     */
    public static function recordLogin(
        int|string $storeId,
        string $deviceUuid,
        ?string $deviceName = null,
        int|string|null $counterId = null,
        ?string $counterName = null,
        ?string $counterCode = null,
        int|string|null $userId = null,
        ?string $ipAddress = null,
        ?string $location = null,
        ?string $userAgent = null
    ): self {
        // Expire prior active sessions for this device to prevent duplicate active entries
        self::where('device_uuid', $deviceUuid)
            ->where('is_active', true)
            ->update([
                'is_active' => false,
                'status' => 'expired',
                'last_active_at' => now(),
            ]);

        // Attempt to auto-fill missing names from Counter or Device models if available
        if (empty($deviceName)) {
            $deviceModel = Device::where('device_uuid', $deviceUuid)->first();
            $counterModel = $counterId ? Counter::find($counterId) : Counter::where('device_uuid', $deviceUuid)->first();
            $deviceName = $deviceModel?->device_name ?: $counterModel?->device_name;
        }

        if (empty($counterName) && !empty($counterId)) {
            $counter = Counter::find($counterId);
            $counterName = $counter?->counter_name;
            $counterCode = $counterCode ?: $counter?->counter_code;
            if (empty($location)) {
                $location = $counter?->location_name;
            }
        }

        return self::create([
            'store_id' => $storeId,
            'user_id' => $userId,
            'counter_id' => $counterId,
            'device_uuid' => $deviceUuid,
            'session_id' => 'ds_' . Str::random(32),
            'device_name' => $deviceName ?: null,
            'counter_name' => $counterName ?: null,
            'counter_code' => $counterCode ?: null,
            'ip_address' => $ipAddress ?: null,
            'location' => $location ?: null,
            'login_time' => now(),
            'last_active_at' => now(),
            'status' => 'online',
            'is_active' => true,
            'user_agent' => $userAgent ? substr($userAgent, 0, 255) : null,
        ]);
    }

    /**
     * Update heartbeat / last active timestamp for an active device.
     */
    public static function recordHeartbeat(
        string $deviceUuid,
        ?string $ipAddress = null,
        ?string $deviceName = null,
        ?string $counterName = null
    ): ?self {
        $session = self::where('device_uuid', $deviceUuid)
            ->where('is_active', true)
            ->orderBy('id', 'desc')
            ->first();

        if ($session) {
            $updates = [
                'last_active_at' => now(),
            ];
            if ($ipAddress) {
                $updates['ip_address'] = $ipAddress;
            }
            if ($deviceName && empty($session->device_name)) {
                $updates['device_name'] = $deviceName;
            }
            if ($counterName && empty($session->counter_name)) {
                $updates['counter_name'] = $counterName;
            }
            $session->update($updates);
            return $session;
        }

        return null;
    }

    /**
     * Expire active session(s) on explicit device or cashier logout.
     */
    public static function recordLogout(string $deviceUuidOrSessionId): int
    {
        return self::where(function ($q) use ($deviceUuidOrSessionId) {
            $q->where('session_id', $deviceUuidOrSessionId)
              ->orWhere('device_uuid', $deviceUuidOrSessionId);
        })
        ->where('is_active', true)
        ->update([
            'is_active' => false,
            'status' => 'expired',
            'last_active_at' => now(),
        ]);
    }
}
