<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Services\StockAdjustmentService;
use Illuminate\Validation\ValidationException;

class StockController
{
    public function __construct(private StockAdjustmentService $adjustments)
    {
    }

    /**
     * Post a multi-line stock adjustment document.
     *
     * The desktop may send either one adjustment (with document_id) or a
     * legacy single-line payload; both are normalised into a document so the
     * ledger always gets one row per line inside a single DB transaction.
     */
    public function recordAdjustment(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'nullable',
            'document_id' => 'nullable|string|max:120',
            'mode' => 'nullable|in:adjustment,physical_count',
            'reason' => 'nullable|string|max:120',
            'notes' => 'nullable|string',
            'document_date' => 'nullable|string|max:10',
            'lines' => 'nullable|array',
            'lines.*.product_id' => 'nullable',
            'lines.*.barcode' => 'nullable|string',
            'lines.*.batch_id' => 'nullable',
            'lines.*.batch_no' => 'nullable|string',
            'lines.*.adjustment_qty' => 'nullable|numeric',
            'lines.*.counted_qty' => 'nullable|numeric',
            'lines.*.unit_cost' => 'nullable|numeric',
            'lines.*.reason' => 'nullable|string|max:120',
            'lines.*.notes' => 'nullable|string',
            // Legacy single-line fields
            'product_id' => 'nullable',
            'batch_id' => 'nullable',
            'batch_no' => 'nullable|string',
            'adjustment_qty' => 'nullable|numeric',
            'physical_qty' => 'nullable|numeric',
            'counted_qty' => 'nullable|numeric',
        ]);

        $lines = $validated['lines'] ?? [];
        if (count($lines) === 0) {
            $legacySingleLine = $validated['product_id'] ?? null;
            if (!$legacySingleLine) {
                throw ValidationException::withMessages(['lines' => 'At least one adjustment line is required.']);
            }
            $lines = [[
                'product_id' => $validated['product_id'],
                'batch_id' => $validated['batch_id'] ?? null,
                'batch_no' => $validated['batch_no'] ?? null,
                'adjustment_qty' => $validated['adjustment_qty'] ?? null,
                'counted_qty' => $validated['counted_qty'] ?? $validated['physical_qty'] ?? null,
                'reason' => $validated['reason'] ?? null,
                'notes' => $validated['notes'] ?? null,
            ]];
        }

        $storeId = $this->resolveStoreId($request, $validated);
        $payload = [
            'document_id' => $validated['document_id'] ?? null,
            'mode' => $validated['mode'] ?? (!empty($validated['physical_qty']) ? 'physical_count' : 'adjustment'),
            'reason' => $validated['reason'] ?? null,
            'notes' => $validated['notes'] ?? null,
            'document_date' => $validated['document_date'] ?? now()->toDateString(),
            'lines' => $lines,
        ];

        $result = $this->adjustments->post($storeId, $request->user(), $payload);
        /** @var \App\Models\StockAdjustmentDocument $document */
        $document = $result['document'];

        return response()->json([
            'success' => true,
            'duplicate' => $result['duplicate'],
            'document_id' => $document->document_id,
            'status' => $document->status,
            'requires_approval' => (bool) $document->requires_approval,
            'lines_count' => $document->lines_count,
            'total_qty' => (float) $document->total_qty,
            'adjustments_posted' => $document->status === 'posted' ? $document->lines_count : 0,
            'message' => $document->status === 'pending_approval'
                ? 'Stock adjustment submitted for manager approval.'
                : 'Stock adjustment posted to the ledger.',
        ], $result['duplicate'] ? 200 : 201);
    }

    private function resolveStoreId(Request $request, array $validated): int
    {
        $candidate = $validated['store_id']
            ?? $request->header('X-Store-Id')
            ?? $request->header('Store-Id')
            ?? $request->user()?->store_id;

        if ($candidate !== null && $candidate !== '') {
            if (is_numeric($candidate) && \App\Models\Store::find((int) $candidate)) {
                return (int) $candidate;
            }
            $store = \App\Models\Store::where('code', $candidate)->orWhere('name', $candidate)->first();
            if ($store) {
                return (int) $store->id;
            }
        }

        return (int) (\App\Models\Store::first()?->id ?? 1);
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
