<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\MasterLookup;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminMasterController
{
    /**
     * List products with batches and stock.
     */
    public function products(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = Product::with('batches')
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
            'current_stock' => 'nullable|numeric|min:0',
        ]);

        $validated['version'] = 1;
        $validated['is_active'] = true;

        $product = Product::create($validated);

        // Optional initial batch
        if ($request->has('initial_batch')) {
            $batchData = $request->input('initial_batch');
            ProductBatch::create([
                'store_id' => $product->store_id,
                'product_id' => $product->id,
                'batch_no' => $batchData['batch_no'] ?? 'B1',
                'mfg_date' => $batchData['mfg_date'] ?? null,
                'expiry_date' => $batchData['expiry_date'] ?? date('Y-m-d', strtotime('+1 year')),
                'stock_qty' => $batchData['stock_qty'] ?? ($validated['current_stock'] ?? 0),
                'mrp' => $validated['mrp'],
                'purchase_rate' => $validated['ptr'] ?? ($validated['mrp'] * 0.7),
                'selling_rate' => $validated['sel_rate'],
                'rack_location' => $validated['rack_location'] ?? null,
                'shelf_location' => $validated['shelf_location'] ?? null,
                'version' => 1,
            ]);
        }

        AuditLog::log('create_product', 'Product', (string)$product->id, null, $product->toArray(), $product->store_id);

        return response()->json($product->load('batches'), 201);
    }

    /**
     * Update product with optimistic locking.
     */
    public function updateProduct(Request $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);

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
            'current_stock' => 'nullable|numeric|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        $oldValues = $product->toArray();
        $validated['version'] = $product->version + 1;
        $product->update($validated);

        AuditLog::log('update_product', 'Product', (string)$product->id, $oldValues, $product->toArray(), $product->store_id);

        return response()->json($product->load('batches'));
    }

    /**
     * Add batch to product.
     */
    public function addBatch(Request $request, string $productId): JsonResponse
    {
        $product = Product::findOrFail($productId);

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

        // Recalculate product current_stock
        $totalStock = ProductBatch::where('product_id', $product->id)->sum('stock_qty');
        $product->update(['current_stock' => $totalStock, 'version' => $product->version + 1]);

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
        DB::beginTransaction();
        try {
            foreach ($validated['product_ids'] as $id) {
                $p = Product::find($id);
                if (!$p) continue;

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
     * Master Lookups: groups, brands, manufacturers, units, banks, expense heads, discount schemas.
     */
    public function lookups(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $type = $request->query('type');

        $query = MasterLookup::query()
            ->when($type, fn($q) => $q->where('type', $type))
            ->when($storeId, fn($q) => $q->where(fn($sub) => $sub->where('store_id', $storeId)->orWhereNull('store_id')));

        return response()->json($query->orderBy('name')->get());
    }

    public function storeLookup(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => 'required|string',
            'code' => 'nullable|string',
            'name' => 'required|string',
            'description' => 'nullable|string',
            'config' => 'nullable|array',
            'store_id' => 'nullable|exists:stores,id',
        ]);

        $lookup = MasterLookup::create($validated);
        return response()->json($lookup, 201);
    }

    /**
     * Parties: Customers, Suppliers, Doctors, Patients.
     */
    public function parties(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $type = $request->query('type');

        $query = Party::query()
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->when($type, fn($q) => $q->where('type', $type));

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
        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'type' => 'required|in:customer,supplier,doctor,patient',
            'name' => 'required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'gstin' => 'nullable|string|max:20',
            'pan' => 'nullable|string|max:20',
            'address' => 'nullable|string',
            'state_code' => 'nullable|string|max:10',
            'credit_limit' => 'nullable|numeric|min:0',
            'opening_balance' => 'nullable|numeric',
            'reg_no' => 'nullable|string|max:50',
        ]);

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
            'state_code' => 'nullable|string|max:10',
            'credit_limit' => 'nullable|numeric|min:0',
            'reg_no' => 'nullable|string|max:50',
            'is_active' => 'nullable|boolean',
        ]);

        $validated['version'] = $party->version + 1;
        $party->update($validated);

        return response()->json($party);
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
                $newStock = ProductBatch::where('product_id', $primary->id)->sum('stock_qty');
                $primary->update(['current_stock' => $newStock]);

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
                $validRows[] = [
                    'store_id' => $validated['store_id'],
                    'name' => $row['name'],
                    'barcode' => $row['barcode'] ?? null,
                    'hsn_sac_code' => $row['hsn_sac_code'] ?? '30049099',
                    'mrp' => (float)($row['mrp'] ?? 0),
                    'sel_rate' => (float)($row['sel_rate'] ?? 0),
                    'gst_percent' => (float)($row['gst_percent'] ?? 12),
                    'current_stock' => (float)($row['current_stock'] ?? 0),
                    'is_active' => true,
                    'version' => 1,
                    'created_at' => now(),
                    'updated_at' => now(),
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

        // Perform actual import
        DB::table('products')->insert($validRows);
        AuditLog::log('import_master', 'Product', 'bulk', null, ['count' => count($validRows)], $validated['store_id']);

        return response()->json([
            'success' => true,
            'imported_count' => count($validRows),
            'errors' => $errors,
        ]);
    }
}
