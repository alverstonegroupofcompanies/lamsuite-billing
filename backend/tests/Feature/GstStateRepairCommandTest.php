<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * MST-01 backfill: rows written before party state validation carry '32' (or
 * arbitrary text). The repair is journalled, dry-runnable and reversible, and
 * it reports history it must not rewrite.
 */
class GstStateRepairCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $kerala;
    private Store $karnataka;
    private Store $legacy;
    private Party $mismatched;
    private Party $invalid;
    private Party $legacyDefault;
    private Party $explicit;
    private Party $badGstin;
    private ?string $journalBackup = null;

    protected function setUp(): void
    {
        parent::setUp();

        $journal = $this->journalPath();
        if (file_exists($journal)) {
            $this->journalBackup = (string) file_get_contents($journal);
            unlink($journal);
        }

        $this->kerala = Store::create([
            'name' => 'Kerala Store', 'code' => 'KL-R', 'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5', 'is_active' => true, 'version' => 1,
        ]);
        $this->karnataka = Store::create([
            'name' => 'Karnataka Store', 'code' => 'KA-R', 'state_code' => '29',
            'gstin' => '29AAAAA0000A2Z4', 'is_active' => true, 'version' => 1,
        ]);
        $this->legacy = Store::create([
            'name' => 'Legacy Store', 'code' => 'TN-R', 'state_code' => '3232',
            'gstin' => '33AAAAA0000A3Z3', 'is_active' => true, 'version' => 1,
        ]);

        $this->mismatched = $this->party($this->kerala, 'Maharashtra Supplier', '27ABCDE1234F1Z5', '32');
        $this->invalid = $this->party($this->karnataka, 'Invalid State Customer', null, '3232');
        $this->legacyDefault = $this->party($this->karnataka, 'Defaulted Customer', null, '32');
        $this->explicit = $this->party($this->kerala, 'Deliberate Tamil Nadu', null, '33');
        $this->badGstin = $this->party($this->kerala, 'Bad GSTIN Customer', 'BADGSTIN', 'KERALA');
    }

    protected function tearDown(): void
    {
        $journal = $this->journalPath();
        if (file_exists($journal)) {
            unlink($journal);
        }
        if ($this->journalBackup !== null) {
            file_put_contents($journal, $this->journalBackup);
        }

        parent::tearDown();
    }

    public function test_dry_run_reports_without_writing(): void
    {
        $this->artisan('lamsuite:gst-state-repair', ['--dry-run' => true])->assertSuccessful();

        $this->assertSame('32', $this->mismatched->fresh()->state_code);
        $this->assertSame('3232', $this->invalid->fresh()->state_code);
        $this->assertSame('3232', $this->legacy->fresh()->state_code);
        $this->assertFileDoesNotExist($this->journalPath());
    }

    public function test_a_bare_run_is_a_dry_run(): void
    {
        $this->artisan('lamsuite:gst-state-repair')->assertSuccessful();

        $this->assertSame('32', $this->mismatched->fresh()->state_code);
        $this->assertSame('3232', $this->invalid->fresh()->state_code);
        $this->assertSame('32', $this->legacyDefault->fresh()->state_code);
        $this->assertFileDoesNotExist($this->journalPath());
    }

    public function test_repairs_from_gstin_and_store_and_journals_the_change(): void
    {
        $this->artisan('lamsuite:gst-state-repair', ['--apply' => true])->assertSuccessful();

        $this->assertSame('27', $this->mismatched->fresh()->state_code);
        $this->assertSame('29', $this->invalid->fresh()->state_code);
        $this->assertSame('29', $this->legacyDefault->fresh()->state_code);
        $this->assertSame('33', $this->explicit->fresh()->state_code, 'An explicit valid state is a deliberate choice.');
        $this->assertSame('32', $this->badGstin->fresh()->state_code, 'An unreadable GSTIN defers to the store state.');
        $this->assertSame('33', $this->legacy->fresh()->state_code);

        $journal = json_decode((string) file_get_contents($this->journalPath()), true);
        $this->assertNotEmpty($journal['changes']);
    }

    public function test_rollback_restores_the_previous_values(): void
    {
        $this->artisan('lamsuite:gst-state-repair', ['--apply' => true])->assertSuccessful();
        $this->assertSame('27', $this->mismatched->fresh()->state_code);

        $this->artisan('lamsuite:gst-state-repair', ['--rollback' => true])->assertSuccessful();

        $this->assertSame('32', $this->mismatched->fresh()->state_code);
        $this->assertSame('3232', $this->invalid->fresh()->state_code);
        $this->assertSame('3232', $this->legacy->fresh()->state_code);
        $this->assertSame('KERALA', $this->badGstin->fresh()->state_code);
    }

    public function test_rollback_refuses_a_journal_from_another_database(): void
    {
        file_put_contents($this->journalPath(), json_encode([
            'database' => 'sqlite:/somewhere/else.sqlite',
            'changes' => [
                ['table' => 'parties', 'id' => $this->explicit->id, 'column' => 'state_code', 'old' => '07', 'new' => '33', 'reason' => 'gstin'],
            ],
        ]));

        $this->artisan('lamsuite:gst-state-repair', ['--rollback' => true])->assertFailed();

        $this->assertSame('33', $this->explicit->fresh()->state_code);
    }

    public function test_apply_will_not_mix_into_another_databases_journal(): void
    {
        file_put_contents($this->journalPath(), json_encode([
            'database' => 'sqlite:/somewhere/else.sqlite',
            'changes' => [
                ['table' => 'parties', 'id' => 999, 'column' => 'state_code', 'old' => '32', 'new' => '27', 'reason' => 'gstin'],
            ],
        ]));

        $this->artisan('lamsuite:gst-state-repair', ['--apply' => true])->assertFailed();

        $this->assertSame('32', $this->mismatched->fresh()->state_code);
    }

    public function test_only_invalid_leaves_a_legacy_default_alone(): void
    {
        $this->artisan('lamsuite:gst-state-repair', ['--only-invalid' => true, '--apply' => true])->assertSuccessful();

        $this->assertSame('29', $this->invalid->fresh()->state_code);
        $this->assertSame('27', $this->mismatched->fresh()->state_code);
        $this->assertSame('32', $this->legacyDefault->fresh()->state_code);
    }

    public function test_history_is_reported_not_rewritten(): void
    {
        $invoiceId = DB::table('invoices')->insertGetId([
            'store_id' => $this->kerala->id,
            'invoice_number' => 'INV-R-1',
            'invoice_date' => '2026-10-01',
            'customer_id' => $this->mismatched->id,
            'customer_name' => 'Maharashtra Supplier',
            'place_of_supply' => '32',
            'subtotal' => 100,
            'tax_total' => 12,
            'grand_total' => 112,
        ]);

        $this->artisan('lamsuite:gst-state-repair', ['--apply' => true])->assertSuccessful();

        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();
        $this->assertSame('32', $invoice->place_of_supply);
        $this->assertSame($this->mismatched->id, (int) $invoice->customer_id);
        $this->assertSame('27', $this->mismatched->fresh()->state_code);
    }

    private function party(Store $store, string $name, ?string $gstin, string $state): Party
    {
        return Party::create([
            'store_id' => $store->id,
            'type' => 'customer',
            'name' => $name,
            'gstin' => $gstin,
            'state_code' => $state,
            'is_active' => true,
            'version' => 1,
        ]);
    }

    private function journalPath(): string
    {
        return storage_path('app/gst-state-repair.json');
    }
}
