<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\StockTransfer;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STK-03 — a receipt reports what actually arrived. The dispatch ledger already
 * removed the full quantity from the sender; receive must credit only what the
 * receiver accepted and record the shortfall with a reason.
 */
class TransferShortReceiptTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Dispatch Store', 'code' => 'SHORT-A', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Receive Store', 'code' => 'SHORT-B', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'super@short.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => null,
        ]);
    }

    private function dispatchedTransfer(int $qty = 30): StockTransfer
    {
        $source = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'QA Amoxicillin 500mg',
            'barcode' => '8909000000099',
            'hsn_sac_code' => '30041010',
            'mrp' => 80,
            'sel_rate' => 75,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => $qty,
        ]);

        ProductBatch::create([
            'store_id' => $this->storeA->id,
            'product_id' => $source->id,
            'batch_no' => 'SHORT-B1',
            'expiry_date' => '2030-12-31',
            'stock_qty' => $qty,
            'mrp' => 80,
            'selling_rate' => 75,
            'purchase_rate' => 60,
        ]);

        $dest = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'QA Amoxicillin 500mg',
            'barcode' => '8909000000099',
            'hsn_sac_code' => '30041010',
            'mrp' => 80,
            'sel_rate' => 75,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 0,
        ]);

        $this->assertNotNull($dest);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/stock/transfers', [
                'to_store_id' => $this->storeB->id,
                'transfer_no' => 'TRF-SHORT-1',
                'lines' => [['product_id' => $source->id, 'batch_no' => 'SHORT-B1', 'qty' => $qty]],
            ])
            ->assertCreated();

        return StockTransfer::where('transfer_number', 'TRF-SHORT-1')->firstOrFail();
    }

    private function receive(StockTransfer $transfer, array $body): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson("/api/stock/transfers/{$transfer->id}/receive", $body);
    }

    public function test_receive_posts_received_quantity_and_records_shortage(): void
    {
        $transfer = $this->dispatchedTransfer(30);
        $item = $transfer->items()->firstOrFail();

        $this->receive($transfer, [
            'lines' => [
                ['item_id' => $item->id, 'received_qty' => 25, 'shortage_reason' => 'Five strips crushed in transit'],
            ],
        ])->assertOk();

        $item->refresh();
        $this->assertEquals(25, (float) $item->received_qty);
        $this->assertEquals(5, (float) $item->short_qty);
        $this->assertSame('Five strips crushed in transit', $item->shortage_reason);

        $destProduct = Product::where('store_id', $this->storeB->id)->where('barcode', '8909000000099')->firstOrFail();
        $this->assertEquals(25, (float) $destProduct->current_stock, 'Destination must be credited only what arrived');

        $destBatch = ProductBatch::where('store_id', $this->storeB->id)
            ->where('product_id', $destProduct->id)
            ->where('batch_no', 'SHORT-B1')
            ->firstOrFail();
        $this->assertEquals(25, (float) $destBatch->stock_qty);

        $ledger = StockLedgerEntry::where('store_id', $this->storeB->id)
            ->where('event_type', 'TRANSFER_IN')
            ->firstOrFail();
        $this->assertEquals(25, (float) $ledger->qty_delta);

        // The sender already gave up all 30 at dispatch; a shortage must not
        // quietly re-credit the sending store.
        $source = Product::where('store_id', $this->storeA->id)->firstOrFail();
        $this->assertEquals(0, (float) $source->current_stock);
    }

    public function test_received_quantity_cannot_exceed_dispatched(): void
    {
        $transfer = $this->dispatchedTransfer(30);
        $item = $transfer->items()->firstOrFail();

        $this->receive($transfer, [
            'lines' => [
                ['item_id' => $item->id, 'received_qty' => 31, 'shortage_reason' => 'Typo'],
            ],
        ])->assertStatus(422);

        $this->assertSame('dispatched', $transfer->fresh()->status);
        $this->assertEquals(0, (float) Product::where('store_id', $this->storeB->id)->value('current_stock'));
    }

    public function test_short_receipt_without_a_reason_records_the_default_reason(): void
    {
        // The QA call (J7): received_qty 25 of 30 and no reason.
        $transfer = $this->dispatchedTransfer(30);
        $item = $transfer->items()->firstOrFail();

        $this->receive($transfer, [
            'lines' => [
                ['item_id' => $item->id, 'received_qty' => 25],
            ],
        ])->assertOk();

        $item->refresh();
        $this->assertEquals(25, (float) $item->received_qty);
        $this->assertEquals(5, (float) $item->short_qty);
        $this->assertSame(\App\Services\Stock\InterStoreTransferService::DEFAULT_SHORTAGE_REASON, $item->shortage_reason);
        $this->assertSame('received', $transfer->fresh()->status);
    }

    public function test_full_receive_without_quantities_keeps_working(): void
    {
        $transfer = $this->dispatchedTransfer(10);

        $this->receive($transfer, [])->assertOk();

        $item = $transfer->items()->firstOrFail();
        $this->assertEquals(10, (float) $item->received_qty);
        $this->assertEquals(0, (float) $item->short_qty);
        $this->assertEquals(10, (float) Product::where('store_id', $this->storeB->id)->value('current_stock'));
    }
}
