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
 * A purchase return is the one document that takes goods back to the supplier, and until it is
 * ingested the server's book keeps stock the store no longer has. These tests push the record the
 * till queues — its own return number, a reference to the inward bill and a `lines` array counted
 * in units — and check the document, the batch stock and the ledger follow.
 */
class SyncPurchaseReturnIngestTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $syrup;
    private Party $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Return Ingest Store',
            'code' => 'RTINGEST1',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->syrup = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Return Syrup',
            'current_stock' => 0,
            'mrp' => 215.00,
            'sel_rate' => 200.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Return Supplier Pvt Ltd',
            'gstin' => '32AAAAA2222CC2Z9',
            'is_active' => true,
        ]);

        // Three units arrive first: a return can only be judged against a bill that put stock in.
        $this->postJson('/api/sync/push/purchases', ['purchases' => [[
            'id' => 'pur_rtingest_1',
            'purchase_number' => 'QA-PUR-RT-0001',
            'supplier_invoice_no' => 'SUP-RT-0001',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'purchase_date' => '2026-11-19',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'subtotal' => 600,
            'tax_total' => 72,
            'grand_total' => 672,
            'status' => 'received',
            'items' => [[
                'product_id' => (string) $this->syrup->id,
                'product_name' => $this->syrup->name,
                'batch_no' => 'BCH-RT-1',
                'expiry_date' => '2027-12-31',
                'pack_qty' => 3,
                'units_per_pack' => 1,
                'purchase_rate' => 200,
                'mrp' => 215,
                'gst_percent' => 12,
                'taxable_amount' => 600,
                'tax_amount' => 72,
                'total_amount' => 672,
            ]],
        ]]])->assertStatus(200);
    }

    /**
     * Push what purchaseReturnService queues, header and lines intact.
     */
    private function pushReturn(array $overrides = [], array $lines = []): \Illuminate\Testing\TestResponse
    {
        $payload = array_merge([
            'id' => 'pr_rtingest_1',
            'return_number' => 'PR-RT-0001',
            'return_date' => '2026-11-20',
            'original_purchase_id' => 'pur_rtingest_1',
            'original_purchase_number' => 'QA-PUR-RT-0001',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'supplier_invoice_no' => 'SUP-RT-0001',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase_return',
            'subtotal' => 400,
            'tax_total' => 48,
            'round_off' => 0,
            'grand_total' => 448,
            'settlement_type' => 'credit_adjust',
            'status' => 'completed',
            'notes' => '',
            'lines' => [[
                'product_id' => (string) $this->syrup->id,
                'product_name' => $this->syrup->name,
                'batch_no' => 'BCH-RT-1',
                'expiry_date' => '2027-12-31',
                'hsn_code' => '30049099',
                'purchased_qty' => 3,
                'return_qty' => 2,
                'purchase_rate' => 200,
                'gst_percent' => 12,
                'taxable_amount' => 400,
                'cgst_amount' => 24,
                'sgst_amount' => 24,
                'igst_amount' => 0,
                'cess_amount' => 0,
                'tax_amount' => 48,
                'total_amount' => 448,
            ]],
        ], $overrides, $lines);

        return $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/purchases', ['purchases' => [$payload]]);
    }

    private function inward(): Purchase
    {
        return Purchase::where('store_id', $this->store->id)
            ->where('invoice_number', 'SUP-RT-0001')
            ->firstOrFail();
    }

    private function returned(): Purchase
    {
        return Purchase::where('store_id', $this->store->id)
            ->where('invoice_number', 'PR-RT-0001')
            ->firstOrFail();
    }

    private function batch(): ProductBatch
    {
        return ProductBatch::where('store_id', $this->store->id)
            ->where('product_id', $this->syrup->id)
            ->where('batch_no', 'BCH-RT-1')
            ->firstOrFail();
    }

    public function test_return_lands_as_its_own_document_and_takes_the_units_back(): void
    {
        $this->pushReturn()->assertStatus(200)->assertJson(['ingested_count' => 1]);

        $return = $this->returned();
        $this->assertEquals('purchase_return', $return->module_key);
        $this->assertEquals($this->supplier->id, $return->supplier_id);
        $this->assertEquals('completed', $return->status);
        $this->assertEqualsWithDelta(448.0, (float) $return->grand_total, 0.001);

        $this->assertEqualsWithDelta(1.0, (float) $this->batch()->stock_qty, 0.001, 'two of the three units went back to the supplier');
        $this->assertEqualsWithDelta(1.0, (float) $this->syrup->fresh()->current_stock, 0.001);

        $entry = StockLedgerEntry::where('reference_type', 'PURCHASE_RETURN')
            ->where('reference_id', (string) $return->id)
            ->where('event_type', 'PURCHASE_RETURN')
            ->first();
        $this->assertNotNull($entry, 'a debit note has to leave its own mark in the ledger');
        $this->assertEqualsWithDelta(-2.0, (float) $entry->qty_delta, 0.001);
    }

    public function test_return_never_rewrites_the_inward_bill_it_references(): void
    {
        $this->pushReturn();

        $inward = $this->inward();
        $this->assertEquals('purchase', $inward->module_key);
        $this->assertEquals('received', $inward->status);
        $this->assertEqualsWithDelta(672.0, (float) $inward->grand_total, 0.001);
        $this->assertEqualsWithDelta(3.0, (float) $inward->items()->firstOrFail()->qty, 0.001);
    }

    public function test_repushing_the_same_return_moves_stock_once(): void
    {
        $this->pushReturn();
        $first = $this->returned()->id;
        $this->pushReturn();

        $this->assertEquals($first, $this->returned()->id, 'the same debit note re-pushed must not become a second document');
        $this->assertEqualsWithDelta(1.0, (float) $this->batch()->stock_qty, 0.001);
        $this->assertEquals(1, StockLedgerEntry::where('reference_type', 'PURCHASE_RETURN')->count());
    }

    public function test_editing_a_return_moves_only_the_difference(): void
    {
        $this->pushReturn();

        $this->pushReturn([], ['lines' => [[
            'product_id' => (string) $this->syrup->id,
            'product_name' => $this->syrup->name,
            'batch_no' => 'BCH-RT-1',
            'expiry_date' => '2027-12-31',
            'purchased_qty' => 3,
            'return_qty' => 1,
            'purchase_rate' => 200,
            'gst_percent' => 12,
            'taxable_amount' => 200,
            'tax_amount' => 24,
        ]]]);

        $this->assertEqualsWithDelta(2.0, (float) $this->batch()->stock_qty, 0.001, 'the second unit the till gave up comes back');
        $entries = StockLedgerEntry::where('reference_type', 'PURCHASE_RETURN')->orderBy('id')->get();
        $this->assertSame([-2.0, 1.0], $entries->map(fn ($e) => (float) $e->qty_delta)->all());
    }

    public function test_cancelling_a_return_gives_every_unit_back(): void
    {
        $this->pushReturn();
        $this->pushReturn(['status' => 'cancelled', 'cancel_reason' => 'wrong supplier']);

        $this->assertEquals('cancelled', $this->returned()->status);
        $this->assertEquals('wrong supplier', $this->returned()->cancel_reason);
        $this->assertEqualsWithDelta(3.0, (float) $this->batch()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(3.0, (float) $this->syrup->fresh()->current_stock, 0.001);

        // A cancelled note pushed again is a no-op, not a second restock.
        $this->pushReturn(['status' => 'cancelled', 'cancel_reason' => 'wrong supplier']);
        $this->assertEqualsWithDelta(3.0, (float) $this->batch()->stock_qty, 0.001);

        $events = StockLedgerEntry::where('reference_type', 'PURCHASE_RETURN')->pluck('event_type')->all();
        $this->assertContains('PURCHASE_RETURN', $events);
        $this->assertContains('PURCHASE_RETURN_CANCEL', $events);
    }

    public function test_return_line_is_priced_by_unit_and_linked_to_the_product(): void
    {
        $this->pushReturn();

        $line = $this->returned()->items()->firstOrFail();
        $this->assertEquals($this->syrup->id, $line->product_id);
        $this->assertEqualsWithDelta(2.0, (float) $line->qty, 0.001);
        $this->assertEqualsWithDelta(1.0, (float) $line->units_per_pack, 0.001, 'a returned unit is not a pack of it');
        $this->assertEqualsWithDelta(200.0, (float) $line->purchase_rate, 0.001);
        $this->assertEquals('BCH-RT-1', $line->batch_no);
        $this->assertEqualsWithDelta(400.0, (float) $line->taxable_amount, 0.001);
    }

    public function test_a_debit_note_line_that_only_carries_the_split_still_records_its_tax(): void
    {
        $this->pushReturn([], ['lines' => [[
            'product_id' => (string) $this->syrup->id,
            'product_name' => $this->syrup->name,
            'batch_no' => 'BCH-RT-1',
            'return_qty' => 2,
            'purchase_rate' => 200,
            'gst_percent' => 12,
            'taxable_amount' => 400,
            'cgst_amount' => 24,
            'sgst_amount' => 24,
            'total_amount' => 448,
        ]]]);

        $line = $this->returned()->items()->firstOrFail();
        $this->assertEqualsWithDelta(48.0, (float) $line->tax_amount, 0.001, 'the split has to add up to the line tax');
    }

    public function test_return_keeps_a_link_to_the_inward_bill(): void
    {
        $this->pushReturn();
        $this->assertStringContainsString('QA-PUR-RT-0001', (string) $this->returned()->notes);

        $this->pushReturn(['notes' => 'Cold chain broken']);
        $notes = (string) $this->returned()->notes;
        $this->assertStringContainsString('Cold chain broken', $notes);
        $this->assertStringContainsString('QA-PUR-RT-0001', $notes);
    }

    public function test_return_of_a_batch_the_server_never_saw_records_the_document_without_a_phantom_batch(): void
    {
        $this->pushReturn([], ['lines' => [[
            'product_id' => (string) $this->syrup->id,
            'product_name' => $this->syrup->name,
            'batch_no' => 'BCH-RT-GHOST',
            'return_qty' => 1,
            'purchase_rate' => 200,
            'gst_percent' => 12,
            'taxable_amount' => 200,
        ]]]);

        $this->assertNotNull($this->returned()->items()->firstOrFail());
        $this->assertNull(
            ProductBatch::where('batch_no', 'BCH-RT-GHOST')->first(),
            'a return must not invent a batch to hang a negative stock on'
        );
        $this->assertEqualsWithDelta(2.0, (float) $this->syrup->fresh()->current_stock, 0.001);
    }

    public function test_a_return_without_a_module_key_is_still_read_as_a_return(): void
    {
        // The wizard's record carries no module_key; the reference to an inward bill is enough.
        $this->pushReturn(['module_key' => null])->assertStatus(200);

        $this->assertEquals('purchase_return', $this->returned()->module_key);
        $this->assertEqualsWithDelta(1.0, (float) $this->batch()->stock_qty, 0.001);
    }

    public function test_an_inward_pushed_after_a_return_is_not_mistaken_for_one(): void
    {
        $this->pushReturn();

        $this->postJson('/api/sync/push/purchases', ['purchases' => [[
            'id' => 'pur_rtingest_2',
            'supplier_invoice_no' => 'SUP-RT-0002',
            'purchase_date' => '2026-11-21',
            'store_id' => (string) $this->store->id,
            'grand_total' => 200,
            'subtotal' => 200,
            'status' => 'received',
            'items' => [[
                'product_id' => (string) $this->syrup->id,
                'product_name' => $this->syrup->name,
                'batch_no' => 'BCH-RT-2',
                'pack_qty' => 1,
                'units_per_pack' => 1,
                'purchase_rate' => 200,
                'taxable_amount' => 200,
            ]],
        ]]])->assertStatus(200);

        $second = Purchase::where('store_id', $this->store->id)->where('invoice_number', 'SUP-RT-0002')->firstOrFail();
        $this->assertEquals('purchase', $second->module_key);
        $this->assertEqualsWithDelta(1.0, (float) $second->items()->firstOrFail()->qty, 0.001);
        $this->assertEquals(
            0,
            StockLedgerEntry::where('reference_type', 'PURCHASE')->where('event_type', 'PURCHASE_RETURN')->count(),
            'an inward is never booked as a return'
        );
        $this->assertEqualsWithDelta(1.0, (float) $this->batch()->stock_qty, 0.001, 'only the debit note touches that batch');
    }
}
