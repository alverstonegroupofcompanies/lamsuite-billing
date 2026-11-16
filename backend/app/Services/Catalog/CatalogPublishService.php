<?php

namespace App\Services\Catalog;

use App\Models\CatalogPublication;
use App\Models\Product;
use App\Models\Store;
use Illuminate\Support\Str;

class CatalogPublishService
{
    /**
     * Attributes copied from a source product into a store copy. Stock, rack,
     * shelf and reorder levels stay local to each store.
     */
    private const CATALOG_FIELDS = [
        'name',
        'print_name',
        'generic_name',
        'hsn_sac_code',
        'category_id',
        'brand_id',
        'manufacturer_id',
        'unit_id',
        'mrp',
        'sel_rate',
        'ptr',
        'pts',
        'gst_percent',
        'units_per_pack',
        'allow_loose_sale',
    ];

    public function publish(Product $source, array $storeIds, ?int $userId = null): array
    {
        $familyId = $this->ensureFamilyId($source);
        $results = [];

        foreach (array_unique(array_map('intval', $storeIds)) as $storeId) {
            if ($storeId === (int) $source->store_id) {
                $results[] = ['store_id' => $storeId, 'status' => 'skipped', 'message' => 'Source store already owns this product.'];
                continue;
            }

            $store = Store::find($storeId);
            if (! $store) {
                $results[] = ['store_id' => $storeId, 'status' => 'skipped', 'message' => 'Store not found.'];
                continue;
            }

            $publication = CatalogPublication::firstOrNew([
                'source_product_id' => $source->id,
                'target_store_id' => $storeId,
            ]);

            $target = $publication->target_product_id
                ? Product::find($publication->target_product_id)
                : null;
            $target ??= Product::where('store_id', $storeId)
                ->where('product_family_id', $familyId)
                ->first();

            $payload = $this->catalogPayload($source);

            if (! $target) {
                $target = Product::create($payload + [
                    'store_id' => $storeId,
                    'product_family_id' => $familyId,
                    'source_product_id' => $source->id,
                    'barcode' => $source->barcode,
                    'current_stock' => 0,
                    'is_active' => true,
                    'version' => 1,
                ]);
            } else {
                if (! $target->barcode && $source->barcode) {
                    $payload['barcode'] = $source->barcode;
                }
                $payload['product_family_id'] = $familyId;
                $payload['source_product_id'] = $source->id;
                $payload['is_active'] = true;
                $payload['version'] = (int) $target->version + 1;
                $target->update($payload);
            }

            $publication->fill([
                'target_product_id' => $target->id,
                'family_id' => $familyId,
                'status' => 'published',
                'snapshot' => $this->catalogPayload($source),
                'published_by' => $userId,
                'published_at' => now(),
            ])->save();

            $results[] = [
                'store_id' => $storeId,
                'store_name' => $store->name,
                'status' => 'published',
                'target_product_id' => $target->id,
            ];
        }

        return $results;
    }

    public function unpublish(Product $source, array $storeIds, ?int $userId = null): array
    {
        $results = [];

        foreach (array_unique(array_map('intval', $storeIds)) as $storeId) {
            $publication = CatalogPublication::where('source_product_id', $source->id)
                ->where('target_store_id', $storeId)
                ->first();

            if (! $publication) {
                $results[] = ['store_id' => $storeId, 'status' => 'skipped', 'message' => 'Product was never published to this store.'];
                continue;
            }

            if ($publication->status === 'unpublished') {
                $results[] = ['store_id' => $storeId, 'status' => 'unchanged', 'message' => 'Already unpublished.'];
                continue;
            }

            $target = $publication->target_product_id ? Product::find($publication->target_product_id) : null;
            if ($target) {
                $target->update([
                    'is_active' => false,
                    'version' => (int) $target->version + 1,
                ]);
            }

            $publication->update([
                'status' => 'unpublished',
                'published_by' => $userId,
            ]);

            $results[] = ['store_id' => $storeId, 'status' => 'unpublished'];
        }

        return $results;
    }

    /**
     * Publication status of a product across every store.
     */
    public function publicationState(Product $source): array
    {
        $publications = CatalogPublication::where('source_product_id', $source->id)
            ->get()
            ->keyBy('target_store_id');

        return Store::orderBy('name')->get(['id', 'name', 'code'])->map(function (Store $store) use ($source, $publications) {
            $publication = $publications->get($store->id);

            return [
                'store_id' => $store->id,
                'store_name' => $store->name,
                'store_code' => $store->code,
                'is_source' => (int) $store->id === (int) $source->store_id,
                'status' => $publication?->status ?? 'not_published',
                'target_product_id' => $publication?->target_product_id,
                'published_at' => $publication?->published_at?->toIso8601String(),
            ];
        })->all();
    }

    private function ensureFamilyId(Product $source): string
    {
        if ($source->product_family_id) {
            return $source->product_family_id;
        }

        $familyId = 'FAM-'.strtoupper(Str::random(10));
        $source->update(['product_family_id' => $familyId]);

        return $familyId;
    }

    private function catalogPayload(Product $source): array
    {
        return array_intersect_key($source->only(self::CATALOG_FIELDS), array_flip(self::CATALOG_FIELDS));
    }
}
