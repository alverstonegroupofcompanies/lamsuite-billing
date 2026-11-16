<?php

namespace App\Http\Middleware;

use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authenticates a paired POS workstation by its device token and pins all
 * tenant-scoped work to the store that token was issued for.
 */
class AuthenticateDevice
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = trim((string) ($request->header('X-Device-Token') ?: $request->input('device_token', '')));

        if ($token === '') {
            return $this->deny('Device authentication token is required.', 401);
        }

        $hash = hash('sha256', $token);

        $device = Device::with('store')->where('device_token_hash', $hash)->first()
            ?? Device::with('store')->where('device_token', $token)->first();

        $counter = null;
        if (!$device) {
            $counter = Counter::with('store')->where('device_token_hash', $hash)->first()
                ?? Counter::with('store')->where('device_token', $token)->first();
        }

        if (!$device && !$counter) {
            return $this->deny('Device token is unrecognized or expired.', 401);
        }

        $status = $device?->status ?? $counter?->status;
        $store = $device?->store ?? $counter?->store;

        if (!$store || !$store->is_active) {
            return $this->deny('Store license is suspended or deactivated.', 403);
        }

        if (in_array($status, ['revoked', 'locked'], true)) {
            return $this->deny('This workstation has been revoked or locked by the store administrator.', 403);
        }

        if ($status === 'pending_approval') {
            return $this->deny('This workstation is pending approval from the store owner.', 403);
        }

        $storeId = (int) $store->id;
        $requested = $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? $request->query('store_id');

        if ($requested !== null && $requested !== '' && !$this->requestedStoreMatches($requested, $storeId)) {
            return $this->deny('Tenant isolation violation: this device is not registered for the requested store.', 403);
        }

        $request->attributes->set('device_id', $device?->id);
        $request->attributes->set('device_uuid', $device?->device_uuid ?? $counter?->device_uuid);
        $request->attributes->set('device_store_id', $storeId);
        $request->merge(['store_id' => $storeId]);

        return $next($request);
    }

    private function requestedStoreMatches(mixed $requested, int $storeId): bool
    {
        if (is_numeric($requested)) {
            return (int) $requested === $storeId;
        }

        return Store::where('id', $storeId)->where('code', $requested)->exists();
    }

    private function deny(string $message, int $status): Response
    {
        return response()->json([
            'success' => false,
            'error' => 'DEVICE_AUTH_FAILED',
            'message' => $message,
        ], $status);
    }
}
