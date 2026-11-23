<?php

namespace App\Http\Controllers\Api;

use App\Services\CounterClaimService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CNT-006 — the only registration path a counter computer ever sees: a code.
 */
class CounterClaimController
{
    public function __construct(private readonly CounterClaimService $claims)
    {
    }

    public function claim(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => 'required|string|max:120',
            'device_uuid' => 'required|string|max:100',
            'device_name' => 'nullable|string|max:100',
            'app_version' => 'nullable|string|max:30',
        ]);

        $result = $this->claims->claim(
            $validated['code'],
            $validated['device_uuid'],
            $validated['device_name'] ?? null,
            $validated['app_version'] ?? null,
            $request->ip(),
            $request->header('X-Store-Id') ?? $request->input('store_id'),
        );

        return response()->json($result['body'], $result['status']);
    }
}
