<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Product;
use App\Services\Catalog\CatalogPublishService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminCatalogController
{
    public function __construct(private CatalogPublishService $catalog)
    {
    }

    /**
     * Publication footprint of one product across all stores.
     */
    public function publications(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_id' => 'required|integer|exists:products,id',
        ]);

        $product = Product::findOrFail($validated['product_id']);
        $this->assertStoreAccessible($request, (int) $product->store_id);

        return response()->json([
            'product' => [
                'id' => $product->id,
                'name' => $product->name,
                'store_id' => $product->store_id,
                'product_family_id' => $product->product_family_id,
            ],
            'stores' => $this->catalog->publicationState($product),
        ]);
    }

    /**
     * Publish (or refresh) a catalog product into other stores.
     */
    public function publish(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_id' => 'required|integer|exists:products,id',
            'store_ids' => 'required|array|min:1',
            'store_ids.*' => 'integer|exists:stores,id',
        ]);

        $product = Product::findOrFail($validated['product_id']);
        $this->assertStoreAccessible($request, (int) $product->store_id);
        foreach ($validated['store_ids'] as $storeId) {
            $this->assertStoreAccessible($request, (int) $storeId);
        }

        $results = $this->catalog->publish($product, $validated['store_ids'], $request->user()?->id);

        AuditLog::log(
            'publish_catalog_product',
            'Product',
            (string) $product->id,
            null,
            ['store_ids' => $validated['store_ids'], 'results' => $results],
            $product->store_id
        );

        return response()->json([
            'success' => true,
            'family_id' => $product->fresh()->product_family_id,
            'results' => $results,
        ]);
    }

    /**
     * Withdraw a published product from stores (their copies are deactivated).
     */
    public function unpublish(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'product_id' => 'required|integer|exists:products,id',
            'store_ids' => 'required|array|min:1',
            'store_ids.*' => 'integer|exists:stores,id',
        ]);

        $product = Product::findOrFail($validated['product_id']);
        $this->assertStoreAccessible($request, (int) $product->store_id);
        foreach ($validated['store_ids'] as $storeId) {
            $this->assertStoreAccessible($request, (int) $storeId);
        }

        $results = $this->catalog->unpublish($product, $validated['store_ids'], $request->user()?->id);

        AuditLog::log(
            'unpublish_catalog_product',
            'Product',
            (string) $product->id,
            null,
            ['store_ids' => $validated['store_ids'], 'results' => $results],
            $product->store_id
        );

        return response()->json(['success' => true, 'results' => $results]);
    }

    private function assertStoreAccessible(Request $request, int $storeId): void
    {
        $user = $request->user();
        if ($user && ! $user->canAccessStore($storeId)) {
            abort(403, 'Tenant isolation violation: cross-store access denied.');
        }
    }
}
