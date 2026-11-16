<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockAdjustmentDocument;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Services\StockAdjustmentPolicy;
use App\Services\StockAdjustmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminInventoryController
{
    public function __construct(
        private StockAdjustmentService $adjustmentService,
        private StockAdjustmentPolicy $adjustmentPolicy
    ) {
    }

    /**
     * Stock by store and batch.
     */
    public function batchInventory(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');

        $query = ProductBatch::with(['product:id,name,barcode,hsn_sac_code', 'store:id,name,code'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('batch_no', 'like', "%{$search}%")
                  ->orWhereHas('product', fn($sub) => $sub->where('name', 'like', "%{$search}%")->orWhere('barcode', 'like', "%{$search}%"));
            });
        }

        if ($request->query('only_positive') === 'true') {
            $query->where('stock_qty', '>', 0);
        }

        $query->orderBy('expiry_date', 'asc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        $perPage = (int) $request->query('per_page', 50);
        return response()->json($query->paginate($perPage));
    }

    /**
     * Stock ledger for a specific item (or overall).
     */
    public function stockLedger(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $productId = $request->query('product_id');

        // Compile ledger entries from sales, purchases, adjustments
        $inwardEntries = DB::table('purchase_items')
            ->join('purchases', 'purchase_items.purchase_id', '=', 'purchases.id')
            ->when($storeId, fn($q) => $q->where('purchases.store_id', $storeId))
            ->when($productId, fn($q) => $q->where('purchase_items.product_id', $productId))
            ->where('purchases.status', '!=', 'cancelled')
            ->select(
                'purchases.invoice_date as transaction_date',
                'purchases.invoice_number as reference_number',
                'purchase_items.product_name',
                'purchase_items.batch_no',
                DB::raw("'Purchase Inward' as voucher_type"),
                'purchase_items.qty as in_qty',
                DB::raw("0 as out_qty"),
                'purchases.supplier_name as party_name'
            );

        $outwardEntries = DB::table('invoice_items')
            ->join('invoices', 'invoice_items.invoice_id', '=', 'invoices.id')
            ->when($storeId, fn($q) => $q->where('invoices.store_id', $storeId))
            ->when($productId, fn($q) => $q->where('invoice_items.product_id', $productId))
            ->where('invoices.status', '!=', 'cancelled')
            ->select(
                'invoices.invoice_date as transaction_date',
                'invoices.invoice_number as reference_number',
                'invoice_items.product_name',
                'invoice_items.batch_no',
                DB::raw("'POS Sale' as voucher_type"),
                DB::raw("0 as in_qty"),
                'invoice_items.qty as out_qty',
                'invoices.customer_name as party_name'
            );

        $ledger = $inwardEntries->unionAll($outwardEntries)->orderBy('transaction_date', 'desc')->paginate(30);

        return response()->json($ledger);
    }

    /**
     * Near-expiry and expired stock.
     */
    public function nearExpiry(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $thresholdDays = (int)$request->query('threshold_days', 60);
        $cutoffDate = Carbon::now()->addDays($thresholdDays)->toDateString();
        $today = Carbon::today()->toDateString();

        $batches = ProductBatch::with(['product', 'store:id,name'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->where('stock_qty', '>', 0)
            ->whereDate('expiry_date', '<=', $cutoffDate)
            ->orderBy('expiry_date', 'asc')
            ->get()
            ->map(function ($b) use ($today) {
                $isExpired = $b->expiry_date <= $today;
                return [
                    'id' => $b->id,
                    'store_id' => $b->store_id,
                    'store_name' => $b->store ? $b->store->name : '',
                    'product_id' => $b->product_id,
                    'product_name' => $b->product ? $b->product->name : '',
                    'batch_no' => $b->batch_no,
                    'expiry_date' => $b->expiry_date,
                    'stock_qty' => $b->stock_qty,
                    'mrp' => $b->mrp,
                    'selling_rate' => $b->selling_rate,
                    'is_expired' => $isExpired,
                    'days_remaining' => Carbon::now()->diffInDays(Carbon::parse($b->expiry_date), false),
                ];
            });

        return response()->json($batches);
    }

    /**
     * Inter-store Transfer Dispatch.
     */
    public function dispatchTransfer(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from_store_id' => 'required|exists:stores,id',
            'to_store_id' => 'required|exists:stores,id|different:from_store_id',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required|exists:products,id',
            'items.*.batch_no' => 'required|string',
            'items.*.qty' => 'required|numeric|min:0.01',
        ]);

        DB::beginTransaction();
        try {
            $transferNo = 'TRF-' . date('Ymd') . '-' . rand(100, 999);

            $transfer = StockTransfer::create([
                'from_store_id' => $validated['from_store_id'],
                'to_store_id' => $validated['to_store_id'],
                'transfer_number' => $transferNo,
                'status' => 'dispatched',
                'notes' => $validated['notes'] ?? null,
                'created_by' => $request->user() ? $request->user()->id : null,
            ]);

            foreach ($validated['items'] as $it) {
                // Deduct source stock
                $batch = ProductBatch::where('store_id', $validated['from_store_id'])
                    ->where('product_id', $it['product_id'])
                    ->where('batch_no', $it['batch_no'])
                    ->first();

                if ($batch) {
                    $batch->decrement('stock_qty', $it['qty']);
                    Product::where('id', $it['product_id'])->decrement('current_stock', $it['qty']);
                }

                StockTransferItem::create([
                    'stock_transfer_id' => $transfer->id,
                    'product_id' => $it['product_id'],
                    'batch_no' => $it['batch_no'],
                    'qty' => $it['qty'],
                ]);
            }

            AuditLog::log('dispatch_transfer', 'StockTransfer', (string)$transfer->id, null, $transfer->toArray(), $validated['from_store_id']);

            DB::commit();

            return response()->json($transfer->load('items'), 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Transfer dispatch failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Approve and Receive Stock Transfer.
     */
    public function receiveTransfer(Request $request, string $id): JsonResponse
    {
        $transfer = StockTransfer::with('items')->findOrFail($id);

        if ($transfer->status !== 'dispatched') {
            return response()->json(['message' => 'Only dispatched transfers can be received.'], 422);
        }

        DB::beginTransaction();
        try {
            foreach ($transfer->items as $it) {
                // Find or create batch in destination store
                $destBatch = ProductBatch::firstOrCreate(
                    [
                        'store_id' => $transfer->to_store_id,
                        'product_id' => $it->product_id,
                        'batch_no' => $it->batch_no,
                    ],
                    [
                        'expiry_date' => date('Y-m-d', strtotime('+1 year')),
                        'stock_qty' => 0,
                        'mrp' => 100,
                        'selling_rate' => 90,
                        'version' => 1,
                    ]
                );

                $destBatch->increment('stock_qty', $it->qty);
                Product::where('id', $it->product_id)->increment('current_stock', $it->qty);
            }

            $transfer->update([
                'status' => 'received',
                'approved_by' => $request->user() ? $request->user()->id : null,
                'received_at' => now(),
            ]);

            AuditLog::log('receive_transfer', 'StockTransfer', (string)$transfer->id, ['status' => 'dispatched'], ['status' => 'received'], $transfer->to_store_id);

            DB::commit();

            return response()->json(['success' => true, 'transfer' => $transfer]);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Transfer receive failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Multi-line stock adjustment documents (posted + pending approval).
     */
    public function listAdjustments(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = StockAdjustmentDocument::with(['creator:id,name', 'approver:id,name', 'lines'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->when($request->query('status'), fn($q) => $q->where('status', $request->query('status')))
            ->orderByDesc('id');

        return response()->json($query->paginate((int) $request->query('per_page', 20)));
    }

    public function showAdjustment(Request $request, string $id): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $document = StockAdjustmentDocument::with(['creator:id,name', 'approver:id,name', 'lines.product:id,name,barcode', 'lines.batch:id,batch_no,expiry_date'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->findOrFail($id);

        return response()->json($document);
    }

    public function approveAdjustment(Request $request, string $id): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $document = StockAdjustmentDocument::when($storeId, fn($q) => $q->where('store_id', $storeId))->findOrFail($id);

        $document = $this->adjustmentService->approve($document, $request->user());

        return response()->json([
            'success' => true,
            'document' => $document,
            'message' => 'Stock adjustment approved and posted to the ledger.',
        ]);
    }

    public function rejectAdjustment(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate(['reason' => 'nullable|string|max:500']);
        $storeId = $request->get('active_store_id');
        $document = StockAdjustmentDocument::when($storeId, fn($q) => $q->where('store_id', $storeId))->findOrFail($id);

        $document = $this->adjustmentService->reject($document, $request->user(), $validated['reason'] ?? null);

        return response()->json([
            'success' => true,
            'document' => $document,
            'message' => 'Stock adjustment rejected.',
        ]);
    }

    public function getAdjustmentPolicy(Request $request): JsonResponse
    {
        $storeId = (int) $request->get('active_store_id');
        return response()->json([
            'success' => true,
            'store_id' => $storeId,
            'policy' => $this->adjustmentPolicy->forStore($storeId),
            'defaults' => StockAdjustmentPolicy::DEFAULTS,
        ]);
    }

    public function updateAdjustmentPolicy(Request $request): JsonResponse
    {
        $storeId = (int) $request->get('active_store_id');
        $policy = $this->adjustmentPolicy->save($storeId, $request->input('policy', $request->all()));

        AuditLog::log('update_stock_adjustment_policy', 'Store', (string) $storeId, null, $policy, $storeId);

        return response()->json(['success' => true, 'store_id' => $storeId, 'policy' => $policy]);
    }

    /**
     * Stock Reconciliation adjustment.
     */
    public function reconcileStock(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'product_id' => 'required|exists:products,id',
            'batch_no' => 'required|string',
            'physical_qty' => 'required|numeric|min:0',
            'reason' => 'required|string',
        ]);

        $batch = ProductBatch::where('store_id', $validated['store_id'])
            ->where('product_id', $validated['product_id'])
            ->where('batch_no', $validated['batch_no'])
            ->first();
        $previousQty = $batch ? (float) $batch->stock_qty : null;

        // Route admin reconciliation through the same policy engine as the
        // desktop and sync paths so role, threshold and period limits cannot
        // be bypassed from the admin panel.
        $result = $this->adjustmentService->post((int) $validated['store_id'], $request->user(), [
            'document_id' => 'adm_rec_' . $validated['store_id'] . '_' . $validated['product_id'] . '_' . $validated['batch_no'] . '_' . now()->format('YmdHis'),
            'mode' => 'physical_count',
            'reason' => $validated['reason'],
            'notes' => $validated['reason'],
            'document_date' => now()->toDateString(),
            'lines' => [[
                'product_id' => (int) $validated['product_id'],
                'batch_no' => $validated['batch_no'],
                'counted_qty' => (float) $validated['physical_qty'],
                'reason' => $validated['reason'],
                'notes' => $validated['reason'],
            ]],
        ]);

        // Preserve the admin reconcile audit trail expected by existing reports.
        if (
            $batch
            && $previousQty !== null
            && !($result['duplicate'] ?? false)
            && $result['document']->status === 'posted'
        ) {
            AuditLog::log(
                'reconcile_stock',
                'ProductBatch',
                (string) $batch->id,
                ['old_qty' => $previousQty],
                [
                    'new_qty' => (float) $validated['physical_qty'],
                    'diff' => (float) $validated['physical_qty'] - $previousQty,
                ],
                $validated['store_id']
            );
        }

        return response()->json([
            'success' => true,
            'duplicate' => $result['duplicate'] ?? false,
            'document_id' => $result['document']->document_id,
            'status' => $result['document']->status,
            'requires_approval' => (bool) $result['document']->requires_approval,
            'message' => $result['document']->status === 'pending_approval'
                ? 'Stock reconciliation submitted for approval.'
                : 'Stock reconciled successfully.',
        ]);
    }
}
