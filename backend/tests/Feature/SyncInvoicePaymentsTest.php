<?php

namespace Tests\Feature;

use App\Models\GiftCard;
use App\Models\GiftCardTransaction;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Party;
use App\Models\Store;
use App\Services\Payments\GiftCardService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SyncInvoicePaymentsTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Sync Payments Store',
            'code' => 'SYNCPAY1',
            'tax_mode' => 'inclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);
    }

    private function issueCard(float $amount = 500): GiftCard
    {
        return app(GiftCardService::class)->issue($this->store->id, [
            'initial_balance' => $amount,
            'code' => 'GCSYNCTEST01',
        ]);
    }

    private function pushInvoice(array $overrides = [])
    {
        return $this->postJson('/api/sync/push/invoices', [
            'invoices' => [array_merge([
                'external_id' => 'ext_sync_pay_1',
                'invoice_number' => 'INV-SYNC-PAY-1',
                'store_id' => $this->store->id,
                'invoice_date' => now()->toDateString(),
                'customer_name' => 'Walk-in Customer',
                'grand_total' => 500,
                'taxable_subtotal' => 446.43,
                'tax_total' => 53.57,
                'round_off' => 0,
                'paid_amount' => 500,
                'payment_mode' => 'Gift Voucher',
                'payments' => [
                    ['mode' => 'Gift Voucher', 'amount' => 500, 'reference_no' => 'GCSYNCTEST01', 'extra_fields' => ['gift_card_code' => 'GCSYNCTEST01']],
                ],
                'items' => [],
            ], $overrides)],
        ]);
    }

    public function test_synced_invoice_redeems_gift_card_and_records_payment_line(): void
    {
        $card = $this->issueCard(500);

        $this->pushInvoice()->assertStatus(200)->assertJson(['success' => true]);

        $invoice = Invoice::where('invoice_number', 'INV-SYNC-PAY-1')->firstOrFail();
        $this->assertSame(1, InvoicePayment::where('invoice_id', $invoice->id)->count());

        $card->refresh();
        $this->assertSame(0.0, (float) $card->balance);
        $this->assertSame(GiftCard::STATUS_EXHAUSTED, $card->status);
        $this->assertSame(1, GiftCardTransaction::where('gift_card_id', $card->id)
            ->where('type', GiftCardTransaction::TYPE_REDEEM)
            ->count());
    }

    public function test_resync_is_idempotent_for_payments_and_card_balance(): void
    {
        $card = $this->issueCard(1000);

        $this->pushInvoice()->assertStatus(200);
        $this->pushInvoice()->assertStatus(200);

        $invoice = Invoice::where('invoice_number', 'INV-SYNC-PAY-1')->firstOrFail();
        $this->assertSame(1, InvoicePayment::where('invoice_id', $invoice->id)->count());
        $this->assertSame(500.0, (float) $card->fresh()->balance);
        $this->assertSame(1, GiftCardTransaction::where('gift_card_id', $card->id)
            ->where('type', GiftCardTransaction::TYPE_REDEEM)
            ->count());
    }

    public function test_synced_credit_portion_increments_customer_ledger(): void
    {
        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Ramesh Monthly Account',
            'phone' => '9847000001',
            'credit_limit' => 10000,
            'current_balance' => 250,
            'is_active' => true,
        ]);

        $this->pushInvoice([
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'payment_mode' => 'Split',
            'paid_amount' => 200,
            'payments' => [
                ['mode' => 'Cash', 'amount' => 200],
                ['mode' => 'Credit', 'amount' => 300],
            ],
        ])->assertStatus(200);

        $customer->refresh();
        $this->assertSame(550.0, (float) $customer->current_balance);
    }

    public function test_invalid_gift_card_fails_invoice_ingestion(): void
    {
        $this->pushInvoice([
            'payments' => [
                ['mode' => 'Gift Voucher', 'amount' => 500, 'reference_no' => 'GC-DOES-NOT-EXIST'],
            ],
        ])->assertStatus(422);

        $this->assertSame(0, InvoicePayment::count());
        $this->assertSame(0, GiftCardTransaction::count());
    }
}
