<?php

namespace Tests\Feature\Constitution;

use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution — "Copy products to another store" tool.
 * Copies are independent rows (no family/link), carry master data + rates,
 * never stock/batches/history, and runs are audited + reversible for 7 days.
 */
class CopyProductsToStoreTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $superAdmin;
    private User $storeAOnlyAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin', 'email' => 'super@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => null, 'allowed_store_ids' => null,
        ]);

        $this->storeAOnlyAdmin = User::create([
            'name' => 'A Owner', 'email' => 'a-only@test.in', 'password' => bcrypt('password123'),
            'role' => 'store_owner', 'store_id' => $this->storeA->id, 'allowed_store_ids' => [$this->storeA->id],
        ]);
    }

    private function createSourceProduct(array $overrides = []): Product
    {
        return Product::create(array_merge([
            'store_id' => $this->storeA->id,
            'name' => 'Paracetamol 500mg',
            'barcode' => 'SRC-100',
            'hsn_sac_code' => '30049099',
            'mrp' => 25.50,
            'sel_rate' => 22.00,
            'ptr' => 19.00,
            'pts' => 18.00,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'rack_location' => 'R-1',
            'current_stock' => 47,
        ], $overrides));
    }

    public function test_preview_flags_barcode_conflicts_naming_existing_target_product(): void
    {
        $source = $this->createSourceProduct();
        Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Store B Paracetamol',
            'barcode' => 'SRC-100',
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id],
                'preview' => true,
            ])
            ->assertOk();

        $rows = $response->json('preview.products');
        $this->assertCount(1, $rows);
        $this->assertSame('conflict', $rows[0]['status']);
        $this->assertSame('Store B Paracetamol', $rows[0]['conflict_with']);
    }

    public function test_copy_creates_independent_product_with_rates_and_no_stock_or_batches(): void
    {
        $source = $this->createSourceProduct();
        ProductBatch::create([
            'store_id' => $this->storeA->id,
            'product_id' => $source->id,
            'batch_no' => 'B1',
            'expiry_date' => '2030-06-30',
            'stock_qty' => 47,
            'mrp' => 25.50,
            'selling_rate' => 22,
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id],
            ])
            ->assertOk();

        $copied = Product::where('store_id', $this->storeB->id)->where('barcode', 'SRC-100')->first();
        $this->assertNotNull($copied);
        $this->assertSame('Paracetamol 500mg', $copied->name);
        $this->assertSame('30049099', $copied->hsn_sac_code);
        $this->assertSame('25.50', (string) $copied->mrp);
        $this->assertSame('22.00', (string) $copied->sel_rate);
        $this->assertSame('12.00', (string) $copied->gst_percent);
        $this->assertSame(10, (int) $copied->units_per_pack);
        $this->assertSame(0.0, (float) $copied->current_stock, 'copies never carry stock');
        $this->assertTrue($copied->batches->isEmpty(), 'copies never carry batches');
        $this->assertNull($copied->rack_location, 'rack/shelf stay store-local');

        $run = $response->json('run');
        $this->assertSame(1, (int) $run['copied_count']);
        $this->assertEquals($copied->id, $run['product_map'][(string) $source->id]['target_product_id'] ?? null);

        // Audit trail exists.
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'copy_products_to_store',
            'entity_type' => 'ProductCopyRun',
        ]);
    }

    public function test_copy_references_shared_lookup_by_id_and_copies_private_lookup(): void
    {
        $sharedUnit = MasterLookup::create([
            'store_id' => null, 'type' => 'unit', 'name' => 'Tablet', 'code' => 'TAB',
        ]);
        $privateBrand = MasterLookup::create([
            'store_id' => $this->storeA->id, 'type' => 'brand', 'name' => 'Alverstone Pharma',
        ]);

        $source = $this->createSourceProduct([
            'unit_id' => (string) $sharedUnit->id,
            'brand_id' => (string) $privateBrand->id,
        ]);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id],
            ])
            ->assertOk();

        $copied = Product::where('store_id', $this->storeB->id)->where('barcode', 'SRC-100')->first();

        // Shared lookup (units) is referenced by the same id — no duplicate.
        $this->assertSame((string) $sharedUnit->id, $copied->unit_id);
        $this->assertSame(1, MasterLookup::where('type', 'unit')->where('name', 'Tablet')->count());

        // Private lookup is copied into the target store, copy points at the new row.
        $this->assertNotSame((string) $privateBrand->id, $copied->brand_id);
        $this->assertDatabaseHas('master_lookups', [
            'store_id' => $this->storeB->id,
            'type' => 'brand',
            'name' => 'Alverstone Pharma',
        ]);
        $copiedBrand = MasterLookup::find((int) $copied->brand_id);
        $this->assertSame($this->storeB->id, $copiedBrand->store_id);
        $this->assertSame('Alverstone Pharma', $copiedBrand->name);
    }

    public function test_copy_skips_barcode_conflicts_during_execution(): void
    {
        $source = $this->createSourceProduct();
        $clean = $this->createSourceProduct(['name' => 'Clean Item', 'barcode' => 'SRC-200', 'external_id' => 'ext-1']);
        Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Store B Paracetamol',
            'barcode' => 'SRC-100',
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id, $clean->id],
            ])
            ->assertOk();

        $this->assertSame(1, (int) $response->json('run.copied_count'));
        $this->assertSame(1, (int) $response->json('run.skipped_count'));
        $this->assertSame('skipped', $response->json("run.product_map.{$source->id}.status"));
        $this->assertSame('Clean Item', Product::where('store_id', $this->storeB->id)->where('barcode', 'SRC-200')->value('name'));
    }

    public function test_revert_deletes_unreferenced_copy(): void
    {
        $source = $this->createSourceProduct();

        $runId = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id],
            ])
            ->assertOk()
            ->json('run.id');

        $copied = Product::where('store_id', $this->storeB->id)->where('barcode', 'SRC-100')->first();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/catalog/copy-runs/{$runId}/revert")
            ->assertOk()
            ->assertJsonFragment(['deleted' => 1]);

        $this->assertNull($copied->fresh());
    }

    public function test_revert_archives_copy_referenced_by_batch(): void
    {
        $source = $this->createSourceProduct();

        $runId = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id],
            ])
            ->assertOk()
            ->json('run.id');

        $copied = Product::where('store_id', $this->storeB->id)->where('barcode', 'SRC-100')->first();
        ProductBatch::create([
            'store_id' => $this->storeB->id,
            'product_id' => $copied->id,
            'batch_no' => 'TGT-B1',
            'expiry_date' => '2030-06-30',
            'stock_qty' => 5,
            'mrp' => 25.5,
            'selling_rate' => 22,
        ]);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/catalog/copy-runs/{$runId}/revert")
            ->assertOk()
            ->assertJsonFragment(['archived' => 1]);

        $fresh = $copied->fresh();
        $this->assertNotNull($fresh);
        $this->assertFalse($fresh->is_active, 'referenced copies are archived, not deleted');
    }

    public function test_revert_rejected_after_seven_days(): void
    {
        $source = $this->createSourceProduct();

        $runId = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id],
            ])
            ->assertOk()
            ->json('run.id');

        \App\Models\ProductCopyRun::whereKey($runId)->update(['created_at' => now()->subDays(8)]);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/catalog/copy-runs/{$runId}/revert")
            ->assertStatus(422);
    }

    public function test_copy_requires_access_to_both_source_and_target_store(): void
    {
        $source = $this->createSourceProduct();

        $this->actingAs($this->storeAOnlyAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/catalog/copy', [
                'target_store_id' => $this->storeB->id,
                'product_ids' => [$source->id],
            ])
            ->assertForbidden();
    }

    public function test_publish_endpoints_are_gone(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/catalog/publish', [])
            ->assertNotFound();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/catalog/unpublish', [])
            ->assertNotFound();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson('/api/admin/catalog/publications?product_id=1')
            ->assertNotFound();
    }
}
