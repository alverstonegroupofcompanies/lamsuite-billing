<?php

namespace App\Http\Middleware;

use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * Normalizes the tenant key a client sends into a server store id.
 *
 * Older POS builds send a local registry key such as "store_main" wherever a
 * store id is expected. Public terminal endpoints resolve store ids themselves
 * and would either 404 or silently fall back to the first store, which can read
 * or reseed another tenant's data. This middleware converts any resolvable
 * store key/code into the numeric id before the controller sees it.
 */
class NormalizeStoreContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $candidate = $request->header('X-Store-Id')
            ?? $request->header('Store-Id')
            ?? $request->query('active_store_id')
            ?? $request->query('store_id')
            ?? $request->input('active_store_id')
            ?? $request->input('store_id');

        if ($candidate === null || $candidate === '') {
            return $next($request);
        }

        if (strtolower(trim((string) $candidate)) === 'all') {
            return $next($request);
        }

        $store = $this->match($candidate)
            ?? $this->fromDeviceToken($request)
            ?? $this->fromDeviceUuid($request)
            ?? $this->fromBearerUser($request);

        if (!$store) {
            return $next($request);
        }

        $storeId = (string) $store->id;
        if ((string) $candidate !== $storeId) {
            $request->headers->set('X-Store-Id', $storeId);
            $request->headers->set('Store-Id', $storeId);

            foreach (['store_id', 'active_store_id'] as $key) {
                if ($request->query->has($key)) {
                    $request->query->set($key, $storeId);
                }
                if ($request->request->has($key)) {
                    $request->request->set($key, $storeId);
                }
            }
        }

        return $next($request);
    }

    private function match(mixed $candidate): ?Store
    {
        if (is_numeric($candidate)) {
            return Store::find((int) $candidate);
        }

        if (!is_string($candidate)) {
            return null;
        }

        $value = trim($candidate);
        if ($value === '') {
            return null;
        }

        return Store::where('code', $value)->orWhere('name', $value)->first();
    }

    private function fromDeviceToken(Request $request): ?Store
    {
        $token = trim((string) ($request->header('X-Device-Token') ?: $request->input('device_token', '')));
        if ($token === '') {
            return null;
        }

        $hash = hash('sha256', $token);

        $device = Device::with('store')->where('device_token_hash', $hash)->first()
            ?? Device::with('store')->where('device_token', $token)->first();
        if ($device?->store) {
            return $device->store;
        }

        $counter = Counter::with('store')->where('device_token_hash', $hash)->first()
            ?? Counter::with('store')->where('device_token', $token)->first();

        return $counter?->store;
    }

    private function fromDeviceUuid(Request $request): ?Store
    {
        $uuid = trim((string) ($request->header('X-Device-Uuid') ?: $request->input('device_uuid', '')));
        if ($uuid === '') {
            return null;
        }

        $counter = Counter::with('store')->where('device_uuid', $uuid)->first();
        if ($counter?->store) {
            return $counter->store;
        }

        $device = Device::with('store')->where('device_uuid', $uuid)->first();
        return $device?->store;
    }

    private function fromBearerUser(Request $request): ?Store
    {
        $user = $request->user();

        if (!$user && ($bearer = $request->bearerToken())) {
            try {
                $user = PersonalAccessToken::findToken($bearer)?->tokenable;
            } catch (\Throwable) {
                return null;
            }
        }

        if (!$user?->store_id) {
            return null;
        }

        return Store::find((int) $user->store_id);
    }
}
