<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class PurchaseController
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => []]);
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'purchase_id' => 'pb_' . time(),
        ], 201);
    }

    public function show(string $id): JsonResponse
    {
        return response()->json(['id' => $id]);
    }
}
