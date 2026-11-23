<?php

namespace Tests\Feature;

use App\Exceptions\BusinessRuleException;
use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoiceApproval;
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
        // G12: cancellation is a till route, so these tests speak as a claimed counter.
        $this->actAsClaimedCounterOfRequestedStore();

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

    /** G12: the manager's own credentials mint the grant the till presents. */
    private function grantCancel(Invoice $invoice): string
    {
        return $this->grantCancellationToken($invoice, [
            'action' => 'cancel',
            'mode' => 'manager',
            'identifier' => 'manager@apex.in',
            'secret' => 'password123',
            'requested_by_user_id' => $this->manager->id,
            'counter_code' => 'C-01',
        ]);
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

    public function test_closed_day_blocks_cancellation_until_the_day_is_reopened(): void
    {
        $invoice = $this->makeInvoice(['grand_total' => 25]);
        $token = $this->grantCancel($invoice);

        $service = app(StoreDayCloseService::class);
        $service->close($this->store->id, $this->day);

        $this->postJson("/api/invoices/{$invoice->id}/cancel", [
            'reason' => 'Customer changed mind',
            'approval_token' => $token,
        ])->assertStatus(409)->assertJson(['code' => 'DAY_CLOSED_LOCKED']);

        $this->assertSame('completed', $invoice->fresh()->status);
        // A refused cancellation must not spend the grant it was handed.
        $this->assertNull(InvoiceApproval::firstOrFail()->consumed_at);

        $close = StoreDayClose::where('store_id', $this->store->id)->firstOrFail();
        $service->reopen($close, 'Late cancellation');

        $this->assertSame('open', $close->fresh()->status);

        $this->postJson("/api/invoices/{$invoice->id}/cancel", [
            'reason' => 'Customer changed mind',
            'approval_token' => $token,
        ])->assertOk();

        $this->assertSame('cancelled', $invoice->fresh()->status);
        $this->assertNotNull(InvoiceApproval::firstOrFail()->consumed_at);
    }

    public function test_reconciled_day_blocks_cancellation(): void
    {
        $invoice = $this->makeInvoice(['grand_total' => 25]);
        $token = $this->grantCancel($invoice);

        $service = app(StoreDayCloseService::class);
        $close = $service->close($this->store->id, $this->day);
        $service->reconcile($close, 0);

        $this->postJson("/api/invoices/{$invoice->id}/cancel", [
            'reason' => 'After reconciliation',
            'approval_token' => $token,
        ])->assertStatus(409)->assertJson(['code' => 'DAY_CLOSED_LOCKED']);

        $this->assertSame('completed', $invoice->fresh()->status);
    }

    public function test_super_admin_override_cancels_on_a_closed_day_and_is_audited(): void
    {
        $invoice = $this->makeInvoice(['grand_total' => 25]);
        $token = $this->grantCancel($invoice);

        app(StoreDayCloseService::class)->close($this->store->id, $this->day);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/invoices/{$invoice->id}/cancel", [
                'reason' => 'Owner correction',
                'approval_token' => $token,
                'override_day_close_lock' => true,
                'override_reason' => 'Bill keyed against the wrong customer',
            ])->assertOk();

        $this->assertSame('cancelled', $invoice->fresh()->status);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'day_close_lock_overridden',
            'entity_type' => 'StoreDayClose',
            'user_id' => $this->superAdmin->id,
        ]);
    }

    public function test_override_without_a_reason_is_refused(): void
    {
        $invoice = $this->makeInvoice(['grand_total' => 25]);
        $token = $this->grantCancel($invoice);

        app(StoreDayCloseService::class)->close($this->store->id, $this->day);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/invoices/{$invoice->id}/cancel", [
                'reason' => 'Owner correction',
                'approval_token' => $token,
                'override_day_close_lock' => true,
            ])->assertStatus(422)->assertJson(['code' => 'DAY_CLOSE_OVERRIDE_REASON_REQUIRED']);

        $this->assertSame('completed', $invoice->fresh()->status);
        $this->assertNull(InvoiceApproval::firstOrFail()->consumed_at);
    }

    public function test_a_closed_day_can_be_reopened_without_super_admin(): void
    {
        app(StoreDayCloseService::class)->close($this->store->id, $this->day);

        $this->actingAs($this->manager, 'sanctum')
            ->postJson('/api/admin/day-close/reopen', ['close_date' => $this->day, 'reason' => 'Closed too early'])
            ->assertOk()
            ->assertJsonPath('day_close.saved.status', 'open');

        $this->assertDatabaseHas('audit_logs', ['action' => 'reopen_store_day']);
    }

    public function test_super_admin_override_bypasses_lock(): void
    {
        $service = app(StoreDayCloseService::class);
        $close = $service->close($this->store->id, $this->day);
        $service->reconcile($close, 0);

        $admin = $this->superAdmin;
        $this->app->instance('request', Request::create('/api/invoices', 'POST', ['override_day_close_lock' => true, 'override_reason' => 'Late supplier bill']));
        // setUserResolver must run on the container-bound instance: binding clears it.
        $this->app->make('request')->setUserResolver(static fn () => $admin);

        $this->assertTrue($this->app->make('request')->user()->isSuperAdmin());
        $this->assertTrue($this->app->make('request')->boolean('override_day_close_lock'));
        $service->assertDayOpen($this->store->id, $this->day);

        // G12: the bypass is no longer silent.
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'day_close_lock_overridden',
            'entity_type' => 'StoreDayClose',
            'user_id' => $this->superAdmin->id,
        ]);
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
            ->assertJsonPath('day_close.saved.status', 'open');

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
