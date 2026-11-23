<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\MasterLookup;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Services\Gst\PartyStateResolver;
use App\Services\Masters\UnitDefaultsService;
use App\Services\Masters\ChargeHeadDefaultsService;
use App\Services\Stock\StockLedgerService;
use App\Support\DrugSchedule;
use App\Support\GstStateCodes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AdminMasterController
{
    public function __construct(private StockLedgerService $stockLedger)
    {
    }

    /**
     * List products with batches and stock.
     * Cross-store read (All Stores scope) is admin aggregation; store identity always included.
     */
    public function products(Request $request): JsonResponse
    {
        $storeId = $request->attributes->get('active_store_id') ?? $request->get('active_store_id');
        $query = Product::with(['batches', 'store:id,name,code'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('barcode', 'like', "%{$search}%")
                  ->orWhere('generic_name', 'like', "%{$search}%")
                  ->orWhere('hsn_sac_code', 'like', "%{$search}%");
            });
        }

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $query->where('is_active', filter_var($request->query('is_active'), FILTER_VALIDATE_BOOLEAN));
        }

        if ($request->query('low_stock') === 'true') {
            $query->whereColumn('current_stock', '<=', 'reorder_level');
        }

        $sortBy = $request->query('sort_by', 'id');
        $sortDir = $request->query('sort_dir', 'desc');
        $query->orderBy($sortBy, $sortDir);

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        $perPage = (int) $request->query('per_page', 50);
        return response()->json($query->paginate($perPage));
    }

    /**
     * Create product.
     */
    public function storeProduct(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'name' => 'required|string|max:255',
            'print_name' => 'nullable|string|max:255',
            'barcode' => 'nullable|string|max:100',
            'generic_name' => 'nullable|string|max:255',
            'hsn_sac_code' => 'required|string|max:20',
            'category_id' => 'nullable|string',
            'brand_id' => 'nullable|string',
            'manufacturer_id' => 'nullable|string',
            'unit_id' => 'nullable|string',
            'mrp' => 'required|numeric|min:0',
            'sel_rate' => 'required|numeric|min:0',
            'ptr' => 'nullable|numeric|min:0',
            'pts' => 'nullable|numeric|min:0',
            'gst_percent' => 'required|numeric|min:0',
            'units_per_pack' => 'nullable|integer|min:1',
            'rack_location' => 'nullable|string',
            'shelf_location' => 'nullable|string',
            'reorder_level' => 'nullable|numeric|min:0',
            'drug_schedule_id' => 'nullable|integer',
            'initial_batch' => 'nullable|array',
            'initial_batch.batch_no' => 'nullable|string|max:50',
            'initial_batch.mfg_date' => 'nullable|date',
            'initial_batch.expiry_date' => 'nullable|date',
            'initial_batch.stock_qty' => 'nullable|numeric|min:0',
        ]);

        $validated['version'] = 1;
        $validated['is_active'] = true;

        if ($existing = Product::where('store_id', $validated['store_id'])->where('barcode', $validated['barcode'] ?? null)->first()) {
            return response()->json([
                'message' => "Barcode {$validated['barcode']} is already used by \"{$existing->name}\" in this store.",
                'errors' => ['barcode' => ["Barcode {$validated['barcode']} is already used by \"{$existing->name}\" in this store."]],
                'existing_product' => $existing->name,
            ], 422);
        }

        $batchData = $validated['initial_batch'] ?? null;
        unset($validated['initial_batch']);

        if ($refusal = $this->stampSchedule($validated, (int) $validated['store_id'])) {
            return $refusal;
        }

        $openingQty = (float) ($batchData['stock_qty'] ?? 0);
        $hasBatch = $openingQty > 0;
        if ($hasBatch && (blank($batchData['batch_no'] ?? null) || blank($batchData['expiry_date'] ?? null))) {
            throw ValidationException::withMessages([
                'initial_batch' => 'Opening stock needs a batch number and an expiry date.',
            ]);
        }

        $actor = $request->user();
        $product = DB::transaction(function () use ($validated, $batchData, $hasBatch, $actor) {
            $product = Product::create($validated);

            if ($hasBatch) {
                $batch = ProductBatch::create([
                    'store_id' => $product->store_id,
                    'product_id' => $product->id,
                    'batch_no' => $batchData['batch_no'],
                    'mfg_date' => $batchData['mfg_date'] ?? null,
                    'expiry_date' => $batchData['expiry_date'],
                    'stock_qty' => $batchData['stock_qty'],
                    'mrp' => $validated['mrp'],
                    'purchase_rate' => $validated['ptr'] ?? ($validated['mrp'] * 0.7),
                    'selling_rate' => $validated['sel_rate'],
                    'rack_location' => $validated['rack_location'] ?? null,
                    'shelf_location' => $validated['shelf_location'] ?? null,
                    'version' => 1,
                ]);

                $this->stockLedger->postOpeningStock($batch, $actor);
            }

            return $product;
        });

        AuditLog::log('create_product', 'Product', (string)$product->id, null, $product->toArray(), $product->store_id);

        return response()->json($product->fresh()->load('batches'), 201);
    }

    /**
     * Update product with optimistic locking.
     */
    public function updateProduct(Request $request, string $id): JsonResponse
    {
        $product = Product::where('store_id', $this->requireStoreId($request))->findOrFail($id);

        if ($request->has('version') && (int)$request->input('version') !== (int)$product->version) {
            return response()->json([
                'message' => 'Conflict warning: This product was updated by an offline sync or another user. Please reload.',
                'current_version' => $product->version,
                'client_version' => $request->input('version'),
            ], 409);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'print_name' => 'nullable|string|max:255',
            'barcode' => 'nullable|string|max:100',
            'generic_name' => 'nullable|string|max:255',
            'hsn_sac_code' => 'sometimes|required|string|max:20',
            'category_id' => 'nullable|string',
            'brand_id' => 'nullable|string',
            'unit_id' => 'nullable|string',
            'mrp' => 'sometimes|required|numeric|min:0',
            'sel_rate' => 'sometimes|required|numeric|min:0',
            'ptr' => 'nullable|numeric|min:0',
            'pts' => 'nullable|numeric|min:0',
            'gst_percent' => 'sometimes|required|numeric|min:0',
            'units_per_pack' => 'nullable|integer|min:1',
            'rack_location' => 'nullable|string',
            'shelf_location' => 'nullable|string',
            'reorder_level' => 'nullable|numeric|min:0',
            'drug_schedule_id' => 'nullable|integer',
            'is_active' => 'nullable|boolean',
        ]);

        $oldValues = $product->toArray();
        $validated['version'] = $product->version + 1;

        if (array_key_exists('barcode', $validated) && $validated['barcode'] && $validated['barcode'] !== $product->barcode) {
            $clash = Product::where('store_id', $product->store_id)
                ->where('barcode', $validated['barcode'])
                ->where('id', '!=', $product->id)
                ->first();
            if ($clash) {
                return response()->json([
                    'message' => "Barcode {$validated['barcode']} is already used by \"{$clash->name}\" in this store.",
                    'errors' => ['barcode' => ["Barcode {$validated['barcode']} is already used by \"{$clash->name}\" in this store."]],
                    'existing_product' => $clash->name,
                ], 422);
            }
        }

        if ($refusal = $this->stampSchedule($validated, (int) $product->store_id)) {
            return $refusal;
        }

        $product->update($validated);

        AuditLog::log('update_product', 'Product', (string)$product->id, $oldValues, $product->toArray(), $product->store_id);

        return response()->json($product->load('batches'));
    }

    /**
     * Delete product or deactivate if historical transaction records exist.
     */
    public function deleteProduct(Request $request, string $id): JsonResponse
    {
        $product = Product::where('store_id', $this->requireStoreId($request))->findOrFail($id);
        $oldData = $product->toArray();

        $hasInvoices = DB::table('invoice_items')->where('product_id', $product->id)->exists();
        $hasPurchases = DB::table('purchase_items')->where('product_id', $product->id)->exists();

        if ($hasInvoices || $hasPurchases) {
            $product->update(['is_active' => false, 'version' => $product->version + 1]);
            AuditLog::log('deactivate_product', 'Product', (string)$id, $oldData, $product->toArray(), $product->store_id);
            return response()->json([
                'success' => true,
                'deactivated' => true,
                'message' => 'Product has historical billing records and was deactivated instead of deleted.',
            ]);
        }

        $product->batches()->delete();
        $product->delete();

        AuditLog::log('delete_product', 'Product', (string)$id, $oldData, null, $product->store_id);

        return response()->json(['success' => true, 'message' => 'Product deleted successfully.']);
    }

    /**
     * List batches across products with search, expiry filters and pagination.
     */
    public function batches(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = ProductBatch::with(['product:id,name,barcode,hsn_sac_code,unit_id'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($productId = $request->query('product_id')) {
            $query->where('product_id', $productId);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('batch_no', 'like', "%{$search}%")
                  ->orWhere('rack_location', 'like', "%{$search}%")
                  ->orWhere('shelf_location', 'like', "%{$search}%")
                  ->orWhereHas('product', function ($pq) use ($search) {
                      $pq->where('name', 'like', "%{$search}%")
                         ->orWhere('barcode', 'like', "%{$search}%");
                  });
            });
        }

        if ($request->query('expiring') === 'true') {
            $threshold = date('Y-m-d', strtotime('+90 days'));
            $query->where('expiry_date', '<=', $threshold);
        }

        $sortBy = $request->query('sort_by', 'expiry_date');
        $sortDir = $request->query('sort_dir', 'asc');
        $query->orderBy($sortBy, $sortDir);

        $perPage = (int) $request->query('per_page', 50);
        return response()->json($query->paginate($perPage));
    }

    /**
     * Update an individual batch.
     */
    public function updateBatch(Request $request, string $id): JsonResponse
    {
        $batch = ProductBatch::where('store_id', $this->requireStoreId($request))->findOrFail($id);
        $oldData = $batch->toArray();

        $validated = $request->validate([
            'batch_no' => 'sometimes|required|string|max:50',
            'mfg_date' => 'nullable|date',
            'expiry_date' => 'sometimes|required|date',
            'stock_qty' => 'sometimes|required|numeric|min:0',
            'mrp' => 'sometimes|required|numeric|min:0',
            'purchase_rate' => 'nullable|numeric|min:0',
            'selling_rate' => 'sometimes|required|numeric|min:0',
            'rack_location' => 'nullable|string',
            'shelf_location' => 'nullable|string',
        ]);

        $validated['version'] = $batch->version + 1;
        $oldQty = (float) $batch->stock_qty;
        $actor = $request->user();
        DB::transaction(function () use ($batch, $validated, $oldQty, $actor) {
            $batch->update($validated);
            // STK-01: a hand edit of the quantity is a stock movement and is booked.
            $this->stockLedger->postAdminCorrection($batch, $oldQty, (float) $batch->stock_qty, $actor);
        });

        AuditLog::log('update_batch', 'ProductBatch', (string)$batch->id, $oldData, $batch->toArray(), $batch->store_id);

        return response()->json($batch->load('product'));
    }

    /**
     * Delete an individual batch.
     */
    public function deleteBatch(Request $request, string $id): JsonResponse
    {
        $batch = ProductBatch::where('store_id', $this->requireStoreId($request))->findOrFail($id);
        $productId = $batch->product_id;
        $storeId = $batch->store_id;
        $oldData = $batch->toArray();

        $hasInvoices = DB::table('invoice_items')
            ->where('product_id', $productId)
            ->where('batch_no', $batch->batch_no)
            ->exists();

        $oldQty = (float) $batch->stock_qty;
        $actor = $request->user();

        if ($hasInvoices) {
            DB::transaction(function () use ($batch, $oldQty, $actor) {
                $batch->update(['stock_qty' => 0, 'version' => $batch->version + 1]);
                $this->stockLedger->postAdminCorrection($batch, $oldQty, 0.0, $actor);
            });

            AuditLog::log('zero_batch_stock', 'ProductBatch', (string)$id, $oldData, $batch->toArray(), $storeId);
            return response()->json([
                'success' => true,
                'deactivated' => true,
                'message' => 'Batch has billing records. Stock quantity was zeroed out to maintain ledger balance.',
            ]);
        }

        DB::transaction(function () use ($batch, $oldQty, $actor) {
            // Book the stock out before the row goes, so the product's ledger
            // total still matches its batches once the batch is gone.
            $batch->update(['stock_qty' => 0, 'version' => $batch->version + 1]);
            $this->stockLedger->postAdminCorrection($batch, $oldQty, 0.0, $actor);
            $batch->delete();
            $this->stockLedger->syncProductStock($batch->product);
        });

        AuditLog::log('delete_batch', 'ProductBatch', (string)$id, $oldData, null, $storeId);

        return response()->json(['success' => true, 'message' => 'Batch deleted successfully.']);
    }

    /**
     * Add batch to product.
     */
    public function addBatch(Request $request, string $productId): JsonResponse
    {
        $product = Product::where('store_id', $this->requireStoreId($request))->findOrFail($productId);

        $validated = $request->validate([
            'batch_no' => 'required|string|max:50',
            'mfg_date' => 'nullable|date',
            'expiry_date' => 'required|date',
            'stock_qty' => 'required|numeric|min:0',
            'mrp' => 'required|numeric|min:0',
            'purchase_rate' => 'nullable|numeric|min:0',
            'selling_rate' => 'required|numeric|min:0',
            'rack_location' => 'nullable|string',
            'shelf_location' => 'nullable|string',
        ]);

        $batch = DB::transaction(function () use ($product, $validated, $request) {
            $batch = ProductBatch::create([
                'store_id' => $product->store_id,
                'product_id' => $product->id,
                'batch_no' => $validated['batch_no'],
                'mfg_date' => $validated['mfg_date'] ?? null,
                'expiry_date' => $validated['expiry_date'],
                'stock_qty' => $validated['stock_qty'],
                'mrp' => $validated['mrp'],
                'purchase_rate' => $validated['purchase_rate'] ?? ($validated['mrp'] * 0.7),
                'selling_rate' => $validated['selling_rate'],
                'rack_location' => $validated['rack_location'] ?? null,
                'shelf_location' => $validated['shelf_location'] ?? null,
                'version' => 1,
            ]);

            $this->stockLedger->postOpeningStock($batch, $request->user());
            $product->update(['version' => $product->version + 1]);

            return $batch;
        });

        AuditLog::log('add_batch', 'ProductBatch', (string)$batch->id, null, $batch->toArray(), $product->store_id);

        return response()->json($batch, 201);
    }

    /**
     * Bulk edit products.
     */
    public function bulkEditProducts(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_ids' => 'required|array',
            'product_ids.*' => 'exists:products,id',
            'action' => 'required|in:set_gst,set_category,toggle_active,adjust_price_percent',
            'value' => 'required',
        ]);

        $count = 0;
        $storeId = $this->requireStoreId($request);

        $products = Product::whereIn('id', $validated['product_ids'])->where('store_id', $storeId)->get();
        if ($products->count() !== count(array_unique($validated['product_ids']))) {
            $foreign = Product::whereIn('id', $validated['product_ids'])->where('store_id', '!=', $storeId)->pluck('name')->all();
            return response()->json([
                'message' => 'Bulk edits apply to a single store per job. These products belong to another store: ' . implode(', ', $foreign),
                'foreign_products' => $foreign,
            ], 422);
        }

        DB::beginTransaction();
        try {
            foreach ($products as $p) {
                if ($validated['action'] === 'set_gst') {
                    $p->update(['gst_percent' => (float)$validated['value'], 'version' => $p->version + 1]);
                } elseif ($validated['action'] === 'set_category') {
                    $p->update(['category_id' => (string)$validated['value'], 'version' => $p->version + 1]);
                } elseif ($validated['action'] === 'toggle_active') {
                    $p->update(['is_active' => filter_var($validated['value'], FILTER_VALIDATE_BOOLEAN), 'version' => $p->version + 1]);
                } elseif ($validated['action'] === 'adjust_price_percent') {
                    $percent = (float)$validated['value'];
                    $newMrp = round($p->mrp * (1 + $percent / 100), 2);
                    $newRate = round($p->sel_rate * (1 + $percent / 100), 2);
                    $p->update(['mrp' => $newMrp, 'sel_rate' => $newRate, 'version' => $p->version + 1]);
                }
                $count++;
            }
            DB::commit();

            AuditLog::log('bulk_edit_products', 'Product', 'bulk', null, ['count' => $count, 'action' => $validated['action']]);

            return response()->json(['success' => true, 'updated_count' => $count]);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Bulk edit failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Master Lookups: groups, brands, manufacturers, units, banks, expense heads, discount schemas, tax rates.
     */
    public function lookups(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $type = $request->query('type');

        // Units (R11) and charge heads (R12) are store-scoped: a store with no rows of
        // the type gets its default set on first read, self-healing pre-CR stores.
        $defaults = [
            'unit' => UnitDefaultsService::class,
            'charge_head' => ChargeHeadDefaultsService::class,
        ];
        if ($storeId && isset($defaults[$type])
            && MasterLookup::where('store_id', $storeId)->where('type', $type)->count() === 0) {
            app($defaults[$type])->seedDefaultsForStore((int) $storeId);
        }

        // Store-scoped types never fall back to the legacy shared (store-less) rows.
        $storeScoped = array_keys($defaults);
        $isStoreScoped = isset($defaults[$type]);

        $query = MasterLookup::query()
            ->when($type, fn($q) => $q->where('type', $type))
            ->when($storeId, function ($q) use ($storeId, $type, $storeScoped, $isStoreScoped) {
                if ($isStoreScoped) {
                    $q->where('store_id', $storeId);

                    return;
                }

                // Own rows, plus the legacy shared (store-less) rows of the types that
                // are still allowed to be shared.
                $q->where(function ($scoped) use ($storeId, $type, $storeScoped) {
                    $scoped->where('store_id', $storeId);

                    if ($type === null || $type === '') {
                        $scoped->orWhere(fn($shared) => $shared->whereNotIn('type', $storeScoped)->whereNull('store_id'));

                        return;
                    }

                    $scoped->orWhereNull('store_id');
                });
            });

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('code', 'like', "%{$search}%")
                  ->orWhere('description', 'like', "%{$search}%");
            });
        }

        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $query->where('is_active', filter_var($request->query('is_active'), FILTER_VALIDATE_BOOLEAN));
        }

        $query->orderBy('name', 'asc');

        if ($request->has('page')) {
            $perPage = (int) $request->query('per_page', 50);
            return response()->json($query->paginate($perPage));
        }

        return response()->json(['data' => $query->get()]);
    }

    public function storeLookup(Request $request): JsonResponse
    {
        $storeId = $request->input('store_id') ?: $request->get('active_store_id');

        $validated = $request->validate([
            'type' => 'required|string|max:40',
            'code' => 'nullable|string|max:50',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'config' => 'nullable|array',
            'store_id' => 'nullable|exists:stores,id',
            'is_active' => 'nullable|boolean',
        ]);

        if (empty($validated['store_id']) && $storeId) {
            $validated['store_id'] = $storeId;
        }

        // R12: a charge head belongs to exactly one store — no shared, store-less row.
        if ($validated['type'] === 'charge_head') {
            if (empty($validated['store_id'])) {
                return response()->json([
                    'message' => 'R12: a charge head must belong to a store.',
                ], 422);
            }
            $validated['config'] = $this->chargeHeadConfig($validated['config'] ?? []);
        }

        // PHR-001/PHR-011: a drug schedule is a pharmacy's own list. A store that
        // sells no medicines has nothing to mark restricted, and gets no field for it.
        if ($validated['type'] === DrugSchedule::TYPE) {
            if ($refusal = $this->drugScheduleRefusal((int) ($validated['store_id'] ?? 0))) {
                return $refusal;
            }

            $validated['config'] = DrugSchedule::cleanConfig($validated['config'] ?? []);
        }

        $lookup = MasterLookup::create($validated);
        AuditLog::log('create_lookup', 'MasterLookup', (string)$lookup->id, null, $lookup->toArray(), $lookup->store_id);

        return response()->json($lookup, 201);
    }

    public function updateLookup(Request $request, string $id): JsonResponse
    {
        $lookup = MasterLookup::findOrFail($id);
        $this->assertSameActiveStore($request, $lookup);
        $oldData = $lookup->toArray();

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'code' => 'nullable|string|max:50',
            'description' => 'nullable|string',
            'config' => 'nullable|array',
            'is_active' => 'nullable|boolean',
        ]);

        if ($lookup->type === 'charge_head' && array_key_exists('config', $validated)) {
            $validated['config'] = $this->chargeHeadConfig($validated['config'] ?? [], $lookup->config ?? []);
        }

        if ($lookup->type === DrugSchedule::TYPE) {
            if ($refusal = $this->drugScheduleRefusal((int) ($lookup->store_id ?? 0))) {
                return $refusal;
            }

            if (array_key_exists('config', $validated)) {
                $validated['config'] = DrugSchedule::cleanConfig($validated['config'] ?? [], (array) ($lookup->config ?? []));
            }
        }

        $lookup->update($validated);
        AuditLog::log('update_lookup', 'MasterLookup', (string)$lookup->id, $oldData, $lookup->toArray(), $lookup->store_id);

        return response()->json($lookup);
    }

    public function deleteLookup(Request $request, string $id): JsonResponse
    {
        $lookup = MasterLookup::findOrFail($id);
        $this->assertSameActiveStore($request, $lookup);
        $oldData = $lookup->toArray();

        // Unit delete guard: a unit assigned to products must have its products
        // reassigned to a replacement unit first (reassign_to completes that).
        if ($lookup->type === 'unit' && ($lookup->store_id || $request->get('active_store_id'))) {
            $unitStoreId = (int) ($lookup->store_id ?? $request->get('active_store_id'));
            $service = app(UnitDefaultsService::class);
            $references = $service->referencingProducts($unitStoreId, $lookup);

            if ($references !== []) {
                if (!$request->filled('reassign_to')) {
                    return response()->json([
                        'message' => "Unit \"{$lookup->name}\" is assigned to " . count($references)
                            . ' product(s) in this store. Choose a replacement unit to reassign them before deleting.',
                        'reassignment_required' => true,
                        'referencing_products' => $references,
                        'candidate_units' => $service->candidateUnits($unitStoreId, $lookup),
                    ], 409);
                }

                $reassigned = $service->reassignAndDelete($unitStoreId, $lookup, (int) $request->input('reassign_to'));
                AuditLog::log('delete_lookup', 'MasterLookup', (string)$id, $oldData, [
                    'reassigned_to' => (int) $request->input('reassign_to'),
                    'reassigned_count' => $reassigned,
                ], $lookup->store_id);

                return response()->json([
                    'success' => true,
                    'message' => "Unit deleted and {$reassigned} product(s) reassigned.",
                    'reassigned_count' => $reassigned,
                ]);
            }
        }

        // MST-008 / R12: a head that posted charges reference is deleted only after
        // those charges are reassigned to a replacement head of the same store.
        if ($lookup->type === 'charge_head') {
            $headStoreId = (int) ($lookup->store_id ?: $request->get('active_store_id'));
            $service = app(ChargeHeadDefaultsService::class);
            $references = $service->referencingCharges($headStoreId, $lookup);

            if ($references !== []) {
                if (!$request->filled('reassign_to')) {
                    return response()->json([
                        'message' => "Charge head \"{$lookup->name}\" is used by " . count($references)
                            . ' bill(s) in this store. Choose a replacement head to reassign them before deleting.',
                        'reassignment_required' => true,
                        'referencing_bills' => $references,
                        'candidate_heads' => $service->candidateHeads($headStoreId, $lookup),
                    ], 409);
                }

                $reassigned = $service->reassignAndDelete($headStoreId, $lookup, (int) $request->input('reassign_to'));
                AuditLog::log('delete_lookup', 'MasterLookup', (string)$id, $oldData, [
                    'reassigned_to' => (int) $request->input('reassign_to'),
                    'reassigned_count' => $reassigned,
                ], $lookup->store_id);

                return response()->json([
                    'success' => true,
                    'message' => "Charge head deleted and {$reassigned} charge line(s) reassigned.",
                    'reassigned_count' => $reassigned,
                ]);
            }
        }

        $lookup->delete();
        AuditLog::log('delete_lookup', 'MasterLookup', (string)$id, $oldData, null, $lookup->store_id);

        return response()->json(['success' => true, 'message' => 'Lookup record deleted successfully.']);
    }

    /**
     * Restore the store's default charge head set: missing defaults re-seeded,
     * unreferenced custom heads removed, referenced custom heads kept.
     */
    public function resetChargeHeads(Request $request): JsonResponse
    {
        $storeId = $this->requireStoreId($request);

        $summary = app(ChargeHeadDefaultsService::class)->resetForStore($storeId);
        AuditLog::log('reset_charge_heads', 'MasterLookup', 'charge_heads', null, $summary, $storeId);

        return response()->json(['success' => true] + $summary);
    }

    /**
     * A charge head prefills the POS grid, so its config is limited to the enums both
     * tax engines understand; anything else is refused rather than silently stored.
     *
     * @param  array<string, mixed>  $config
     * @param  array<string, mixed>  $existing
     * @return array<string, mixed>
     */
    private function chargeHeadConfig(array $config, array $existing = []): array
    {
        $enums = [
            'default_treatment' => ['add_to_cost', 'expense'],
            'default_spread_method' => ['value', 'quantity', 'weight'],
            'default_itc_eligibility' => ['eligible', 'ineligible', 'blocked', 'partial'],
            'allowed_sign' => ['positive', 'negative', 'both'],
        ];

        $clean = ['seeded' => (bool) ($existing['seeded'] ?? false)];

        foreach ($enums as $key => $allowed) {
            if (!array_key_exists($key, $config)) {
                continue;
            }
            if (!in_array($config[$key], $allowed, true)) {
                abort(422, "Charge head {$key} must be one of: " . implode(', ', $allowed) . '.');
            }
            $clean[$key] = $config[$key];
        }

        if (array_key_exists('sac_code', $config)) {
            $sac = trim((string) $config['sac_code']);
            if ($sac !== '' && !preg_match('/^\d{6}(\d{2})?$/', $sac)) {
                abort(422, 'Charge head sac_code must be a 6 or 8 digit SAC.');
            }
            $clean['sac_code'] = $sac === '' ? null : $sac;
        }

        return $clean;
    }

    /**
     * PHR-001/PHR-011 — a drug schedule exists for one pharmacy and nowhere else.
     *
     * The list is what the server later reads to decide whether a bill needs a
     * pharmacist, so a store-less row or a grocery row would be a rule nobody
     * can see. The refusal names the store so the panel can say which one to fix.
     */
    private function drugScheduleRefusal(int $storeId): ?JsonResponse
    {
        if ($storeId <= 0) {
            return response()->json([
                'message' => 'A drug schedule must belong to a store. Choose the pharmacy first.',
                'errors' => ['store_id' => ['A drug schedule must belong to a store.']],
            ], 422);
        }

        $store = Store::find($storeId);

        if ($store === null || (string) $store->store_type !== 'pharmacy') {
            $name = $store?->name ?? 'this store';

            return response()->json([
                'message' => "\"{$name}\" is not a pharmacy, so it keeps no drug schedule list. "
                    . 'Change the store type under Stores & Locations first.',
                'errors' => ['store_id' => ['Only a pharmacy keeps drug schedules.']],
            ], 422);
        }

        return null;
    }

    /**
     * PHR-001 — the schedule a product may name, and the code stamped with it.
     *
     * A product names a schedule of its own store only, and the code travels on
     * the row so an old bill still reads what that item was called when sold.
     */
    private function stampSchedule(array &$validated, int $storeId): ?JsonResponse
    {
        if (!array_key_exists('drug_schedule_id', $validated)) {
            return null;
        }

        $scheduleId = $validated['drug_schedule_id'];

        if ($scheduleId === null || $scheduleId === '') {
            $validated['drug_schedule_id'] = null;
            $validated['schedule_code'] = null;

            return null;
        }

        $schedule = MasterLookup::query()
            ->where('type', DrugSchedule::TYPE)
            ->find((int) $scheduleId);

        if ($schedule === null || (int) $schedule->store_id !== $storeId) {
            $own = DrugSchedule::forStore($storeId);

            return response()->json([
                'message' => 'A product can only carry a drug schedule from its own store\'s list.',
                'errors' => ['drug_schedule_id' => [
                    'Choose a schedule from the product\'s own store'
                        . ($own->isEmpty() ? ' — this store has no drug schedules yet.' : '.'),
                ]],
            ], 422);
        }

        if (! (bool) $schedule->is_active) {
            return response()->json([
                'message' => "Drug schedule \"{$schedule->name}\" is retired, so no new product may carry it.",
                'errors' => ['drug_schedule_id' => ['This schedule is switched off in the list.']],
            ], 422);
        }

        $validated['drug_schedule_id'] = (int) $schedule->id;
        $validated['schedule_code'] = strtoupper((string) ($schedule->code ?: $schedule->name));

        return null;
    }

    /**
     * Restore the store's default unit set: missing defaults re-seeded, unused
     * custom units removed, assigned custom units kept.
     */
    public function resetUnits(Request $request): JsonResponse
    {
        $storeId = $this->requireStoreId($request);

        $summary = app(UnitDefaultsService::class)->resetForStore($storeId);
        AuditLog::log('reset_units', 'MasterLookup', 'units', null, $summary, $storeId);

        return response()->json(['success' => true] + $summary);
    }

    /**
     * A lookup row owned by another store is invisible to this store's writes.
     */
    private function assertSameActiveStore(Request $request, MasterLookup $lookup): void
    {
        $storeId = $request->get('active_store_id');
        if ($lookup->store_id && $storeId && (int) $lookup->store_id !== (int) $storeId) {
            abort(404);
        }
    }

    /**
     * Parties: Customers, Suppliers, Doctors, Patients.
     */
    public function parties(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $type = $request->query('type');
        $store = $storeId ? Store::find($storeId) : null;
        $isPharmacy = !$store || $store->store_type === 'pharmacy';

        if (!$isPharmacy && in_array($type, ['doctor', 'patient'])) {
            return response()->json([
                'data' => [],
                'current_page' => 1,
                'last_page' => 1,
                'total' => 0,
            ]);
        }

        $query = Party::query()
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->when($type, fn($q) => $q->where('type', $type))
            ->when(!$isPharmacy && empty($type), fn($q) => $q->whereNotIn('type', ['doctor', 'patient']));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%")
                  ->orWhere('gstin', 'like', "%{$search}%")
                  ->orWhere('reg_no', 'like', "%{$search}%");
            });
        }

        $query->orderBy('name', 'asc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        $perPage = (int) $request->query('per_page', 50);
        return response()->json($query->paginate($perPage));
    }

    public function storeParty(Request $request): JsonResponse
    {
        $storeId = $request->input('store_id') ?: $request->get('active_store_id');
        $store = $storeId ? Store::find($storeId) : null;
        $isPharmacy = !$store || $store->store_type === 'pharmacy';

        if (!$isPharmacy && in_array($request->input('type'), ['doctor', 'patient'])) {
            return response()->json([
                'message' => 'Clinical party types (Doctor, Patient) are strictly permitted for Pharmacy stores only.',
            ], 422);
        }

        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'type' => 'required|in:customer,supplier,doctor,patient',
            'name' => 'required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'gstin' => 'nullable|string|max:20',
            'pan' => 'nullable|string|max:20',
            'address' => 'nullable|string',
            'state_code' => ['nullable', 'string', Rule::in(GstStateCodes::all())],
            'credit_limit' => 'nullable|numeric|min:0',
            'opening_balance' => 'nullable|numeric',
            'reg_no' => 'nullable|string|max:50',
        ]);

        $this->assertPartyGstinMatchesState($validated['gstin'] ?? null, $validated['state_code'] ?? null);
        $validated['state_code'] = app(PartyStateResolver::class)->resolve(
            $validated['state_code'] ?? null,
            $validated['gstin'] ?? null,
            $store
        );
        $validated['current_balance'] = $validated['opening_balance'] ?? 0;
        $party = Party::create($validated);

        AuditLog::log('create_party', 'Party', (string)$party->id, null, $party->toArray(), $party->store_id);

        return response()->json($party, 201);
    }

    public function updateParty(Request $request, string $id): JsonResponse
    {
        $party = Party::findOrFail($id);

        if ($request->has('version') && (int)$request->input('version') !== (int)$party->version) {
            return response()->json([
                'message' => 'Conflict warning: This party record was updated concurrently. Please refresh.',
                'current_version' => $party->version,
            ], 409);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'gstin' => 'nullable|string|max:20',
            'pan' => 'nullable|string|max:20',
            'address' => 'nullable|string',
            'state_code' => ['nullable', 'string', Rule::in(GstStateCodes::all())],
            'credit_limit' => 'nullable|numeric|min:0',
            'reg_no' => 'nullable|string|max:50',
            'is_active' => 'nullable|boolean',
        ]);

        $gstin = array_key_exists('gstin', $validated) ? $validated['gstin'] : $party->gstin;
        $stateCode = array_key_exists('state_code', $validated) ? $validated['state_code'] : $party->state_code;
        $this->assertPartyGstinMatchesState($gstin, $stateCode);

        // A GSTIN carries its own registered state. When no state was supplied
        // (or it was emptied), follow the GSTIN; with no GSTIN leave the stored
        // state alone rather than guessing the store's.
        if (!array_key_exists('state_code', $validated) || $validated['state_code'] === null) {
            if (GstStateCodes::isValidGstin($gstin)) {
                $validated['state_code'] = GstStateCodes::fromGstin($gstin);
            } else {
                unset($validated['state_code']);
            }
        }

        $validated['version'] = $party->version + 1;
        $party->update($validated);

        AuditLog::log('update_party', 'Party', (string)$party->id, null, $party->toArray(), $party->store_id);

        return response()->json($party);
    }

    /**
     * MST-01: a GSTIN's first two digits are the registered state; an explicit
     * state that disagrees with it is a data-entry error, not a preference.
     */
    private function assertPartyGstinMatchesState(?string $gstin, ?string $stateCode): void
    {
        $gstin = $gstin === null ? null : trim($gstin);
        if ($gstin === '') {
            $gstin = null;
        }

        if ($gstin !== null && !GstStateCodes::isValidGstin($gstin)) {
            throw ValidationException::withMessages([
                'gstin' => 'Enter a valid 15-character GSTIN or leave it blank.',
            ]);
        }

        $stateCode = GstStateCodes::normalize($stateCode);
        if ($stateCode !== null && !GstStateCodes::isValid($stateCode)) {
            throw ValidationException::withMessages([
                'state_code' => 'Choose a valid GST state code (01-38 or 97).',
            ]);
        }

        if ($gstin !== null && $stateCode !== null && GstStateCodes::fromGstin($gstin) !== $stateCode) {
            throw ValidationException::withMessages([
                'state_code' => "State code {$stateCode} does not match the GSTIN's state.",
            ]);
        }
    }

    /**
     * Delete party or deactivate if financial / transactional records exist.
     */
    public function deleteParty(Request $request, string $id): JsonResponse
    {
        $party = Party::findOrFail($id);
        $oldData = $party->toArray();

        $hasInvoices = DB::table('invoices')->where('customer_id', $party->id)->exists();
        $hasPurchases = DB::table('purchases')->where('supplier_id', $party->id)->exists();

        if ($hasInvoices || $hasPurchases || abs((float)$party->current_balance) > 0.01) {
            $party->update(['is_active' => false, 'version' => $party->version + 1]);
            AuditLog::log('deactivate_party', 'Party', (string)$id, $oldData, $party->toArray(), $party->store_id);
            return response()->json([
                'success' => true,
                'deactivated' => true,
                'message' => 'Party has transactional history or ledger balance. It was deactivated to preserve audit trails.',
            ]);
        }

        $party->delete();
        AuditLog::log('delete_party', 'Party', (string)$id, $oldData, null, $party->store_id);

        return response()->json(['success' => true, 'message' => 'Party record deleted successfully.']);
    }

    /**
     * Merge duplicate master records (e.g. merge duplicate customer or product).
     */
    public function mergeDuplicates(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'entity_type' => 'required|in:party,product',
            'primary_id' => 'required|integer',
            'duplicate_id' => 'required|integer|different:primary_id',
            'reason' => 'required|string',
        ]);

        // Store-scope check happens before any write: merging across stores is forbidden.
        if ($validated['entity_type'] === 'party') {
            $primary = Party::findOrFail($validated['primary_id']);
            $duplicate = Party::findOrFail($validated['duplicate_id']);
            $this->assertSameStore($primary->store_id, $duplicate->store_id, 'party');
        } else {
            $primary = Product::findOrFail($validated['primary_id']);
            $duplicate = Product::findOrFail($validated['duplicate_id']);
            $this->assertSameStore($primary->store_id, $duplicate->store_id, 'product');
        }

        DB::beginTransaction();
        try {
            if ($validated['entity_type'] === 'party') {
                $primary = Party::findOrFail($validated['primary_id']);
                $duplicate = Party::findOrFail($validated['duplicate_id']);
                // Combine balances
                $primary->update([
                    'current_balance' => $primary->current_balance + $duplicate->current_balance,
                    'phone' => $primary->phone ?: $duplicate->phone,
                    'gstin' => $primary->gstin ?: $duplicate->gstin,
                ]);

                // Re-link invoices & purchases
                DB::table('invoices')->where('customer_id', $duplicate->id)->update(['customer_id' => $primary->id]);
                DB::table('purchases')->where('supplier_id', $duplicate->id)->update(['supplier_id' => $primary->id]);

                // Archive duplicate
                $duplicate->update(['is_active' => false, 'name' => $duplicate->name . ' (Merged into #' . $primary->id . ')']);
            } elseif ($validated['entity_type'] === 'product') {
                $primary = Product::findOrFail($validated['primary_id']);
                $duplicate = Product::findOrFail($validated['duplicate_id']);
                // Re-link batches and recalculate stock
                ProductBatch::where('product_id', $duplicate->id)->update(['product_id' => $primary->id]);
                $this->stockLedger->syncProductStock($primary);

                // Archive duplicate
                $duplicate->update(['is_active' => false, 'name' => $duplicate->name . ' (Merged into #' . $primary->id . ')']);
            }

            AuditLog::log('merge_duplicates', ucfirst($validated['entity_type']), (string)$validated['primary_id'], null, [
                'merged_duplicate_id' => $validated['duplicate_id'],
                'reason' => $validated['reason'],
            ]);

            DB::commit();

            return response()->json(['success' => true, 'message' => 'Duplicate record merged successfully.']);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Merge failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Preview and process CSV/Excel imports.
     */
    public function import(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'type' => 'required|in:products,customers,suppliers',
            'rows' => 'required|array',
            'preview_only' => 'nullable|boolean',
        ]);

        $rows = $validated['rows'];
        $validRows = [];
        $errors = [];

        foreach ($rows as $index => $row) {
            if ($validated['type'] === 'products') {
                if (empty($row['name'])) {
                    $errors[] = "Row #" . ($index + 1) . ": Item name is required.";
                    continue;
                }
                $barcode = $row['barcode'] ?? null;
                if ($barcode && ($clash = Product::where('store_id', $validated['store_id'])->where('barcode', $barcode)->first())) {
                    $errors[] = "Row #" . ($index + 1) . ": Barcode {$barcode} is already used by \"{$clash->name}\" in this store. Row skipped.";
                    continue;
                }

                $openingQty = (float) ($row['current_stock'] ?? 0);
                $openingBatch = null;
                if ($openingQty > 0) {
                    if (blank($row['batch_no'] ?? null) || blank($row['expiry_date'] ?? null)) {
                        $errors[] = "Row #" . ($index + 1) . ": opening stock needs a batch number and an expiry date. Row skipped.";
                        continue;
                    }
                    $openingBatch = [
                        'batch_no' => $row['batch_no'],
                        'expiry_date' => $row['expiry_date'],
                        'stock_qty' => $openingQty,
                    ];
                }

                $validRows[] = [
                    'store_id' => $validated['store_id'],
                    'name' => $row['name'],
                    'barcode' => $barcode,
                    'hsn_sac_code' => $row['hsn_sac_code'] ?? '30049099',
                    'mrp' => (float)($row['mrp'] ?? 0),
                    'sel_rate' => (float)($row['sel_rate'] ?? 0),
                    'gst_percent' => (float)($row['gst_percent'] ?? 12),
                    'is_active' => true,
                    'version' => 1,
                    'opening_batch' => $openingBatch,
                ];
            }
        }

        if ($validated['preview_only'] ?? false) {
            return response()->json([
                'total_rows' => count($rows),
                'valid_count' => count($validRows),
                'error_count' => count($errors),
                'errors' => $errors,
                'sample_preview' => array_slice($validRows, 0, 5),
            ]);
        }

        // Perform actual import. Opening stock enters as a real batch and a ledger
        // movement; a CSV row is not allowed to write products.current_stock alone.
        $actor = $request->user();
        DB::transaction(function () use ($validRows, $actor) {
            foreach ($validRows as $row) {
                $openingBatch = $row['opening_batch'] ?? null;
                unset($row['opening_batch']);

                $product = Product::create($row);

                if ($openingBatch) {
                    $batch = ProductBatch::create([
                        'store_id' => $product->store_id,
                        'product_id' => $product->id,
                        'batch_no' => $openingBatch['batch_no'],
                        'expiry_date' => $openingBatch['expiry_date'],
                        'stock_qty' => $openingBatch['stock_qty'],
                        'mrp' => $row['mrp'],
                        'purchase_rate' => $row['mrp'] * 0.7,
                        'selling_rate' => $row['sel_rate'],
                        'version' => 1,
                    ]);

                    $this->stockLedger->postOpeningStock($batch, $actor);
                }
            }
        });

        AuditLog::log('import_master', 'Product', 'bulk', null, ['count' => count($validRows)], $validated['store_id']);

        return response()->json([
            'success' => true,
            'imported_count' => count($validRows),
            'errors' => $errors,
        ]);
    }

    /**
     * Admin writes always run inside a pinned store context (enforced by scope.store);
     * target rows must live in that same store or the request is a cross-store IDOR.
     */
    private function requireStoreId(Request $request): int
    {
        $storeId = $request->attributes->get('active_store_id') ?? $request->get('active_store_id') ?? $request->input('store_id');
        if (empty($storeId)) {
            abort(422, 'A specific store context is required for this change (All Stores scope is read-only).');
        }
        return (int) $storeId;
    }

    private function assertSameStore($storeIdA, $storeIdB, string $entityType): void
    {
        if ((int) $storeIdA !== (int) $storeIdB) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'entity' => "Both {$entityType} records must belong to the same store. Stores do not share {$entityType}s.",
            ]);
        }
    }
}
