<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoiceApproval;
use App\Models\Store;
use App\Models\StoreDayClose;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * G12 backfill: `day-close:audit` reports by default and only writes the two
 * safe repairs when asked. It never un-cancels a bill.
 */
class AuditDayCloseCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'Audit Store', 'code' => 'AUD-G12', 'is_active' => true]);
        $this->cashier = User::create([
            'name' => 'Cashier',
            'email' => 'cashier@g12.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);
    }

    private function cancelledInvoice(string $number): Invoice
    {
        return Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => $number,
            'invoice_date' => '2026-11-21',
            'grand_total' => 100,
            'status' => 'cancelled',
            'cancelled_at' => '2026-11-21 18:00:00',
        ]);
    }

    private function grantFor(Invoice $invoice): InvoiceApproval
    {
        return InvoiceApproval::create([
            'store_id' => $this->store->id,
            'invoice_id' => $invoice->id,
            'action' => 'cancel',
            'mode' => 'manager',
            'status' => 'used',
            'requested_by_user_id' => $this->cashier->id,
            'used_at' => '2026-11-21 17:59:00',
        ]);
    }

    public function test_dry_run_reports_but_writes_nothing(): void
    {
        $withGrant = $this->cancelledInvoice('G12-1');
        $this->grantFor($withGrant);
        $this->cancelledInvoice('G12-2');

        $this->artisan('day-close:audit')
            ->expectsOutputToContain('cancelled without a recorded approval')
            ->expectsOutputToContain('1 row(s) can be stamped')
            ->assertSuccessful();

        $this->assertNull($withGrant->fresh()->cancelled_by);
    }

    public function test_backfill_stamps_only_cancels_with_exactly_one_prior_grant(): void
    {
        $withGrant = $this->cancelledInvoice('G12-1');
        $this->grantFor($withGrant);
        $without = $this->cancelledInvoice('G12-2');

        $this->artisan('day-close:audit', ['--backfill-cancelled-by' => true])->assertSuccessful();

        $this->assertSame($this->cashier->id, (int) $withGrant->fresh()->cancelled_by);
        $this->assertNull($without->fresh()->cancelled_by);
        $this->assertSame('cancelled', $without->fresh()->status);
        $this->assertSame(1, AuditLog::where('action', 'invoice_cancelled_by_backfilled')->count());
    }

    public function test_repairs_a_reopened_day_left_stored_as_closed(): void
    {
        $close = StoreDayClose::create([
            'store_id' => $this->store->id,
            'close_date' => '2026-11-21',
            'status' => 'closed',
        ]);
        AuditLog::log('reopen_store_day', 'StoreDayClose', (string) $close->id, null, [], $this->store->id);

        $this->artisan('day-close:audit')->assertSuccessful();
        $this->assertSame('closed', $close->fresh()->status);

        $this->artisan('day-close:audit', ['--repair-reopened' => true])->assertSuccessful();
        $this->assertSame('open', $close->fresh()->status);
    }
}
