<?php

namespace Tests\Feature;

use App\Models\CatalogPublication;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CatalogPublishTest extends TestCase
{
    use RefreshDatabase;

    private Store $centralStore;
    private Store $branchStore;
    private Store $thirdStore;
    private Product $sourceProduct;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->centralStore = Store::create([
            'name' => 'Central Warehouse',
            'code' => 'CENTRAL',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->branchStore = Store::create([
            'name' => 'Branch Pharmacy',
            'code' => 'BR-01',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->thirdStore = Store::create([
            'name' => 'Highway Outlet',
            'code' => 'BR-02',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->superAdmin = User::create([
            'store_id' => $this->centralStore->id,
            'name' => 'Central Admin',
            'email' => 'central@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);

        $this->sourceProduct = Product::create([
            'store_id' => $this->centralStore->id,
            'barcode' => '8901234567890',
            'name' => 'Paracetamol 500mg',
            'generic_name' => 'Paracetamol',
            'hsn_sac_code' => '3004',
            'mrp' => 30,
            'sel_rate' => 24,
            'ptr' => 18,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 0,
            'reorder_level' => 100,
            'is_active' => true,
            'version' => 1,
        ]);
    }

    public function test_publish_creates_store_copy_and_publication_rows(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/catalog/publish', [
                'product_id' => $this->sourceProduct->id,
                'store_ids' => [$this->branchStore->id, $this->thirdStore->id],
            ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonCount(2, 'results');

        $familyId = $this->sourceProduct->fresh()->product_family_id;
        $this->assertNotNull($familyId);

        foreach ([$this->branchStore, $this->thirdStore] as $store) {
            $copy = Product::where('store_id', $store->id)->where('product_family_id', $familyId)->first();
            $this->assertNotNull($copy, "Missing catalog copy in store {$store->code}");
            $this->assertSame('Paracetamol 500mg', $copy->name);
            $this->assertSame('3004', $copy->hsn_sac_code);
            $this->assertEquals(30, (float) $copy->mrp);
            $this->assertEquals(24, (float) $copy->sel_rate);
            $this->assertEquals(0, (float) $copy->current_stock);
            $this->assertSame($this->sourceProduct->id, $copy->source_product_id);
            $this->assertTrue((bool) $copy->is_active);

            $this->assertDatabaseHas('catalog_publications', [
                'source_product_id' => $this->sourceProduct->id,
                'target_store_id' => $store->id,
                'target_product_id' => $copy->id,
                'status' => 'published',
            ]);
        }

        // Reorder level stays store-specific on the source
        $this->assertEquals(100, (float) $this->sourceProduct->fresh()->reorder_level);
    }

    public function test_republish_updates_existing_copy_without_duplicating(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->postJson('/api/admin/catalog/publish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->branchStore->id],
        ])->assertOk();

        $copy = Product::where('store_id', $this->branchStore->id)->firstOrFail();
        $firstVersion = $copy->version;

        $this->sourceProduct->update([
            'name' => 'Paracetamol 650mg',
            'mrp' => 36,
            'sel_rate' => 30,
            'version' => 2,
        ]);

        $this->actingAs($this->superAdmin, 'sanctum')->postJson('/api/admin/catalog/publish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->branchStore->id],
        ])->assertOk();

        $this->assertSame(1, Product::where('store_id', $this->branchStore->id)->count());
        $fresh = Product::findOrFail($copy->id);
        $this->assertSame('Paracetamol 650mg', $fresh->name);
        $this->assertEquals(36, (float) $fresh->mrp);
        $this->assertGreaterThan($firstVersion, (int) $fresh->version);
    }

    public function test_unpublish_deactivates_copy_and_republish_reactivates_it(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->postJson('/api/admin/catalog/publish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->branchStore->id],
        ])->assertOk();

        $copy = Product::where('store_id', $this->branchStore->id)->firstOrFail();

        $this->actingAs($this->superAdmin, 'sanctum')->postJson('/api/admin/catalog/unpublish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->branchStore->id],
        ])->assertOk()->assertJsonPath('results.0.status', 'unpublished');

        $this->assertFalse((bool) Product::findOrFail($copy->id)->is_active);
        $this->assertSame(
            'unpublished',
            CatalogPublication::where('target_store_id', $this->branchStore->id)->value('status')
        );

        $this->actingAs($this->superAdmin, 'sanctum')->postJson('/api/admin/catalog/publish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->branchStore->id],
        ])->assertOk();

        $this->assertTrue((bool) Product::findOrFail($copy->id)->is_active);
        $this->assertSame(
            'published',
            CatalogPublication::where('target_store_id', $this->branchStore->id)->value('status')
        );
    }

    public function test_publication_state_lists_source_and_target_stores(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->postJson('/api/admin/catalog/publish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->branchStore->id],
        ])->assertOk();

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson("/api/admin/catalog/publications?product_id={$this->sourceProduct->id}")
            ->assertOk()
            ->assertJsonPath('product.id', $this->sourceProduct->id);

        $byStore = collect($response->json('stores'))->keyBy('store_id');
        $this->assertTrue($byStore[$this->centralStore->id]['is_source']);
        $this->assertSame('not_published', $byStore[$this->centralStore->id]['status']);
        $this->assertSame('published', $byStore[$this->branchStore->id]['status']);
        $this->assertSame('not_published', $byStore[$this->thirdStore->id]['status']);
    }

    public function test_source_store_is_skipped_and_tenant_isolation_is_enforced(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')->postJson('/api/admin/catalog/publish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->centralStore->id],
        ])->assertOk()->assertJsonPath('results.0.status', 'skipped');

        $manager = User::create([
            'store_id' => $this->centralStore->id,
            'name' => 'Branch Manager',
            'email' => 'manager@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'is_active' => true,
        ]);

        $this->actingAs($manager, 'sanctum')->postJson('/api/admin/catalog/publish', [
            'product_id' => $this->sourceProduct->id,
            'store_ids' => [$this->branchStore->id],
        ])->assertForbidden();

        $this->assertSame(0, Product::where('store_id', $this->branchStore->id)->count());
    }
}
