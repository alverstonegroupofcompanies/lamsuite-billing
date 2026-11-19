<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A purchase bill is how stock arrives, so the copy the till pushes has to carry the lines, the
 * quantities, the supplier and the batch stock with it. These tests follow one inward from the
 * payload the desktop queues to the rows and the ledger entries the server ends up holding, and
 * then re-push it, edit it and cancel it.
 */
class SyncPurchaseIngestTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private Product $syrup;
    private Product $ORS;
    private Party $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateDevice::class);

        $this->store = Store::create([
            'name' => 'Purchase Ingest Store',
            'code' => 'PINGEST1',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->otherStore = Store::create([
            'name' => 'Purchase Ingest Store Two',
            'code' => 'PINGEST2',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->syrup = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Ingest Syrup',
            'current_stock' => 0,
            'mrp' => 215.00,
            'sel_rate' => 200.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->ORS = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Ingest ORS Box',
            'current_stock' => 0,
            'mrp' => 300.00,
            'sel_rate' => 288.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 24,
            'is_active' => true,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Ingest Supplier Pvt Ltd',
            'gstin' => '32AAAAA1111BB1Z9',
            'is_active' => true,
        ]);
    }

    /**
     * Push exactly what the till queues for a purchase: its own document number, the supplier's
     * bill number, ids the till knows as strings, and lines carrying packs rather than a qty.
     */
    private function pushPurchase(array $overrides = [], array $headerOnly = []): \Illuminate\Testing\TestResponse
    {
        $payload = array_merge([
            'id' => 'pur_ingest_1',
            'external_id' => 'pur_ingest_1',
            'purchase_number' => 'QA-PUR-0001',
            'supplier_invoice_no' => 'SUP-BILL-0001',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'purchase_date' => '2026-11-19',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'subtotal' => 600,
            'tax_total' => 72,
            'round_off' => 0,
            'grand_total' => 672,
            'status' => 'received',
            'items' => [[
                'product_id' => (string) $this->syrup->id,
                'product_name' => $this->syrup->name,
                'batch_no' => 'BCH-IN-1',
                'expiry_date' => '2027-12-31',
                'pack_qty' => 3,
                'loose_qty' => 0,
                'free_qty' => 0,
                'free_loose_qty' => 0,
                'units_per_pack' => 1,
                'total_units' => 3,
                'purchase_rate' => 200,
                'mrp' => 215,
                'selling_rate' => 200,
                'gst_percent' => 12,
                'taxable_amount' => 600,
                'tax_amount' => 72,
                'total_amount' => 672,
            ]],
        ], $overrides, $headerOnly);

        return $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/purchases', ['purchases' => [$payload]]);
    }

    private function purchase(): Purchase
    {
        return Purchase::where('store_id', $this->store->id)
            ->where('invoice_number', 'SUP-BILL-0001')
            ->firstOrFail();
    }

    public function test_inward_credits_server_batch_stock_and_links_every_line(): void
    {
        $this->pushPurchase()->assertStatus(200)->assertJson(['ingested_count' => 1]);

        $purchase = $this->purchase();
        $this->assertEquals($this->supplier->id, $purchase->supplier_id);
        $this->assertEquals('2026-11-19', $purchase->invoice_date->toDateString());

        $line = $purchase->items()->firstOrFail();
        $this->assertEquals($this->syrup->id, $line->product_id, 'the line must belong to a product, not just a name');
        $this->assertEqualsWithDelta(3.0, (float) $line->qty, 0.001, 'the billed quantity must survive the push');

        $batch = ProductBatch::where('store_id', $this->store->id)
            ->where('product_id', $this->syrup->id)
            ->where('batch_no', 'BCH-IN-1')
            ->first();
        $this->assertNotNull($batch, 'an inward has to create the batch it received');
        $this->assertEqualsWithDelta(3.0, (float) $batch->stock_qty, 0.001);
        $this->assertEquals('2027-12-31', $batch->expiry_date->toDateString());

        $this->assertEqualsWithDelta(3.0, (float) $this->syrup->fresh()->current_stock, 0.001);

        $entry = StockLedgerEntry::where('reference_type', 'PURCHASE')
            ->where('reference_id', (string) $purchase->id)
            ->where('event_type', 'PURCHASE_RECEIPT')
            ->first();
        $this->assertNotNull($entry);
        $this->assertEqualsWithDelta(3.0, (float) $entry->qty_delta, 0.001);
    }

    public function test_repushing_the_same_inward_moves_stock_once(): void
    {
        $this->pushPurchase();
        $first = $this->purchase()->id;
        $this->pushPurchase();

        $this->assertEquals($first, $this->purchase()->id, 'the same bill re-pushed must not become a second document');
        $this->assertEqualsWithDelta(3.0, (float) $this->syrup->fresh()->current_stock, 0.001);
        $this->assertEquals(1, StockLedgerEntry::where('reference_type', 'PURCHASE')->count());
    }

    public function test_editing_an_inward_moves_only_the_difference(): void
    {
        $this->pushPurchase();

        $this->pushPurchase([], [
            'items' => [[
                'product_id' => (string) $this->syrup->id,
                'product_name' => $this->syrup->name,
                'batch_no' => 'BCH-IN-1',
                'expiry_date' => '2027-12-31',
                'pack_qty' => 5,
                'loose_qty' => 2,
                'free_qty' => 0,
                'free_loose_qty' => 0,
                'units_per_pack' => 1,
                'total_units' => 7,
                'purchase_rate' => 200,
                'mrp' => 215,
                'gst_percent' => 12,
            ]],
        ]);

        $this->assertEqualsWithDelta(7.0, (float) $this->syrup->fresh()->current_stock, 0.001);
        $this->assertEqualsWithDelta(5.0, (float) $this->purchase()->items()->firstOrFail()->qty, 0.001);

        // The net is what is written: the bill already put 3 units in, so the edit moves the 4
        // units it added, never a receipt of 7 with a reversal nobody asked for.
        $entries = StockLedgerEntry::where('reference_type', 'PURCHASE')->orderBy('id')->get();
        $this->assertSame([3.0, 4.0], $entries->map(fn ($e) => (float) $e->qty_delta)->all());
    }

    public function test_packs_of_a_multi_unit_pack_take_the_whole_pack(): void
    {
        $this->pushPurchase([], [
            'items' => [[
                'product_id' => (string) $this->ORS->id,
                'product_name' => $this->ORS->name,
                'batch_no' => 'BCH-IN-2',
                'expiry_date' => '2028-06-30',
                'pack_qty' => 2,
                'loose_qty' => 3,
                'free_qty' => 1,
                'free_loose_qty' => 0,
                'units_per_pack' => 24,
                'total_units' => 75,
                'purchase_rate' => 240,
                'mrp' => 300,
                'gst_percent' => 12,
            ]],
        ]);

        $batch = ProductBatch::where('store_id', $this->store->id)->where('batch_no', 'BCH-IN-2')->firstOrFail();
        $this->assertEqualsWithDelta(75.0, (float) $batch->stock_qty, 0.001);
        $this->assertEqualsWithDelta(75.0, (float) $this->ORS->fresh()->current_stock, 0.001);
    }

    public function test_cancelling_an_inward_gives_every_unit_back_and_repeats_as_nothing(): void
    {
        $this->pushPurchase();

        // A cancellation is queued as the document alone: no lines, only the new status.
        $this->pushPurchase([], ['status' => 'cancelled', 'cancel_reason' => 'wrong supplier bill', 'items' => []]);

        $purchase = $this->purchase();
        $this->assertEquals('cancelled', $purchase->status);
        $this->assertEqualsWithDelta(0.0, (float) $this->syrup->fresh()->current_stock, 0.001);
        $this->assertEqualsWithDelta(0.0, (float) ProductBatch::where('batch_no', 'BCH-IN-1')->firstOrFail()->stock_qty, 0.001);

        $this->pushPurchase([], ['status' => 'cancelled', 'items' => []]);
        $this->assertEqualsWithDelta(0.0, (float) $this->syrup->fresh()->current_stock, 0.001);
        $this->assertEquals(1, StockLedgerEntry::where('event_type', 'PURCHASE_CANCEL')->count());
    }

    public function test_two_stores_sharing_a_supplier_bill_number_keep_their_own_inward(): void
    {
        $this->pushPurchase();

        $otherProduct = Product::create([
            'store_id' => $this->otherStore->id,
            'name' => 'Ingest Syrup',
            'current_stock' => 0,
            'mrp' => 215.00,
            'sel_rate' => 200.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->withHeader('X-Store-Id', $this->otherStore->id)
            ->postJson('/api/sync/push/purchases', ['purchases' => [[
                'purchase_number' => 'QA-PUR-0001',
                'supplier_invoice_no' => 'SUP-BILL-0001',
                'supplier_name' => $this->supplier->name,
                'purchase_date' => '2026-11-19',
                'store_id' => (string) $this->otherStore->id,
                'status' => 'received',
                'grand_total' => 672,
                'items' => [[
                    'product_id' => (string) $otherProduct->id,
                    'product_name' => $otherProduct->name,
                    'batch_no' => 'BCH-IN-9',
                    'pack_qty' => 4,
                    'units_per_pack' => 1,
                    'purchase_rate' => 200,
                    'gst_percent' => 12,
                ]],
            ]]])->assertStatus(200);

        $this->assertEquals(2, Purchase::where('invoice_number', 'SUP-BILL-0001')->count());
        $this->assertEqualsWithDelta(3.0, (float) $this->syrup->fresh()->current_stock, 0.001);
        $this->assertEqualsWithDelta(4.0, (float) $otherProduct->fresh()->current_stock, 0.001);

        // The second store must not adopt the first store's product through a matching name.
        $otherLine = Purchase::where('store_id', $this->otherStore->id)
            ->firstOrFail()->items()->firstOrFail();
        $this->assertEquals($otherProduct->id, $otherLine->product_id);
    }

    public function test_an_unknown_till_product_id_falls_back_to_the_name_within_the_store(): void
    {
        $this->pushPurchase([], [
            'items' => [[
                'product_id' => 'prod_desktop_local_xyz',
                'product_name' => $this->syrup->name,
                'batch_no' => 'BCH-IN-3',
                'pack_qty' => 2,
                'units_per_pack' => 1,
                'purchase_rate' => 200,
                'gst_percent' => 12,
            ]],
        ]);

        $line = $this->purchase()->items()->firstOrFail();
        $this->assertEquals($this->syrup->id, $line->product_id);
        $this->assertEqualsWithDelta(2.0, (float) $this->syrup->fresh()->current_stock, 0.001);
    }

    public function test_a_line_naming_nothing_the_store_sells_stays_unlinked_and_credits_nothing(): void
    {
        $this->pushPurchase([], [
            'items' => [[
                'product_name' => 'Product Nobody Stocks',
                'batch_no' => 'BCH-IN-4',
                'pack_qty' => 2,
                'units_per_pack' => 1,
                'purchase_rate' => 200,
                'gst_percent' => 12,
            ]],
        ]);

        $line = $this->purchase()->items()->firstOrFail();
        $this->assertNull($line->product_id);
        $this->assertDatabaseMissing('product_batches', ['store_id' => $this->store->id, 'batch_no' => 'BCH-IN-4']);
        $this->assertEqualsWithDelta(0.0, (float) $this->syrup->fresh()->current_stock, 0.001);
        $this->assertEquals(0, StockLedgerEntry::where('reference_type', 'PURCHASE')->count());
    }

    public function test_inward_reuses_a_batch_the_store_already_holds(): void
    {
        $existing = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->syrup->id,
            'batch_no' => 'BCH-IN-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 10,
        ]);

        $this->pushPurchase();

        $this->assertEquals(1, ProductBatch::where('store_id', $this->store->id)->where('batch_no', 'BCH-IN-1')->count());
        $this->assertEqualsWithDelta(13.0, (float) $existing->fresh()->stock_qty, 0.001);
    }
}
