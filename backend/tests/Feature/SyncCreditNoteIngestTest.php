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
 * The sales return wizard mirrors its return as a credit note in the till's own invoices table —
 * that mirror is what GSTR-1 and the tax summaries read, so it is also what the cloud has to
 * hold. Pushing the raw return record instead left the server with a zero-line bill whose tax was
 * re-derived from nothing, and cancelling it was never sent at all.
 */
class SyncCreditNoteIngestTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateDevice::class);

        $this->store = Store::create([
            'name' => 'Credit Note Store',
            'code' => 'CRTNOTE1',
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
            'device_uuid' => 'uuid_crt_note_c01',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Returned Tablet',
            'current_stock' => 40,
            'mrp' => 120.00,
            'sel_rate' => 100.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-CN-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 40,
            'mrp' => 120.00,
            'selling_rate' => 100.00,
        ]);
    }

    private function push(array $payload, string $action = 'create'): void
    {
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/batch', [
                'items' => [[
                    'entity_type' => 'invoice',
                    'entity_id' => $payload['id'],
                    'action' => $action,
                    'payload' => $payload,
                ]],
            ])->assertStatus(200);
    }

    /**
     * Exactly what salesReturnService queues: the mirrored credit note header plus its lines.
     * 2 units back at Rs 100.00 exclusive: taxable 200.00, tax 24.00, total 224.00.
     */
    private function creditNote(array $overrides = []): array
    {
        return array_merge([
            'id' => 'sr_wizard_1',
            'module_key' => 'credit_note',
            'invoice_number' => 'SR-0001',
            'invoice_date' => '2026-11-19',
            'customer_name' => 'Return Customer',
            'customer_gstin' => null,
            'place_of_supply' => '32',
            'subtotal' => 200.00,
            'taxable_subtotal' => 200.00,
            'discount_total' => 0.00,
            'tax_total' => 24.00,
            'cgst_total' => 12.00,
            'sgst_total' => 12.00,
            'igst_total' => 0.00,
            'cess_total' => 0.00,
            'round_off' => 0.00,
            'grand_total' => 224.00,
            'paid_amount' => 224.00,
            'payment_mode' => 'Cash',
            'status' => 'issued',
            'original_invoice_number' => 'C01-INV-ORIG',
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'hsn_code' => '30049099',
                'batch_no' => 'BCH-CN-1',
                'expiry_date' => '2027-12-31',
                'qty' => 2,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'discount_percent' => 0,
                'discount_amount' => 0,
                'gst_percent' => 12,
                'taxable_amount' => 200.00,
                'cgst_amount' => 12.00,
                'sgst_amount' => 12.00,
                'igst_amount' => 0.00,
                'tax_amount' => 24.00,
                'total_amount' => 224.00,
            ]],
        ], $overrides);
    }

    private function note(): Invoice
    {
        return Invoice::where('store_id', $this->store->id)
            ->where('invoice_number', 'SR-0001')
            ->firstOrFail();
    }

    public function test_the_wizard_credit_note_is_stored_as_a_credit_note_with_its_lines(): void
    {
        $this->push($this->creditNote());

        $note = $this->note();
        $this->assertEquals('credit_note', $note->module_key);
        $this->assertEquals('issued', $note->status);
        $this->assertEquals('C01-INV-ORIG', $note->original_invoice_number);

        $lines = $note->items;
        $this->assertCount(1, $lines, 'a credit note without lines cannot be reconciled with the bill it credits');
        $this->assertEquals($this->product->id, $lines[0]->product_id);
        $this->assertEqualsWithDelta(2.0, (float) $lines[0]->qty, 0.001);

        // The server re-prices from its own engine; 12% on 200.00 is what the till booked.
        $this->assertEqualsWithDelta(200.00, (float) $note->taxable_subtotal, 0.001);
        $this->assertEqualsWithDelta(24.00, (float) $note->tax_total, 0.001);
        $this->assertEqualsWithDelta(12.00, (float) $note->cgst_total, 0.001);
        $this->assertEqualsWithDelta(12.00, (float) $note->sgst_total, 0.001);
        $this->assertEqualsWithDelta(224.00, (float) $note->grand_total, 0.001);
        $this->assertEqualsWithDelta(24.00, (float) $lines[0]->tax_amount, 0.001);
    }

    public function test_a_credit_note_puts_its_units_back_on_the_shelf(): void
    {
        $this->push($this->creditNote());

        $this->assertEqualsWithDelta(42.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(42.0, (float) $this->product->fresh()->current_stock, 0.001);

        $entry = StockLedgerEntry::where('reference_type', 'INVOICE')
            ->where('reference_id', (string) $this->note()->id)
            ->where('event_type', 'SALES_RETURN')
            ->first();
        $this->assertNotNull($entry, 'the restock has to be written under the credit note, not the sale');
        $this->assertEqualsWithDelta(2.0, (float) $entry->qty_delta, 0.001);
    }

    public function test_repushing_the_same_credit_note_neither_double_count_nor_rewrites_it(): void
    {
        $this->push($this->creditNote());
        $first = $this->note()->id;
        $this->push($this->creditNote());

        $this->assertEquals($first, $this->note()->id);
        $this->assertCount(1, $this->note()->items);
        $this->assertEqualsWithDelta(42.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEquals(1, StockLedgerEntry::where('event_type', 'SALES_RETURN')->count());
    }

    public function test_a_credit_note_never_touches_the_bill_it_credits(): void
    {
        $this->push([
            'id' => 'bill_orig_1',
            'module_key' => 'invoice',
            'invoice_number' => 'C01-INV-ORIG',
            'invoice_date' => '2026-11-18',
            'customer_name' => 'Return Customer',
            'taxable_subtotal' => 500.00,
            'tax_total' => 60.00,
            'grand_total' => 560.00,
            'paid_amount' => 560.00,
            'payment_mode' => 'Cash',
            'status' => 'issued',
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'BCH-CN-1',
                'qty' => 5,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 12,
            ]],
        ]);
        $before = Invoice::where('invoice_number', 'C01-INV-ORIG')->firstOrFail();
        $this->assertEqualsWithDelta(35.0, (float) $this->batch->fresh()->stock_qty, 0.001);

        $this->push($this->creditNote());

        $after = $before->fresh();
        $this->assertEquals('invoice', $after->module_key);
        $this->assertEqualsWithDelta(560.00, (float) $after->grand_total, 0.001);
        $this->assertCount(1, $after->items);
        $this->assertEqualsWithDelta(37.0, (float) $this->batch->fresh()->stock_qty, 0.001, 'the note adds two units of its own');
        $this->assertEquals(2, Invoice::where('store_id', $this->store->id)->count());
    }

    public function test_cancelling_a_credit_note_takes_the_units_back_off_the_shelf(): void
    {
        $this->push($this->creditNote());
        $this->assertEqualsWithDelta(42.0, (float) $this->batch->fresh()->stock_qty, 0.001);

        // cancelSalesReturn queues a header only: money and lines must survive untouched.
        $this->push([
            'id' => 'sr_wizard_1',
            'invoice_number' => 'SR-0001',
            'status' => 'cancelled',
            'cancel_reason' => 'Return entered against the wrong bill',
        ], 'update');

        $note = $this->note();
        $this->assertEquals('cancelled', $note->status);
        $this->assertEquals('Return entered against the wrong bill', $note->cancel_reason);
        $this->assertEqualsWithDelta(224.00, (float) $note->grand_total, 0.001, 'a cancellation may not erase the booked money');
        $this->assertCount(1, $note->items, 'a cancellation may not delete the lines');

        $this->assertEqualsWithDelta(40.0, (float) $this->batch->fresh()->stock_qty, 0.001, 'voiding a restock has to take the units off again');
        $this->assertEqualsWithDelta(40.0, (float) $this->product->fresh()->current_stock, 0.001);

        $cancel = StockLedgerEntry::where('event_type', 'CREDIT_NOTE_CANCEL')->first();
        $this->assertNotNull($cancel);
        $this->assertEqualsWithDelta(-2.0, (float) $cancel->qty_delta, 0.001);
    }

    public function test_cancelling_a_sale_still_restores_stock(): void
    {
        $this->push([
            'id' => 'bill_plain_1',
            'invoice_number' => 'C01-INV-PLAIN',
            'invoice_date' => '2026-11-19',
            'customer_name' => 'Walk-in Customer',
            'taxable_subtotal' => 200.00,
            'tax_total' => 24.00,
            'grand_total' => 224.00,
            'paid_amount' => 224.00,
            'payment_mode' => 'Cash',
            'status' => 'issued',
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'BCH-CN-1',
                'qty' => 2,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 12,
            ]],
        ]);
        $this->assertEqualsWithDelta(38.0, (float) $this->batch->fresh()->stock_qty, 0.001);

        $this->push([
            'id' => 'bill_plain_1',
            'invoice_number' => 'C01-INV-PLAIN',
            'status' => 'cancelled',
            'cancel_reason' => 'Customer walked away',
        ], 'update');

        $this->assertEqualsWithDelta(40.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertNotNull(StockLedgerEntry::where('event_type', 'CANCEL_RESTORE')->first());
        $this->assertNull(StockLedgerEntry::where('event_type', 'CREDIT_NOTE_CANCEL')->first());
    }

    public function test_an_older_return_push_without_a_module_key_is_not_booked_as_a_sale(): void
    {
        // Returns queued before the mirror existed carried a return number and no module_key.
        $this->push($this->creditNote([
            'module_key' => null,
            'return_number' => 'SR-0001',
            'status' => 'completed',
        ]));

        $note = $this->note();
        $this->assertEquals('credit_note', $note->module_key, 'a document that puts stock back is a credit note');
        $this->assertEqualsWithDelta(42.0, (float) $this->batch->fresh()->stock_qty, 0.001, 'never a second sale');
    }

    public function test_a_credit_note_edit_moves_only_the_difference(): void
    {
        $this->push($this->creditNote());

        $this->push($this->creditNote([
            'taxable_subtotal' => 100.00,
            'tax_total' => 12.00,
            'cgst_total' => 6.00,
            'sgst_total' => 6.00,
            'grand_total' => 112.00,
            'paid_amount' => 112.00,
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'BCH-CN-1',
                'qty' => 1,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 12,
            ]],
        ]));

        $this->assertEqualsWithDelta(41.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(1.0, (float) $this->note()->items()->firstOrFail()->qty, 0.001);
        $this->assertEqualsWithDelta(112.00, (float) $this->note()->grand_total, 0.001);
    }

    /**
     * One unit went back on the shelf and one was thrown away, which is what the till's own
     * stock ledger says; the credit note still covers both.
     */
    private function mixedNote(array $overrides = []): array
    {
        return $this->creditNote(array_merge([
            'id' => 'sr_wizard_mixed',
            'invoice_number' => 'SR-0002',
            'items' => [
                [
                    'product_id' => $this->product->id,
                    'product_name' => $this->product->name,
                    'batch_no' => 'BCH-CN-1',
                    'qty' => 1,
                    'units_per_pack' => 1,
                    'unit_price' => 100.00,
                    'gst_percent' => 12,
                    'taxable_amount' => 100.00,
                    'cgst_amount' => 6.00,
                    'sgst_amount' => 6.00,
                    'tax_amount' => 12.00,
                    'total_amount' => 112.00,
                    'stock_action' => 'restock',
                ],
                [
                    'product_id' => $this->product->id,
                    'product_name' => $this->product->name,
                    'batch_no' => 'BCH-CN-1',
                    'qty' => 1,
                    'units_per_pack' => 1,
                    'unit_price' => 100.00,
                    'gst_percent' => 12,
                    'taxable_amount' => 100.00,
                    'cgst_amount' => 6.00,
                    'sgst_amount' => 6.00,
                    'tax_amount' => 12.00,
                    'total_amount' => 112.00,
                    'stock_action' => 'damaged_discard',
                ],
            ],
        ], $overrides));
    }

    private function mixedNoteInvoice(): Invoice
    {
        return Invoice::where('store_id', $this->store->id)
            ->where('invoice_number', 'SR-0002')
            ->firstOrFail();
    }

    public function test_a_discarded_return_line_is_credited_but_never_restocked(): void
    {
        $this->push($this->mixedNote());

        $note = $this->mixedNoteInvoice();
        $this->assertCount(2, $note->items, 'a discarded line still belongs on the credit note');
        $this->assertEqualsWithDelta(200.00, (float) $note->taxable_subtotal, 0.001);
        $this->assertEqualsWithDelta(224.00, (float) $note->grand_total, 0.001);
        $this->assertEquals('damaged_discard', $note->items[1]->stock_action);

        $this->assertEqualsWithDelta(41.0, (float) $this->batch->fresh()->stock_qty, 0.001, 'only the restocked line came back');
        $this->assertEqualsWithDelta(41.0, (float) $this->product->fresh()->current_stock, 0.001);

        $entries = StockLedgerEntry::where('reference_type', 'INVOICE')
            ->where('reference_id', (string) $note->id)
            ->get();
        $this->assertEqualsWithDelta(1.0, (float) $entries->sum('qty_delta'), 0.001);
    }

    public function test_voiding_a_mixed_note_moves_only_the_units_it_ever_put_back(): void
    {
        $this->push($this->mixedNote());
        $this->assertEqualsWithDelta(41.0, (float) $this->batch->fresh()->stock_qty, 0.001);

        $this->push([
            'id' => 'sr_wizard_mixed',
            'invoice_number' => 'SR-0002',
            'status' => 'cancelled',
            'cancel_reason' => 'Both lines booked in error',
        ], 'update');

        $this->assertEqualsWithDelta(40.0, (float) $this->batch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(40.0, (float) $this->product->fresh()->current_stock, 0.001);

        $cancel = StockLedgerEntry::where('event_type', 'CREDIT_NOTE_CANCEL')->firstOrFail();
        $this->assertEqualsWithDelta(-1.0, (float) $cancel->qty_delta, 0.001);
    }
}
