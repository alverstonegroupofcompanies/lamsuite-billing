<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Counter;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockTransfer;
use App\Services\Stock\InterStoreTransferService;
use App\Services\StockAdjustmentService;
use App\Support\RequestTenant;
use Illuminate\Validation\ValidationException;

class StockController
{
    public function __construct(
        private StockAdjustmentService $adjustments,
        private InterStoreTransferService $transfers
    ) {
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

        $result = $this->adjustments->post($storeId, $request->user(), $payload, $this->resolveCounter($request, $storeId));
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

    /**
     * The till principal posting this adjustment. Authenticated device traffic
     * names its counter on the request; older payloads may still send a
     * counter_code, which is resolved inside the same store.
     */
    private function resolveCounter(Request $request, int $storeId): ?Counter
    {
        $counterId = RequestTenant::counterId($request);
        if ($counterId !== null) {
            return Counter::find($counterId);
        }

        $code = trim((string) $request->input('counter_code', ''));
        if ($code === '') {
            return null;
        }

        return Counter::where('store_id', $storeId)
            ->where('counter_code', strtoupper($code))
            ->first();
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
        $storeId = $this->resolveStoreId($request, $request->all());
        $direction = $request->query('direction', 'all');

        $query = StockTransfer::with(['items.product:id,name,barcode', 'fromStore:id,name,code', 'toStore:id,name,code'])
            ->orderByDesc('id')
            ->limit(100);

        if ($direction === 'inbound') {
            $query->where('to_store_id', $storeId);
        } elseif ($direction === 'outbound') {
            $query->where('from_store_id', $storeId);
        } else {
            $query->where(fn ($q) => $q->where('to_store_id', $storeId)->orWhere('from_store_id', $storeId));
        }

        return response()->json([
            'success' => true,
            'data' => $query->get(),
        ]);
    }

    public function dispatchTransfer(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from_store_id' => 'nullable',
            'store_id' => 'nullable',
            'to_store_id' => 'required',
            'transfer_no' => 'nullable|string',
            'notes' => 'nullable|string',
            'lines' => 'required|array|min:1',
            'lines.*.product_id' => 'required',
            'lines.*.batch_no' => 'required|string',
            'lines.*.qty' => 'required|numeric|min:0.01',
        ]);

        $toStoreId = \App\Models\Store::where('id', $validated['to_store_id'])
            ->orWhere('code', $validated['to_store_id'])
            ->first()?->id;
        if (!$toStoreId) {
            throw ValidationException::withMessages(['to_store_id' => 'Destination store not found.']);
        }

        $fromStoreId = $this->resolveStoreId($request, array_merge($validated, [
            'store_id' => $validated['store_id'] ?? $validated['from_store_id'] ?? null,
        ]));

        $transfer = $this->transfers->dispatch(
            $fromStoreId,
            (int) $toStoreId,
            $validated['lines'],
            $request->user(),
            $validated['transfer_no'] ?? null,
            $validated['notes'] ?? null
        );

        return response()->json([
            'success' => true,
            'transfer_id' => $transfer->id,
            'id' => $transfer->id,
            'transfer_no' => $transfer->transfer_number,
            'status' => $transfer->status,
            'item_count' => $transfer->items->count(),
            'lines' => $transfer->items,
        ], 201);
    }

    public function receiveTransfer(Request $request, string $id): JsonResponse
    {
        $transfer = StockTransfer::findOrFail($id);
        $storeId = $this->resolveStoreId($request, $request->all());

        if ((int) $transfer->to_store_id !== (int) $storeId) {
            throw ValidationException::withMessages([
                'transfer' => 'A transfer can only be received at its destination store.',
            ]);
        }

        $instructions = [];
        foreach ((array) $request->input('lines', []) as $line) {
            if (is_array($line) && isset($line['item_id'])) {
                $instructions[] = [
                    'item_id' => $line['item_id'],
                    'dest_product_id' => $line['dest_product_id'] ?? null,
                    'received_qty' => $line['received_qty'] ?? null,
                    'shortage_reason' => $line['shortage_reason'] ?? null,
                ];
            }
        }

        $result = $this->transfers->receive(
            $transfer,
            $request->user(),
            $instructions,
            $request->boolean('auto_create')
        );

        return response()->json([
            'success' => true,
            'transfer_id' => $transfer->id,
            'status' => $result['transfer']->status,
            'received_at' => optional($result['transfer']->received_at)->toDateTimeString(),
            'resolutions' => $result['resolutions'],
        ]);
    }

    public function cancelTransfer(Request $request, string $id): JsonResponse
    {
        $transfer = StockTransfer::findOrFail($id);
        $storeId = $this->resolveStoreId($request, $request->all());

        if ((int) $transfer->from_store_id !== (int) $storeId) {
            throw ValidationException::withMessages([
                'transfer' => 'A transfer can only be cancelled by its sending store.',
            ]);
        }

        $cancelled = $this->transfers->cancel($transfer, $request->user(), (string) $request->input('reason', ''));

        return response()->json([
            'success' => true,
            'transfer_id' => $cancelled->id,
            'status' => $cancelled->status,
        ]);
    }

    public function nearExpiry(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request, $request->all());
        $days = (int) $request->query('threshold_days', 60);
        $cutoff = date('Y-m-d', strtotime("+{$days} days"));

        $batches = ProductBatch::with('product')
            ->where('store_id', $storeId)
            ->where('stock_qty', '>', 0)
            ->where('expiry_date', '<=', $cutoff)
            ->orderBy('expiry_date', 'asc')
            ->get();

        return response()->json($batches);
    }

    public function lowStock(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request, $request->all());
        $products = Product::where('store_id', $storeId)
            ->where('is_active', true)
            ->whereColumn('current_stock', '<=', 'reorder_level')
            ->get();

        return response()->json($products);
    }
}
