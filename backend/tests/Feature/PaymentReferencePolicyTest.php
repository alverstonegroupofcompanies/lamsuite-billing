<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PAY-04: the till has always carried a per-mode reference rule, but the server
 * never applied it, so an unreconcilable UPI/card payment was banked silently.
 */
class PaymentReferencePolicyTest extends TestCase
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
            'name' => 'Reference Store',
            'code' => 'REF1',
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
            'device_uuid' => 'uuid_ref_c01',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Reference Tablet',
            'current_stock' => 100,
            'mrp' => 187.50,
            'sel_rate' => 187.50,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-RF-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'mrp' => 187.50,
            'selling_rate' => 187.50,
        ]);
    }

    private function payload(string $mode, ?string $reference): array
    {
        static $n = 0;
        $n++;
        $externalId = 'ext_ref_' . $n;

        $line = ['mode' => $mode, 'amount' => 210.00];
        if ($reference !== null) {
            $line['reference_no'] = $reference;
        }

        return [
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'counter_code' => 'C01',
            'customer_name' => 'Walk-in Customer',
            'payments' => [$line],
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'BCH-RF-1',
                'qty' => 1,
                'units_per_pack' => 1,
                'unit_price' => 187.50,
                'gst_percent' => 12.00,
            ]],
        ];
    }

    private function postInvoice(array $payload)
    {
        return $this->withHeader('X-Store-Id', (string) $this->store->id)
            ->postJson('/api/invoices', $payload);
    }

    public function test_default_policy_requires_upi_reference(): void
    {
        $this->postInvoice($this->payload('UPI', null))->assertStatus(422);
        $this->assertSame(0, Invoice::count());
    }

    public function test_default_policy_requires_card_reference(): void
    {
        $this->postInvoice($this->payload('Card', null))->assertStatus(422);
        $this->assertSame(0, Invoice::count());
    }

    public function test_cash_payment_needs_no_reference(): void
    {
        $this->postInvoice($this->payload('Cash', null))->assertStatus(201);

        $invoice = Invoice::findOrFail(Invoice::max('id'));
        $this->assertSame('paid', $invoice->payment_status);
    }

    public function test_reference_min_length_is_enforced(): void
    {
        $this->postInvoice($this->payload('UPI', 'A1B2C'))->assertStatus(422);
        $this->assertSame(0, Invoice::count());
    }

    public function test_duplicate_blocked_reference_is_rejected(): void
    {
        $this->postInvoice($this->payload('Cheque', '123456'))->assertStatus(201);

        $this->postInvoice($this->payload('Cheque', '123456'))->assertStatus(422);
        $this->assertSame(1, Invoice::count());
    }

    public function test_store_can_configure_upi_reference_as_optional(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'payments',
            'value' => ['modes' => [
                ['id' => 'cash', 'name' => 'Cash', 'referenceRequirement' => 'off'],
                ['id' => 'upi', 'name' => 'UPI', 'referenceRequirement' => 'optional'],
            ]],
            'is_secret' => false,
        ]);

        $this->postInvoice($this->payload('UPI', null))->assertStatus(201);
    }

    /**
     * An owner can make UPI references required while a till is offline; the
     * bills that till already rang up must still reach the books. They are
     * booked and flagged, not refused into a sync queue that can never drain.
     */
    public function test_synced_upi_without_reference_is_booked_and_flagged(): void
    {
        $payload = $this->payload('UPI', null) + [
            'store_id' => $this->store->id,
            'invoice_number' => 'REF-SYNC-1',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 210.00,
            'paid_amount' => 210.00,
            'payment_mode' => 'UPI',
        ];

        $this->postJson('/api/sync/push/batch', [
            'items' => [[
                'entity_type' => 'invoice',
                'entity_id' => $payload['external_id'],
                'action' => 'create',
                'payload' => $payload,
            ]],
        ])->assertStatus(200)->assertJson(['success' => true, 'results' => ['failed' => 0]]);

        $invoice = Invoice::with('payments')->where('external_id', $payload['external_id'])->firstOrFail();
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertNull($invoice->payments->first()->reference_no);
        $this->assertDatabaseHas('notifications', [
            'store_id' => $this->store->id,
            'type' => 'offline_payment_policy',
        ]);
    }

    public function test_synced_non_cash_overpayment_is_still_refused(): void
    {
        $payload = $this->payload('UPI', 'UTR123456789012') + [
            'store_id' => $this->store->id,
            'invoice_number' => 'REF-SYNC-2',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 210.00,
            'payment_mode' => 'UPI',
        ];
        $payload['payments'][0]['amount'] = 500.00;

        $this->postJson('/api/sync/push/batch', [
            'items' => [[
                'entity_type' => 'invoice',
                'entity_id' => $payload['external_id'],
                'action' => 'create',
                'payload' => $payload,
            ]],
        ])->assertStatus(200)->assertJson(['results' => ['failed' => 1]]);
    }
}
