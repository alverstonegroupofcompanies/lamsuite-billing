<?php

namespace App\Services;

use App\Models\ActivationKey;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceActivationAttempt;
use App\Models\Notification;
use App\Models\Store;
use App\Support\Counter\CounterProfile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * CNT-006 / CNT-007 — a code alone brings a workstation onto one counter.
 * The counter is the tenant principal: the token minted here resolves to exactly
 * one (store, counter) pair for its lifetime.
 */
class CounterClaimService
{
    /** CNT-005: how much code-guessing is tolerated before the endpoint locks. */
    public const LOCKOUT_FAILURES = 5;
    public const LOCKOUT_WINDOW_MINUTES = 15;

    /**
     * CNT-005: the only IP-wide lock. A shared shop network reaches this only
     * when a caller rotates device identities to keep guessing.
     */
    public const IP_CEILING_FAILURES = 30;

    /**
     * @return array{status:int, body:array}
     */
    public function claim(
        string $rawCode,
        string $deviceUuid,
        ?string $deviceName = null,
        ?string $appVersion = null,
        ?string $ip = null,
        ?string $storeHint = null,
    ): array {
        $key = ActivationKey::findByCode($rawCode);
        $hintedStoreId = $this->resolveStoreHint($storeHint);

        // CNT-005: guessing is stopped before a code is judged, so a valid code
        // cannot be burned while an attacker hammers one machine or IP.
        // ACT-01: the lock belongs to the workstation that typed the wrong codes;
        // only a flood far beyond ordinary mistyping closes the whole network.
        $lockScope = $this->lockScope($ip, $deviceUuid);
        if ($lockScope !== null) {
            $this->alertLockout($key?->store_id ?? $hintedStoreId, $key?->counter_id, $ip, $deviceUuid, $lockScope);

            return [
                'status' => 429,
                'body' => [
                    'success' => false,
                    'error' => 'claim_locked',
                    'locked' => true,
                    'scope' => $lockScope,
                    'locked_minutes' => self::LOCKOUT_WINDOW_MINUTES,
                    'message' => $lockScope === 'device'
                        ? 'This workstation is locked for ' . self::LOCKOUT_WINDOW_MINUTES
                            . ' minutes after repeated wrong activation codes. Other counters can still be activated, and the store owner has been alerted.'
                        : 'Too many wrong activation codes from this network. Counter activation is locked here for '
                            . self::LOCKOUT_WINDOW_MINUTES . ' minutes and the store owner has been alerted.',
                ],
            ];
        }

        // IS2: the store is read off the code, never off the request. A request that
        // claims a different store is refused instead of silently landing elsewhere.
        $reason = match (true) {
            !$key => 'unknown_code',
            $key->whyInvalid() !== null => $key->whyInvalid(),
            !$key->counter_id => 'not_counter_code',
            $hintedStoreId !== null && $hintedStoreId !== (int) $key->store_id => 'store_mismatch',
            default => null,
        };

        $counter = $reason === null ? Counter::find($key->counter_id) : null;

        if ($reason === null && !$counter) {
            $reason = 'counter_missing';
        } elseif ($reason === null && (!$counter->store || !$counter->store->is_active)) {
            $reason = 'store_suspended';
        }

        if ($reason !== null) {
            $this->record($key, $reason, $rawCode, $deviceUuid, $deviceName, $ip);

            return $this->refused();
        }

        if (in_array($counter->status, [Counter::STATUS_ACTIVE, Counter::STATUS_LOCKED], true)
            && $counter->device_uuid !== $deviceUuid) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'error' => 'counter_already_claimed',
                    'message' => 'This counter is already in use on another workstation. Ask the owner to re-issue its activation code.',
                ],
            ];
        }

        // CNT-008: a machine holds one counter per store. Claiming a second one
        // in the same store would put two number series, two permission profiles
        // and two audit trails behind a single till, so the first must be
        // released (re-issued or retired) by the owner before the next is taken.
        $held = Counter::where('store_id', $counter->store_id)
            ->where('device_uuid', $deviceUuid)
            ->where('id', '!=', $counter->id)
            ->whereIn('status', [Counter::STATUS_ACTIVE, Counter::STATUS_LOCKED])
            ->first();

        if ($held) {
            return [
                'status' => 409,
                'body' => [
                    'success' => false,
                    'error' => 'device_on_another_counter',
                    'counter_id' => $held->id,
                    'counter_name' => $held->counter_name,
                    'message' => 'This workstation already works "'
                        . $held->counter_name . '" in this store. Ask the owner to release that counter before claiming another one here.',
                ],
            ];
        }

        $rawToken = 'lsd_' . Str::random(40);
        $tokenHash = hash('sha256', $rawToken);

        DB::transaction(function () use ($key, $counter, $deviceUuid, $deviceName, $appVersion, $ip, $tokenHash) {
            // A device identity is per store, so one machine can hold a counter in
            // each store without either claim overwriting the other (CNT-008).
            $device = Device::firstOrNew([
                'store_id' => $counter->store_id,
                'device_uuid' => $deviceUuid,
            ]);

            $device->fill([
                'device_name' => $deviceName ?: $counter->counter_name,
                'app_version' => $appVersion ?: $device->app_version ?: '2.0.0',
                'status' => 'active',
                'counter_id' => $counter->id,
                'registered_via' => 'counter_code',
                'activation_key_id' => $key->id,
                'device_token' => null,
                'device_token_hash' => $tokenHash,
                'ip_address' => $ip,
                'revoke_reason' => null,
                'last_seen_at' => now(),
                'approved_at' => now(),
            ])->save();

            $counter->update([
                'status' => Counter::STATUS_ACTIVE,
                'device_uuid' => $deviceUuid,
                'current_device_id' => $device->id,
                'device_name' => $deviceName ?: $counter->device_name,
                'mac_address' => $counter->mac_address,
                'ip_address' => $ip ?? $counter->ip_address,
                'last_seen_at' => now(),
                'approved_at' => now(),
                'device_token' => null,
                'device_token_hash' => $tokenHash,
                'pairing_code' => null,
                'pairing_expires_at' => null,
                'revoke_reason' => null,
            ]);

            $key->markConsumed($deviceUuid);

            // CNT-005: the claim that actually opened the counter is the security event.
            // A repeated claim by the same device returns early elsewhere and adds nothing.
            AuditLog::log(
                'counter_claimed',
                'Counter',
                (string) $counter->id,
                null,
                [
                    'counter_code' => $counter->counter_code,
                    'store_id' => $counter->store_id,
                    'device_uuid' => $deviceUuid,
                    'device_name' => $device->device_name,
                ],
                (int) $counter->store_id
            );
        });

        $counter = $counter->fresh();
        $sequences = app(CounterSequenceService::class);
        $sequences->ensureFor($counter);

        // PRF-001: the document the till works inside arrives with the counter,
        // so the first screen it draws is already the owner's.
        $permissions = CounterProfile::seed($counter);

        // CNT-005: a success is recorded against the counter it opened.
        $this->record($key, null, $rawCode, $deviceUuid, $deviceName, $ip, $counter);

        return [
            'status' => 200,
            'body' => [
                'success' => true,
                'device_token' => $rawToken,
                'token_stored_as' => 'hash_only',
                'sequences' => $sequences->manifest($counter),
                'counter' => [
                    'id' => $counter->id,
                    'counter_code' => $counter->counter_code,
                    'counter_name' => $counter->counter_name,
                    'location_name' => $counter->location_name,
                    'is_remote' => (bool) $counter->is_remote,
                    'is_digital_only' => (bool) $counter->is_digital_only,
                    'printer_profile' => $counter->printer_profile,
                    'receipt_customization' => $counter->receipt_customization,
                ],
                'store' => [
                    'id' => $counter->store_id,
                    'name' => $counter->store->name,
                    'code' => $counter->store->code,
                ],
                'offline' => $counter->offlinePayload(),
                'profile' => [
                    'permissions' => $permissions,
                    'version' => (int) ($counter->permission_profile_version ?? CounterProfile::VERSION),
                    'updated_at' => $counter->updated_at?->toIso8601String(),
                ],
                'server_time' => now()->toIso8601String(),
                'message' => 'Counter activated. Keep this token on this machine only.',
            ],
        ];
    }

    /**
     * CNT-007: replace the workstation. The device it retires is refused on its
     * next call, and the counter goes back to waiting for exactly one claim.
     *
     * @return array{code:string, activation_key_id:int, qr_payload:array, revoked_device_uuid:?string}
     */
    public function reissue(Counter $counter, array $options = []): array
    {
        $revokedDevice = Device::where('counter_id', $counter->id)
            ->where('status', 'active')
            ->orderByDesc('id')
            ->first();

        DB::transaction(function () use ($counter, $revokedDevice) {
            if ($revokedDevice) {
                $revokedDevice->update([
                    'status' => 'revoked',
                    'revoke_reason' => 'Replaced by a re-issued activation code',
                    'device_token' => null,
                ]);
            }

            ActivationKey::where('counter_id', $counter->id)
                ->whereNull('consumed_at')
                ->where('is_revoked', false)
                ->get()
                ->each(fn ($key) => $key->revoke('Superseded by a re-issued code'));

            $counter->update([
                'status' => Counter::STATUS_UNCLAIMED,
                'current_device_id' => null,
                'device_uuid' => null,
                'device_token' => null,
                'device_token_hash' => null,
                'pairing_code' => null,
                'pairing_expires_at' => null,
                'approved_at' => null,
                'revoke_reason' => null,
            ]);
        });

        $issued = ActivationKey::generateForCounter($counter, $options);

        return [
            'code' => $issued['raw_key'],
            'activation_key_id' => $issued['model']->id,
            'key_prefix' => $issued['model']->key_prefix,
            'expires_at' => $issued['model']->expires_at?->toIso8601String(),
            'qr_payload' => $issued['qr_payload'],
            'revoked_device_uuid' => $revokedDevice?->device_uuid,
        ];
    }

    /**
     * A till may say which store it thinks it is joining. Local registry keys
     * ("store_main") are not server stores and carry no claim on tenancy.
     */
    private function resolveStoreHint(?string $hint): ?int
    {
        $hint = trim((string) $hint);

        if ($hint === '') {
            return null;
        }

        if (is_numeric($hint)) {
            return (int) $hint;
        }

        return Store::where('code', $hint)->value('id');
    }

    /** CNT-005: one common refusal, whatever the reason. */
    private function refused(): array
    {
        return [
            'status' => 401,
            'body' => [
                'success' => false,
                'error' => 'claim_failed',
                'message' => 'That activation code is not valid here. Ask the store owner for a current counter code.',
            ],
        ];
    }

    /** @return 'device'|'network'|null */
    private function lockScope(?string $ip, string $deviceUuid): ?string
    {
        if (DeviceActivationAttempt::countRecentDeviceFailures($deviceUuid, self::LOCKOUT_WINDOW_MINUTES)
            >= self::LOCKOUT_FAILURES) {
            return 'device';
        }

        if (DeviceActivationAttempt::countRecentIpFailures((string) $ip, self::LOCKOUT_WINDOW_MINUTES)
            >= self::IP_CEILING_FAILURES) {
            return 'network';
        }

        return null;
    }

    /**
     * CNT-005: every judged claim leaves exactly one row, and the code never
     * appears in it — only its first ten characters, enough to tell a typo
     * from a guess.
     */
    private function record(
        ?ActivationKey $key,
        ?string $reason,
        string $rawCode,
        string $deviceUuid,
        ?string $deviceName,
        ?string $ip,
        ?Counter $counter = null,
    ): void {
        DeviceActivationAttempt::create([
            'ip_address' => $ip ?: '0.0.0.0',
            'device_uuid' => substr($deviceUuid, 0, 80),
            'device_name' => $deviceName ? substr($deviceName, 0, 100) : null,
            'attempted_key_prefix' => substr(strtoupper(trim($rawCode)), 0, 10),
            'store_id' => $counter?->store_id ?? $key?->store_id,
            'counter_id' => $counter?->id ?? $key?->counter_id,
            'activation_key_id' => $key?->id,
            'success' => $reason === null,
            'failure_reason' => $reason,
        ]);
    }

    /**
     * CNT-005: the owner hears about a lockout once per window for each locked
     * workstation (ACT-01) — or once for the network — not once per request,
     * and learns nothing about the codes that were tried.
     */
    private function alertLockout(?int $storeId, ?int $counterId, ?string $ip, string $deviceUuid, string $scope): void
    {
        if ($storeId === null) {
            return;
        }

        $subject = $scope === 'device' ? $deviceUuid : (string) $ip;
        $alreadyAlerted = AuditLog::where('action', 'counter_claim_lockout_triggered')
            ->where('store_id', $storeId)
            ->where('created_at', '>=', now()->subMinutes(self::LOCKOUT_WINDOW_MINUTES))
            ->get(['new_values'])
            ->contains(function ($log) use ($scope, $subject) {
                $values = is_array($log->new_values) ? $log->new_values : (json_decode((string) $log->new_values, true) ?: []);
                $loggedScope = $values['scope'] ?? (($values['triggered_by'] ?? null) === 'ip' ? 'network' : 'device');
                $loggedSubject = $loggedScope === 'device' ? ($values['device_uuid'] ?? null) : ($values['ip_address'] ?? null);

                return $loggedScope === $scope && (string) $loggedSubject === $subject;
            });

        if ($alreadyAlerted) {
            return;
        }

        $deviceFailures = DeviceActivationAttempt::countRecentDeviceFailures($deviceUuid, self::LOCKOUT_WINDOW_MINUTES);
        $ipFailures = DeviceActivationAttempt::countRecentIpFailures((string) $ip, self::LOCKOUT_WINDOW_MINUTES);

        AuditLog::log(
            'counter_claim_lockout_triggered',
            'Counter',
            $counterId === null ? null : (string) $counterId,
            null,
            [
                'ip_address' => $ip,
                'device_uuid' => $deviceUuid,
                'device_failures' => $deviceFailures,
                'ip_failures' => $ipFailures,
                'scope' => $scope,
                'locked_minutes' => self::LOCKOUT_WINDOW_MINUTES,
            ],
            $storeId
        );

        Notification::create([
            'store_id' => $storeId,
            'title' => 'Counter activation locked',
            'message' => $scope === 'device'
                ? 'Too many invalid activation codes were tried on workstation ' . $deviceUuid
                    . '. Counter activation is paused on that workstation for '
                    . self::LOCKOUT_WINDOW_MINUTES . ' minutes.'
                : 'Too many invalid activation codes were tried from ' . ($ip ?: 'an unknown address')
                    . '. Counter activation is paused for ' . self::LOCKOUT_WINDOW_MINUTES . ' minutes.',
            'type' => 'counter_claim_lockout',
            'data' => [
                'counter_id' => $counterId,
                'ip_address' => $ip,
                'device_uuid' => $deviceUuid,
                'scope' => $scope,
            ],
        ]);
    }
}
