<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PAY-03: nobody owes money on a walk-in sale. A bill short of its total must be
 * refused, not filed as partially paid against a customer who does not exist.
 */
class WalkInSettlementTest extends TestCase
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
            'name' => 'Walk-in Store',
            'code' => 'WALKIN1',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'is_active' => true,
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => 'active',
            'device_uuid' => 'uuid_walkin_c01',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Walk-in Syrup',
            'current_stock' => 100,
            'mrp' => 90.00,
            'sel_rate' => 90.00,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-WI-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'mrp' => 90.00,
            'selling_rate' => 90.00,
        ]);
    }

    private function payload(float $tendered, array $overrides = []): array
    {
        static $n = 0;
        $n++;
        $externalId = 'ext_walkin_' . $n;

        return array_merge([
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'counter_code' => 'C01',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'payments' => [['mode' => 'Cash', 'amount' => $tendered]],
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'BCH-WI-1',
                'qty' => 1,
                'units_per_pack' => 1,
                'unit_price' => 90.00,
                'gst_percent' => 0.00,
            ]],
        ], $overrides);
    }

    private function postInvoice(array $payload)
    {
        return $this->withHeader('X-Store-Id', (string) $this->store->id)
            ->postJson('/api/invoices', $payload);
    }

    public function test_walk_in_invoice_with_balance_due_is_rejected(): void
    {
        $res = $this->postInvoice($this->payload(40.00));

        $res->assertStatus(422);
        $this->assertSame(0, Invoice::count());
    }

    public function test_walk_in_with_cash_change_is_accepted(): void
    {
        $res = $this->postInvoice($this->payload(500.00));
        $res->assertStatus(201);

        $invoice = Invoice::findOrFail($res->json('invoice.id'));
        $this->assertEqualsWithDelta(90.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('paid', $invoice->payment_status);
    }

    public function test_registered_customer_can_pay_partially(): void
    {
        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Registered Customer',
            'phone' => '9847000011',
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);

        $res = $this->postInvoice($this->payload(40.00, [
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
        ]));
        $res->assertStatus(201);

        $invoice = Invoice::findOrFail($res->json('invoice.id'));
        $this->assertEqualsWithDelta(40.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('partially_paid', $invoice->payment_status);
    }

    /**
     * A till already refuses an unsettled walk-in bill at the counter, so one that
     * arrives through sync came from an older or altered till, and its goods and
     * money have already moved. Refusing it would lose the sale from the books;
     * it is booked as it happened and flagged for the owner instead.
     */
    public function test_sync_books_underpaid_walk_in_and_flags_it(): void
    {
        $payload = $this->payload(40.00, [
            'store_id' => $this->store->id,
            'invoice_number' => 'WALKIN-SYNC-1',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 90.00,
            'paid_amount' => 40.00,
        ]);

        $this->postJson('/api/sync/push/batch', [
            'items' => [[
                'entity_type' => 'invoice',
                'entity_id' => $payload['external_id'],
                'action' => 'create',
                'payload' => $payload,
            ]],
        ])->assertStatus(200)->assertJson([
            'success' => true,
            'results' => ['failed' => 0],
        ]);

        $invoice = Invoice::where('external_id', $payload['external_id'])->firstOrFail();
        $this->assertEqualsWithDelta(40.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('partially_paid', $invoice->payment_status);

        $this->assertDatabaseHas('notifications', [
            'store_id' => $this->store->id,
            'type' => 'offline_payment_policy',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'offline_bill_policy_exception',
            'entity_id' => (string) $invoice->id,
        ]);
    }
}
