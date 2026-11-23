<?php

namespace App\Http\Controllers\Api;

use App\Models\Counter;
use App\Models\Device;
use App\Services\CounterSequenceService;
use App\Support\Counter\CounterProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CNT-011 / PRF-001 — what a claimed counter is, what it may do, how long it
 * may work offline, and which credential caches it may fill.
 *
 * The device token names the counter. No parameter in the request can choose a
 * different one, and no answer carries a PIN, a hash or a token.
 */
class CounterContextController
{
    /**
     * The caches a till is allowed to hold for offline verification. Waves
     * C, D and E light these up; until then the manifest says so plainly
     * instead of letting the till guess from a 404.
     */
    private const CREDENTIAL_CACHES = [
        'approver_pins',
        'salesperson_pins',
        'pharmacist_pins',
        'drug_schedules',
    ];

    /** B7 ships one: the counter's own unlock hash, from the cache endpoint below. */
    private const SHIPPED_CACHES = [
        'counter_unlock' => '/api/credentials/offline-cache',
    ];

    public function show(Request $request): JsonResponse
    {
        $counter = $this->resolveCounter($request);

        if (!$counter) {
            return response()->json([
                'success' => false,
                'error' => 'counter_unclaimed',
                'message' => 'This workstation is not on a counter yet. Ask the store owner for a counter activation code.',
            ], 409);
        }

        $store = $counter->store;
        $isPharmacy = $store && (($store->store_type ?? 'pharmacy') === 'pharmacy');
        $lockedUntil = $counter->unlock_locked_until;

        // PRF-001: a counter that has never been handed a document gets the
        // canonical one here, so the till boots from a complete profile whether
        // or not an owner has opened the screen yet.
        $permissions = CounterProfile::seed($counter);

        return response()->json([
            'success' => true,
            'counter' => [
                'id' => $counter->id,
                'counter_code' => $counter->counter_code,
                'counter_name' => $counter->counter_name,
                'location_name' => $counter->location_name,
                'is_remote' => (bool) $counter->is_remote,
                'is_digital_only' => (bool) $counter->is_digital_only,
                'printer_profile' => $counter->printer_profile,
                'receipt_customization' => $counter->receipt_customization,
                'status' => $counter->status,
                'is_locked' => $lockedUntil !== null && $lockedUntil->isFuture(),
            ],
            'store' => [
                'id' => $store?->id,
                'name' => $store?->name,
                'code' => $store?->code,
                'is_pharmacy' => $isPharmacy,
            ],
            'profile' => [
                'permissions' => $permissions,
                'version' => (int) ($counter->permission_profile_version ?? CounterProfile::VERSION),
                'updated_at' => $counter->updated_at?->toIso8601String(),
            ],
            'defaults' => [
                'timezone' => $store?->timezone,
                'tax_mode' => $store?->tax_mode,
                'gst_type' => $store?->gst_type,
                'invoice_prefix' => $store?->invoice_prefix,
                'license_plan' => $store?->license_plan,
                'license_expires_at' => $store?->license_expires_at,
            ],
            'sequences' => app(CounterSequenceService::class)->manifest($counter),
            'locking' => [
                'idle_lock_minutes' => (int) ($counter->idle_lock_minutes ?? Counter::DEFAULT_IDLE_LOCK_MINUTES),
                'unlock' => [
                    // The hash itself only ever leaves through the cache endpoint.
                    'pin_set' => $counter->unlock_pin_hash !== null,
                    'failed_attempts' => (int) $counter->unlock_failed_attempts,
                    'locked_until' => $lockedUntil?->toIso8601String(),
                ],
            ],
            'offline' => $counter->offlinePayload() + [
                'last_sync_at' => $counter->last_sync_at?->toIso8601String(),
            ],
            'pharmacy' => $isPharmacy ? [
                'drug_license_numbers' => $store?->drug_license_numbers,
            ] : null,
            'credentials' => array_merge(
                array_map(fn (string $url, string $kind) => [
                    'kind' => $kind,
                    'available' => true,
                    'url' => $url,
                    'offline_verification' => 'bcrypt_hash',
                ], array_values(self::SHIPPED_CACHES), array_keys(self::SHIPPED_CACHES)),
                array_map(fn (string $kind) => [
                    'kind' => $kind,
                    'available' => false,
                    'url' => null,
                    'offline_verification' => 'not_shipped',
                ], self::CREDENTIAL_CACHES)
            ),
            'server_time' => now()->toIso8601String(),
        ]);
    }

    /**
     * PRF-004: the watermark alone, for a till that is only asking whether its
     * cached document is still the one in force. Cheap enough to ask often; it
     * answers with a number, never with the document, so a till cannot learn a
     * permission from this call — it has to read /api/counter/context for that.
     */
    public function version(Request $request): JsonResponse
    {
        $counter = $this->resolveCounter($request);

        if (!$counter) {
            return response()->json([
                'success' => false,
                'error' => 'counter_unclaimed',
                'message' => 'This workstation is not on a counter yet.',
            ], 409);
        }

        return response()->json([
            'success' => true,
            'counter_id' => (int) $counter->id,
            'counter_code' => $counter->counter_code,
            'permission_profile_version' => (int) ($counter->permission_profile_version ?? CounterProfile::VERSION),
            'status' => $counter->status,
            'counter_updated_at' => $counter->updated_at?->toIso8601String(),
            'server_time' => now()->toIso8601String(),
        ]);
    }

    /**
     * A counter-claimed token resolves to its own row; a device token resolves
     * through the device it was issued to. Nothing here takes a counter id from
     * the request (IS1).
     */
    private function resolveCounter(Request $request): ?Counter
    {
        if ($id = $request->attributes->get('device_counter_id')) {
            return Counter::with('store')->find($id);
        }

        $device = Device::find($request->attributes->get('device_id'));

        return $device?->counter_id
            ? Counter::with('store')->find($device->counter_id)
            : null;
    }
}
