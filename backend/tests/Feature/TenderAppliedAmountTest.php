<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PAY-02: ₹500 handed over for a ₹210 bill is a ₹210 payment and ₹290 change,
 * not a ₹210 bill that collected ₹500.
 */
class TenderAppliedAmountTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $product;
    private ProductBatch $batch;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Tender Store',
            'code' => 'TENDER1',
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
            'device_uuid' => 'uuid_tender_c01',
        ]);

        $this->admin = User::create([
            'store_id' => $this->store->id,
            'name' => 'Tender Admin',
            'email' => 'tender.admin@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Tender Tablet',
            'current_stock' => 100,
            'mrp' => 200.00,
            'sel_rate' => 187.50,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-TD-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'mrp' => 200.00,
            'selling_rate' => 187.50,
        ]);
    }

    private function payload(array $payments, array $overrides = []): array
    {
        static $n = 0;
        $n++;
        $externalId = 'ext_tender_' . $n;

        return array_merge([
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'counter_code' => 'C01',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'payments' => $payments,
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'BCH-TD-1',
                'qty' => 1,
                'units_per_pack' => 1,
                'unit_price' => 187.50,
                'gst_percent' => 12.00,
            ]],
        ], $overrides);
    }

    private function postInvoice(array $payload)
    {
        return $this->withHeader('X-Store-Id', (string) $this->store->id)
            ->postJson('/api/invoices', $payload);
    }

    public function test_cash_tender_above_bill_stores_applied_amount_and_change(): void
    {
        $res = $this->postInvoice($this->payload([['mode' => 'Cash', 'amount' => 500.00]]));
        $res->assertStatus(201);

        $invoice = Invoice::with('payments')->findOrFail($res->json('invoice.id'));
        $this->assertEqualsWithDelta(210.00, (float) $invoice->grand_total, 0.01);
        $this->assertEqualsWithDelta(210.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('paid', $invoice->payment_status);

        $row = $invoice->payments->firstOrFail();
        $this->assertEqualsWithDelta(210.00, (float) $row->amount, 0.01);
        $this->assertEqualsWithDelta(500.00, (float) $row->tendered_amount, 0.01);
        $this->assertEqualsWithDelta(290.00, (float) $row->change_amount, 0.01);

        $collection = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/admin/reports/daily-collection?start_date=' . now()->toDateString() . '&end_date=' . now()->toDateString());
        $collection->assertStatus(200);
        $this->assertEqualsWithDelta(210.00, (float) $collection->json('by_tender.Cash'), 0.01);
    }

    public function test_explicit_applied_and_tendered_lines_are_preserved(): void
    {
        $res = $this->postInvoice($this->payload([[
            'mode' => 'Cash',
            'amount' => 210.00,
            'tendered_amount' => 500.00,
            'change_amount' => 290.00,
        ]]));
        $res->assertStatus(201);

        $invoice = Invoice::with('payments')->findOrFail($res->json('invoice.id'));
        $this->assertEqualsWithDelta(210.00, (float) $invoice->paid_amount, 0.01);

        $row = $invoice->payments->firstOrFail();
        $this->assertEqualsWithDelta(210.00, (float) $row->amount, 0.01);
        $this->assertEqualsWithDelta(500.00, (float) $row->tendered_amount, 0.01);
        $this->assertEqualsWithDelta(290.00, (float) $row->change_amount, 0.01);
    }

    public function test_non_cash_overpayment_is_rejected(): void
    {
        $res = $this->postInvoice($this->payload([[
            'mode' => 'UPI',
            'amount' => 500.00,
            'reference_no' => 'UTR-OVERPAY-1',
        ]]));

        $res->assertStatus(422);
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, InvoicePayment::count());
    }

    public function test_offline_sync_caps_legacy_cash_tender(): void
    {
        $payload = $this->payload([['mode' => 'Cash', 'amount' => 500.00]], [
            'store_id' => $this->store->id,
            'invoice_number' => 'TENDER-SYNC-1',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 210.00,
            'paid_amount' => 500.00,
        ]);

        $this->postJson('/api/sync/push/batch', [
            'items' => [[
                'entity_type' => 'invoice',
                'entity_id' => $payload['external_id'],
                'action' => 'create',
                'payload' => $payload,
            ]],
        ])->assertStatus(200)->assertJson(['success' => true]);

        $invoice = Invoice::with('payments')->where('external_id', $payload['external_id'])->firstOrFail();
        $this->assertEqualsWithDelta(210.00, (float) $invoice->paid_amount, 0.01);

        $row = $invoice->payments->firstOrFail();
        $this->assertEqualsWithDelta(210.00, (float) $row->amount, 0.01);
        $this->assertEqualsWithDelta(500.00, (float) $row->tendered_amount, 0.01);
        $this->assertEqualsWithDelta(290.00, (float) $row->change_amount, 0.01);
    }
}
