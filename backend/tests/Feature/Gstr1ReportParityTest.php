<?php

namespace Tests\Feature;

use Illuminate\Support\Carbon;
use App\Models\Store;
use App\Models\User;
use Tests\Support\BuildsG14Fixtures;
use Tests\Support\RefreshLegacySqlite;
use Tests\TestCase;

/**
 * RPT-01: the admin GSTR-1 and the till GSTR-1 must agree with the line-level
 * oracle: taxable is the exclusive base, credit notes belong to Table 9, and
 * neither table may mix tax-inclusive amounts into a taxable value.
 */
class Gstr1ReportParityTest extends TestCase
{
    use RefreshLegacySqlite;
    use BuildsG14Fixtures;

    protected Store $store;
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = $this->g14Store(['timezone' => 'Asia/Kolkata']);
        $this->admin = $this->g14User($this->store);
        Carbon::setTestNow(Carbon::parse('2026-11-15 12:00:00', 'Asia/Kolkata'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function adminGstr1(): array
    {
        $res = $this->actingAs($this->admin)->getJson(
            '/api/admin/reports/gstr1?store_id=' . $this->store->id
                . '&start_date=2026-11-15&end_date=2026-11-15',
            ['X-Store-Id' => (string) $this->store->id]
        );
        $res->assertOk();

        return $res->json();
    }

    private function tillGstr1(): array
    {
        $res = $this->getJson(
            '/api/reports/gstr-1?store_id=' . $this->store->id
                . '&start_date=2026-11-15&end_date=2026-11-15'
        );
        $res->assertOk();

        return $res->json();
    }

    public function test_admin_and_till_gstr1_match_the_line_oracle(): void
    {
        $this->g14StandardDay($this->store);

        $admin = $this->adminGstr1();

        // Table 7: B2CS holds the two sale bills only, on their exclusive base.
        $b2cs = $admin['table_7_b2cs'];
        $this->assertSame(2, $b2cs['count']);
        $this->assertEqualsWithDelta(1151.79, (float) $b2cs['taxable_value'], 0.001);
        $this->assertEqualsWithDelta(138.21, (float) $b2cs['tax_amount'], 0.001);
        $this->assertEqualsWithDelta(1290.00, (float) $b2cs['invoice_value'], 0.001);

        // Table 4: no GSTIN customer in this day.
        $this->assertSame(0, $admin['table_4_b2b']['count']);

        // Table 9: the credit note, not a sale.
        $this->assertArrayHasKey('table_9_credit_notes', $admin);
        $creditNotes = $admin['table_9_credit_notes'];
        $this->assertSame(1, $creditNotes['count']);
        $this->assertEqualsWithDelta(34.00, (float) $creditNotes['note_value'], 0.001);
        $this->assertEqualsWithDelta(30.00, (float) $creditNotes['taxable_value'], 0.001);
        $this->assertEqualsWithDelta(3.60, (float) $creditNotes['tax_amount'], 0.001);

        // Table 12: HSN nets the return line.
        $hsn = collect($admin['table_12_hsn'])->firstWhere('hsn_code', 'OTHER');
        $this->assertNotNull($hsn);
        $this->assertEqualsWithDelta(1121.79, (float) $hsn['taxable_value'], 0.001);
        $this->assertEqualsWithDelta(1, (float) $hsn['total_qty'], 0.001);
        $this->assertEqualsWithDelta(67.31, (float) $hsn['cgst_amount'], 0.001);
        $this->assertEqualsWithDelta(67.30, (float) $hsn['sgst_amount'], 0.001);
        $this->assertEqualsWithDelta(134.61, (float) $hsn['total_tax'], 0.001);

        // Table 13 counts documents issued: the two sale bills, not the note.
        $this->assertSame(2, $admin['table_13_docs']['total_number']);

        // Till GSTR-1 must produce the same exclusive totals.
        $till = $this->tillGstr1();
        $tillB2cs = collect($till['table_7_b2c_small'])->firstWhere('place_of_supply', '32');
        $this->assertNotNull($tillB2cs);
        $this->assertEqualsWithDelta(1151.79, (float) $tillB2cs['taxable_value'], 0.001);
        $this->assertEqualsWithDelta(138.21, (float) $tillB2cs['tax_amount'], 0.001);
        $this->assertEqualsWithDelta(69.11, (float) $tillB2cs['cgst_amount'], 0.001);
        $this->assertEqualsWithDelta(69.10, (float) $tillB2cs['sgst_amount'], 0.001);

        $this->assertCount(1, $till['table_9_credit_debit_notes']);
        $this->assertEqualsWithDelta(
            30.00,
            (float) $till['table_9_credit_debit_notes'][0]['taxable_value'],
            0.001
        );
    }

    public function test_header_only_bill_is_taxable_grand_minus_tax(): void
    {
        // A legacy header-only bill: no item rows, and taxable_subtotal was
        // never backfilled so it is 0 rather than null.
        $this->g14Invoice($this->store, [
            'invoice_number' => 'G14-HEADER-ONLY',
            'subtotal' => 112.00,
            'taxable_subtotal' => 0,
            'tax_total' => 12.00,
            'cgst_total' => 6.00,
            'sgst_total' => 6.00,
            'grand_total' => 112.00,
            'paid_amount' => 112.00,
        ]);

        $admin = $this->adminGstr1();
        $this->assertEqualsWithDelta(100.00, (float) $admin['table_7_b2cs']['taxable_value'], 0.001);
        $this->assertEqualsWithDelta(12.00, (float) $admin['table_7_b2cs']['tax_amount'], 0.001);

        $till = $this->tillGstr1();
        $row = collect($till['table_7_b2c_small'])->firstWhere('place_of_supply', '32');
        $this->assertNotNull($row);
        $this->assertEqualsWithDelta(100.00, (float) $row['taxable_value'], 0.001);
        $this->assertEqualsWithDelta(12.00, (float) $row['tax_amount'], 0.001);
    }

    public function test_zero_value_document_never_inflates_turnover(): void
    {
        // A degenerate bill: grand total 0 with a stale subtotal left on the
        // header. It is a document, but it is not turnover.
        $this->g14Invoice($this->store, [
            'invoice_number' => 'G14-ZERO-VALUE',
            'subtotal' => 90.00,
            'taxable_subtotal' => 0,
            'tax_total' => 0,
            'grand_total' => 0,
        ], [[
            'product_name' => 'G14 Zero',
            'qty' => 1,
            'unit_price' => 0,
            'taxable_amount' => 0,
            'total_amount' => 0,
        ]]);

        $admin = $this->adminGstr1();
        $this->assertSame(1, $admin['table_7_b2cs']['count']);
        $this->assertEqualsWithDelta(0.0, (float) $admin['table_7_b2cs']['taxable_value'], 0.001);
        $this->assertEqualsWithDelta(0.0, (float) $admin['table_7_b2cs']['invoice_value'], 0.001);

        $till = $this->tillGstr1();
        $row = collect($till['table_7_b2c_small'])->firstWhere('place_of_supply', '32');
        $this->assertNotNull($row);
        $this->assertEqualsWithDelta(0.0, (float) $row['taxable_value'], 0.001);
    }
}
