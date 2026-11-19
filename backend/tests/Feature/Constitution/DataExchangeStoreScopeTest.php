<?php

namespace Tests\Feature\Constitution;

use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution — bulk import/export.
 * Imports must target one explicit store (barcode matching scoped to that
 * store — never another store's row) and exports must be store-filtered.
 */
class DataExchangeStoreScopeTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin', 'email' => 'super@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => null, 'allowed_store_ids' => null,
        ]);
    }

    public function test_import_barcode_match_is_scoped_to_the_target_store(): void
    {
        $existingA = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'Store A Original',
            'barcode' => 'IMP-100',
            'mrp' => 10,
        ]);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson('/api/admin/data-exchange/commit', [
                'entity_type' => 'items',
                'store_id' => $this->storeB->id,
                'rows' => [
                    ['name' => 'Store B Imported', 'barcode' => 'IMP-100', 'mrp' => 12],
                ],
            ])->assertOk();

        $existingA->refresh();
        $this->assertSame('Store A Original', $existingA->name, 'Import into B must never update store A\'s product');
        $this->assertEquals(10, (float) $existingA->mrp);

        $importedB = Product::where('store_id', $this->storeB->id)->where('barcode', 'IMP-100')->first();
        $this->assertNotNull($importedB, 'Import must create the product in the target store');
        $this->assertSame('Store B Imported', $importedB->name);
        $this->assertEquals(12, (float) $importedB->mrp);
        $this->assertNotSame($existingA->id, $importedB->id);
    }

    public function test_import_requires_an_explicit_store_context(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/data-exchange/commit', [
                'entity_type' => 'items',
                'rows' => [
                    ['name' => 'No Store', 'barcode' => 'IMP-NOSTORE'],
                ],
            ])->assertStatus(422);

        $this->assertSame(0, Product::where('barcode', 'IMP-NOSTORE')->count());
    }

    public function test_export_is_store_filtered_and_requires_store_context(): void
    {
        Product::create(['store_id' => $this->storeA->id, 'name' => 'A Product', 'barcode' => 'EXP-A']);
        Product::create(['store_id' => $this->storeB->id, 'name' => 'B Product', 'barcode' => 'EXP-B']);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/admin/data-exchange/export/items')
            ->assertOk();

        $data = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/admin/data-exchange/export/items')
            ->json('data');

        $barcodes = array_column($data, 'barcode');
        $this->assertContains('EXP-A', $barcodes);
        $this->assertNotContains('EXP-B', $barcodes, 'Export must not leak another store\'s products');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->flushHeaders()
            ->getJson('/api/admin/data-exchange/export/items')
            ->assertStatus(422);
    }
}
