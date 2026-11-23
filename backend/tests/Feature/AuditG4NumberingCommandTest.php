<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * G4-NUMBERING — the survey reports the gaps and duplicates the old lease loop
 * left behind, and writes nothing.
 */
class AuditG4NumberingCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_reports_gaps_duplicates_and_run_ahead_without_writing(): void
    {
        $store = Store::create([
            'name' => 'LamStone AUD', 'code' => 'AUDG4', 'state_code' => '32',
            'tax_mode' => 'inclusive', 'gst_type' => 'regular', 'is_active' => true,
        ]);
        $counter = Counter::create([
            'store_id' => $store->id, 'counter_code' => 'C01',
            'counter_name' => 'C01 Counter', 'location_name' => 'Shop floor',
        ]);

        $sequence = CounterSequence::updateOrCreate(
            ['counter_id' => $counter->id, 'doc_type' => 'invoice', 'financial_year' => '2026-27'],
            ['store_id' => $store->id, 'prefix' => 'C01-INV', 'next_number' => 9201, 'range_start' => 9151, 'range_end' => 9200]
        );

        foreach (['C01-INV-8301', 'C01-INV-8302', 'C01-INV-8651', 'C01-INV-8651', 'C01-INV-9151'] as $i => $number) {
            DB::table('invoices')->insert([
                'store_id' => $store->id,
                'counter_id' => (string) $counter->id,
                'invoice_number' => $number,
                'invoice_date' => '2026-11-21',
                'external_id' => "aud_{$i}",
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $out = sys_get_temp_dir() . '/g4_audit_' . uniqid() . '.csv';

        $this->artisan('billing:audit-g4-numbering', ['--store' => $store->id, '--out' => $out])
            ->expectsOutputToContain('2 gap(s), 1 duplicate number(s).')
            ->assertSuccessful();

        $csv = array_map('str_getcsv', file($out, FILE_IGNORE_NEW_LINES));
        @unlink($out);

        $this->assertContains(['gap', (string) $store->id, (string) $counter->id, 'C01-INV', '2026-27', 'C01-INV-8303', 'C01-INV-8650', '348'], $csv);
        $this->assertContains(['gap', (string) $store->id, (string) $counter->id, 'C01-INV', '2026-27', 'C01-INV-8652', 'C01-INV-9150', '499'], $csv);
        $this->assertContains(['duplicate', (string) $store->id, '', '', '', 'C01-INV-8651', 'C01-INV-8651', '2'], $csv);

        // Dry run: the series and the bills are exactly as they were.
        $this->assertSame(9201, $sequence->fresh()->next_number);
        $this->assertSame(5, DB::table('invoices')->count());
    }
}
