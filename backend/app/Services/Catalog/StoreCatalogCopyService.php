<?php

namespace App\Services\Catalog;

use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\ProductCopyRun;
use Illuminate\Support\Facades\DB;

/**
 * One-time audited "Copy products to another store" tool.
 *
 * Copies are independent rows — no family link, no shared identity beyond
 * the carried barcode/external_id. They carry master data + rates; stock,
 * batches and history never travel. Reversible for 7 days.
 */
class StoreCatalogCopyService
{
    /** Fields that travel with the copy (master data + rates). */
    private const COPY_FIELDS = [
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

    private const LOOKUP_FIELDS = ['category_id', 'brand_id', 'manufacturer_id', 'unit_id'];

    /** Tables whose rows prove a copy is in use and must be archived, not deleted. */
    private const REFERENCE_TABLES = [
        'product_batches',
        'stock_ledger_entries',
        'invoice_items',
        'purchase_items',
        'stock_transfer_items',
        'stock_adjustments',
        'stock_adjustment_lines',
        'price_list_items',
        'sales_order_items',
        'delivery_challan_items',
    ];

    /**
     * @param iterable<Product> $products
     */
    public function preview(iterable $products, int $targetStoreId): array
    {
        $rows = [];

        foreach ($products as $product) {
            $rows[] = $this->describeRow($product, $targetStoreId);
        }

        return [
            'products' => $rows,
            'counts' => [
                'new' => count(array_filter($rows, fn ($r) => $r['status'] === 'new')),
                'conflict' => count(array_filter($rows, fn ($r) => $r['status'] === 'conflict')),
            ],
        ];
    }

    /**
     * @param iterable<Product> $products all from $sourceStoreId
     */
    public function copy(iterable $products, int $sourceStoreId, int $targetStoreId, ?int $userId = null): ProductCopyRun
    {
        $map = [];
        $copied = 0;
        $skipped = 0;

        DB::beginTransaction();
        try {
            foreach ($products as $product) {
                $existing = $this->targetByBarcode($product->barcode, $targetStoreId);
                if ($existing) {
                    $map[(string) $product->id] = [
                        'status' => 'skipped',
                        'conflict_with' => $existing->name,
                    ];
                    $skipped++;
                    continue;
                }

                $target = Product::create($this->copyPayload($product, $targetStoreId));

                $map[(string) $product->id] = [
                    'status' => 'copied',
                    'target_product_id' => $target->id,
                    'barcode' => $target->barcode,
                ];
                $copied++;
            }

            $run = ProductCopyRun::create([
                'source_store_id' => $sourceStoreId,
                'target_store_id' => $targetStoreId,
                'product_map' => $map,
                'copied_count' => $copied,
                'skipped_count' => $skipped,
                'created_by' => $userId,
            ]);

            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return $run;
    }

    /**
     * Create a single audited copy used by flows like transfer auto-create.
     * Returns the existing barcode twin if the target store already has one.
     */
    public function createCopy(Product $source, int $targetStoreId, ?int $userId = null): Product
    {
        $existing = $this->targetByBarcode($source->barcode, $targetStoreId);
        if ($existing) {
            return $existing;
        }

        return Product::create($this->copyPayload($source, $targetStoreId));
    }

    /**
     * Revert a run within 7 days: delete unreferenced copies, archive referenced ones.
     */
    public function revert(ProductCopyRun $run, ?int $userId = null): array
    {
        if ($run->reversed_at) {
            abort(422, 'This copy run was already reversed.');
        }

        if ($run->created_at->lt(now()->subDays(7))) {
            abort(422, 'The 7-day revert window for this copy run has closed. Archive the copied products manually if needed.');
        }

        $deleted = 0;
        $archived = 0;

        DB::beginTransaction();
        try {
            foreach ($run->product_map ?? [] as $entry) {
                $targetId = $entry['target_product_id'] ?? null;
                if (! $targetId || ($entry['status'] ?? '') !== 'copied') {
                    continue;
                }

                // @store-scope-ok: target id comes from this run's audited product_map, not user input
                $target = Product::find($targetId);
                if (! $target) {
                    continue;
                }

                if ($this->isReferenced($targetId)) {
                    $target->update(['is_active' => false, 'version' => $target->version + 1]);
                    $archived++;
                } else {
                    $target->delete();
                    $deleted++;
                }
            }

            $run->update(['reversed_at' => now(), 'reversed_by' => $userId]);
            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        return ['deleted' => $deleted, 'archived' => $archived];
    }

    private function describeRow(Product $product, int $targetStoreId): array
    {
        $existing = $this->targetByBarcode($product->barcode, $targetStoreId);

        return [
            'source_product_id' => $product->id,
            'name' => $product->name,
            'barcode' => $product->barcode,
            'status' => $existing ? 'conflict' : 'new',
            'conflict_with' => $existing?->name,
        ];
    }

    private function targetByBarcode(?string $barcode, int $targetStoreId): ?Product
    {
        if (! $barcode) {
            return null;
        }

        return Product::where('store_id', $targetStoreId)->where('barcode', $barcode)->first();
    }

    private function copyPayload(Product $source, int $targetStoreId): array
    {
        $payload = array_intersect_key($source->only(self::COPY_FIELDS), array_flip(self::COPY_FIELDS));

        foreach (self::LOOKUP_FIELDS as $field) {
            $payload[$field] = $this->lookupIdForTarget($source->{$field}, $targetStoreId);
        }

        return $payload + [
            'store_id' => $targetStoreId,
            'barcode' => $source->barcode,
            'external_id' => $source->external_id,
            'current_stock' => 0,
            'rack_location' => null,
            'shelf_location' => null,
            'is_active' => true,
            'version' => 1,
        ];
    }

    /**
     * Shared lookups (store_id NULL, e.g. units) stay referenced by id; private
     * lookups are copied into the target store so the copy is fully self-owned.
     */
    private function lookupIdForTarget($lookupId, int $targetStoreId)
    {
        if ($lookupId === null || $lookupId === '') {
            return null;
        }

        $lookup = MasterLookup::find((int) $lookupId);
        if (! $lookup) {
            return null;
        }

        if ($lookup->store_id === null) {
            return (string) $lookup->id;
        }

        $copy = MasterLookup::firstOrCreate(
            ['store_id' => $targetStoreId, 'type' => $lookup->type, 'name' => $lookup->name],
            ['code' => $lookup->code, 'config' => $lookup->config, 'is_active' => true]
        );

        return (string) $copy->id;
    }

    private function isReferenced(int $productId): bool
    {
        foreach (self::REFERENCE_TABLES as $table) {
            if (DB::table($table)->where('product_id', $productId)->exists()) {
                return true;
            }
        }

        return false;
    }
}
