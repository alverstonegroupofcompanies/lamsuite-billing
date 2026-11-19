<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\InvoicePayment;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Offline till edits reach the server through the sync queue. A cancellation must not erase
 * the booked money, and a revision must leave a bill whose header, lines and tenders agree.
 */
class SyncInvoiceEditCancelTest extends TestCase
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
            'name' => 'Sync Edit Store',
            'code' => 'SYNCEDIT1',
            'tax_mode' => 'inclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => 'active',
            'device_uuid' => 'uuid_sync_edit_c01',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Sync Edit Tablet',
            'current_stock' => 100,
            'mrp' => 200.00,
            'sel_rate' => 200.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-SE-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'mrp' => 200.00,
            'selling_rate' => 200.00,
        ]);
    }

    /** A bill booked live, exactly as the till posts it (it always carries an idempotency key). */
    private function postLiveInvoice(int $packs = 1): Invoice
    {
        static $n = 0;
        $n++;
        $externalId = 'ext_sync_edit_' . $n;

        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'external_id' => $externalId,
                'idempotency_key' => $externalId,
                'customer_name' => 'Walk-in Customer',
                'payment_mode' => 'Cash',
                'items' => [[
                    'product_id' => $this->product->id,
                    'batch_id' => $this->batch->id,
                    'batch_no' => 'BCH-SE-1',
                    'qty' => $packs,
                    'units_per_pack' => 1,
                    'unit_price' => 200.00,
                    'gst_percent' => 12.00,
                ]],
            ]);

        $response->assertStatus(201);

        return Invoice::with(['items', 'payments'])->findOrFail($response->json('invoice.id'));
    }

    private function pushBatch(array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/sync/push/batch', [
            'items' => [[
                'entity_type' => 'invoice',
                'entity_id' => $payload['external_id'] ?? ($payload['id'] ?? null),
                'action' => 'update',
                'payload' => $payload,
            ]],
        ]);
    }

    private function revisionPayload(Invoice $invoice, array $overrides = []): array
    {
        return array_merge([
            'external_id' => $invoice->external_id,
            'invoice_number' => $invoice->invoice_number,
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'invoice_date' => $invoice->invoice_date->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            // 1 pack @200 revised down to a 100.00 bill: taxable 89.29, tax 10.71
            'taxable_subtotal' => 89.29,
            'tax_total' => 10.71,
            'cgst_total' => 5.36,
            'sgst_total' => 5.35,
            'round_off' => 0.00,
            'grand_total' => 100.00,
            'paid_amount' => 100.00,
            'is_revised' => 1,
            'payments' => [['mode' => 'Cash', 'amount' => 100.00]],
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => 'Sync Edit Tablet',
                'batch_no' => 'BCH-SE-1',
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'mrp' => 200.00,
                'gst_percent' => 12.00,
                'taxable_amount' => 89.29,
                'cgst_amount' => 5.36,
                'sgst_amount' => 5.35,
                'tax_amount' => 10.71,
                'total_amount' => 100.00,
            ]],
        ], $overrides);
    }

    public function test_cancelling_a_multi_unit_pack_line_restores_every_base_unit(): void
    {
        $box = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Sync Edit Box of 10',
            'current_stock' => 50,
            'mrp' => 120.00,
            'sel_rate' => 120.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 10,
            'is_active' => true,
        ]);
        $boxBatch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $box->id,
            'batch_no' => 'BCH-SE-BOX',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 50,
            'mrp' => 120.00,
            'selling_rate' => 120.00,
        ]);

        // 2 packs + 3 loose = 23 base units out of stock.
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'external_id' => 'ext_sync_edit_box_1',
                'idempotency_key' => 'ext_sync_edit_box_1',
                'customer_name' => 'Walk-in Customer',
                'payment_mode' => 'Cash',
                'items' => [[
                    'product_id' => $box->id,
                    'batch_id' => $boxBatch->id,
                    'batch_no' => 'BCH-SE-BOX',
                    'qty' => 2,
                    'loose_qty' => 3,
                    'units_per_pack' => 10,
                    'unit_price' => 120.00,
                    'gst_percent' => 12.00,
                ]],
            ]);
        $response->assertStatus(201);
        $invoice = Invoice::findOrFail($response->json('invoice.id'));

        $this->assertEqualsWithDelta(27.0, (float) $boxBatch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(23.0, 50.0 - (float) $box->fresh()->current_stock, 0.001);

        $this->pushBatch([
            'external_id' => $invoice->external_id,
            'invoice_number' => $invoice->invoice_number,
            'store_id' => $this->store->id,
            'status' => 'cancelled',
            'cancel_reason' => 'Cancelled at the till',
        ])->assertStatus(200);

        $this->assertEqualsWithDelta(50.0, (float) $boxBatch->fresh()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(50.0, (float) $box->fresh()->current_stock, 0.001);
    }

    public function test_status_only_sync_cancels_without_erasing_the_booked_money(): void
    {
        $invoice = $this->postLiveInvoice();
        $stockAfterSale = (float) $this->batch->fresh()->stock_qty;
        $this->assertSame(99.0, $stockAfterSale);

        $this->pushBatch([
            'id' => $invoice->external_id,
            'external_id' => $invoice->external_id,
            'invoice_number' => $invoice->invoice_number,
            'store_id' => $this->store->id,
            'status' => 'cancelled',
            'cancel_reason' => 'Wrong customer, cancelled at the till while offline',
        ])->assertStatus(200)->assertJson(['success' => true]);

        $invoice->refresh()->load(['items', 'payments']);

        // The bill must still show what was actually sold and collected.
        $this->assertSame('cancelled', $invoice->status);
        $this->assertEqualsWithDelta(178.57, (float) $invoice->taxable_subtotal, 0.01);
        $this->assertEqualsWithDelta(21.43, (float) $invoice->tax_total, 0.01);
        $this->assertEqualsWithDelta(200.00, (float) $invoice->grand_total, 0.01);
        $this->assertEqualsWithDelta(200.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('Wrong customer, cancelled at the till while offline', $invoice->cancel_reason);

        // A cancelled bill may not keep counted cash, and the stock has to come back.
        $this->assertSame('refunded', $invoice->payments[0]->status);
        $this->assertEqualsWithDelta(0.0, $invoice->payments->where('status', 'received')->sum('amount'), 0.01);
        $this->assertSame(100.0, (float) $this->batch->fresh()->stock_qty);
    }

    public function test_repeated_cancellation_sync_does_not_restore_stock_twice(): void
    {
        $invoice = $this->postLiveInvoice();

        $payload = [
            'external_id' => $invoice->external_id,
            'invoice_number' => $invoice->invoice_number,
            'store_id' => $this->store->id,
            'status' => 'cancelled',
            'cancel_reason' => 'cancelled twice over a flaky link',
        ];

        $this->pushBatch($payload)->assertStatus(200);
        $this->pushBatch($payload)->assertStatus(200);

        $this->assertSame(100.0, (float) $this->batch->fresh()->stock_qty);
        $this->assertSame(1, InvoicePayment::where('invoice_id', $invoice->id)->count());
    }

    public function test_revise_sync_rewrites_lines_and_tenders_to_the_new_total(): void
    {
        $invoice = $this->postLiveInvoice();

        $this->pushBatch($this->revisionPayload($invoice))->assertStatus(200)->assertJson(['success' => true]);

        $invoice->refresh()->load(['items', 'payments']);

        $this->assertEqualsWithDelta(89.29, (float) $invoice->taxable_subtotal, 0.01);
        $this->assertEqualsWithDelta(100.00, (float) $invoice->grand_total, 0.01);

        // Header must equal the sum of the lines it stores.
        $this->assertEqualsWithDelta((float) $invoice->taxable_subtotal, $invoice->items->sum('taxable_amount'), 0.01);
        $this->assertEqualsWithDelta((float) $invoice->tax_total, $invoice->items->sum('tax_amount'), 0.01);
        $this->assertGreaterThan(0.0, (float) $invoice->items->first()->taxable_amount);

        // The stale 200.00 tender is out, the 100.00 tender is in.
        $this->assertEqualsWithDelta(100.00, $invoice->payments->where('status', 'received')->sum('amount'), 0.01);
        $this->assertEqualsWithDelta(100.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame(1, $invoice->payments->where('status', 'refunded')->count());
    }

    public function test_resending_the_same_revision_does_not_duplicate_tenders(): void
    {
        $invoice = $this->postLiveInvoice();

        $this->pushBatch($this->revisionPayload($invoice))->assertStatus(200);
        $this->pushBatch($this->revisionPayload($invoice))->assertStatus(200);

        $invoice->refresh()->load('payments');

        $this->assertEqualsWithDelta(100.00, $invoice->payments->where('status', 'received')->sum('amount'), 0.01);
        $this->assertSame(1, InvoiceItem::where('invoice_id', $invoice->id)->count());
    }

    public function test_synced_document_update_keeps_the_counter_it_was_booked_on(): void
    {
        $invoice = $this->postLiveInvoice();
        $counterId = $invoice->counter_id;
        $this->assertNotNull($counterId);

        // The till keys its counter as a device string, not the server row id.
        $this->pushBatch($this->revisionPayload($invoice, ['counter_id' => 'cntr_57']))->assertStatus(200);

        $invoice->refresh();
        $this->assertSame($counterId, $invoice->counter_id);
        $this->assertSame('C01', $invoice->counter_code);
    }

    /**
     * A revision that carries no tender lines cannot prove it collected anything, so the cash
     * the counter already took (and its paid_amount) must survive untouched.
     */
    public function test_revision_without_tender_lines_does_not_fabricate_collected_cash(): void
    {
        $invoice = $this->postLiveInvoice();

        $payload = $this->revisionPayload($invoice);
        unset($payload['payments']);

        $this->pushBatch($payload)->assertStatus(200);
        $invoice->refresh()->load('payments');

        $this->assertEqualsWithDelta(100.00, (float) $invoice->grand_total, 0.01);
        $this->assertSame(0, $invoice->payments->where('status', 'refunded')->count());
        $this->assertEqualsWithDelta(200.00, $invoice->payments->where('status', 'received')->sum('amount'), 0.01);
        $this->assertEqualsWithDelta(200.00, (float) $invoice->paid_amount, 0.01);
    }

    /**
     * When a synced header contradicts its own lines, the lines win: they are what the counter
     * screen charged and what the GST returns are filed from. The mismatch is recorded.
     */
    public function test_header_that_contradicts_its_own_lines_is_booked_from_the_lines(): void
    {
        $staleHeader = $this->revisionPayload($this->postLiveInvoice());

        // Same lines, but a header left behind from the pre-edit bill.
        $payload = array_merge($staleHeader, [
            'external_id' => 'ext_sync_edit_stale_header',
            'invoice_number' => 'INV-STALE-HEADER',
            'taxable_subtotal' => 89.29,
            'tax_total' => 10.71,
            'cgst_total' => 5.36,
            'sgst_total' => 5.35,
            'grand_total' => 100.00,
            'paid_amount' => 100.00,
            'payments' => [['mode' => 'Cash', 'amount' => 100.00]],
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => 'Sync Edit Tablet',
                'batch_no' => 'BCH-SE-1',
                'qty' => 1,
                'units_per_pack' => 1,
                'unit_price' => 200.00,
                'gst_percent' => 12.00,
                'taxable_amount' => 178.57,
                'cgst_amount' => 8.93,
                'sgst_amount' => 8.92,
                'tax_amount' => 21.43,
                'total_amount' => 200.00,
            ]],
        ]);

        $this->postJson('/api/sync/push/invoices', ['invoices' => [$payload]])
            ->assertStatus(200)
            ->assertJson(['ingested_count' => 1, 'failed_count' => 0]);

        $invoice = Invoice::where('external_id', 'ext_sync_edit_stale_header')->firstOrFail();
        $invoice->load(['items', 'payments']);

        $this->assertEqualsWithDelta(200.00, (float) $invoice->grand_total, 0.01);
        $this->assertEqualsWithDelta(178.57, (float) $invoice->taxable_subtotal, 0.01);
        $this->assertEqualsWithDelta(21.43, (float) $invoice->tax_total, 0.01);

        // Header and lines agree, and the contradiction is visible to the Sync Center.
        $this->assertEqualsWithDelta((float) $invoice->taxable_subtotal, $invoice->items->sum('taxable_amount'), 0.01);
        $this->assertEqualsWithDelta((float) $invoice->tax_total, $invoice->items->sum('tax_amount'), 0.01);

        $event = \App\Models\SyncEvent::where('entity_type', 'invoice')
            ->where('entity_id', (string) $invoice->id)
            ->latest('id')
            ->firstOrFail();
        $this->assertArrayHasKey('recalculation', (array) $event->client_data);
    }

    public function test_revising_a_synced_bill_moves_only_the_stock_the_revision_changed(): void
    {
        $invoice = $this->postLiveInvoice(2);
        $this->assertSame(98.0, (float) $this->batch->fresh()->stock_qty);

        // 2 packs become 3, so exactly one further base unit leaves the shelf.
        $payload = $this->revisionPayload($invoice, [
            'taxable_subtotal' => 535.71,
            'tax_total' => 64.29,
            'cgst_total' => 32.15,
            'sgst_total' => 32.14,
            'grand_total' => 600.00,
            'paid_amount' => 600.00,
            'payments' => [['mode' => 'Cash', 'amount' => 600.00]],
            'items' => [[
                'product_id' => $this->product->id,
                'product_name' => 'Sync Edit Tablet',
                'batch_no' => 'BCH-SE-1',
                'qty' => 3,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'unit_price' => 200.00,
                'mrp' => 200.00,
                'gst_percent' => 12.00,
                'taxable_amount' => 535.71,
                'cgst_amount' => 32.15,
                'sgst_amount' => 32.14,
                'tax_amount' => 64.29,
                'total_amount' => 600.00,
            ]],
        ]);

        $this->pushBatch($payload)->assertStatus(200);

        $this->assertSame(97.0, (float) $this->batch->fresh()->stock_qty);
        $this->assertSame(97.0, (float) $this->product->fresh()->current_stock);
        $this->assertEqualsWithDelta(-3.0, $this->ledgerUnitsBooked($invoice), 0.001);

        // The same document arriving again nets nothing: no further movement, no drift.
        $this->pushBatch($payload)->assertStatus(200);

        $this->assertSame(97.0, (float) $this->batch->fresh()->stock_qty);
        $this->assertEqualsWithDelta(-3.0, $this->ledgerUnitsBooked($invoice), 0.001);
    }

    /** Net units this bill took out of stock, across every ledger row written for it. */
    private function ledgerUnitsBooked(Invoice $invoice): float
    {
        return (float) \App\Models\StockLedgerEntry::where('reference_type', 'INVOICE')
            ->where('reference_id', (string) $invoice->id)
            ->sum('qty_delta');
    }
}
