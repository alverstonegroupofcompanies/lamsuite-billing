<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Services\Auth\CounterPinAuthenticator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PRF-005 / PRF-006 / B7 — the counter's own unlock credential.
 *
 * A till verifies the counter PIN here to lift its idle lock; the counter is the
 * subject, named by its device token and by nothing in the request (IS1). Five
 * wrong attempts hand the till back to the owner, because only the admin panel
 * resets a PIN (IS7). The offline-cache response is the single place a cached
 * credential hash leaves the server, and only ever to the counter that owns it
 * (plan-delta §4.5).
 */
class CounterUnlockController
{
    public function unlock(Request $request): JsonResponse
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $this->unclaimed();
        }

        $validated = $request->validate([
            'pin' => 'required|string|max:8',
        ]);

        // PRF-007: the drawer is opened with this same credential, so the
        // comparison, the attempt counting and the lockout live in one service
        // and cannot drift apart between the two screens.
        $verdict = app(CounterPinAuthenticator::class)->verify($counter, $validated['pin']);

        if (!$verdict['ok']) {
            return response()->json([
                'success' => false,
                'code' => $verdict['code'],
                'error' => $verdict['message'],
            ] + array_intersect_key($verdict, array_flip(['locked_until', 'remaining_attempts'])), $verdict['status']);
        }

        AuditLog::log('counter_unlocked_by_pin', 'Counter', (string) $counter->id, null, [
            'method' => 'counter_pin',
        ], $counter->store_id);

        return response()->json([
            'success' => true,
            'counter_id' => $counter->id,
            'message' => 'Counter unlocked.',
        ]);
    }

    /**
     * §4.5: the caches a till may hold to verify credentials while it is offline.
     * Hashes only, only for the counter making the call, never a PIN.
     */
    public function offlineCache(Request $request): JsonResponse
    {
        $counter = $this->counter($request);

        if (!$counter) {
            return $this->unclaimed();
        }

        return response()->json([
            'success' => true,
            'counter_id' => $counter->id,
            'store_id' => $counter->store_id,
            'profile_version' => (int) ($counter->permission_profile_version ?? 1),
            'generated_at' => now()->toIso8601String(),
            'credentials' => [[
                'kind' => 'counter_unlock',
                'pin_set' => $counter->unlock_pin_hash !== null,
                'algorithm' => 'bcrypt',
                'hash' => $counter->unlock_pin_hash,
                'failed_attempts' => (int) $counter->unlock_failed_attempts,
                'locked_until' => $counter->unlock_locked_until?->toIso8601String(),
            ]],
        ]);
    }

    private function counter(Request $request): ?Counter
    {
        $id = $request->attributes->get('device_counter_id');

        return $id ? Counter::find($id) : null;
    }

    private function unclaimed(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'error' => 'counter_unclaimed',
            'message' => 'This workstation is not on a counter yet. Ask the store owner for a counter activation code.',
        ], 409);
    }
}
