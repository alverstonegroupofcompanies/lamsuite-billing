<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class DashboardMetricsTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Timezone Test Store',
            'code' => 'STORE-TZ',
            'state_code' => '32',
            'timezone' => 'Asia/Kolkata',
            'tax_mode' => 'inclusive',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'TZ Admin',
            'email' => 'tz-admin@example.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'store_id' => $this->store->id,
            'allowed_store_ids' => [$this->store->id],
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function makeInvoice(array $overrides = []): Invoice
    {
        return Invoice::create(array_merge([
            'store_id' => $this->store->id,
            'invoice_number' => 'INV-TZ-' . uniqid(),
            'invoice_date' => '2026-11-15',
            'customer_name' => 'Walk-in',
            'subtotal' => 1000,
            'taxable_subtotal' => 1000,
            'tax_total' => 0,
            'cgst_total' => 0,
            'sgst_total' => 0,
            'igst_total' => 0,
            'grand_total' => 1000,
            'paid_amount' => 1000,
            'payment_mode' => 'Cash',
            'status' => 'issued',
            'module_key' => 'invoice',
        ], $overrides));
    }

    public function test_defaults_to_store_calendar_day_not_server_utc_day(): void
    {
        // 00:30 IST on 2026-11-15 is still 2026-11-14 in UTC.
        Carbon::setTestNow(Carbon::parse('2026-11-14 19:00:00', 'UTC'));
        $this->actingAs($this->admin);

        $this->makeInvoice(['invoice_number' => 'INV-TZ-LATE', 'grand_total' => 500]);
        $this->makeInvoice([
            'invoice_number' => 'INV-TZ-PREV',
            'invoice_date' => '2026-11-14',
            'grand_total' => 999,
        ]);

        $res = $this->getJson('/api/dashboard/metrics?store_id=' . $this->store->id);
        $res->assertOk();

        $data = $res->json();
        $this->assertSame('2026-11-15', $data['date_range']['start_date']);
        $this->assertSame('2026-11-15', $data['date_range']['end_date']);
        $this->assertSame('Asia/Kolkata', $data['timezone']);
        $this->assertEquals(500, $data['gross_sales']);
        $this->assertSame(1, $data['bills_count']);
    }

    public function test_counts_sales_returns_and_credit_notes_as_returns(): void
    {
        $this->actingAs($this->admin);

        $this->makeInvoice(['invoice_number' => 'INV-TZ-SALE', 'grand_total' => 1000]);
        $this->makeInvoice([
            'invoice_number' => 'SR-TZ-01',
            'module_key' => 'sales_return',
            'grand_total' => 150,
            'payment_mode' => 'UPI',
        ]);
        $this->makeInvoice([
            'invoice_number' => 'CN-TZ-01',
            'module_key' => 'credit_note',
            'grand_total' => 50,
            'payment_mode' => 'UPI',
        ]);

        $res = $this->getJson('/api/dashboard/metrics?store_id=' . $this->store->id . '&start_date=2026-11-15&end_date=2026-11-15');
        $res->assertOk();

        $data = $res->json();
        $this->assertEquals(1000, $data['gross_sales']);
        $this->assertEquals(200, $data['total_returns']);
        $this->assertEquals(800, $data['net_sales']);
        $this->assertSame(1, $data['bills_count']);
    }

    public function test_header_only_invoice_still_produces_a_gst_slab(): void
    {
        $this->actingAs($this->admin);

        $this->makeInvoice([
            'invoice_number' => 'INV-TZ-HEADER',
            'subtotal' => 1000,
            'taxable_subtotal' => 1000,
            'tax_total' => 180,
            'cgst_total' => 90,
            'sgst_total' => 90,
            'grand_total' => 1180,
        ]);

        $res = $this->getJson('/api/dashboard/metrics?store_id=' . $this->store->id . '&start_date=2026-11-15&end_date=2026-11-15');
        $res->assertOk();

        $data = $res->json();
        $slabs = collect($data['gst']['slabs']);
        $slab18 = $slabs->firstWhere('rate', 18);

        $this->assertNotNull($slab18, 'GST quick view must not be empty for header-only invoices');
        $this->assertEquals(1000, $slab18['taxable_value']);
        $this->assertEquals(90, $slab18['cgst_amount']);
        $this->assertEquals(90, $slab18['sgst_amount']);
        $this->assertEquals(180, $slab18['total_tax']);
        $this->assertEquals(1000, $data['gst']['total_taxable']);
        $this->assertEquals(180, $data['gst']['total_tax_accrued']);
    }

    public function test_item_rows_win_over_header_totals(): void
    {
        $this->actingAs($this->admin);

        $inv = $this->makeInvoice([
            'invoice_number' => 'INV-TZ-ITEMS',
            'tax_total' => 180,
            'cgst_total' => 90,
            'sgst_total' => 90,
            'grand_total' => 1180,
        ]);

        InvoiceItem::create([
            'invoice_id' => $inv->id,
            'product_name' => 'Paracetamol',
            'hsn_code' => '300410',
            'qty' => 10,
            'unit_price' => 100,
            'taxable_amount' => 1000,
            'gst_percent' => 12,
            'cgst_amount' => 60,
            'sgst_amount' => 60,
            'igst_amount' => 0,
            'tax_amount' => 120,
            'total_amount' => 1120,
        ]);

        $res = $this->getJson('/api/dashboard/metrics?store_id=' . $this->store->id . '&start_date=2026-11-15&end_date=2026-11-15');
        $res->assertOk();

        $data = $res->json();
        $slab12 = collect($data['gst']['slabs'])->firstWhere('rate', 12);
        $this->assertNotNull($slab12);
        $this->assertEquals(1000, $slab12['taxable_value']);
        $this->assertEquals(120, $data['gst']['total_tax_accrued']);
        $this->assertEquals(1000, $data['gst']['total_taxable']);
    }
}
