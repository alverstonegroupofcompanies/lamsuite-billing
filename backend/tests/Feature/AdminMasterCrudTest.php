<?php

namespace Tests\Feature;

use App\Models\MasterLookup;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminMasterCrudTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Metro Superstore',
            'code' => 'METRO-01',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
            'store_type' => 'pharmacy',
        ]);

        $this->admin = User::create([
            'name' => 'Store Owner',
            'email' => 'owner@metro.in',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);
    }

    public function test_product_crud_flow(): void
    {
        // 1. Create Product
        $createRes = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/products', [
                'store_id' => $this->store->id,
                'name' => 'Paracetamol 650mg',
                'barcode' => '8901234567890',
                'hsn_sac_code' => '30049099',
                'mrp' => 35.00,
                'sel_rate' => 30.00,
                'ptr' => 22.00,
                'pts' => 20.00,
                'gst_percent' => 12.00,
                'units_per_pack' => 10,
                'initial_batch' => [
                    'batch_no' => 'B-001',
                    'expiry_date' => '2028-12-31',
                    'stock_qty' => 100,
                ],
            ]);

        $createRes->assertStatus(201);
        $productId = $createRes->json('id');
        $this->assertDatabaseHas('products', ['id' => $productId, 'name' => 'Paracetamol 650mg']);

        // 2. Read / List Products
        $listRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/products?search=Paracetamol');
        $listRes->assertStatus(200);
        $this->assertEquals(1, count($listRes->json('data')));

        // 3. Update Product
        $updateRes = $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/admin/products/{$productId}", [
                'name' => 'Paracetamol 650mg Tabs',
                'sel_rate' => 32.00,
            ]);
        $updateRes->assertStatus(200);
        $this->assertDatabaseHas('products', ['id' => $productId, 'name' => 'Paracetamol 650mg Tabs', 'sel_rate' => 32.00]);

        // 4. Delete Product
        $deleteRes = $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/admin/products/{$productId}");
        $deleteRes->assertStatus(200);
        $this->assertDatabaseMissing('products', ['id' => $productId]);
    }

    public function test_batches_crud_flow(): void
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500mg',
            'barcode' => '8909876543210',
            'hsn_sac_code' => '30041010',
            'mrp' => 80.00,
            'sel_rate' => 75.00,
            'gst_percent' => 12.00,
            'current_stock' => 0,
            'version' => 1,
            'is_active' => true,
        ]);

        // 1. Add Batch
        $batchRes = $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/products/{$product->id}/batches", [
                'batch_no' => 'AMX-2026',
                'expiry_date' => '2028-06-30',
                'stock_qty' => 50,
                'mrp' => 80.00,
                'selling_rate' => 75.00,
                'rack_location' => 'R1',
                'shelf_location' => 'S2',
            ]);
        $batchRes->assertStatus(201);
        $batchId = $batchRes->json('id');
        $this->assertDatabaseHas('product_batches', ['id' => $batchId, 'batch_no' => 'AMX-2026']);
        $this->assertEquals(50, Product::find($product->id)->current_stock);

        // 2. List Batches
        $listRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/admin/batches?search=AMX");
        $listRes->assertStatus(200);
        $this->assertEquals(1, count($listRes->json('data')));

        // 3. Update Batch
        $updateRes = $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/admin/batches/{$batchId}", [
                'stock_qty' => 75,
                'selling_rate' => 72.00,
            ]);
        $updateRes->assertStatus(200);
        $this->assertDatabaseHas('product_batches', ['id' => $batchId, 'stock_qty' => 75, 'selling_rate' => 72.00]);
        $this->assertEquals(75, Product::find($product->id)->current_stock);

        // 4. Delete Batch
        $deleteRes = $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/admin/batches/{$batchId}");
        $deleteRes->assertStatus(200);
        $this->assertDatabaseMissing('product_batches', ['id' => $batchId]);
        $this->assertEquals(0, Product::find($product->id)->current_stock);
    }

    public function test_parties_crud_flow(): void
    {
        // 1. Create Party (Customer)
        $createRes = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/parties', [
                'store_id' => $this->store->id,
                'type' => 'customer',
                'name' => 'Rahul Sharma',
                'phone' => '9876543210',
                'email' => 'rahul@example.com',
                'gstin' => '32AAAAA0000A1Z5',
                'credit_limit' => 5000,
            ]);
        $createRes->assertStatus(201);
        $partyId = $createRes->json('id');
        $this->assertDatabaseHas('parties', ['id' => $partyId, 'name' => 'Rahul Sharma', 'type' => 'customer']);

        // 2. List Parties
        $listRes = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/parties?type=customer&search=Rahul');
        $listRes->assertStatus(200);
        $this->assertEquals(1, count($listRes->json('data')));

        // 3. Update Party
        $updateRes = $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/admin/parties/{$partyId}", [
                'name' => 'Rahul K Sharma',
                'credit_limit' => 8000,
            ]);
        $updateRes->assertStatus(200);
        $this->assertDatabaseHas('parties', ['id' => $partyId, 'name' => 'Rahul K Sharma', 'credit_limit' => 8000]);

        // 4. Delete Party
        $deleteRes = $this->actingAs($this->admin, 'sanctum')
            ->deleteJson("/api/admin/parties/{$partyId}");
        $deleteRes->assertStatus(200);
        $this->assertDatabaseMissing('parties', ['id' => $partyId]);
    }

    public function test_lookups_crud_for_all_types(): void
    {
        $types = [
            ['type' => 'unit', 'name' => 'Strip', 'code' => 'STP', 'config' => ['precision' => 0]],
            ['type' => 'group', 'name' => 'Antibiotics', 'code' => 'GRP-ANT', 'description' => 'Antibacterial medicines'],
            ['type' => 'brand', 'name' => 'Cipla Healthcare', 'code' => 'CIP', 'description' => 'Cipla pharma brand'],
            ['type' => 'manufacturer', 'name' => 'Abbott India Ltd', 'code' => 'ABB', 'description' => 'Abbott labs'],
            ['type' => 'discount_schema', 'name' => 'Bulk Buy 10', 'code' => 'SCH-10', 'config' => ['discount_percent' => 10, 'min_quantity' => 10]],
            ['type' => 'tax_rate', 'name' => 'GST 12%', 'code' => '3004', 'config' => ['tax_percent' => 12]],
            ['type' => 'expense_head', 'name' => 'Shop Electricity', 'code' => 'EXP-ELEC', 'description' => 'Monthly power bill'],
            ['type' => 'bank', 'name' => 'HDFC Current Account', 'code' => 'HDFC', 'config' => ['account_no' => '50200012345678', 'ifsc' => 'HDFC0000123']],
        ];

        foreach ($types as $item) {
            // 1. Create Lookup
            $res = $this->actingAs($this->admin, 'sanctum')
                ->postJson('/api/admin/lookups', array_merge($item, ['store_id' => $this->store->id]));
            $res->assertStatus(201);
            $id = $res->json('id');
            $this->assertDatabaseHas('master_lookups', ['id' => $id, 'type' => $item['type'], 'name' => $item['name']]);

            // 2. Read / List Lookup by type
            $listRes = $this->actingAs($this->admin, 'sanctum')
                ->getJson("/api/admin/lookups?type={$item['type']}");
            $listRes->assertStatus(200);
            $this->assertTrue(collect($listRes->json('data'))->contains('id', $id));

            // 3. Update Lookup
            $updatedName = $item['name'] . ' (Updated)';
            $upRes = $this->actingAs($this->admin, 'sanctum')
                ->putJson("/api/admin/lookups/{$id}", ['name' => $updatedName]);
            $upRes->assertStatus(200);
            $this->assertDatabaseHas('master_lookups', ['id' => $id, 'name' => $updatedName]);

            // 4. Delete Lookup
            $delRes = $this->actingAs($this->admin, 'sanctum')
                ->deleteJson("/api/admin/lookups/{$id}");
            $delRes->assertStatus(200);
            $this->assertDatabaseMissing('master_lookups', ['id' => $id]);
        }
    }

    public function test_sync_push_and_pull_deltas_lookups(): void
    {
        // Push batch containing unit lookup
        $pushRes = $this->postJson('/api/sync/push/batch', [
            'store_id' => $this->store->id,
            'items' => [
                [
                    'id' => 'sync_unit_1',
                    'entity_type' => 'unit',
                    'action' => 'create',
                    'payload' => [
                        'name' => 'Tablet',
                        'symbol' => 'TAB',
                        'precision' => 0,
                    ],
                ],
            ],
        ]);

        $pushRes->assertStatus(200);
        $this->assertTrue($pushRes->json('success'));
        $this->assertDatabaseHas('master_lookups', ['type' => 'unit', 'name' => 'Tablet', 'code' => 'TAB']);

        // Pull deltas should return lookups
        $deltaRes = $this->getJson('/api/sync/pull/deltas?since_watermark=0');
        $deltaRes->assertStatus(200);
        $this->assertArrayHasKey('lookups', $deltaRes->json());
        $this->assertTrue(collect($deltaRes->json('lookups'))->contains('name', 'Tablet'));
    }
}
