<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\GiftCard;
use App\Models\GiftCardTransaction;
use App\Models\Invoice;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GiftCardLedgerTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Gift Card Pharmacy',
            'code' => 'GCP01',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@gcp.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
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
            'name' => 'Vitamin C 500mg',
            'barcode' => '8900000000001',
            'current_stock' => 20,
            'mrp' => 10.00,
            'sel_rate' => 10.00,
            'gst_percent' => 0,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'GC-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 20,
            'mrp' => 10.00,
            'selling_rate' => 10.00,
        ]);
    }

    private function issueViaApi(float $amount, array $overrides = []): array
    {
        return $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/gift-cards', array_merge([
                'initial_balance' => $amount,
                'issued_to_name' => 'QA Customer',
            ], $overrides))
            ->assertStatus(201)
            ->json('gift_card');
    }

    private function invoicePayload(string $mode, float $amount, string $code): array
    {
        return [
            'counter_code' => 'C01',
            'customer_name' => 'Walk-in Customer',
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'GC-B1',
                'qty' => 1,
                'unit_price' => 10.00,
                'gst_percent' => 0,
            ]],
            'payments' => [[
                'mode' => $mode,
                'amount' => $amount,
                'reference_no' => $code,
            ]],
        ];
    }

    public function test_issue_card_creates_ledger_entry_and_unique_code(): void
    {
        $card = $this->issueViaApi(500);

        $this->assertStringStartsWith('GC', $card['code']);
        $this->assertSame(500.0, (float) $card['balance']);
        $this->assertSame(GiftCard::STATUS_ACTIVE, $card['status']);
        $this->assertDatabaseHas('gift_card_transactions', [
            'gift_card_id' => $card['id'],
            'type' => GiftCardTransaction::TYPE_ISSUE,
        ]);

        $second = $this->issueViaApi(100);
        $this->assertNotSame($card['code'], $second['code']);
    }

    public function test_lookup_returns_redeemable_balance(): void
    {
        $card = $this->issueViaApi(250);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/gift-cards/lookup?code=' . $card['code'])
            ->assertStatus(200)
            ->assertJson([
                'success' => true,
                'redeemable' => true,
                'gift_card' => ['balance' => 250],
            ]);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/gift-cards/lookup?code=GC-DOES-NOT-EXIST')
            ->assertStatus(404);
    }

    public function test_admin_adjustment_credits_and_debits(): void
    {
        $card = $this->issueViaApi(100);

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/gift-cards/{$card['id']}/adjust", [
                'amount' => 50,
                'direction' => 'credit',
                'notes' => 'Goodwill credit',
            ])
            ->assertStatus(200)
            ->assertJson(['success' => true, 'gift_card' => ['balance' => 150]]);

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/gift-cards/{$card['id']}/adjust", [
                'amount' => 200,
                'direction' => 'debit',
            ])
            ->assertStatus(422);

        $this->assertSame(150.0, (float) GiftCard::find($card['id'])->balance);
    }

    public function test_gift_card_tender_redeems_balance_at_checkout(): void
    {
        $card = $this->issueViaApi(100);

        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->invoicePayload('Gift Voucher', 10, $card['code']));

        $response->assertStatus(201)->assertJson(['success' => true]);

        $cardModel = GiftCard::find($card['id']);
        $this->assertSame(90.0, (float) $cardModel->balance);
        $this->assertDatabaseHas('gift_card_transactions', [
            'gift_card_id' => $card['id'],
            'type' => GiftCardTransaction::TYPE_REDEEM,
            'invoice_id' => $response->json('invoice.id'),
        ]);
    }

    public function test_insufficient_balance_rolls_back_the_sale(): void
    {
        $card = $this->issueViaApi(5);
        $invoiceCount = Invoice::count();

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->invoicePayload('Gift Card', 10, $card['code']))
            ->assertStatus(422);

        $this->assertSame($invoiceCount, Invoice::count());
        $this->assertSame(5.0, (float) GiftCard::find($card['id'])->balance);
        $this->assertSame(20, (int) $this->batch->fresh()->stock_qty);
    }

    public function test_cancelling_invoice_returns_value_to_card(): void
    {
        $card = $this->issueViaApi(100);

        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->invoicePayload('Gift Voucher', 10, $card['code']))
            ->assertStatus(201);

        $invoiceId = $response->json('invoice.id');
        $this->assertSame(90.0, (float) GiftCard::find($card['id'])->balance);

        $this->postJson("/api/invoices/{$invoiceId}/cancel", ['reason' => 'QA refund check'])
            ->assertStatus(200)
            ->assertJson(['success' => true]);

        $this->assertSame(100.0, (float) GiftCard::find($card['id'])->balance);
        $this->assertDatabaseHas('gift_card_transactions', [
            'gift_card_id' => $card['id'],
            'type' => GiftCardTransaction::TYPE_REFUND,
            'invoice_id' => $invoiceId,
        ]);
    }

    public function test_expired_card_cannot_be_redeemed(): void
    {
        $card = GiftCard::create([
            'store_id' => $this->store->id,
            'code' => 'GCEXPIRED001',
            'initial_balance' => 100,
            'balance' => 100,
            'status' => GiftCard::STATUS_ACTIVE,
            'expires_at' => now()->subDay()->toDateString(),
        ]);

        $service = app(\App\Services\Payments\GiftCardService::class);
        $this->expectException(\DomainException::class);
        try {
            $service->redeem($this->store->id, $card->code, 10);
        } finally {
            $this->assertSame(100.0, (float) $card->fresh()->balance);
        }
    }
}
