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
        'user_role',
        'counter_id',
        'device_uuid',
        'session_id',
        'device_name',
        'counter_name',
        'counter_code',
        'ip_address',
        'public_ip',
        'location',
        'login_time',
        'last_active_at',
        'status',
        'app_version',
        'unsynced_items_count',
        'is_active',
        'user_agent',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'unsynced_items_count' => 'integer',
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
     * Compute device status: Active, Idle, Offline, Locked, Revoked.
     */
    public function computeStatus(int $activeThresholdSeconds = 120, int $idleThresholdSeconds = 600): string
    {
        $rawStatus = strtolower((string)$this->status);

        if ($rawStatus === 'revoked') {
            return 'Revoked';
        }

        if ($rawStatus === 'locked') {
            return 'Locked';
        }

        if (!$this->is_active || in_array($rawStatus, ['expired', 'logged_out'])) {
            return 'Offline';
        }

        if (empty($this->last_active_at)) {
            return 'Offline';
        }

        $lastActive = Carbon::parse($this->last_active_at);
        $diffSeconds = $lastActive->diffInSeconds(now());

        if ($diffSeconds <= $activeThresholdSeconds) {
            return $rawStatus === 'idle' ? 'Idle' : 'Active';
        }

        if ($diffSeconds <= $idleThresholdSeconds) {
            return 'Idle';
        }

        return 'Offline';
    }

    /**
     * Resolve the client's actual public IP address from standard proxy headers,
     * reverse-proxy forward chains, or client self-reporting.
     */
    public static function resolvePublicIp(\Illuminate\Http\Request $request, ?string $clientReportedIp = null): ?string
    {
        // 1. If client provided a valid public IPv4 / IPv6, use it
        if ($clientReportedIp && filter_var($clientReportedIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return $clientReportedIp;
        }

        // 2. Cloudflare Connecting IP
        $cf = $request->header('CF-Connecting-IP');
        if ($cf && filter_var($cf, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return $cf;
        }

        // 3. True-Client-IP (Akamai / Cloudflare Enterprise)
        $trueClient = $request->header('True-Client-IP');
        if ($trueClient && filter_var($trueClient, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return $trueClient;
        }

        // 4. X-Real-IP (Nginx / Apache proxy)
        $xReal = $request->header('X-Real-IP');
        if ($xReal && filter_var($xReal, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return $xReal;
        }

        // 5. X-Forwarded-For chain: grab first public IP from client -> proxy chain
        $forwarded = $request->header('X-Forwarded-For');
        if ($forwarded) {
            $parts = array_map('trim', explode(',', $forwarded));
            foreach ($parts as $part) {
                if (filter_var($part, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                    return $part;
                }
            }
        }

        // 6. Direct request IP if public
        $directIp = $request->ip();
        if ($directIp && filter_var($directIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return $directIp;
        }

        // 7. Fallback to client-reported IP (even if in dev/NAT) or direct request IP
        return $clientReportedIp ?: ($cf ?: ($xReal ?: $directIp));
    }

    /**
     * Record a new authenticated device login session.
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
        ?string $userAgent = null,
        ?string $appVersion = null,
        ?string $userRole = null,
        ?string $publicIp = null
    ): self {
        // Expire prior active sessions for this device
        self::where('device_uuid', $deviceUuid)
            ->where('is_active', true)
            ->update([
                'is_active' => false,
                'status' => 'expired',
                'last_active_at' => now(),
            ]);

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

        if (empty($userRole) && !empty($userId)) {
            $user = User::find($userId);
            $userRole = $user?->role ?: ($user?->is_admin ? 'Admin' : 'Cashier');
        }

        return self::create([
            'store_id' => $storeId,
            'user_id' => $userId,
            'user_role' => $userRole ?: 'Cashier',
            'counter_id' => $counterId,
            'device_uuid' => $deviceUuid,
            'session_id' => 'ds_' . Str::random(32),
            'device_name' => $deviceName ?: null,
            'counter_name' => $counterName ?: null,
            'counter_code' => $counterCode ?: null,
            'ip_address' => $ipAddress ?: null,
            'public_ip' => $publicIp ?: null,
            'location' => $location ?: null,
            'login_time' => now(),
            'last_active_at' => now(),
            'status' => 'active',
            'app_version' => $appVersion ?: '2.0.21',
            'unsynced_items_count' => 0,
            'is_active' => true,
            'user_agent' => $userAgent ? substr($userAgent, 0, 255) : null,
        ]);
    }

    /**
     * Update heartbeat for an active device session.
     */
    public static function recordHeartbeat(
        string $deviceUuid,
        ?string $ipAddress = null,
        ?string $deviceName = null,
        ?string $counterName = null,
        ?string $appVersion = null,
        ?int $unsyncedItemsCount = null,
        ?string $status = null,
        ?string $userRole = null,
        ?string $publicIp = null,
        int|string|null $storeId = null
    ): ?self {
        $session = self::where('device_uuid', $deviceUuid)
            ->where('is_active', true)
            ->orderBy('id', 'desc')
            ->first();

        if ($session) {
            $updates = [
                'last_active_at' => now(),
            ];
            if ($storeId && (int)$session->store_id !== (int)$storeId) {
                $updates['store_id'] = (int)$storeId;
            }
            if ($ipAddress) {
                $updates['ip_address'] = $ipAddress;
            }
            if ($publicIp) {
                $updates['public_ip'] = $publicIp;
            }
            if ($deviceName && empty($session->device_name)) {
                $updates['device_name'] = $deviceName;
            }
            if ($counterName && empty($session->counter_name)) {
                $updates['counter_name'] = $counterName;
            }
            if ($appVersion) {
                $updates['app_version'] = $appVersion;
            }
            if ($unsyncedItemsCount !== null) {
                $updates['unsynced_items_count'] = max(0, $unsyncedItemsCount);
            }
            if ($status && in_array(strtolower($status), ['active', 'idle', 'locked'])) {
                // If it is locked on server, client heartbeat shouldn't silently unlock unless authenticated
                if ($session->status !== 'locked' || strtolower($status) === 'locked') {
                    $updates['status'] = strtolower($status);
                }
            }
            if ($userRole && empty($session->user_role)) {
                $updates['user_role'] = $userRole;
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
