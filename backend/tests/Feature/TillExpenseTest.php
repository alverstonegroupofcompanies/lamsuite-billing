<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Services\DayClose\StoreDayCloseService;
use App\Support\Counter\CounterProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * EXP-01: a till can book an expense, and a cash one names the drawer that
 * paid it so the shift and the day close both account for the money.
 */
class TillExpenseTest extends TestCase
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
            'name' => 'Expense Store',
            'code' => 'EXPS1',
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
            'device_uuid' => 'uuid_expense_c01',
            'unlock_pin_hash' => Hash::make('1234'),
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Expense Tablet',
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
            'batch_no' => 'BCH-EXP-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'mrp' => 100.00,
            'selling_rate' => 100.00,
        ]);
    }

    private function headers(): array
    {
        return ['X-Store-Id' => (string) $this->store->id, 'X-Device-UUID' => 'uuid_expense_c01'];
    }

    private function bookExpense(array $payload)
    {
        return $this->withHeaders($this->headers())->postJson('/api/expenses', $payload);
    }

    private function sell(float $amount): void
    {
        $res = $this->withHeaders($this->headers())->postJson('/api/invoices', [
            'external_id' => 'ext_expense_sale_1',
            'idempotency_key' => 'ext_expense_sale_1',
            'counter_code' => 'C01',
            'customer_name' => 'Walk-in Customer',
            'payments' => [['mode' => 'Cash', 'amount' => $amount]],
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'BCH-EXP-1',
                'qty' => $amount / 100,
                'units_per_pack' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 0.00,
            ]],
        ]);

        $res->assertStatus(201);
    }

    public function test_counter_cash_expense_reduces_shift_expected_cash(): void
    {
        $this->withHeaders($this->headers())->postJson('/api/counter/shift/open', [
            'pin' => '1234',
            'opening_float' => 1000.00,
        ])->assertStatus(200);

        $this->sell(115.00);

        $this->bookExpense([
            'expense_head' => 'Tea & supplies',
            'amount' => 50.00,
            'payment_mode' => 'Cash',
        ])->assertStatus(201);

        $res = $this->withHeaders($this->headers())->postJson('/api/counter/shift/close', [
            'pin' => '1234',
            'closing_cash_actual' => 1065.00,
        ]);

        $res->assertStatus(200);
        $this->assertEqualsWithDelta(1065.00, (float) $res->json('expected_cash'), 0.01);
        $this->assertEqualsWithDelta(50.00, (float) $res->json('server_tally.cash_expenses'), 0.01);
        $this->assertEqualsWithDelta(0.00, (float) $res->json('variance'), 0.01);
    }

    public function test_till_route_records_expense_with_counter_id(): void
    {
        $res = $this->bookExpense([
            'expense_head' => 'Freight',
            'amount' => 275.50,
            'payment_mode' => 'Cash',
            'notes' => 'Courier paid from drawer',
        ]);

        $res->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('expense.counter_id', (int) $this->counter->id)
            ->assertJsonPath('expense.counter_code', 'C01');

        $this->assertNotNull($res->json('expense.expense_number'));

        $this->assertDatabaseHas('expenses', [
            'store_id' => $this->store->id,
            'counter_id' => (string) $this->counter->id,
            'expense_head' => 'Freight',
            'amount' => 275.50,
        ]);
    }

    public function test_till_expense_replay_by_expense_number_is_one_row(): void
    {
        $payload = [
            'expense_number' => 'EXP-TILL-00001',
            'expense_head' => 'Housekeeping',
            'amount' => 120.00,
            'payment_mode' => 'Cash',
        ];

        $this->bookExpense($payload)->assertStatus(201);
        $this->bookExpense($payload)->assertStatus(201);

        $this->assertSame(1, \App\Models\Expense::where('store_id', $this->store->id)->count());
    }

    public function test_reused_expense_number_for_a_different_expense_is_a_new_row(): void
    {
        $this->bookExpense([
            'expense_number' => 'EXP-00001',
            'expense_head' => 'Housekeeping',
            'amount' => 120.00,
            'payment_mode' => 'Cash',
        ])->assertStatus(201);

        $second = $this->bookExpense([
            'expense_number' => 'EXP-00001',
            'expense_head' => 'Courier',
            'amount' => 45.00,
            'payment_mode' => 'Cash',
        ])->assertStatus(201);

        $rows = \App\Models\Expense::where('store_id', $this->store->id)->orderBy('id')->get();
        $this->assertCount(2, $rows);
        $this->assertSame('Housekeeping', $rows[0]->expense_head);
        $this->assertNotSame('EXP-00001', $second->json('expense.expense_number'));
    }

    public function test_till_expense_replay_by_external_id_is_one_row(): void
    {
        $payload = [
            'external_id' => 'exp_1763800000000_ab12',
            'expense_head' => 'Tea',
            'amount' => 30.00,
            'payment_mode' => 'Cash',
        ];

        $first = $this->bookExpense($payload)->assertStatus(201);
        $this->bookExpense($payload)->assertStatus(201)
            ->assertJsonPath('expense.id', $first->json('expense.id'));

        $this->assertSame(1, \App\Models\Expense::where('store_id', $this->store->id)->count());
    }

    public function test_expense_route_answers_to_the_drawer_control(): void
    {
        $this->counter->update([
            'permission_profile' => array_merge(CounterProfile::defaults(), ['modules' => ['pos']]),
        ]);

        $this->bookExpense([
            'expense_head' => 'Tea',
            'amount' => 20.00,
            'payment_mode' => 'Cash',
        ])->assertStatus(403);

        $this->counter->update([
            'permission_profile' => array_merge(CounterProfile::defaults(), ['cash_drawer' => false]),
        ]);

        $this->bookExpense([
            'expense_head' => 'Tea',
            'amount' => 20.00,
            'payment_mode' => 'Cash',
        ])->assertStatus(403);

        $this->counter->update(['permission_profile' => CounterProfile::defaults()]);

        $this->bookExpense([
            'expense_head' => 'Tea',
            'amount' => 20.00,
            'payment_mode' => 'Cash',
        ])->assertStatus(201);
    }

    public function test_upi_expense_without_reference_is_refused(): void
    {
        $this->bookExpense([
            'expense_head' => 'Courier',
            'amount' => 90.00,
            'payment_mode' => 'UPI',
        ])->assertStatus(422);

        $this->bookExpense([
            'expense_head' => 'Courier',
            'amount' => 90.00,
            'payment_mode' => 'UPI',
            'reference_no' => 'UTR-EXP-9912',
        ])->assertStatus(201);
    }

    public function test_cash_expense_reduces_store_day_close_cash(): void
    {
        CounterShift::create([
            'store_id' => $this->store->id,
            'counter_id' => $this->counter->id,
            'opening_float' => 500.00,
            'status' => 'open',
            'opened_at' => now(),
        ]);

        $this->bookExpense([
            'expense_head' => 'Tea',
            'amount' => 50.00,
            'payment_mode' => 'Cash',
        ])->assertStatus(201);

        $summary = app(StoreDayCloseService::class)->summary($this->store->id, now()->toDateString());

        $this->assertSame(50.0, (float) $summary['cash']['cash_expenses']);
        $this->assertSame(450.0, (float) $summary['cash']['expected']);
    }
}
