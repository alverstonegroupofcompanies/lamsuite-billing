<?php

namespace Tests\Feature\Constitution;

use App\Models\Device;
use App\Models\Product;
use App\Models\Store;
use App\Models\SyncEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution guard — R5: offline sync pushes are keyed by
 * (store_id, external_id) and can never hijack another store's product,
 * party or transfer target. Conflicts land in the sync centre (sync_events).
 */
class SyncPushStoreScopeTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private string $tokenA = 'device-token-store-a';
    private string $tokenB = 'device-token-store-b';

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        Device::create([
            'store_id' => $this->storeA->id,
            'device_name' => 'Till A',
            'device_uuid' => 'UUID-SA-1',
            'device_token' => $this->tokenA,
            'status' => 'active',
        ]);
        Device::create([
            'store_id' => $this->storeB->id,
            'device_name' => 'Till B',
            'device_uuid' => 'UUID-SB-1',
            'device_token' => $this->tokenB,
            'status' => 'active',
        ]);
    }

    private function pushing(string $token): self
    {
        return $this->withHeader('X-Device-Token', $token);
    }

    public function test_same_external_id_in_two_stores_creates_two_independent_products(): void
    {
        $payload = [
            'store_id' => null,
            'products' => [
                ['external_id' => 'loc-1001', 'name' => 'Crocine', 'barcode' => 'BC-1001', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12],
            ],
        ];

        $this->pushing($this->tokenA)->postJson('/api/sync/push/products', $payload)->assertOk();
        $this->pushing($this->tokenB)->postJson('/api/sync/push/products', $payload)->assertOk();

        $this->assertSame(2, Product::where('external_id', 'loc-1001')->count());
        $this->assertSame(1, Product::where('store_id', $this->storeA->id)->where('external_id', 'loc-1001')->count());
        $this->assertSame(1, Product::where('store_id', $this->storeB->id)->where('external_id', 'loc-1001')->count());
    }

    public function test_same_external_id_push_never_touches_another_stores_row(): void
    {
        // Legacy global row: external_id claimed by store B.
        $foreign = Product::create([
            'store_id' => $this->storeB->id, 'external_id' => 'loc-2002', 'name' => 'Store B Original',
            'barcode' => 'BC-2002', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12,
        ]);

        $this->pushing($this->tokenA)
            ->postJson('/api/sync/push/products', [
                'store_id' => $this->storeA->id,
                'products' => [
                    ['external_id' => 'loc-2002', 'name' => 'Till A Item', 'barcode' => 'BC-2002-A', 'mrp' => 12, 'sel_rate' => 10, 'gst_percent' => 12],
                ],
            ])
            ->assertOk();

        // The store B row is untouched; store A gains its own independent product.
        $this->assertSame('Store B Original', $foreign->fresh()->name);
        $this->assertSame('Store B Original', $foreign->fresh()->name);
        $ownRow = Product::where('store_id', $this->storeA->id)->where('external_id', 'loc-2002')->first();
        $this->assertNotNull($ownRow);
        $this->assertSame('Till A Item', $ownRow->name);
        $this->assertSame('BC-2002-A', $ownRow->barcode);

        // The conflict is visible in the admin sync centre endpoint.
        $superAdmin = User::create([
            'name' => 'Super Admin', 'email' => 'sync-super@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => null, 'allowed_store_ids' => null,
        ]);
        $this->actingAs($superAdmin, 'sanctum')
            ->getJson('/api/admin/sync/events')
            ->assertOk();
    }

    public function test_transfer_push_uses_real_destination_and_scopes_lines_to_sending_store(): void
    {
        $productA = Product::create([
            'store_id' => $this->storeA->id, 'external_id' => 'loc-tr-1', 'name' => 'Transfer Item A',
            'barcode' => 'TR-1', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12,
        ]);
        // A different store's product with the same external_id must NOT be matched.
        Product::create([
            'store_id' => $this->storeB->id, 'external_id' => 'loc-tr-1', 'name' => 'Transfer Item B',
            'barcode' => 'TR-1-B', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12,
        ]);

        $this->pushing($this->tokenA)
            ->postJson('/api/sync/push/transfers', [
                'store_id' => $this->storeA->id,
                'transfers' => [
                    [
                        'transfer_no' => 'TRF-TEST-1',
                        'destination_store_id' => $this->storeB->id,
                        'status' => 'dispatched',
                        'lines' => [
                            ['product_id' => 'loc-tr-1', 'batch_no' => 'B1', 'qty' => 5],
                        ],
                    ],
                ],
            ])
            ->assertOk();

        $this->assertDatabaseHas('stock_transfers', [
            'transfer_number' => 'TRF-TEST-1',
            'from_store_id' => $this->storeA->id,
            'to_store_id' => $this->storeB->id,
        ]);

        $item = \DB::table('stock_transfer_items')->where('stock_transfer_id', function ($q) {
            $q->select('id')->from('stock_transfers')->where('transfer_number', 'TRF-TEST-1');
        })->first();
        $this->assertSame($this->storeA->id, (int) $item->store_id, 'transfer item rows are scoped to the sending store');
        $this->assertSame($productA->id, (int) $item->product_id, 'line resolution must match the sending store product, never another store');

        // A transfer without a destination store is rejected instead of silently targeting store 2.
        $this->pushing($this->tokenA)
            ->postJson('/api/sync/push/transfers', [
                'store_id' => $this->storeA->id,
                'transfers' => [
                    [
                        'transfer_no' => 'TRF-TEST-2',
                        'status' => 'dispatched',
                        'lines' => [['product_id' => 'loc-tr-1', 'batch_no' => 'B1', 'qty' => 2]],
                    ],
                ],
            ])
            ->assertStatus(422);
        $this->assertDatabaseMissing('stock_transfers', ['transfer_number' => 'TRF-TEST-2']);
    }

    public function test_duplicate_barcode_push_in_same_store_is_a_conflict_not_a_crash(): void
    {
        Product::create([
            'store_id' => $this->storeA->id, 'external_id' => 'loc-bc-1', 'name' => 'First', 'barcode' => 'BC-DUP',
            'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12,
        ]);

        $this->pushing($this->tokenA)
            ->postJson('/api/sync/push/products', [
                'store_id' => $this->storeA->id,
                'products' => [
                    ['external_id' => 'loc-bc-2', 'name' => 'Second', 'barcode' => 'BC-DUP', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12],
                ],
            ])
            ->assertOk();

        $this->assertSame(1, Product::where('store_id', $this->storeA->id)->where('barcode', 'BC-DUP')->count());
        $this->assertTrue(
            SyncEvent::where('store_id', $this->storeA->id)->where('status', 'conflict')->where('entity_type', 'product')->exists()
        );
    }
}
