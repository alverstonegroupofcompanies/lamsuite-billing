<?php

namespace Tests\Support;

use App\Models\Counter;
use App\Models\Store;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Test double for AuthenticateDevice (G1-SEC).
 *
 * Since G1-SEC the store and counter of a till request come only from the
 * authenticated counter (RequestTenant), never from a header or body field.
 * Feature tests about sync ingest, billing maths or reports are not about
 * authentication, so instead of claiming a real counter in every one of them
 * they stand this guard in: the request is treated exactly as if it came from a
 * claimed counter of the store it names (X-Store-Id / store_id, by id or code).
 *
 * Tests about authentication itself (RouteAuthAllowlistTest,
 * AnonymousTillRoutesTest, InvoiceTenantScopeTest, CounterAuthorisesPosRoutesTest,
 * DeviceAuthHardeningTest) use the real middleware and real claimed tokens.
 */
final class FakeCounterGuard
{
    public function handle(Request $request, Closure $next): Response
    {
        $named = $request->header('X-Store-Id')
            ?: $request->header('Store-Id')
            ?: $request->input('store_id')
            ?: $request->query('store_id');

        $store = null;
        if ($named !== null && $named !== '') {
            $store = is_numeric($named)
                ? Store::find((int) $named)
                : Store::where('code', $named)->first();
        }
        // A test that names no store stands for the only/first store it set up.
        $store ??= Store::orderBy('id')->first();

        if (!$store) {
            return response()->json(['success' => false, 'error' => 'DEVICE_AUTH_FAILED', 'message' => 'Test guard: no store.'], 401);
        }

        $requested = trim((string) ($request->input('counter_code') ?? ''));
        $code = strtoupper($requested !== '' ? $requested : 'C01');
        $counter = Counter::where('store_id', $store->id)->where('counter_code', $code)->first();

        // A test that names no code stands for the store's first counter when
        // one exists; a test that names a code gets exactly that counter, so
        // per-counter behaviour is measured against what it asked for.
        if (!$counter && $requested === '') {
            $counter = Counter::where('store_id', $store->id)->orderBy('id')->first();
        }

        $counter ??= Counter::create(['store_id' => $store->id, 'counter_code' => $code, 'counter_name' => 'Counter ' . $code]);

        $request->attributes->set('device_store_id', (int) $store->id);
        $request->attributes->set('device_counter_id', (int) $counter->id);
        $request->attributes->set('device_uuid', $request->header('X-Device-UUID') ?: 'test-device');
        $request->merge(['store_id' => (int) $store->id]);

        return $next($request);
    }
}
