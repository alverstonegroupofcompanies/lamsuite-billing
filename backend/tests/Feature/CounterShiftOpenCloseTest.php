<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\Expense;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * SHF-01: opening and closing a shift is the counter's own drawer. The server
 * derives the sales figures from the money it booked, not from what the till typed.
 */
class CounterShiftOpenCloseTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Shift Store',
            'code' => 'SHIFT1',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => 'active',
            'device_uuid' => 'uuid_shift_c01',
            'unlock_pin_hash' => Hash::make('1234'),
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Shift Tablet',
            'current_stock' => 100,
            'mrp' => 100.00,
            'sel_rate' => 100.00,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'BCH-SH-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'mrp' => 100.00,
            'selling_rate' => 100.00,
        ]);
    }

    private function headers(): array
    {
        return ['X-Store-Id' => (string) $this->store->id, 'X-Device-UUID' => 'uuid_shift_c01'];
    }

    private function open(float $float = 1000.00)
    {
        return $this->withHeaders($this->headers())->postJson('/api/counter/shift/open', [
            'pin' => '1234',
            'opening_float' => $float,
        ]);
    }

    private function sell(float $amount, string $mode, ?string $reference = null): void
    {
        static $n = 0;
        $n++;
        $externalId = 'ext_shift_' . $n;

        $line = ['mode' => $mode, 'amount' => $amount];
        if ($reference !== null) {
            $line['reference_no'] = $reference;
        }

        $res = $this->withHeaders($this->headers())->postJson('/api/invoices', [
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'counter_code' => 'C01',
            'customer_name' => 'Walk-in Customer',
            'payments' => [$line],
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'BCH-SH-1',
                'qty' => $amount / 100,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 0.00,
            ]],
        ]);
        $res->assertStatus(201);
    }

    private function close(array $overrides = [])
    {
        return $this->withHeaders($this->headers())->postJson('/api/counter/shift/close', array_merge([
            'pin' => '1234',
            'closing_cash_actual' => 1100.00,
        ], $overrides));
    }

    public function test_open_then_close_computes_expected_cash_from_documents(): void
    {
        $this->open(1000.00)->assertStatus(200);

        $this->sell(115.00, 'Cash');
        $this->sell(230.00, 'UPI', 'UTR-SHIFT-1');

        $res = $this->close(['cash_sales' => 0, 'digital_sales' => 0]);
        $res->assertStatus(200);

        $this->assertEqualsWithDelta(1115.00, (float) $res->json('expected_cash'), 0.01);
        $this->assertEqualsWithDelta(-15.00, (float) $res->json('variance'), 0.01);

        $shift = CounterShift::where('counter_id', $this->counter->id)->latest('id')->firstOrFail();
        $this->assertSame('closed', $shift->status);
        $this->assertEqualsWithDelta(115.00, (float) $shift->cash_sales, 0.01);
        $this->assertEqualsWithDelta(230.00, (float) $shift->digital_sales, 0.01);
        $this->assertEqualsWithDelta(1115.00, (float) $shift->expected_cash, 0.01);
        $this->assertEqualsWithDelta(-15.00, (float) $shift->closing_discrepancy, 0.01);
    }

    public function test_client_sales_figures_are_ignored_on_online_close(): void
    {
        $this->open(1000.00)->assertStatus(200);
        $this->sell(115.00, 'Cash');

        $res = $this->close([
            'closing_cash_actual' => 1100.00,
            'cash_sales' => 9999.00,
            'digital_sales' => 8888.00,
            'cash_refunds' => 777.00,
        ]);
        $res->assertStatus(200);

        $this->assertEqualsWithDelta(1115.00, (float) $res->json('expected_cash'), 0.01);
        $this->assertEqualsWithDelta(9999.00, (float) $res->json('ignored_client_totals.cash_sales'), 0.01);

        $shift = CounterShift::where('counter_id', $this->counter->id)->latest('id')->firstOrFail();
        $this->assertEqualsWithDelta(115.00, (float) $shift->cash_sales, 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $shift->digital_sales, 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $shift->cash_refunds, 0.01);
    }

    public function test_open_idempotent_when_shift_already_open(): void
    {
        $this->open(1000.00)->assertStatus(200);
        $again = $this->open(500.00);

        $again->assertStatus(200)->assertJson(['already_open' => true]);
        $this->assertSame(1, CounterShift::where('counter_id', $this->counter->id)->count());
        $this->assertEqualsWithDelta(1000.00, (float) CounterShift::first()->opening_float, 0.01);
    }

    public function test_cash_expense_reduces_expected_cash(): void
    {
        $this->open(1000.00)->assertStatus(200);
        $this->sell(115.00, 'Cash');

        Expense::create([
            'store_id' => $this->store->id,
            'counter_id' => $this->counter->id,
            'expense_head' => 'Tea',
            'amount' => 50.00,
            'payment_mode' => 'Cash',
            'expense_date' => now()->toDateString(),
        ]);

        $res = $this->close(['closing_cash_actual' => 1065.00]);
        $res->assertStatus(200);

        $this->assertDatabaseHas('expenses', [
            'store_id' => $this->store->id,
            'counter_id' => (string) $this->counter->id,
            'amount' => 50.00,
        ]);

        $this->assertEqualsWithDelta(1065.00, (float) $res->json('expected_cash'), 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $res->json('variance'), 0.01);
        $this->assertEqualsWithDelta(50.00, (float) $res->json('server_tally.cash_expenses'), 0.01);
    }

    /**
     * SHF-01: a counter that opens, closes and reopens on the same calendar day
     * must not be handed the whole day's money twice.
     */
    public function test_a_second_shift_the_same_day_counts_only_its_own_drawer(): void
    {
        $this->open(1000.00)->assertStatus(200);
        $this->sell(115.00, 'Cash');
        $this->close(['closing_cash_actual' => 1115.00])->assertStatus(200);

        $this->travel(5)->minutes();

        $this->open(500.00)->assertStatus(200);
        $this->sell(200.00, 'Cash');
        $res = $this->close(['closing_cash_actual' => 700.00]);
        $res->assertStatus(200);

        $this->assertEqualsWithDelta(700.00, (float) $res->json('expected_cash'), 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $res->json('variance'), 0.01);

        $shift = CounterShift::where('counter_id', $this->counter->id)->latest('id')->firstOrFail();
        $this->assertEqualsWithDelta(200.00, (float) $shift->cash_sales, 0.01);
        $this->assertEqualsWithDelta(500.00, (float) $res->json('server_tally.opening_float'), 0.01);
        $this->assertEqualsWithDelta(700.00, (float) $res->json('server_tally.expected_cash'), 0.01);
    }
}
