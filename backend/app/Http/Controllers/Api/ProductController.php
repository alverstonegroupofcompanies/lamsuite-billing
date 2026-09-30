<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Product;
use App\Models\ProductBatch;

class ProductController
{
    public function index(Request $request): JsonResponse
    {
        $query = $request->query('query');
        $builder = Product::with('batches')->where('is_active', true);

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
        $validated = $request->validate([
            'barcode' => 'required|string',
            'name' => 'required|string',
            'mrp' => 'required|numeric',
            'sel_rate' => 'required|numeric',
            'gst_percent' => 'required|numeric',
            'units_per_pack' => 'nullable|integer',
        ]);

        $product = Product::create($validated);
        return response()->json($product, 201);
    }

    public function show(string $id): JsonResponse
    {
        $product = Product::with('batches')->findOrFail($id);
        return response()->json($product);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product->update($request->all());
        return response()->json($product);
    }

    public function destroy(string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product->update(['is_active' => false]);
        return response()->json(['success' => true]);
    }

    public function addBatch(Request $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $batch = $product->batches()->create($request->all());
        return response()->json($batch, 201);
    }
}
