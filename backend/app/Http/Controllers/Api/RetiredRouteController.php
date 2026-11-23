<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CNT-013 — the single answer every retired registration path gives.
 *
 * A workstation can no longer join a store with a shared key, an owner password
 * or a pairing code, so those doors are closed rather than deleted: an old till
 * gets one clear instruction instead of a 404 it cannot explain, and nothing a
 * caller sends is validated, consumed or bound on the way out.
 */
class RetiredRouteController
{
    public function __invoke(Request $request): JsonResponse
    {
        return response()->json([
            'success' => false,
            'error' => 'route_retired',
            'message' => 'That way of joining a store is retired. Ask the store owner for a counter activation code and enter it on the counter code screen.',
        ], 410);
    }
}
