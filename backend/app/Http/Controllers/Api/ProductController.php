<?php

namespace App\Http\Controllers\Api;

use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ProductController
{
    public function index(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $query = $request->query('query');

        $builder = Product::with('batches')
            ->where('store_id', $storeId)
            ->where('is_active', true);

        if ($query) {
            $builder->where(function ($q) use ($query) {
                $q->where('name', 'like', "%{$query}%")
                  ->orWhere('barcode', 'like', "%{$query}%");
            });
        }

        return response()->json($builder->paginate(25));
    }

    public function store(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);

        $validated = $request->validate([
            'barcode' => 'required|string',
            'name' => 'required|string',
            'mrp' => 'required|numeric',
            'sel_rate' => 'required|numeric',
            'gst_percent' => 'required|numeric',
            'units_per_pack' => 'nullable|integer',
        ]);

        if ($existing = Product::where('store_id', $storeId)->where('barcode', $validated['barcode'])->first()) {
            return response()->json([
                'message' => "Barcode {$validated['barcode']} is already used by \"{$existing->name}\" in this store.",
                'errors' => ['barcode' => ["Barcode {$validated['barcode']} is already used by \"{$existing->name}\" in this store."]],
                'existing_product' => $existing->name,
            ], 422);
        }

        $product = Product::create($validated + ['store_id' => $storeId]);
        return response()->json($product, 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $product = $this->findScopedProduct($request, $id)->load('batches');
        return response()->json($product);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $product = $this->findScopedProduct($request, $id);

        $validated = $request->validate([
            'barcode' => 'sometimes|string',
            'name' => 'sometimes|string',
            'print_name' => 'sometimes|nullable|string',
            'generic_name' => 'sometimes|nullable|string',
            'hsn_sac_code' => 'sometimes|nullable|string',
            'category_id' => 'sometimes|nullable|string',
            'brand_id' => 'sometimes|nullable|string',
            'manufacturer_id' => 'sometimes|nullable|string',
            'unit_id' => 'sometimes|nullable|string',
            'mrp' => 'sometimes|numeric',
            'sel_rate' => 'sometimes|numeric',
            'ptr' => 'sometimes|numeric',
            'pts' => 'sometimes|numeric',
            'gst_percent' => 'sometimes|numeric',
            'units_per_pack' => 'sometimes|integer',
            'rack_location' => 'sometimes|nullable|string',
            'shelf_location' => 'sometimes|nullable|string',
            'reorder_level' => 'sometimes|numeric',
        ]);

        if (isset($validated['barcode'])) {
            $clash = Product::where('store_id', $product->store_id)
                ->where('barcode', $validated['barcode'])
                ->where('id', '!=', $product->id)
                ->first();
            if ($clash) {
                throw ValidationException::withMessages([
                    'barcode' => "Barcode {$validated['barcode']} is already used by \"{$clash->name}\" in this store.",
                ]);
            }
        }

        $product->update($validated);
        return response()->json($product);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $product = $this->findScopedProduct($request, $id);
        $product->update(['is_active' => false]);
        return response()->json(['success' => true]);
    }

    public function addBatch(Request $request, string $id): JsonResponse
    {
        $product = $this->findScopedProduct($request, $id);

        $validated = $request->validate([
            'batch_no' => 'required|string',
            'expiry_date' => 'required|date',
            'stock_qty' => 'sometimes|numeric',
            'mrp' => 'sometimes|numeric',
            'purchase_rate' => 'sometimes|numeric',
            'selling_rate' => 'sometimes|numeric',
        ]);

        $batch = $product->batches()->create($validated + ['store_id' => $product->store_id]);
        return response()->json($batch, 201);
    }

    private function findScopedProduct(Request $request, string $id): Product
    {
        return Product::where('store_id', $this->resolveStoreId($request))->findOrFail($id);
    }

    private function resolveStoreId(Request $request): int
    {
        // A paired device may only act against the store its token was issued for.
        $deviceStoreId = $request->attributes->get('device_store_id');
        if (!empty($deviceStoreId)) {
            return (int) $deviceStoreId;
        }

        $candidate = $request->header('X-Store-Id') ?: $request->header('Store-Id');
        if (!$candidate && $request->user()) {
            $candidate = $request->user()->store_id;
        }
        if (!$candidate) {
            throw ValidationException::withMessages([
                'store_id' => 'A store context is required (X-Store-Id header).',
            ]);
        }

        $storeId = (int) $candidate;
        $user = $request->user();
        if ($user && !empty($user->allowed_store_ids) && !in_array($storeId, array_map('intval', $user->allowed_store_ids))) {
            abort(403, 'You are not allowed to operate on this store.');
        }

        return $storeId;
    }
}
