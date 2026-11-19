<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\ProductCopyRun;
use App\Services\Catalog\StoreCatalogCopyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminCatalogController
{
    public function __construct(private StoreCatalogCopyService $copyService)
    {
    }

    /**
     * Copy products into another store as independent rows (audited, reversible 7 days).
     * With `preview: true` returns the would-be result (new vs conflicts) without writing.
     */
    public function copy(Request $request): JsonResponse
    {
        $validated = $this->validateCopyRequest($request);
        $storeId = (int) $validated['source_store_id'];
        $targetStoreId = (int) $validated['target_store_id'];
        $products = $this->resolveSourceProducts($request, $validated['product_ids'], $storeId);

        if ($request->boolean('preview')) {
            return response()->json([
                'preview' => $this->copyService->preview($products, $targetStoreId),
            ]);
        }

        $run = $this->copyService->copy($products, $storeId, $targetStoreId, $request->user()?->id);

        AuditLog::log(
            'copy_products_to_store',
            'ProductCopyRun',
            (string) $run->id,
            null,
            [
                'source_store_id' => $storeId,
                'target_store_id' => $targetStoreId,
                'copied_count' => $run->copied_count,
                'skipped_count' => $run->skipped_count,
                'product_ids' => $validated['product_ids'],
            ],
            $storeId
        );

        return response()->json([
            'success' => true,
            'run' => $run->toArray(),
        ]);
    }

    /**
     * Revert a copy run: delete unreferenced copies, archive referenced ones.
     */
    public function revertCopyRun(Request $request, int $id): JsonResponse
    {
        $run = ProductCopyRun::findOrFail($id);
        $this->assertStoreAccessible($request, (int) $run->source_store_id);

        $result = $this->copyService->revert($run, $request->user()?->id);

        AuditLog::log(
            'revert_product_copy_run',
            'ProductCopyRun',
            (string) $run->id,
            null,
            $result,
            $run->source_store_id
        );

        return response()->json(['success' => true, 'run_id' => $run->id] + $result);
    }

    /**
     * Copy-run history for the source store.
     */
    public function copyRuns(Request $request): JsonResponse
    {
        $storeId = (int) ($request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->input('store_id'));
        if (empty($storeId)) {
            abort(422, 'A specific store context is required for this change (All Stores scope is read-only).');
        }

        $runs = ProductCopyRun::with(['sourceStore:id,name,code', 'targetStore:id,name,code'])
            ->where('source_store_id', $storeId)
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        return response()->json(['data' => $runs]);
    }

    private function validateCopyRequest(Request $request): array
    {
        $validated = $request->validate([
            'source_store_id' => 'nullable|integer|exists:stores,id',
            'target_store_id' => 'required|integer|exists:stores,id|different:source_store_id',
            'product_ids' => 'required|array|min:1|max:500',
            'product_ids.*' => 'integer',
        ]);

        $storeId = $validated['source_store_id']
            ?? $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->input('store_id');

        if (empty($storeId)) {
            abort(422, 'A specific source store context is required (All Stores scope is read-only).');
        }
        if ((int) $storeId === (int) $validated['target_store_id']) {
            abort(422, 'Source and target stores must differ.');
        }

        $this->assertStoreAccessible($request, (int) $storeId);
        $this->assertStoreAccessible($request, (int) $validated['target_store_id']);

        $validated['source_store_id'] = (int) $storeId;

        return $validated;
    }

    private function resolveSourceProducts(Request $request, array $requestedIds, int $storeId)
    {
        $products = Product::whereIn('id', $requestedIds)
            ->where('store_id', $storeId)
            ->orderBy('id')
            ->get();

        $expectedCount = count(array_map('intval', array_unique($requestedIds)));
        if ($products->count() !== $expectedCount) {
            $foreignNames = Product::whereIn('id', $requestedIds)
                ->where('store_id', '!=', $storeId)
                ->pluck('name')
                ->all();
            abort(422, 'All selected products must belong to the source store. Foreign products: '
                . implode(', ', $foreignNames));
        }

        return $products;
    }

    private function assertStoreAccessible(Request $request, int $storeId): void
    {
        $user = $request->user();
        if ($user && ! $user->canAccessStore($storeId)) {
            abort(403, 'Tenant isolation violation: cross-store access denied.');
        }
    }
}
