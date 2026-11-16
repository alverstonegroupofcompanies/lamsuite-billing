<?php

namespace Tests\Feature;

use App\Exceptions\BusinessRuleException;
use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\Store;
use App\Models\StoreDayClose;
use App\Models\User;
use App\Services\DayClose\StoreDayCloseService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class DayCloseTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $superAdmin;
    protected User $manager;
    protected Counter $counter;
    protected string $day;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Apex Healthcare',
            'code' => 'APEX-01',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'admin@apex.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->manager = User::create([
            'name' => 'Manager',
            'email' => 'manager@apex.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->store->id,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C-01',
            'counter_name' => 'Main Counter',
            'status' => 'active',
        ]);

        $this->day = now()->toDateString();
    }

    private function seedTradingDay(): void
    {
        $invoice = $this->makeInvoice(['grand_total' => 1000, 'tax_total' => 50]);

        InvoicePayment::create([
            'store_id' => $this->store->id,
            'invoice_id' => $invoice->id,
            'counter_code' => 'C-01',
            'payment_mode' => 'Cash',
            'amount' => 600,
            'status' => 'received',
        ]);

        InvoicePayment::create([
            'store_id' => $this->store->id,
            'invoice_id' => $invoice->id,
            'counter_code' => 'C-01',
            'payment_mode' => 'UPI',
            'amount' => 400,
            'status' => 'received',
        ]);

        $this->makeInvoice([
            'module_key' => 'credit_note',
            'grand_total' => 100,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ]);

        Expense::create([
            'store_id' => $this->store->id,
            'expense_head' => 'Tea & supplies',
            'amount' => 50,
            'payment_mode' => 'Cash',
            'expense_date' => $this->day,
        ]);

        CounterShift::create([
            'store_id' => $this->store->id,
            'counter_id' => $this->counter->id,
            'opening_float' => 500,
            'status' => 'open',
            'opened_at' => now(),
        ]);
    }

    private function makeInvoice(array $overrides = []): Invoice
    {
        static $sequence = 1;

        return Invoice::create(array_merge([
            'store_id' => $this->store->id,
            'counter_id' => $this->counter->id,
            'counter_code' => 'C-01',
            'module_key' => 'pos',
            'invoice_number' => 'TST-' . $sequence++,
            'invoice_date' => $this->day,
            'grand_total' => 0,
            'tax_total' => 0,
            'status' => 'completed',
            'payment_mode' => 'Cash',
        ], $overrides));
    }

    public function test_summary_computes_tender_and_cash_math(): void
    {
        $this->seedTradingDay();

        $summary = app(StoreDayCloseService::class)->summary($this->store->id, $this->day);

        $this->assertSame(1000.0, $summary['sales']['gross_total']);
        $this->assertSame(1, $summary['sales']['bills_count']);
        $this->assertSame(600.0, $summary['tenders']['cash']['collected']);
        $this->assertSame(400.0, $summary['tenders']['upi']['collected']);
        $this->assertSame(100.0, $summary['tenders']['cash']['refunded']);
        $this->assertSame(100.0, $summary['returns']['total']);
        $this->assertSame(500.0, $summary['cash']['opening_float']);
        $this->assertSame(50.0, $summary['cash']['cash_expenses']);
        // 500 float + 600 cash - 100 cash refund - 50 cash expense
        $this->assertSame(950.0, $summary['cash']['expected']);
        $this->assertSame(500.0, $summary['totals']['cash_collected']);
        $this->assertSame(400.0, $summary['totals']['digital_collected']);
        $this->assertSame('C-01', $summary['counters'][0]['counter_code'] ?? null);
        $this->assertCount(1, $summary['shifts']);
    }

    public function test_close_persists_totals_and_reconcile_locks_day(): void
    {
        $this->seedTradingDay();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/day-close/close', [
                'close_date' => $this->day,
                'notes' => 'Night close',
            ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('day_close.saved.status', 'closed')
            ->assertJsonPath('day_close.cash.expected', 950);

        $close = StoreDayClose::firstOrFail();
        $this->assertSame('950.00', $close->expected_cash);
        $this->assertSame('500.00', $close->total_cash_collected);
        $this->assertSame('400.00', $close->total_digital_collected);
        $this->assertSame('100.00', $close->total_refunds);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/day-close/reconcile', [
                'close_date' => $this->day,
                'counted_cash' => 940,
            ])
            ->assertOk()
            ->assertJsonPath('day_close.saved.status', 'reconciled')
            ->assertJsonPath('day_close.saved.cash_variance', -10);

        $close = $close->fresh();
        $this->assertSame('reconciled', $close->status);
        $this->assertNotNull($close->locked_at);
        $this->assertSame('-10.00', $close->cash_variance);
    }

    public function test_reconciled_day_blocks_backdated_invoice(): void
    {
        $this->seedTradingDay();
        $service = app(StoreDayCloseService::class);
        $close = $service->close($this->store->id, $this->day);
        $service->reconcile($close, 950);

        $this->expectException(BusinessRuleException::class);

        $this->makeInvoice(['grand_total' => 25]);
    }

    public function test_open_day_still_accepts_invoices(): void
    {
        $this->seedTradingDay();
        $service = app(StoreDayCloseService::class);
        $service->close($this->store->id, $this->day);

        $invoice = $this->makeInvoice(['grand_total' => 25]);

        $this->assertNotNull($invoice->id);
    }

    public function test_super_admin_override_bypasses_lock(): void
    {
        $service = app(StoreDayCloseService::class);
        $close = $service->close($this->store->id, $this->day);
        $service->reconcile($close, 0);

        $admin = $this->superAdmin;
        $this->app->instance('request', Request::create('/api/invoices', 'POST', ['override_day_close_lock' => true]));
        // setUserResolver must run on the container-bound instance: binding clears it.
        $this->app->make('request')->setUserResolver(static fn () => $admin);

        $this->assertTrue($this->app->make('request')->user()->isSuperAdmin());
        $this->assertTrue($this->app->make('request')->boolean('override_day_close_lock'));
        $service->assertDayOpen($this->store->id, $this->day);

        $this->assertTrue(true);
    }

    public function test_reopen_requires_super_admin(): void
    {
        $service = app(StoreDayCloseService::class);
        $close = $service->close($this->store->id, $this->day);
        $service->reconcile($close, 950);

        $this->actingAs($this->manager, 'sanctum')
            ->postJson('/api/admin/day-close/reopen', ['close_date' => $this->day])
            ->assertStatus(403);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/day-close/reopen', ['close_date' => $this->day, 'reason' => 'Late bill'])
            ->assertOk()
            ->assertJsonPath('day_close.saved.status', 'closed');

        $this->assertNull($close->fresh()->locked_at);
    }

    public function test_history_lists_closed_days(): void
    {
        $service = app(StoreDayCloseService::class);
        $service->close($this->store->id, $this->day);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson("/api/admin/day-close/history")
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('history.0.close_date', $this->day)
            ->assertJsonPath('history.0.status', 'closed');
    }
}
