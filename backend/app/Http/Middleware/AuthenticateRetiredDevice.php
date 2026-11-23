<?php

namespace App\Http\Middleware;

use App\Models\Device;
use App\Models\Store;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * SYNC-02 / CR Q1 — the one door a retired workstation may still knock on.
 *
 * A till the owner re-issued while it was offline holds bills it sold before
 * that moment. Its old token is accepted here, and only here, while the device
 * row says it was revoked and the revocation is recent. An active token, an
 * unknown token or a token retired longer ago than the window is turned away,
 * and the request is pinned to the store the device belonged to, exactly as
 * AuthenticateDevice pins a live till.
 */
class AuthenticateRetiredDevice
{
    /** How long after a revocation its pre-revocation bills are still taken. */
    public const WINDOW_DAYS = 7;

    public function handle(Request $request, Closure $next): Response
    {
        $token = trim((string) $request->header('X-Device-Token', ''));
        if ($token === '') {
            return $this->deny('A retired device token is required.', 401);
        }

        $device = Device::with('store')
            ->where('device_token_hash', hash('sha256', $token))
            ->first();

        if (!$device || $device->status !== 'revoked' || !$device->revoked_at) {
            return $this->deny('This token does not belong to a retired workstation.', 401);
        }

        if ($device->revoked_at->lt(now()->subDays(self::WINDOW_DAYS))) {
            return $this->deny('This workstation was retired too long ago to send its offline bills. Ask the store owner to enter them.', 401);
        }

        $store = $device->store;
        if (!$store || !$store->is_active) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_DISABLED',
                'message' => 'Store license is suspended or deactivated.',
            ], 403);
        }

        $storeId = (int) $store->id;
        $requested = $request->header('X-Store-Id') ?? $request->input('store_id');
        if ($requested !== null && $requested !== '' && !$this->requestedStoreMatches($requested, $storeId)) {
            return response()->json([
                'success' => false,
                'error' => 'DEVICE_AUTH_FAILED',
                'message' => 'Tenant isolation violation: this device is not registered for the requested store.',
            ], 403);
        }

        $request->attributes->set('device_id', $device->id);
        $request->attributes->set('device_uuid', $device->device_uuid);
        $request->attributes->set('device_store_id', $storeId);
        $request->attributes->set('device_counter_id', $device->counter_id);
        $request->attributes->set('retired_device', $device);
        $request->merge(['store_id' => $storeId]);

        return $next($request);
    }

    private function requestedStoreMatches(mixed $requested, int $storeId): bool
    {
        if (is_numeric($requested)) {
            return (int) $requested === $storeId;
        }

        if (is_string($requested) && preg_match('/^store_/i', trim($requested)) === 1) {
            return true;
        }

        return Store::where('id', $storeId)->where('code', $requested)->exists();
    }

    /**
     * Same shape as AuthenticateDevice, so the till reads a closed door the way
     * it reads any refused credential: it stops asking and keeps its bills.
     */
    private function deny(string $message, int $status): Response
    {
        return response()->json([
            'success' => false,
            'error' => 'DEVICE_AUTH_FAILED',
            'status' => 'unrecognized',
            'message' => $message,
        ], $status);
    }
}
