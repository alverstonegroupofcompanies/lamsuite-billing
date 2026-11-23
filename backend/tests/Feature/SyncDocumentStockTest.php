<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A document that reaches the server through the sync queue has to leave the same stock behind as
 * the same document billed while the line was up, and it has to know which side it sits on: a
 * bill takes units off the shelf, a credit note puts them back, and a quotation promises stock
 * without touching it.
 */
class SyncDocumentStockTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Sync Stock Store',
            'code' => 'SYNCSTOCK1',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => 'active',
            'device_uuid' => 'uuid_sync_stock_c01',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Sync Stock Tablet',
            'current_stock' => 100,
            'mrp' => 120.00,
            'sel_rate' => 100.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-SS-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'mrp' => 120.00,
            'selling_rate' => 100.00,
        ]);
    }

    private function push(array $payload, string $action = 'create'): void
    {
        $this->postJson('/api/sync/push/batch', [
            'items' => [[
                'entity_type' => 'invoice',
                'entity_id' => $payload['external_id'] ?? $payload['id'],
                'action' => $action,
                'payload' => $payload,
            ]],
        ])->assertStatus(200);
    }

    private function documentPayload(array $overrides = []): array
    {
        static $n = 0;
        $n++;

        // 2 packs at 100.00 exclusive: taxable 200.00, tax 24.00, grand 224.00
        return array_merge([
            'external_id' => 'ext_sync_stock_' . $n,
            'invoice_number' => 'C01-INV-SYNC-' . $n,
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'invoice_date' => '2026-11-19',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'taxable_subtotal' => 200.00,
            'tax_total' => 24.00,
            'cgst_total' => 12.00,
            'sgst_total' => 12.00,
            'round_off' => 0.00,
            'grand_total' => 224.00,
            'paid_amount' => 224.00,
            'status' => 'issued',
            'payments' => [['mode' => 'Cash', 'amount' => 224.00]],
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'BCH-SS-1',
                'qty' => 2,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'mrp' => 120.00,
                'gst_percent' => 12.00,
                'taxable_amount' => 200.00,
                'cgst_amount' => 12.00,
                'sgst_amount' => 12.00,
                'tax_amount' => 24.00,
                'total_amount' => 224.00,
            ]],
        ], $overrides);
    }

    private function entries(): \Illuminate\Support\Collection
    {
        return StockLedgerEntry::where('store_id', $this->store->id)->orderBy('id')->get();
    }

    public function test_a_bill_queued_while_offline_takes_the_same_units_off_the_shelf(): void
    {
        $this->push($this->documentPayload());

        $this->assertEqualsWithDelta(98.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(98.0, (float) $this->product->fresh()->current_stock, 0.001);

        $entry = $this->entries()->firstOrFail();
        $this->assertEquals('SALE', $entry->event_type);
        $this->assertEqualsWithDelta(-2.0, (float) $entry->qty_delta, 0.001);
        $this->assertEquals('INVOICE', $entry->reference_type);
    }

    public function test_the_same_offline_bill_requeued_moves_nothing_a_second_time(): void
    {
        $payload = $this->documentPayload();
        $this->push($payload);
        $this->push($payload, 'update');

        $this->assertEqualsWithDelta(98.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEquals(1, $this->entries()->count());
    }

    public function test_a_credit_note_queued_as_an_invoice_puts_the_units_back(): void
    {
        $this->push($this->documentPayload());

        $this->push($this->documentPayload([
            'invoice_number' => 'SR-9001',
            'module_key' => 'credit_note',
            'return_number' => 'SR-9001',
            'original_invoice_number' => 'C01-INV-1001',
            'grand_total' => 224.00,
        ]));

        $this->assertEqualsWithDelta(100.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(100.0, (float) $this->product->fresh()->current_stock, 0.001);

        $return = $this->entries()->last();
        $this->assertEquals('SALES_RETURN', $return->event_type);
        $this->assertEqualsWithDelta(2.0, (float) $return->qty_delta, 0.001);
    }

    public function test_a_return_queued_without_a_module_key_is_still_read_as_a_return(): void
    {
        $this->push($this->documentPayload([
            'return_number' => 'SR-9002',
            'original_invoice_number' => 'C01-INV-1001',
        ]));

        $this->assertEqualsWithDelta(102.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEquals('SALES_RETURN', $this->entries()->firstOrFail()->event_type);
    }

    public function test_a_quotation_reserves_nothing_on_the_shelf(): void
    {
        $this->push($this->documentPayload([
            'module_key' => 'quotation',
            'invoice_number' => 'QTN-9003',
        ]));

        $this->assertEqualsWithDelta(100.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEquals(0, $this->entries()->count());

        $this->assertDatabaseHas('invoices', [
            'store_id' => $this->store->id,
            'invoice_number' => 'QTN-9003',
            'module_key' => 'quotation',
        ]);
    }

    public function test_a_multi_unit_pack_line_moves_the_whole_pack_count(): void
    {
        $box = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Sync Stock Box of 24',
            'current_stock' => 48,
            'mrp' => 300.00,
            'sel_rate' => 288.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 24,
            'is_active' => true,
        ]);
        $boxBatch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $box->id,
            'batch_no' => 'BCH-SS-24',
            'expiry_date' => '2028-06-30',
            'stock_qty' => 48,
        ]);

        $this->push($this->documentPayload([
            'items' => [[
                'product_id' => $box->id,
                'product_name' => $box->name,
                'batch_no' => 'BCH-SS-24',
                'qty' => 1,
                'loose_qty' => 2,
                'free_qty' => 0,
                'units_per_pack' => 24,
                'unit_price' => 288.00,
                'gst_percent' => 12.00,
                'taxable_amount' => 288.00,
                'tax_amount' => 34.56,
                'total_amount' => 322.56,
            ]],
            'taxable_subtotal' => 288.00,
            'tax_total' => 34.56,
            'cgst_total' => 17.28,
            'sgst_total' => 17.28,
            'grand_total' => 322.56,
            'paid_amount' => 322.56,
            'payments' => [['mode' => 'Cash', 'amount' => 322.56]],
        ]));

        // 1 pack of 24 plus 2 loose units leave the shelf.
        $this->assertEqualsWithDelta(22.0, (float) $boxBatch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(22.0, (float) $box->fresh()->current_stock, 0.001);
    }

    public function test_a_line_naming_a_product_the_store_does_not_sell_moves_no_stock(): void
    {
        $this->push($this->documentPayload([
            'invoice_number' => 'C01-INV-UNKNOWN',
            'items' => [[
                'product_name' => 'Product Nobody Stocks',
                'batch_no' => 'BCH-SS-1',
                'qty' => 2,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 12.00,
                'taxable_amount' => 200.00,
                'tax_amount' => 24.00,
                'total_amount' => 224.00,
            ]],
        ]));

        $this->assertEqualsWithDelta(100.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEquals(0, $this->entries()->count());

        // The document itself is still kept: a bill the server cannot link is a bill to fix, not
        // a bill to lose.
        $this->assertDatabaseHas('invoices', ['store_id' => $this->store->id, 'invoice_number' => 'C01-INV-UNKNOWN']);
    }

    public function test_syncing_a_credit_note_broadcasts_the_batch_balance_other_counters_read(): void
    {
        $this->push($this->documentPayload([
            'module_key' => 'credit_note',
            'invoice_number' => 'SR-9004',
            'return_number' => 'SR-9004',
        ]));

        $event = \App\Models\SyncEvent::where('entity_type', 'stock_event')->latest('id')->first();
        $this->assertNotNull($event, 'a return that no other till hears about leaves every other shelf short');
        $this->assertEqualsWithDelta(102.0, (float) $event->client_data['remaining_stock'], 0.001);
        $this->assertEquals($this->batch->id, $event->client_data['batch_id']);
    }

    public function test_an_existing_live_bill_revised_through_the_queue_nets_only_the_change(): void
    {
        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'module_key' => 'invoice',
            'invoice_number' => 'C01-INV-7777',
            'invoice_date' => '2026-11-19',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'taxable_subtotal' => 200.00,
            'tax_total' => 24.00,
            'grand_total' => 224.00,
            'paid_amount' => 224.00,
            'status' => 'issued',
        ]);
        \App\Models\InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $this->product->id,
            'product_name' => $this->product->name,
            'batch_no' => 'BCH-SS-1',
            'qty' => 2,
            'units_per_pack' => 1,
            'unit_price' => 100.00,
            'gst_percent' => 12.00,
            'taxable_amount' => 200.00,
            'tax_amount' => 24.00,
            'total_amount' => 224.00,
        ]);

        // The two units this bill already took left the shelf when it was billed live.
        $this->batch->decrement('stock_qty', 2);
        $this->product->decrement('current_stock', 2);

        $this->push($this->documentPayload([
            'external_id' => 'ext_live_7777',
            'invoice_number' => 'C01-INV-7777',
            'is_revised' => 1,
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'BCH-SS-1',
                'qty' => 3,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 12.00,
                'taxable_amount' => 300.00,
                'tax_amount' => 36.00,
                'total_amount' => 336.00,
            ]],
            'taxable_subtotal' => 300.00,
            'tax_total' => 36.00,
            'cgst_total' => 18.00,
            'sgst_total' => 18.00,
            'grand_total' => 336.00,
            'paid_amount' => 336.00,
            'payments' => [['mode' => 'Cash', 'amount' => 336.00]],
        ]));

        $this->assertEqualsWithDelta(97.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEquals(1, $this->entries()->count(), 'the extra unit is the only movement');
        $this->assertEqualsWithDelta(-1.0, (float) $this->entries()->firstOrFail()->qty_delta, 0.001);
    }
}
