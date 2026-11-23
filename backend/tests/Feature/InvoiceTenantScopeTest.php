<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * G1-SEC — SEC-04 / SEC-05 from QA round 3: a counter could sell another store's
 * batch, bills were credited to whatever counter_code the payload named (or a
 * counter invented on the spot), a locked counter could still bill, and invoices
 * were read and cancelled by id across stores.
 */
class InvoiceTenantScopeTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private Counter $counterA1;
    private Counter $counterA2;
    private string $tokenA2;
    private Product $productA;
    private ProductBatch $batchA;
    private Product $productB;
    private ProductBatch $batchB;
    private User $ownerA;

    protected function setUp(): void
    {
        parent::setUp();

        // B is created first so "the first store" is never the right answer.
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'STB', 'state_code' => '29', 'is_active' => true, 'tax_mode' => 'inclusive']);
        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'STA', 'state_code' => '32', 'is_active' => true, 'tax_mode' => 'inclusive']);

        $this->ownerA = User::create(['name' => 'Owner A', 'email' => 'owner-a@test.in', 'password' => bcrypt('password123'), 'role' => 'store_owner', 'store_id' => $this->storeA->id]);

        $this->counterA1 = Counter::create(['store_id' => $this->storeA->id, 'counter_code' => 'C01', 'counter_name' => 'A Front']);
        $this->counterA2 = Counter::create(['store_id' => $this->storeA->id, 'counter_code' => 'C02', 'counter_name' => 'A Back']);
        $this->tokenA2 = $this->claim($this->counterA2, 'dev-a2');

        [$this->productA, $this->batchA] = $this->stock($this->storeA, 'Paracet A', '8900000000011', 'PA-1');
        // Same barcode in the other store is allowed (J2.05); it must never be reachable from A.
        [$this->productB, $this->batchB] = $this->stock($this->storeB, 'Lipstick B', '8900000000011', 'LB-1');
    }

    private function claim(Counter $counter, string $uuid): string
    {
        $issued = ActivationKey::generateForCounter($counter);

        return $this->postJson('/api/counters/claim', ['code' => $issued['raw_key'], 'device_uuid' => $uuid])
            ->assertOk()->json('device_token');
    }

    private function stock(Store $store, string $name, string $barcode, string $batchNo): array
    {
        $product = Product::create(['store_id' => $store->id, 'name' => $name, 'barcode' => $barcode, 'mrp' => 100, 'sel_rate' => 100, 'gst_percent' => 12, 'units_per_pack' => 1, 'current_stock' => 10, 'is_active' => true]);
        $batch = ProductBatch::create(['store_id' => $store->id, 'product_id' => $product->id, 'batch_no' => $batchNo, 'expiry_date' => now()->addYear()->toDateString(), 'stock_qty' => 10, 'mrp' => 100, 'purchase_rate' => 60, 'selling_rate' => 100]);

        return [$product, $batch];
    }

    private function sale(Product $product, ProductBatch $batch, array $over = []): array
    {
        return array_merge([
            'external_id' => 'ext-' . uniqid(),
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'paid_amount' => 100,
            'payments' => [['mode' => 'Cash', 'amount' => 100]],
            'tax_mode' => 'inclusive',
            'grand_total' => 100,
            'items' => [[
                'product_id' => (string) $product->id,
                'product_name' => $product->name,
                'batch_id' => (string) $batch->id,
                'batch_no' => $batch->batch_no,
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'unit_price' => 100,
                'mrp' => 100,
                'gst_percent' => 12,
            ]],
        ], $over);
    }

    private function asCounterA2(): array
    {
        return ['X-Device-Token' => $this->tokenA2];
    }

    public function test_a_counter_cannot_sell_another_stores_batch(): void
    {
        $this->withHeaders($this->asCounterA2())
            ->postJson('/api/invoices', $this->sale($this->productB, $this->batchB))
            ->assertStatus(422);

        $this->assertSame(10.0, (float) $this->batchB->fresh()->stock_qty);
        $this->assertSame(0, Invoice::count());
    }

    public function test_another_stores_product_named_with_this_stores_batch_is_refused(): void
    {
        $payload = $this->sale($this->productA, $this->batchA);
        $payload['items'][0]['product_id'] = (string) $this->productB->id;
        $payload['items'][0]['product_name'] = $this->productB->name;

        $this->withHeaders($this->asCounterA2())->postJson('/api/invoices', $payload)->assertStatus(422);
        $this->assertSame(0, Invoice::count());
    }

    public function test_the_bill_is_stamped_with_the_tokens_counter_not_the_payloads(): void
    {
        $countersBefore = Counter::count();

        $this->withHeaders($this->asCounterA2())
            ->postJson('/api/invoices', $this->sale($this->productA, $this->batchA, ['counter_code' => 'C09', 'store_id' => $this->storeB->id]))
            ->assertStatus(403);   // naming another store is refused, not followed

        $response = $this->withHeaders($this->asCounterA2())
            ->postJson('/api/invoices', $this->sale($this->productA, $this->batchA, ['counter_code' => 'C09']))
            ->assertCreated();

        $invoice = Invoice::findOrFail($response->json('invoice.id'));
        $this->assertSame($this->storeA->id, (int) $invoice->store_id);
        $this->assertSame($this->counterA2->id, (int) $invoice->counter_id);
        $this->assertSame('C02', $invoice->counter_code);
        $this->assertSame($countersBefore, Counter::count(), 'no counter may be invented from a payload');
    }

    public function test_a_locked_counter_cannot_bill(): void
    {
        Sanctum::actingAs($this->ownerA);
        $this->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$this->counterA2->id}/lock")
            ->assertOk();
        $this->app['auth']->forgetGuards();

        $this->withHeaders($this->asCounterA2())
            ->postJson('/api/invoices', $this->sale($this->productA, $this->batchA))
            ->assertStatus(403);

        $this->assertSame(0, Invoice::count());
    }

    public function test_invoices_of_another_store_cannot_be_read_or_cancelled(): void
    {
        $foreign = Invoice::create([
            'store_id' => $this->storeB->id, 'module_key' => 'invoice', 'invoice_number' => 'STB-INV-1',
            'invoice_date' => now()->toDateString(), 'customer_name' => 'Walk-in Customer',
            'subtotal' => 100, 'tax_total' => 10.71, 'grand_total' => 100, 'paid_amount' => 100, 'payment_mode' => 'Cash', 'status' => 'issued',
        ]);

        $this->withHeaders($this->asCounterA2())->getJson("/api/invoices/{$foreign->id}")->assertNotFound();
        $this->withHeaders($this->asCounterA2())->getJson('/api/invoices/STB-INV-1')->assertNotFound();
        $this->withHeaders($this->asCounterA2())->postJson("/api/invoices/{$foreign->id}/cancel", ['reason' => 'x'])->assertNotFound();
        $this->withHeaders($this->asCounterA2())->postJson("/api/invoices/{$foreign->id}/lock")->assertNotFound();

        $list = $this->withHeaders($this->asCounterA2())->getJson('/api/invoices')->assertOk();
        $this->assertNotContains('STB-INV-1', collect($list->json('data'))->pluck('invoice_number')->all());

        $this->assertSame('issued', $foreign->fresh()->status);
    }

    public function test_a_person_token_cannot_reach_another_store_through_a_till_route(): void
    {
        $cashierA = User::create(['name' => 'Cashier A', 'email' => 'cashier-a@test.in', 'password' => bcrypt('password123'), 'role' => 'cashier', 'store_id' => $this->storeA->id]);
        Sanctum::actingAs($cashierA);

        $this->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->getJson('/api/invoices')
            ->assertStatus(403);
    }
}
