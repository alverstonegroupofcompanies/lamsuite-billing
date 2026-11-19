<?php

namespace Tests\Feature\Constitution;

use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution guard — admin master surface. R2, R4, R6, R7, R9.
 * The scope.store middleware pins active_store_id; mutations must honour it.
 */
class AdminMasterStoreScopeTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $superAdmin;
    private Product $productA;
    private Product $productB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin', 'email' => 'super@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => null, 'allowed_store_ids' => null,
        ]);

        $this->productA = Product::create([
            'store_id' => $this->storeA->id, 'name' => 'Store A Item', 'barcode' => 'A-1',
            'hsn_sac_code' => '30049099', 'mrp' => 20, 'sel_rate' => 18, 'gst_percent' => 12,
        ]);
        $this->productB = Product::create([
            'store_id' => $this->storeB->id, 'name' => 'Store B Item', 'barcode' => 'B-1',
            'hsn_sac_code' => '30049099', 'mrp' => 20, 'sel_rate' => 18, 'gst_percent' => 12,
        ]);
    }

    public function test_admin_cannot_update_delete_or_add_batch_to_foreign_store_product(): void
    {
        $foreignId = $this->productB->id;

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->putJson("/api/admin/products/{$foreignId}", ['name' => 'Hacked'])
            ->assertNotFound();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/products/{$foreignId}")
            ->assertNotFound();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/products/{$foreignId}/batches", [
                'batch_no' => 'X1', 'expiry_date' => '2030-01-01', 'stock_qty' => 5,
                'mrp' => 10, 'selling_rate' => 9,
            ])
            ->assertNotFound();

        $this->assertSame('Store B Item', $this->productB->fresh()->name);
        $this->assertTrue($this->productB->fresh()->is_active);
    }

    public function test_admin_duplicate_barcode_is_422_naming_existing_product(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/products', [
                'store_id' => $this->storeA->id,
                'name' => 'Dup Item', 'barcode' => 'A-1', 'hsn_sac_code' => '30049099',
                'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 5,
            ])
            ->assertStatus(422)
            ->assertJsonFragment(['existing_product' => 'Store A Item']);

        // Same barcode in the other store is fine.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson('/api/admin/products', [
                'store_id' => $this->storeB->id,
                'name' => 'Dup Item B', 'barcode' => 'A-1', 'hsn_sac_code' => '30049099',
                'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 5,
            ])
            ->assertCreated();
    }

    public function test_bulk_edit_is_restricted_to_one_store_per_job(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/products/bulk-edit', [
                'product_ids' => [$this->productA->id, $this->productB->id],
                'action' => 'set_gst',
                'value' => 18,
            ])
            ->assertStatus(422);

        // Store B product untouched.
        $this->assertSame('12.00', (string) $this->productB->fresh()->gst_percent);
    }

    public function test_merge_rejects_cross_store_products(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/masters/merge', [
                'entity_type' => 'product',
                'primary_id' => $this->productA->id,
                'duplicate_id' => $this->productB->id,
                'reason' => 'test',
            ])
            ->assertStatus(422);
    }

    public function test_import_skips_rows_with_duplicate_barcodes_naming_existing_product(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/masters/import', [
                'store_id' => $this->storeA->id,
                'type' => 'products',
                'rows' => [
                    ['name' => 'Fresh Item', 'barcode' => 'FRESH-1', 'mrp' => 10, 'sel_rate' => 8, 'gst_percent' => 5],
                    ['name' => 'Clash Item', 'barcode' => 'A-1', 'mrp' => 10, 'sel_rate' => 8, 'gst_percent' => 5],
                ],
            ])
            ->assertOk();

        $response->assertJsonFragment(['imported_count' => 1]);
        $this->assertStringContainsString('Store A Item', $response->json('errors.0'));

        $this->assertNotNull(Product::where('store_id', $this->storeA->id)->where('barcode', 'FRESH-1')->first());
        $this->assertSame('Store A Item', Product::where('store_id', $this->storeA->id)->where('barcode', 'A-1')->first()->name);
    }

    public function test_all_stores_product_listing_includes_store_identity(): void
    {
        $rows = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/products')
            ->assertOk()
            ->json('data');

        $byId = collect($rows)->keyBy('id');
        $this->assertArrayHasKey('store', $byId[$this->productA->id] ?? [], 'cross-store admin listing must show the store');
        $this->assertSame('Store A', $byId[$this->productA->id]['store']['name']);
        $this->assertSame('Store B', $byId[$this->productB->id]['store']['name']);
    }
}
