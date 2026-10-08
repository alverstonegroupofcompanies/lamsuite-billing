<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Product;
use App\Models\ProductBatch;

class StockController
{
    public function recordAdjustment(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'adjustment_id' => 'adj_' . time(),
        ]);
    }

    public function listTransfers(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => [],
        ]);
    }

    public function dispatchTransfer(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from_store_id' => 'nullable|string',
            'to_store_id' => 'required|string',
            'transfer_no' => 'nullable|string',
            'lines' => 'required|array|min:1',
            'lines.*.product_id' => 'required|string',
            'lines.*.batch_no' => 'required|string',
            'lines.*.qty' => 'required|numeric|min:0.01',
        ]);

        $transferId = 'st_' . time() . '_' . substr(md5(uniqid()), 0, 4);

        return response()->json([
            'success' => true,
            'transfer_id' => $transferId,
            'transfer_no' => $validated['transfer_no'] ?? ('TRF-' . date('Ymd') . '-' . rand(100, 999)),
            'status' => 'dispatched',
            'item_count' => count($validated['lines']),
        ], 201);
    }

    public function receiveTransfer(Request $request, string $id): JsonResponse
    {
        return response()->json([
            'success' => true,
            'transfer_id' => $id,
            'status' => 'received',
            'received_at' => date('Y-m-d H:i:s'),
        ]);
    }

    public function cancelTransfer(Request $request, string $id): JsonResponse
    {
        return response()->json([
            'success' => true,
            'transfer_id' => $id,
            'status' => 'cancelled',
            'cancelled_at' => date('Y-m-d H:i:s'),
        ]);
    }

    public function nearExpiry(Request $request): JsonResponse
    {
        $days = (int) $request->query('threshold_days', 60);
        $cutoff = date('Y-m-d', strtotime("+{$days} days"));

        $batches = ProductBatch::with('product')
            ->where('stock_qty', '>', 0)
            ->where('expiry_date', '<=', $cutoff)
            ->orderBy('expiry_date', 'asc')
            ->get();

        return response()->json($batches);
    }

    public function lowStock(Request $request): JsonResponse
    {
        $products = Product::where('is_active', true)
            ->whereColumn('current_stock', '<=', 'reorder_level')
            ->get();

        return response()->json($products);
    }
}
