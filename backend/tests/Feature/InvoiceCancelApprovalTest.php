<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\InvoiceApproval;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * G12 / APR-01: a counter may cancel only with a grant the server minted, the
 * grant is redeemed once, and the cancellation records who asked for it even
 * when the request carries no person (a claimed counter's device token).
 */
class InvoiceCancelApprovalTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $manager;
    private User $cashier;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Cancel Approval Pharmacy',
            'code' => 'CAP-01',
            'is_active' => true,
        ]);

        User::create([
            'name' => 'Store Owner',
            'email' => 'owner@cap.in',
            'password' => bcrypt('owner-secret'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        $this->manager = User::create([
            'name' => 'Floor Manager',
            'email' => 'manager@cap.in',
            'username' => 'manager1',
            'password' => bcrypt('manager-pass'),
            'pin_hash' => bcrypt('246810'),
            'role' => 'manager',
            'store_id' => $this->store->id,
        ]);

        $this->cashier = User::create([
            'name' => 'Counter Cashier',
            'email' => 'cashier@cap.in',
            'password' => bcrypt('cashier-pass'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => 'active',
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Cancellable Tablet',
            'current_stock' => 100,
            'mrp' => 10.00,
            'sel_rate' => 10.00,
            'gst_percent' => 0,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'CAP-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 100,
            'mrp' => 10.00,
            'selling_rate' => 10.00,
        ]);
    }

    private function makeInvoice(string $number = 'CAP-INV-100'): Invoice
    {
        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => $number,
            'invoice_date' => now()->toDateString(),
            'grand_total' => 100,
            'tax_total' => 0,
            'status' => 'issued',
            'payment_mode' => 'Cash',
        ]);

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $this->product->id,
            'product_name' => $this->product->name,
            'batch_no' => 'CAP-B1',
            'qty' => 10,
            'units_per_pack' => 1,
            'unit_price' => 10,
            'total_amount' => 100,
        ]);

        return $invoice->fresh('items');
    }

    private function managerGrantPayload(array $overrides = []): array
    {
        return array_merge([
            'action' => 'cancel',
            'mode' => 'manager',
            'identifier' => 'manager1',
            'secret' => 'manager-pass',
            'requested_by' => 'Counter Cashier',
            'requested_by_user_id' => $this->cashier->id,
            'counter_code' => 'C01',
        ], $overrides);
    }

    public function test_cancel_without_approval_token_is_refused_and_changes_nothing(): void
    {
        $invoice = $this->makeInvoice();

        $this->postJson("/api/invoices/{$invoice->id}/cancel", ['reason' => 'Customer changed mind'])
            ->assertStatus(403)
            ->assertJson(['success' => false, 'code' => 'CANCEL_APPROVAL_REQUIRED']);

        $this->assertSame('issued', $invoice->fresh()->status);
        $this->assertEquals(100.0, (float) $this->batch->fresh()->stock_qty);
    }

    public function test_cancel_with_a_verified_token_succeeds_and_consumes_it(): void
    {
        $invoice = $this->makeInvoice();
        $token = $this->grantCancellationToken($invoice, $this->managerGrantPayload());

        $this->postJson("/api/invoices/{$invoice->id}/cancel", [
            'reason' => 'Customer changed mind',
            'approval_token' => $token,
        ])->assertOk()->assertJson(['success' => true, 'status' => 'cancelled']);

        $invoice->refresh();
        $this->assertSame('cancelled', $invoice->status);
        $this->assertSame($this->cashier->id, (int) $invoice->cancelled_by);
        $this->assertEquals(110.0, (float) $this->batch->fresh()->stock_qty);
        $this->assertEquals(110.0, (float) $this->product->fresh()->current_stock);

        $approval = InvoiceApproval::firstOrFail();
        $this->assertNotNull($approval->consumed_at);
        $this->assertNull($approval->token_hash);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'invoice_approval_consumed',
            'entity_type' => 'InvoiceApproval',
            'entity_id' => (string) $approval->id,
        ]);
    }

    public function test_a_grant_issued_for_one_invoice_cannot_cancel_another(): void
    {
        $first = $this->makeInvoice('CAP-INV-101');
        $second = $this->makeInvoice('CAP-INV-102');

        $token = $this->grantCancellationToken($first, $this->managerGrantPayload());

        $this->postJson("/api/invoices/{$second->id}/cancel", [
            'reason' => 'Wrong invoice',
            'approval_token' => $token,
        ])->assertStatus(403)->assertJson(['code' => 'CANCEL_APPROVAL_INVALID']);

        $this->assertSame('issued', $second->fresh()->status);
        $this->assertNull(InvoiceApproval::firstOrFail()->consumed_at);
    }

    public function test_an_edit_grant_cannot_cancel_a_bill(): void
    {
        $invoice = $this->makeInvoice();

        $token = $this->grantCancellationToken($invoice, $this->managerGrantPayload(['action' => 'edit']));

        $this->postJson("/api/invoices/{$invoice->id}/cancel", [
            'reason' => 'Not what the grant was for',
            'approval_token' => $token,
        ])->assertStatus(403)->assertJson(['code' => 'CANCEL_APPROVAL_INVALID']);

        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_a_revoked_or_expired_grant_is_refused(): void
    {
        $invoice = $this->makeInvoice();
        $token = $this->grantCancellationToken($invoice, $this->managerGrantPayload());

        // Revocation already nulls the hash; prove the redemption path honours it.
        InvoiceApproval::firstOrFail()->update(['token_hash' => null]);

        $this->postJson("/api/invoices/{$invoice->id}/cancel", [
            'reason' => 'Revoked grant',
            'approval_token' => $token,
        ])->assertStatus(403)->assertJson(['code' => 'CANCEL_APPROVAL_INVALID']);

        $this->assertSame('issued', $invoice->fresh()->status);
    }

    public function test_an_expired_grant_is_refused(): void
    {
        $invoice = $this->makeInvoice();
        $token = $this->grantCancellationToken($invoice, $this->managerGrantPayload());

        InvoiceApproval::firstOrFail()->update(['expires_at' => now()->subMinute()]);

        $this->postJson("/api/invoices/{$invoice->id}/cancel", [
            'reason' => 'Expired grant',
            'approval_token' => $token,
        ])->assertStatus(403)->assertJson(['code' => 'CANCEL_APPROVAL_INVALID']);

        $this->assertSame('issued', $invoice->fresh()->status);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'invoice_approval_consumed']);
    }
}
