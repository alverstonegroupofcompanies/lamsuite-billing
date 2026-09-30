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

    public function dispatchTransfer(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'transfer_id' => 'st_' . time(),
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
