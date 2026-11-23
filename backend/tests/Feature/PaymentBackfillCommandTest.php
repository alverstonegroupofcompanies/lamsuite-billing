<?php

namespace Tests\Feature;

use App\Models\CustomerPayment;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Party;
use App\Models\PaymentAllocation;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\SupplierPayment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * G10-PAYMENTS repair paths. PAY-02 and PAY-05 wrote wrong numbers into live
 * databases before the fixes landed, so both commands must show their work in a
 * dry run before either touches a row — and neither may move money twice.
 */
class PaymentBackfillCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Backfill Store',
            'code' => 'PAYBF',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'is_active' => true,
        ]);
    }

    private function party(string $name, string $type, float $balance = 0): Party
    {
        return Party::create([
            'store_id' => $this->store->id,
            'type' => $type,
            'name' => $name,
            'opening_balance' => 0,
            'current_balance' => $balance,
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

    private function tender(Invoice $invoice, string $mode, float $amount): InvoicePayment
    {
        return InvoicePayment::create([
            'store_id' => $this->store->id,
            'invoice_id' => $invoice->id,
            'payment_mode' => $mode,
            'amount' => $amount,
            'status' => 'received',
        ]);
    }

    private function command(string $command, array $args = []): string
    {
        Artisan::call($command, $args);

        return Artisan::output();
    }

    public function test_reconcile_dry_run_shows_the_fix_and_writes_nothing(): void
    {
        $customer = $this->party('Backfill Traders', 'customer');
        $invoice = $this->invoice($customer, 'BF-TENDER-1', 210.00, 210.00);
        $payment = $this->tender($invoice, 'Cash', 500.00);

        $output = $this->command('invoices:reconcile-tenders');

        $this->assertStringContainsString('BF-TENDER-1', $output);
        $this->assertStringContainsString('Dry run', $output);
        $payment->refresh();
        $this->assertEqualsWithDelta(500.00, (float) $payment->amount, 0.01);
        $this->assertNull($payment->tendered_amount);
    }

    public function test_reconcile_splits_a_note_into_what_the_bill_kept_and_the_change_handed_back(): void
    {
        $customer = $this->party('Backfill Traders', 'customer');
        $invoice = $this->invoice($customer, 'BF-TENDER-2', 210.00, 210.00);
        $payment = $this->tender($invoice, 'Cash', 500.00);

        $this->command('invoices:reconcile-tenders', ['--apply' => true]);

        $payment->refresh();
        $this->assertEqualsWithDelta(210.00, (float) $payment->amount, 0.01);
        $this->assertEqualsWithDelta(500.00, (float) $payment->tendered_amount, 0.01);
        $this->assertEqualsWithDelta(290.00, (float) $payment->change_amount, 0.01);

        // Re-running must not take the change out a second time.
        $output = $this->command('invoices:reconcile-tenders', ['--apply' => true]);
        $this->assertStringContainsString('Nothing to backfill', $output);
        $payment->refresh();
        $this->assertEqualsWithDelta(210.00, (float) $payment->amount, 0.01);
        $this->assertEqualsWithDelta(290.00, (float) $payment->change_amount, 0.01);
    }

    public function test_reconcile_caps_a_paid_amount_that_cannot_exist(): void
    {
        $customer = $this->party('Backfill Traders', 'customer');
        $invoice = $this->invoice($customer, 'BF-TENDER-3', 210.00, 500.00);
        $this->tender($invoice, 'Cash', 500.00);

        $this->command('invoices:reconcile-tenders', ['--apply' => true]);

        $invoice->refresh();
        $this->assertEqualsWithDelta(210.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('paid', $invoice->payment_status);
    }

    public function test_reconcile_takes_change_only_from_the_cash_line_of_a_split_tender(): void
    {
        $customer = $this->party('Backfill Traders', 'customer');
        $invoice = $this->invoice($customer, 'BF-TENDER-4', 1000.00, 1100.00);
        $upi = $this->tender($invoice, 'UPI', 300.00);
        $cash = $this->tender($invoice, 'Cash', 800.00);

        $this->command('invoices:reconcile-tenders', ['--apply' => true]);

        $upi->refresh();
        $this->assertEqualsWithDelta(300.00, (float) $upi->amount, 0.01);
        $this->assertEqualsWithDelta(300.00, (float) $upi->tendered_amount, 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $upi->change_amount, 0.01);

        $cash->refresh();
        $this->assertEqualsWithDelta(700.00, (float) $cash->amount, 0.01);
        $this->assertEqualsWithDelta(800.00, (float) $cash->tendered_amount, 0.01);
        $this->assertEqualsWithDelta(100.00, (float) $cash->change_amount, 0.01);

        $invoice->refresh();
        $this->assertEqualsWithDelta(1000.00, (float) $invoice->paid_amount, 0.01);
    }

    public function test_reconcile_keeps_credit_out_of_the_money_handed_over(): void
    {
        $customer = $this->party('Backfill Traders', 'customer');
        $invoice = $this->invoice($customer, 'BF-TENDER-5', 1000.00, 400.00);
        $cash = $this->tender($invoice, 'Cash', 400.00);
        $credit = $this->tender($invoice, 'Credit', 600.00);

        $this->command('invoices:reconcile-tenders', ['--apply' => true]);

        $cash->refresh();
        $this->assertEqualsWithDelta(400.00, (float) $cash->amount, 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $cash->change_amount, 0.01);

        $credit->refresh();
        $this->assertEqualsWithDelta(600.00, (float) $credit->amount, 0.01);

        // A credit line is a receivable, not cash in hand: the header keeps its
        // historical meaning and is not raised to the full bill.
        $invoice->refresh();
        $this->assertEqualsWithDelta(400.00, (float) $invoice->paid_amount, 0.01);
        $this->assertSame('partially_paid', $invoice->payment_status);
    }

    public function test_allocate_dry_run_names_the_bills_a_receipt_would_settle(): void
    {
        $customer = $this->party('Allocation Backfill', 'customer', -90.00);
        $invoice = $this->invoice($customer, 'BF-ALLOC-1', 90.00);
        CustomerPayment::create([
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'amount' => 90.00,
            'payment_mode' => 'UPI',
            'payment_date' => now()->toDateString(),
        ]);

        $output = $this->command('payments:allocate-outstanding');

        $this->assertStringContainsString('BF-ALLOC-1', $output);
        $this->assertStringContainsString('Dry run', $output);
        $this->assertSame(0, PaymentAllocation::count());
        $this->assertEqualsWithDelta(0.00, (float) $invoice->fresh()->paid_amount, 0.01);
    }

    public function test_allocate_settles_the_oldest_debt_first_without_moving_the_balance(): void
    {
        $customer = $this->party('Allocation Backfill', 'customer', -80.00);
        $older = $this->invoice($customer, 'BF-ALLOC-OLD', 50.00);
        $older->forceFill(['invoice_date' => now()->subDays(2)->toDateString()])->save();
        $newer = $this->invoice($customer, 'BF-ALLOC-NEW', 70.00);

        CustomerPayment::create([
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'amount' => 80.00,
            'payment_mode' => 'Cash',
            'payment_date' => now()->toDateString(),
        ]);

        $this->command('payments:allocate-outstanding', ['--apply' => true]);

        $this->assertEqualsWithDelta(50.00, (float) $older->fresh()->paid_amount, 0.01);
        $this->assertSame('paid', $older->fresh()->payment_status);
        $this->assertEqualsWithDelta(30.00, (float) $newer->fresh()->paid_amount, 0.01);
        $this->assertSame('partially_paid', $newer->fresh()->payment_status);

        // The receipt already moved the balance when it was recorded; repairing
        // the allocation must not debit the customer a second time.
        $this->assertEqualsWithDelta(-80.00, (float) $customer->fresh()->current_balance, 0.01);
        $this->assertSame(2, PaymentAllocation::count());
    }

    public function test_allocate_leaves_a_receipt_that_is_already_placed_alone(): void
    {
        $customer = $this->party('Allocation Backfill', 'customer', -90.00);
        $invoice = $this->invoice($customer, 'BF-ALLOC-SETTLED', 90.00, 90.00);
        $invoice->forceFill(['payment_status' => 'paid'])->save();

        $payment = CustomerPayment::create([
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'amount' => 90.00,
            'payment_mode' => 'UPI',
            'payment_date' => now()->toDateString(),
        ]);
        PaymentAllocation::create([
            'store_id' => $this->store->id,
            'payment_type' => PaymentAllocation::TYPE_CUSTOMER_PAYMENT,
            'payment_id' => $payment->id,
            'document_type' => PaymentAllocation::DOCUMENT_INVOICE,
            'document_id' => $invoice->id,
            'amount' => 90.00,
        ]);

        $output = $this->command('payments:allocate-outstanding', ['--apply' => true]);

        $this->assertStringContainsString('Nothing to backfill', $output);
        $this->assertSame(1, PaymentAllocation::count());
        $this->assertEqualsWithDelta(90.00, (float) $invoice->fresh()->paid_amount, 0.01);
    }

    public function test_allocate_places_a_supplier_payment_on_the_purchase_bill(): void
    {
        $supplier = $this->party('Sunrise Distributors', 'supplier', 3500.00);
        $purchase = Purchase::create([
            'store_id' => $this->store->id,
            'module_key' => 'purchase',
            'invoice_number' => 'BF-PB-1',
            'invoice_date' => now()->toDateString(),
            'supplier_id' => $supplier->id,
            'supplier_name' => $supplier->name,
            'grand_total' => 5000.00,
            'paid_amount' => 1500.00,
            'status' => 'received',
        ]);

        SupplierPayment::create([
            'store_id' => $this->store->id,
            'supplier_id' => $supplier->id,
            'amount' => 3500.00,
            'payment_mode' => 'Bank Transfer',
            'payment_date' => now()->toDateString(),
        ]);

        $this->command('payments:allocate-outstanding', ['--apply' => true]);

        $this->assertEqualsWithDelta(5000.00, (float) $purchase->fresh()->paid_amount, 0.01);
        $this->assertDatabaseHas('payment_allocations', [
            'payment_type' => PaymentAllocation::TYPE_SUPPLIER_PAYMENT,
            'document_type' => PaymentAllocation::DOCUMENT_PURCHASE,
            'document_id' => $purchase->id,
            'amount' => 3500.00,
        ]);
    }

    public function test_allocate_reports_a_receipt_with_nothing_to_settle(): void
    {
        $customer = $this->party('Allocation Backfill', 'customer', -500.00);
        CustomerPayment::create([
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'amount' => 500.00,
            'payment_mode' => 'Cash',
            'payment_date' => now()->toDateString(),
        ]);

        $output = $this->command('payments:allocate-outstanding', ['--apply' => true]);

        $this->assertStringContainsString('on account', $output);
        $this->assertSame(0, PaymentAllocation::count());
        $this->assertEqualsWithDelta(-500.00, (float) $customer->fresh()->current_balance, 0.01);
    }
}
