<?php

namespace Tests\Feature\Constitution;

use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution guard — the /api/products REST surface must be
 * store-scoped end to end: R1, R2 (422 naming the existing product), R6, R7.
 */
class ProductStoreScopingApiTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $staffA;
    private User $staffB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->staffA = User::create([
            'name' => 'Staff A', 'email' => 'sa@test.in', 'password' => bcrypt('password123'),
            'role' => 'manager', 'store_id' => $this->storeA->id,
            'allowed_store_ids' => [$this->storeA->id],
        ]);
        $this->staffB = User::create([
            'name' => 'Staff B', 'email' => 'sb@test.in', 'password' => bcrypt('password123'),
            'role' => 'manager', 'store_id' => $this->storeB->id,
            'allowed_store_ids' => [$this->storeB->id],
        ]);

        $this->productA = Product::create([
            'store_id' => $this->storeA->id, 'name' => 'Store A Item', 'barcode' => 'A-1',
            'mrp' => 20, 'sel_rate' => 18, 'gst_percent' => 12,
        ]);
        $this->productB = Product::create([
            'store_id' => $this->storeB->id, 'name' => 'Store B Item', 'barcode' => 'B-1',
            'mrp' => 20, 'sel_rate' => 18, 'gst_percent' => 12,
        ]);
    }

    public function actingAsStaff(User $user): self
    {
        parent::actingAs($user, 'sanctum');
        return $this;
    }

    public function test_index_returns_only_own_store_products(): void
    {
        $names = collect($this->actingAsStaff($this->staffA)
            ->getJson('/api/products')
            ->assertOk()
            ->json('data'))->pluck('name')->all();

        $this->assertContains('Store A Item', $names);
        $this->assertNotContains('Store B Item', $names);
    }

    public function test_create_scopes_to_callers_store_and_rejects_duplicate_barcode_naming_existing_product(): void
    {
        // Store A creates a new barcode.
        $this->actingAsStaff($this->staffA)
            ->postJson('/api/products', [
                'name' => 'New Item A', 'barcode' => 'NEW-1', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 5,
            ])
            ->assertCreated()
            ->assertJsonPath('store_id', $this->storeA->id);

        // A second store may reuse the barcode independently.
        $this->actingAsStaff($this->staffB)
            ->postJson('/api/products', [
                'name' => 'New Item B', 'barcode' => 'NEW-1', 'mrp' => 12, 'sel_rate' => 10, 'gst_percent' => 5,
            ])
            ->assertCreated()
            ->assertJsonPath('store_id', $this->storeB->id);

        // Duplicate barcode inside the same store → 422 naming the existing product.
        $this->actingAsStaff($this->staffA)
            ->postJson('/api/products', [
                'name' => 'New Item A Copy', 'barcode' => 'NEW-1', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 5,
            ])
            ->assertStatus(422)
            ->assertJsonFragment(['existing_product' => 'New Item A']);

        // A store_id in the payload cannot re-scope the write to another store.
        $this->actingAsStaff($this->staffA)
            ->postJson('/api/products', [
                'name' => 'Smuggled Item', 'barcode' => 'SMUG-1', 'mrp' => 10, 'sel_rate' => 9,
                'gst_percent' => 5, 'store_id' => $this->storeB->id,
            ])
            ->assertCreated()
            ->assertJsonPath('store_id', $this->storeA->id);
    }

    public function test_foreign_store_products_are_404_for_show_update_destroy_and_add_batch(): void
    {
        $foreignId = $this->productB->id;

        $this->actingAsStaff($this->staffA)->getJson("/api/products/{$foreignId}")->assertNotFound();
        $this->actingAsStaff($this->staffA)->putJson("/api/products/{$foreignId}", ['name' => 'Hacked'])->assertNotFound();
        $this->actingAsStaff($this->staffA)->deleteJson("/api/products/{$foreignId}")->assertNotFound();
        $this->actingAsStaff($this->staffA)->postJson("/api/products/{$foreignId}/batches", [
            'batch_no' => 'X1', 'expiry_date' => '2030-01-01', 'stock_qty' => 5,
        ])->assertNotFound();

        // The foreign product is untouched.
        $this->assertSame('Store B Item', $this->productB->fresh()->name);
        $this->assertTrue($this->productB->fresh()->is_active);
    }

    public function test_deactivate_is_per_store(): void
    {
        $this->actingAsStaff($this->staffA)->deleteJson("/api/products/{$this->productA->id}")->assertOk();

        $this->assertFalse($this->productA->fresh()->is_active);
        $this->assertTrue($this->productB->fresh()->is_active, 'R7: deactivating in store A must not touch store B');
    }

    public function test_add_batch_lands_in_the_products_store(): void
    {
        $this->actingAsStaff($this->staffA)
            ->postJson("/api/products/{$this->productA->id}/batches", [
                'batch_no' => 'B2026', 'expiry_date' => '2030-06-30', 'stock_qty' => 25,
            ])
            ->assertCreated()
            ->assertJsonPath('store_id', $this->storeA->id);
    }

    public function test_staff_cannot_spoof_another_stores_header(): void
    {
        // Staff of store A claims store B via header → the write must not land in B.
        $this->actingAsStaff($this->staffA)
            ->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson('/api/products', [
                'name' => 'Spoofed Item', 'barcode' => 'SPOOF-1', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 5,
            ])
            ->assertStatus(403);
    }
}
