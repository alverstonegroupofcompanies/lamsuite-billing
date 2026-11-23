<?php

namespace Tests\Feature;

use App\Models\CustomerPayment;
use App\Models\Invoice;
use App\Models\Party;
use App\Models\PaymentAllocation;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PAY-05: a receipt must settle the document it paid. Historically it only moved
 * the party's running balance, so the invoice stayed "unpaid" forever.
 */
class PaymentAllocationTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;
    private Party $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Allocation Store',
            'code' => 'ALLOC1',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'store_id' => $this->store->id,
            'name' => 'Allocation Admin',
            'email' => 'allocation.admin@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);

        $this->customer = $this->party('Anand Traders', 'customer');
    }

    private function party(string $name, string $type): Party
    {
        return Party::create([
            'store_id' => $this->store->id,
            'type' => $type,
            'name' => $name,
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);
    }

    private function invoice(Party $customer, string $number, float $grand, float $paid = 0): Invoice
    {
        return Invoice::create([
            'store_id' => $this->store->id,
            'module_key' => 'invoice',
            'invoice_number' => $number,
            'invoice_date' => now()->toDateString(),
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'subtotal' => $grand,
            'taxable_subtotal' => $grand,
            'tax_total' => 0,
            'grand_total' => $grand,
            'paid_amount' => $paid,
            'payment_status' => $paid > 0 ? 'partially_paid' : 'unpaid',
            'status' => 'issued',
            'store_state_code' => '32',
        ]);
    }

    private function purchase(Party $supplier, string $number, float $grand, float $paid = 0): Purchase
    {
        return Purchase::create([
            'store_id' => $this->store->id,
            'module_key' => 'purchase',
            'invoice_number' => $number,
            'invoice_date' => now()->toDateString(),
            'supplier_id' => $supplier->id,
            'supplier_name' => $supplier->name,
            'grand_total' => $grand,
            'paid_amount' => $paid,
            'status' => 'received',
        ]);
    }

    private function admin()
    {
        return $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function receipt(Party $customer, float $amount, ?array $allocations = null)
    {
        $payload = [
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'amount' => $amount,
            'payment_mode' => 'Cash',
        ];
        if ($allocations !== null) {
            $payload['allocations'] = $allocations;
        }

        return $this->admin()->postJson('/api/admin/payments/customer', $payload);
    }

    public function test_customer_receipt_allocated_to_invoice_marks_it_paid(): void
    {
        $invoice = $this->invoice($this->customer, 'ALLOC-INV-1', 90.00);

        $res = $this->receipt($this->customer, 90.00, [['invoice_id' => $invoice->id, 'amount' => 90.00]]);
        $res->assertStatus(201);

        $invoice->refresh();
        $this->assertEqualsWithDelta(90.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('paid', $invoice->payment_status);

        $this->assertDatabaseHas('payment_allocations', [
            'store_id' => $this->store->id,
            'payment_type' => PaymentAllocation::TYPE_CUSTOMER_PAYMENT,
            'document_type' => PaymentAllocation::DOCUMENT_INVOICE,
            'document_id' => $invoice->id,
            'amount' => 90.00,
        ]);
        $this->assertEqualsWithDelta(90.00, (float) $res->json('allocated_amount'), 0.01);

        $this->assertEqualsWithDelta(-90.00, (float) $this->customer->fresh()->current_balance, 0.01);
    }

    public function test_customer_receipt_auto_allocates_fifo_when_allocations_omitted(): void
    {
        $older = $this->invoice($this->customer, 'ALLOC-INV-OLD', 50.00);
        $older->forceFill(['invoice_date' => now()->subDays(2)->toDateString()])->save();
        $newer = $this->invoice($this->customer, 'ALLOC-INV-NEW', 70.00);

        $this->receipt($this->customer, 80.00)->assertStatus(201);

        $this->assertEqualsWithDelta(50.00, (float) $older->fresh()->paid_amount, 0.01);
        $this->assertSame('paid', $older->fresh()->payment_status);

        $this->assertEqualsWithDelta(30.00, (float) $newer->fresh()->paid_amount, 0.01);
        $this->assertSame('partially_paid', $newer->fresh()->payment_status);
    }

    public function test_explicit_allocation_rejects_another_partys_invoice(): void
    {
        $other = $this->party('Other Customer', 'customer');
        $invoice = $this->invoice($other, 'ALLOC-INV-OTHER', 90.00);

        $res = $this->receipt($this->customer, 90.00, [['invoice_id' => $invoice->id, 'amount' => 90.00]]);

        $res->assertStatus(422);
        $this->assertSame(0, CustomerPayment::count());
        $this->assertEqualsWithDelta(0.00, (float) $invoice->fresh()->paid_amount, 0.01);
    }

    public function test_allocation_cannot_exceed_receipt_amount(): void
    {
        $a = $this->invoice($this->customer, 'ALLOC-INV-A', 100.00);
        $b = $this->invoice($this->customer, 'ALLOC-INV-B', 100.00);

        $res = $this->receipt($this->customer, 100.00, [
            ['invoice_id' => $a->id, 'amount' => 60.00],
            ['invoice_id' => $b->id, 'amount' => 60.00],
        ]);

        $res->assertStatus(422);
        $this->assertSame(0, CustomerPayment::count());
        $this->assertEqualsWithDelta(0.00, (float) $a->fresh()->paid_amount, 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $b->fresh()->paid_amount, 0.01);
    }

    public function test_supplier_payment_allocated_to_purchase_updates_paid_amount(): void
    {
        $supplier = $this->party('Sunrise Distributors', 'supplier');
        $purchase = $this->purchase($supplier, 'ALLOC-PB-1', 5000.00, 0.00);

        $res = $this->admin()->postJson('/api/admin/supplier-payments', [
            'store_id' => $this->store->id,
            'supplier_id' => $supplier->id,
            'amount' => 5000.00,
            'payment_mode' => 'Bank Transfer',
            'allocations' => [['purchase_id' => $purchase->id, 'amount' => 5000.00]],
        ]);
        $res->assertStatus(201);

        $this->assertEqualsWithDelta(5000.00, (float) $purchase->fresh()->paid_amount, 0.01);
        $this->assertDatabaseHas('payment_allocations', [
            'payment_type' => PaymentAllocation::TYPE_SUPPLIER_PAYMENT,
            'document_type' => PaymentAllocation::DOCUMENT_PURCHASE,
            'document_id' => $purchase->id,
        ]);
    }

    public function test_synced_customer_payment_allocates_and_moves_balance(): void
    {
        $invoice = $this->invoice($this->customer, 'ALLOC-INV-SYNC', 90.00);

        $this->postJson('/api/sync/push/batch', [
            'items' => [[
                'entity_type' => 'payment',
                'entity_id' => 'till-payment-1',
                'action' => 'create',
                'payload' => [
                    'id' => 'till-payment-1',
                    'store_id' => $this->store->id,
                    'customer_id' => $this->customer->id,
                    'amount' => 90.00,
                    'payment_mode' => 'UPI',
                    'reference_no' => 'UTR-ALLOC-1',
                    'allocations' => [['invoice_id' => $invoice->id, 'amount' => 90.00]],
                ],
            ]],
        ])->assertStatus(200)->assertJson(['success' => true]);

        $this->assertEqualsWithDelta(90.00, (float) $invoice->fresh()->paid_amount, 0.01);
        $this->assertSame('paid', $invoice->fresh()->payment_status);
        $this->assertEqualsWithDelta(-90.00, (float) $this->customer->fresh()->current_balance, 0.01);
    }

    public function test_outstanding_documents_lists_open_bills_oldest_first(): void
    {
        $older = $this->invoice($this->customer, 'ALLOC-LIST-OLD', 500.00, 200.00);
        $older->forceFill(['invoice_date' => now()->subDays(3)->toDateString()])->save();
        $this->invoice($this->customer, 'ALLOC-LIST-NEW', 300.00);
        $this->invoice($this->customer, 'ALLOC-LIST-DONE', 100.00, 100.00);
        $this->invoice($this->party('Another Customer', 'customer'), 'ALLOC-LIST-OTHER', 400.00);

        $res = $this->admin()->getJson(
            '/api/admin/outstanding-documents?store_id=' . $this->store->id
            . '&party_type=customer&party_id=' . $this->customer->id
        );
        $res->assertStatus(200);

        $this->assertSame(
            ['ALLOC-LIST-OLD', 'ALLOC-LIST-NEW'],
            array_column($res->json('data'), 'document_number')
        );

        $first = $res->json('data.0');
        $this->assertSame('invoice', $first['document_type']);
        $this->assertSame((int) $older->id, (int) $first['document_id']);
        $this->assertEqualsWithDelta(300.00, (float) $first['outstanding'], 0.01);
        $this->assertNotContains('ALLOC-LIST-OTHER', array_column($res->json('data'), 'document_number'));
        $this->assertNotContains('ALLOC-LIST-DONE', array_column($res->json('data'), 'document_number'));
    }

    public function test_outstanding_documents_lists_supplier_bills_but_not_orders(): void
    {
        $supplier = $this->party('Sunrise Distributors', 'supplier');
        $bill = $this->purchase($supplier, 'ALLOC-LIST-PB', 5000.00, 1500.00);
        Purchase::create([
            'store_id' => $this->store->id,
            'module_key' => 'purchase_order',
            'invoice_number' => 'ALLOC-LIST-PO',
            'invoice_date' => now()->toDateString(),
            'supplier_id' => $supplier->id,
            'supplier_name' => $supplier->name,
            'grand_total' => 2000.00,
            'paid_amount' => 0,
            'status' => 'received',
        ]);

        $res = $this->admin()->getJson(
            '/api/admin/outstanding-documents?store_id=' . $this->store->id
            . '&party_type=supplier&party_id=' . $supplier->id
        );
        $res->assertStatus(200);

        $rows = $res->json('data');
        $this->assertCount(1, $rows);
        $this->assertSame('purchase', $rows[0]['document_type']);
        $this->assertSame((int) $bill->id, (int) $rows[0]['document_id']);
        $this->assertEqualsWithDelta(3500.00, (float) $rows[0]['outstanding'], 0.01);
    }

    /**
     * A receipt tied to a bill that is later cancelled must not stay spent on a
     * bill nobody owes: the allocation is released, the receipt's money is free
     * again, and the next allocation run can apply it to a live bill.
     */
    public function test_admin_cancel_releases_receipt_allocation(): void
    {
        $invoice = $this->invoice($this->customer, 'ALLOC-CXL-1', 90.00);
        $this->receipt($this->customer, 90.00, [['invoice_id' => $invoice->id, 'amount' => 90.00]])
            ->assertStatus(201);
        $this->assertSame(1, PaymentAllocation::where('document_id', $invoice->id)->count());

        $this->admin()
            ->postJson("/api/admin/invoices/{$invoice->id}/cancel", ['reason' => 'Billed to wrong customer'])
            ->assertStatus(200);

        $this->assertSame(0, PaymentAllocation::where('document_type', PaymentAllocation::DOCUMENT_INVOICE)
            ->where('document_id', $invoice->id)->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'payment_allocation_released']);

        // The freed ₹90 goes to the customer's next open bill.
        $next = $this->invoice($this->customer, 'ALLOC-CXL-2', 90.00);
        $this->artisan('payments:allocate-outstanding', ['--apply' => true])->assertExitCode(0);
        $this->assertSame('paid', $next->fresh()->payment_status);
    }

    public function test_shared_cancellation_releases_receipt_allocation(): void
    {
        $invoice = $this->invoice($this->customer, 'ALLOC-CXL-3', 120.00);
        $this->receipt($this->customer, 120.00, [['invoice_id' => $invoice->id, 'amount' => 120.00]])
            ->assertStatus(201);

        $token = 'cxl-token-' . $invoice->id;
        \App\Models\InvoiceApproval::create([
            'store_id' => $this->store->id,
            'invoice_id' => $invoice->id,
            'action' => 'cancel',
            'mode' => 'pin',
            'status' => 'used',
            'token_hash' => hash('sha256', $token),
            'approved_by_user_id' => $this->admin->id,
            'expires_at' => now()->addMinutes(10),
        ]);

        app(\App\Services\Sales\InvoiceCancellationService::class)
            ->cancel($invoice->fresh(), 'Duplicate bill', $this->admin->id, $token);

        $this->assertSame('cancelled', $invoice->fresh()->status);
        $this->assertSame(0, PaymentAllocation::where('document_type', PaymentAllocation::DOCUMENT_INVOICE)
            ->where('document_id', $invoice->id)->count());
    }
}
