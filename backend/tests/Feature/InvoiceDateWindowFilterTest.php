<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * invoice_date is TEXT, and the column really does hold both shapes: bills synced from the till
 * carry a bare 'YYYY-MM-DD' while seeded and older rows carry 'YYYY-MM-DD 00:00:00'. A window
 * built by appending ' 00:00:00' / ' 23:59:59' and compared as a string silently drops every
 * bare-date bill, which is how the Past Bills "Today" chip came back empty on a day full of bills.
 */
class InvoiceDateWindowFilterTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;
    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Date Window Store',
            'code' => 'DWIN01',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Date Window Admin',
            'email' => 'dwin-admin@test.local',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Window Tablet',
            'current_stock' => 100,
            'mrp' => 118.00,
            'sel_rate' => 100.00,
            'gst_percent' => 18.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);
    }

    /** A bill whose stored invoice_date is exactly the text given, bypassing the date cast. */
    private function bill(string $number, string $storedDate): Invoice
    {
        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'customer_name' => 'Registered Buyer',
            'customer_gstin' => '32ABCDE1234F1Z5',
            'place_of_supply' => '32',
            'invoice_number' => $number,
            'invoice_date' => substr($storedDate, 0, 10),
            'module_key' => 'invoice',
            'taxable_subtotal' => 100.00,
            'cgst_total' => 9.00,
            'sgst_total' => 9.00,
            'tax_total' => 18.00,
            'round_off' => 0.00,
            'grand_total' => 118.00,
            'paid_amount' => 118.00,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ]);

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $this->product->id,
            'product_name' => $this->product->name,
            'batch_no' => 'BCH-DWIN',
            'qty' => 1,
            'units_per_pack' => 1,
            'unit_price' => 100.00,
            'taxable_amount' => 100.00,
            'gst_percent' => 18,
            'tax_amount' => 18.00,
            'total_amount' => 118.00,
        ]);

        DB::table('invoices')->where('id', $invoice->id)->update(['invoice_date' => $storedDate]);

        return $invoice;
    }

    private function listedNumbers(string $query): array
    {
        $res = $this->withHeader('X-Store-Id', $this->store->id)
            ->getJson('/api/invoices?store_id=' . $this->store->id . '&per_page=100&' . $query)
            ->assertStatus(200);

        $numbers = array_column($res->json('data') ?? [], 'invoice_number');
        sort($numbers);

        return $numbers;
    }

    /** Every invoice_number anywhere in a nested report payload. */
    private function invoiceNumbersIn($node): array
    {
        $found = [];
        foreach ((array) $node as $key => $value) {
            if ($key === 'invoice_number' && is_string($value)) {
                $found[] = $value;
            } elseif (is_array($value)) {
                $found = array_merge($found, $this->invoiceNumbersIn($value));
            }
        }

        return $found;
    }

    public function test_the_today_window_returns_bills_whether_or_not_their_date_carries_a_time(): void
    {
        $this->bill('DWIN-BARE', '2026-11-19');
        $this->bill('DWIN-STAMP', '2026-11-19 14:30:22');
        $this->bill('DWIN-EARLIER', '2026-11-18');
        $this->bill('DWIN-LATER', '2026-11-20 09:15:00');

        $this->assertSame(
            ['DWIN-BARE', 'DWIN-STAMP'],
            $this->listedNumbers('start_date=2026-11-19&end_date=2026-11-19'),
            'a day that billed four times has to list the two bills raised on it'
        );
    }

    public function test_a_start_date_alone_does_not_drop_the_bare_dated_bill(): void
    {
        $this->bill('DWIN-FROM-BARE', '2026-11-19');
        $this->bill('DWIN-FROM-STAMP', '2026-11-20 08:00:00');
        $this->bill('DWIN-BEFORE', '2026-11-18 22:00:00');

        $this->assertSame(
            ['DWIN-FROM-BARE', 'DWIN-FROM-STAMP'],
            $this->listedNumbers('start_date=2026-11-19')
        );
    }

    public function test_an_end_date_alone_still_includes_the_last_day_whole(): void
    {
        $this->bill('DWIN-TO-BARE', '2026-11-19');
        $this->bill('DWIN-TO-STAMP', '2026-11-19 23:45:00');
        $this->bill('DWIN-AFTER', '2026-11-20');

        $this->assertSame(
            ['DWIN-TO-BARE', 'DWIN-TO-STAMP'],
            $this->listedNumbers('end_date=2026-11-19')
        );
    }

    public function test_gstr1_does_not_lose_bills_that_stored_a_bare_invoice_date(): void
    {
        $this->bill('DWIN-GSTR-BARE', '2026-11-19');
        $this->bill('DWIN-GSTR-STAMP', '2026-11-19 06:00:00');

        // The single-day window is what the "Today" chip sends; a month window hides this bug.
        $res = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/reports/gstr-1?start_date=2026-11-19&end_date=2026-11-19')
            ->assertStatus(200);

        $listed = $this->invoiceNumbersIn($res->json());
        sort($listed);

        $this->assertSame(
            ['DWIN-GSTR-BARE', 'DWIN-GSTR-STAMP'],
            $listed,
            'a return filed without its bare-dated invoices understates what was collected'
        );
    }

    public function test_the_tax_reconciliation_audit_reads_both_date_shapes(): void
    {
        $this->bill('DWIN-RECON-BARE', '2026-11-19');
        $this->bill('DWIN-RECON-STAMP', '2026-11-19 11:00:00');

        $res = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/reports/tax-reconciliation?start_date=2026-11-19&end_date=2026-11-19')
            ->assertStatus(200);

        $payload = json_encode($res->json());
        foreach (['DWIN-RECON-BARE', 'DWIN-RECON-STAMP'] as $number) {
            $this->assertStringContainsString($number, $payload, 'both bills were raised inside the window');
        }
    }

    /**
     * Every bill in the store was raised on 2026-11-19, so asking for that day alone must return
     * the same revenue as asking for the whole month. The window that reads only one of the two
     * stored date shapes fails this, whichever shape it happens to drop.
     */
    public function test_a_day_window_reports_the_same_revenue_as_a_window_covering_that_day(): void
    {
        $this->bill('DWIN-PROFIT-BARE', '2026-11-19');
        $this->bill('DWIN-PROFIT-STAMP', '2026-11-19 19:20:21');

        $admin = ['X-Store-Id' => (string) $this->store->id];

        $day = $this->actingAs($this->admin, 'sanctum')->withHeaders($admin)
            ->getJson('/api/reports/profit?start_date=2026-11-19&end_date=2026-11-19')
            ->assertStatus(200);
        $month = $this->actingAs($this->admin, 'sanctum')->withHeaders($admin)
            ->getJson('/api/reports/profit?start_date=2026-11-01&end_date=2026-11-30')
            ->assertStatus(200);

        $this->assertGreaterThan(0.0, (float) $month->json('total_revenue'), 'the fixture bills must carry revenue');
        $this->assertEqualsWithDelta(
            (float) $month->json('total_revenue'),
            (float) $day->json('total_revenue'),
            0.01,
            'one day of trading cannot be worth less than the month that contains only that day'
        );
    }

    public function test_a_day_window_reports_the_same_hsn_totals_as_a_window_covering_that_day(): void
    {
        $this->bill('DWIN-HSN-BARE', '2026-11-19');
        $this->bill('DWIN-HSN-STAMP', '2026-11-19 07:30:00');

        $admin = ['X-Store-Id' => (string) $this->store->id];

        $day = $this->actingAs($this->admin, 'sanctum')->withHeaders($admin)
            ->getJson('/api/reports/hsn-summary?start_date=2026-11-19&end_date=2026-11-19')
            ->assertStatus(200);
        $month = $this->actingAs($this->admin, 'sanctum')->withHeaders($admin)
            ->getJson('/api/reports/hsn-summary?start_date=2026-11-01&end_date=2026-11-30')
            ->assertStatus(200);

        $this->assertSame(
            $month->json('hsn_records'),
            $day->json('hsn_records'),
            'the HSN summary of a single trading day must equal the month that holds only that day'
        );
    }
}
