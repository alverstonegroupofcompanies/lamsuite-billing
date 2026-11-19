<?php

namespace Tests\Feature\Constitution;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\StockTransfer;
use App\Models\Store;
use App\Models\TransferProductMapping;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution — inter-store transfers.
 * Dispatch deducts source-store stock with a TRANSFER_OUT ledger row; receive
 * must resolve every line to the DESTINATION store's own product (barcode →
 * remembered store-pair mapping → external_id → explicit/auto-create), never
 * reusing the source product id across the store boundary. Both stores get
 * ledger rows.
 */
class TransferReceiveMatchingTest extends TestCase
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

    private function createSourceProduct(array $overrides = []): Product
    {
        return Product::create(array_merge([
            'store_id' => $this->storeA->id,
            'name' => 'Paracetamol 500mg',
            'barcode' => 'SRC-100',
            'hsn_sac_code' => '30049099',
            'mrp' => 25.50,
            'sel_rate' => 22.00,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 10,
        ], $overrides));
    }

    private function createSourceBatch(Product $product, array $overrides = []): ProductBatch
    {
        return ProductBatch::create(array_merge([
            'store_id' => $this->storeA->id,
            'product_id' => $product->id,
            'batch_no' => 'B1',
            'expiry_date' => '2030-06-30',
            'stock_qty' => 10,
            'mrp' => 25.50,
            'selling_rate' => 22,
            'purchase_rate' => 18,
        ], $overrides));
    }

    private function dispatch(array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/stock/transfers', $payload);
    }

    private function receive(StockTransfer $transfer, array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson("/api/stock/transfers/{$transfer->id}/receive", $body);
    }

    public function test_dispatch_deducts_source_stock_and_writes_transfer_out_ledger(): void
    {
        $source = $this->createSourceProduct();
        $batch = $this->createSourceBatch($source);

        $response = $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-1',
            'lines' => [
                ['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 4],
            ],
        ])->assertCreated();

        $this->assertSame('dispatched', $response->json('status'));

        $batch->refresh();
        $source->refresh();
        $this->assertEquals(6, (float) $batch->stock_qty);
        $this->assertEquals(6, (float) $source->current_stock);

        $transfer = StockTransfer::where('transfer_number', 'TRF-T9-1')->first();
        $this->assertNotNull($transfer);
        $this->assertEquals($this->storeA->id, $transfer->from_store_id);
        $item = $transfer->items()->first();
        $this->assertEquals($this->storeA->id, $item->store_id);
        $this->assertEquals($source->id, $item->product_id);

        $ledger = StockLedgerEntry::where('reference_type', 'STOCK_TRANSFER')
            ->where('reference_id', 'TRF-T9-1')
            ->where('store_id', $this->storeA->id)
            ->first();
        $this->assertNotNull($ledger, 'TRANSFER_OUT ledger row missing in source store');
        $this->assertSame('TRANSFER_OUT', $ledger->event_type);
        $this->assertEquals(-4, (float) $ledger->qty_delta);
        $this->assertEquals($source->id, $ledger->product_id);
        $this->assertEquals($batch->id, $ledger->batch_id);
        $this->assertEquals(6, (float) $ledger->balance_after);
    }

    public function test_receive_matches_destination_product_by_barcode_and_writes_transfer_in_ledger(): void
    {
        $source = $this->createSourceProduct();
        $this->createSourceBatch($source);

        $destProduct = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Store B Paracetamol',
            'barcode' => 'SRC-100',
            'current_stock' => 0,
        ]);

        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-2',
            'lines' => [['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 5]],
        ])->assertCreated();

        $transfer = StockTransfer::where('transfer_number', 'TRF-T9-2')->first();

        $this->receive($transfer)->assertOk();

        $destProduct->refresh();
        $this->assertEquals(5, (float) $destProduct->current_stock);

        $destBatch = ProductBatch::where('store_id', $this->storeB->id)
            ->where('product_id', $destProduct->id)
            ->where('batch_no', 'B1')
            ->first();
        $this->assertNotNull($destBatch, 'Destination batch not created under the destination product');
        $this->assertEquals(5, (float) $destBatch->stock_qty);
        $this->assertSame('2030-06-30', $destBatch->expiry_date->toDateString(), 'Expiry must carry over from the source batch');
        $this->assertEquals(25.50, (float) $destBatch->mrp);

        $ledger = StockLedgerEntry::where('reference_type', 'STOCK_TRANSFER')
            ->where('reference_id', 'TRF-T9-2')
            ->where('store_id', $this->storeB->id)
            ->first();
        $this->assertNotNull($ledger, 'TRANSFER_IN ledger row missing in destination store');
        $this->assertSame('TRANSFER_IN', $ledger->event_type);
        $this->assertEquals(5, (float) $ledger->qty_delta);
        $this->assertEquals($destProduct->id, $ledger->product_id, 'Ledger must reference the destination store product, not the source');

        $mapping = TransferProductMapping::where('from_store_id', $this->storeA->id)
            ->where('to_store_id', $this->storeB->id)
            ->where('source_product_id', $source->id)
            ->first();
        $this->assertNotNull($mapping, 'Barcode match must be remembered as a store-pair mapping');
        $this->assertEquals($destProduct->id, $mapping->dest_product_id);
    }

    public function test_explicit_dest_product_is_remembered_and_subsequent_receive_auto_matches(): void
    {
        $source = $this->createSourceProduct(['barcode' => 'SRC-MAP']);
        $this->createSourceBatch($source);

        // Destination product deliberately carries a DIFFERENT barcode so only
        // the remembered mapping can resolve it on the second transfer.
        $destProduct = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Dest Twin',
            'barcode' => 'DEST-MAP',
            'current_stock' => 0,
        ]);

        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-3',
            'lines' => [['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 2]],
        ])->assertCreated();
        $first = StockTransfer::where('transfer_number', 'TRF-T9-3')->first();

        $this->receive($first, [
            'lines' => [
                ['item_id' => $first->items()->first()->id, 'dest_product_id' => $destProduct->id],
            ],
        ])->assertOk();

        $mapping = TransferProductMapping::where('from_store_id', $this->storeA->id)
            ->where('to_store_id', $this->storeB->id)
            ->where('source_product_id', $source->id)
            ->first();
        $this->assertNotNull($mapping);
        $this->assertEquals($destProduct->id, $mapping->dest_product_id);

        // Second transfer: same source product, no instructions — mapping resolves it.
        $this->createSourceBatch($source, ['batch_no' => 'B2', 'expiry_date' => '2031-01-15']);
        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-4',
            'lines' => [['product_id' => $source->id, 'batch_no' => 'B2', 'qty' => 3]],
        ])->assertCreated();
        $second = StockTransfer::where('transfer_number', 'TRF-T9-4')->first();

        $this->receive($second)->assertOk();

        $destProduct->refresh();
        $this->assertEquals(5, (float) $destProduct->current_stock);

        $destBatch = ProductBatch::where('store_id', $this->storeB->id)
            ->where('product_id', $destProduct->id)
            ->where('batch_no', 'B2')
            ->first();
        $this->assertNotNull($destBatch);
        $this->assertSame('2031-01-15', $destBatch->expiry_date->toDateString());
    }

    public function test_receive_auto_create_creates_independent_product_in_target_store(): void
    {
        $source = $this->createSourceProduct(['barcode' => 'SRC-AUTO', 'external_id' => 'ext-auto-1']);
        $this->createSourceBatch($source);

        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-5',
            'lines' => [['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 5]],
        ])->assertCreated();
        $transfer = StockTransfer::where('transfer_number', 'TRF-T9-5')->first();

        $this->receive($transfer, ['auto_create' => true])->assertOk();

        $created = Product::where('store_id', $this->storeB->id)->where('barcode', 'SRC-AUTO')->first();
        $this->assertNotNull($created, 'auto_create must create the product in the destination store');
        $this->assertSame('Paracetamol 500mg', $created->name);
        $this->assertSame('ext-auto-1', $created->external_id);
        $this->assertNotSame($source->id, $created->id);
        $this->assertEquals(5, (float) $created->current_stock);

        $ledger = StockLedgerEntry::where('reference_id', 'TRF-T9-5')
            ->where('store_id', $this->storeB->id)
            ->first();
        $this->assertNotNull($ledger);
        $this->assertEquals($created->id, $ledger->product_id);

        $mapping = TransferProductMapping::where('source_product_id', $source->id)
            ->where('dest_product_id', $created->id)
            ->first();
        $this->assertNotNull($mapping);
    }

    public function test_receive_without_matching_options_reports_unmatched_lines_and_changes_nothing(): void
    {
        $source = $this->createSourceProduct(['barcode' => 'SRC-UNMATCHED']);
        $this->createSourceBatch($source);

        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-6',
            'lines' => [['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 5]],
        ])->assertCreated();
        $transfer = StockTransfer::where('transfer_number', 'TRF-T9-6')->first();

        $this->receive($transfer)->assertStatus(422);

        $responseJson = $this->receive($transfer)->json();
        $this->assertNotEmpty($responseJson['errors']['lines'] ?? []);

        $transfer->refresh();
        $this->assertSame('dispatched', $transfer->status, 'Unmatched receive must leave the transfer dispatched');
        $this->assertSame(0, ProductBatch::where('store_id', $this->storeB->id)->count());
        $this->assertSame(0, StockLedgerEntry::where('store_id', $this->storeB->id)->count());
    }

    public function test_double_receive_is_rejected(): void
    {
        $source = $this->createSourceProduct(['barcode' => 'SRC-DOUBLE']);
        $this->createSourceBatch($source);

        Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Dest Double',
            'barcode' => 'SRC-DOUBLE',
        ]);

        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-7',
            'lines' => [['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 2]],
        ])->assertCreated();
        $transfer = StockTransfer::where('transfer_number', 'TRF-T9-7')->first();

        $this->receive($transfer)->assertOk();
        $this->receive($transfer)->assertStatus(422);

        $destProduct = Product::where('store_id', $this->storeB->id)->where('barcode', 'SRC-DOUBLE')->first();
        $destProduct->refresh();
        $this->assertEquals(2, (float) $destProduct->current_stock, 'Second receive must not double-apply stock');
    }

    public function test_cancel_restores_source_stock_and_receive_after_cancel_is_rejected(): void
    {
        $source = $this->createSourceProduct(['barcode' => 'SRC-CANCEL']);
        $batch = $this->createSourceBatch($source);

        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-8',
            'lines' => [['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 4]],
        ])->assertCreated();
        $transfer = StockTransfer::where('transfer_number', 'TRF-T9-8')->first();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/stock/transfers/{$transfer->id}/cancel", ['reason' => 'Wrong vehicle'])
            ->assertOk();

        $batch->refresh();
        $source->refresh();
        $this->assertEquals(10, (float) $batch->stock_qty);
        $this->assertEquals(10, (float) $source->current_stock);
        $this->assertSame('cancelled', $transfer->fresh()->status);

        $cancelLedger = StockLedgerEntry::where('reference_id', 'TRF-T9-8')
            ->where('store_id', $this->storeA->id)
            ->where('event_type', 'TRANSFER_CANCEL')
            ->first();
        $this->assertNotNull($cancelLedger);
        $this->assertEquals(4, (float) $cancelLedger->qty_delta);

        $this->receive($transfer)->assertStatus(422);
    }

    public function test_admin_receive_matches_destination_product_instead_of_reusing_source_product(): void
    {
        $source = $this->createSourceProduct(['barcode' => 'SRC-ADMIN']);
        $this->createSourceBatch($source);

        $destProduct = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Dest Admin',
            'barcode' => 'SRC-ADMIN',
        ]);

        $dispatchResponse = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/inventory/transfers/dispatch', [
                'from_store_id' => $this->storeA->id,
                'to_store_id' => $this->storeB->id,
                'items' => [
                    ['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 3],
                ],
            ])->assertCreated();

        $transferId = $dispatchResponse->json('id');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/inventory/transfers/{$transferId}/receive", [])
            ->assertOk();

        $destBatch = ProductBatch::where('store_id', $this->storeB->id)
            ->where('batch_no', 'B1')
            ->first();
        $this->assertNotNull($destBatch);
        $this->assertEquals(
            $destProduct->id,
            $destBatch->product_id,
            'Admin receive must match the destination product, never reuse the source product id'
        );

        $source->refresh();
        $destProduct->refresh();
        $this->assertEquals(7, (float) $source->current_stock);
        $this->assertEquals(3, (float) $destProduct->current_stock);

        $this->assertSame(
            1,
            StockLedgerEntry::where('reference_type', 'STOCK_TRANSFER')
                ->where('store_id', $this->storeA->id)
                ->where('event_type', 'TRANSFER_OUT')
                ->count()
        );
        $this->assertSame(
            1,
            StockLedgerEntry::where('reference_type', 'STOCK_TRANSFER')
                ->where('store_id', $this->storeB->id)
                ->where('event_type', 'TRANSFER_IN')
                ->count()
        );
    }

    public function test_sync_push_transfer_applies_dispatch_effects_idempotently(): void
    {
        $source = $this->createSourceProduct(['barcode' => 'SRC-SYNC', 'external_id' => 'ext-sync-1']);
        $batch = $this->createSourceBatch($source);

        \App\Models\Device::create([
            'store_id' => $this->storeA->id,
            'device_name' => 'Till A',
            'device_uuid' => 'UUID-T9-A',
            'device_token' => 'device-token-t9-a',
            'status' => 'active',
        ]);

        $payload = [
            'transfers' => [
                [
                    'transfer_no' => 'TRF-T9-SYNC',
                    'destination_store_id' => $this->storeB->id,
                    'status' => 'dispatched',
                    'lines' => [
                        ['product_id' => $source->id, 'batch_no' => 'B1', 'qty' => 4],
                    ],
                ],
            ],
        ];

        $this->withHeader('X-Device-Token', 'device-token-t9-a')
            ->postJson('/api/sync/push/transfers', $payload)
            ->assertOk();

        $batch->refresh();
        $source->refresh();
        $this->assertEquals(6, (float) $batch->stock_qty);
        $this->assertEquals(6, (float) $source->current_stock);

        $this->assertSame(
            1,
            StockLedgerEntry::where('reference_id', 'TRF-T9-SYNC')
                ->where('store_id', $this->storeA->id)
                ->where('event_type', 'TRANSFER_OUT')
                ->count()
        );

        // Same push again (offline retry) must not double-deduct.
        $this->withHeader('X-Device-Token', 'device-token-t9-a')
            ->postJson('/api/sync/push/transfers', $payload)
            ->assertOk();

        $batch->refresh();
        $this->assertEquals(6, (float) $batch->stock_qty, 'Repeated sync push must not double-deduct');
    }

    public function test_dispatch_rejects_lines_from_a_foreign_store(): void
    {
        $foreign = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Foreign Product',
            'barcode' => 'FOREIGN-1',
        ]);

        $this->dispatch([
            'to_store_id' => $this->storeB->id,
            'transfer_no' => 'TRF-T9-FGN',
            'lines' => [
                ['product_id' => $foreign->id, 'batch_no' => 'B1', 'qty' => 1],
            ],
        ])->assertStatus(422);

        $this->assertSame(0, StockTransfer::where('transfer_number', 'TRF-T9-FGN')->count());
    }
}
