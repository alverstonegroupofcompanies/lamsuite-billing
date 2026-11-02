<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class RealDataReportsTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Apex Healthcare Store',
            'code' => 'STORE-APEX',
            'state_code' => '32',
            'tax_mode' => 'inclusive',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Apex Admin',
            'email' => 'admin@apex.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'store_id' => $this->store->id,
            'allowed_store_ids' => [$this->store->id],
        ]);
    }

    public function test_empty_store_returns_zeroes_and_empty_states_without_sample_data(): void
    {
        $this->actingAs($this->admin);

        // Daily collection
        $res = $this->getJson('/api/reports/daily-collection?store_id=' . $this->store->id);
        $res->assertOk();
        $data = $res->json();
        $this->assertEquals(0, $data['total_invoices_count']);
        $this->assertEquals(0.0, $data['gross_sales']);
        $this->assertEquals(0.0, $data['net_sales']);
        $this->assertEquals(0.0, $data['by_tender']['Cash']);

        // Top selling
        $res = $this->getJson('/api/reports/top-selling?store_id=' . $this->store->id);
        $res->assertOk();
        $this->assertEmpty($res->json());

        // Cash book
        $res = $this->getJson('/api/reports/cash-book?store_id=' . $this->store->id);
        $res->assertOk();
        $cb = $res->json();
        $this->assertEquals(0.0, $cb['opening_cash']);
        $this->assertEquals(0.0, $cb['cash_sales']);
        $this->assertEquals(0.0, $cb['closing_cash']);

        // Daily summary
        $res = $this->getJson('/api/reports/daily-summary?store_id=' . $this->store->id);
        $res->assertOk();
        $ds = $res->json();
        $this->assertEquals(0.0, $ds['total_sales']);
        $this->assertEquals(0, $ds['invoice_count']);

        // Profit
        $res = $this->getJson('/api/reports/profit?store_id=' . $this->store->id);
        $res->assertOk();
        $p = $res->json();
        $this->assertEquals(0.0, $p['total_revenue']);
        $this->assertEquals(0.0, $p['total_cogs']);
        $this->assertEquals(0.0, $p['gross_profit']);
        $this->assertEquals(0.0, $p['gross_margin_percent']);

        // Customer aging
        $res = $this->getJson('/api/reports/customer-aging?store_id=' . $this->store->id);
        $res->assertOk();
        $ca = $res->json();
        $this->assertEquals(0, $ca['total_customers_with_dues']);
        $this->assertEquals(0.0, $ca['total_outstanding']);
    }

    public function test_reports_tie_out_to_exact_paisa_with_real_transactions(): void
    {
        $this->actingAs($this->admin);

        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500mg',
            'hsn_sac_code' => '300410',
            'mrp' => 100.00,
            'sel_rate' => 90.00,
            'ptr' => 60.00,
            'gst_percent' => 12,
            'current_stock' => 50,
            'is_active' => true,
        ]);

        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Rahul Sharma',
            'phone' => '9447000000',
            'current_balance' => 200.00,
            'is_active' => true,
        ]);

        // Invoice 1: 10 units @ 90 = 900.00 total. Taxable = 803.57, Tax = 96.43 (CGST 48.21, SGST 48.21). Paid 700, balance 200.
        $inv1 = Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => 'INV-001',
            'invoice_date' => Carbon::today()->subDays(15),
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'subtotal' => 803.57,
            'tax_total' => 96.43,
            'cgst_total' => 48.21,
            'sgst_total' => 48.21,
            'grand_total' => 900.00,
            'paid_amount' => 700.00,
            'payment_mode' => 'Cash',
            'status' => 'issued',
            'module_key' => 'invoice',
        ]);

        InvoiceItem::create([
            'invoice_id' => $inv1->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'hsn_code' => '300410',
            'qty' => 10,
            'unit_price' => 90.00,
            'purchase_rate' => 60.00,
            'taxable_amount' => 803.57,
            'gst_percent' => 12,
            'tax_amount' => 96.43,
            'cgst_amount' => 48.21,
            'sgst_amount' => 48.21,
            'total_amount' => 900.00,
        ]);

        // 1. Profit Tie-out
        // Revenue = 900, COGS = 10 * 60 = 600, Gross Profit = 300, Margin = (300/900)*100 = 33.33%
        $resProfit = $this->getJson('/api/reports/profit?store_id=' . $this->store->id . '&start_date=' . Carbon::today()->subDays(20)->toDateString() . '&end_date=' . Carbon::today()->toDateString());
        $resProfit->assertOk();
        $profitData = $resProfit->json();
        $this->assertEquals(900.00, $profitData['total_revenue']);
        $this->assertEquals(600.00, $profitData['total_cogs']);
        $this->assertEquals(300.00, $profitData['gross_profit']);
        $this->assertEquals(33.33, $profitData['gross_margin_percent']);

        // 2. Customer Aging Tie-out: 200 due on 15 days ago -> falls into bracket_0_30
        $resAging = $this->getJson('/api/reports/customer-aging?store_id=' . $this->store->id);
        $resAging->assertOk();
        $agingData = $resAging->json();
        $this->assertEquals(1, $agingData['total_customers_with_dues']);
        $this->assertEquals(200.00, $agingData['total_outstanding']);
        $this->assertEquals(200.00, $agingData['customers'][0]['bracket_0_30']);
        $this->assertEquals(0.0, $agingData['customers'][0]['bracket_31_60']);
        $this->assertEquals(0.0, $agingData['customers'][0]['bracket_61_90']);
        $this->assertEquals(0.0, $agingData['customers'][0]['bracket_90_plus']);

        // 3. Top Selling Tie-out
        $resTop = $this->getJson('/api/reports/top-selling?store_id=' . $this->store->id . '&start_date=' . Carbon::today()->subDays(20)->toDateString() . '&end_date=' . Carbon::today()->toDateString());
        $resTop->assertOk();
        $topData = $resTop->json();
        $this->assertCount(1, $topData);
        $this->assertEquals('Amoxicillin 500mg', $topData[0]['name']);
        $this->assertEquals(10, $topData[0]['qty_sold']);
        $this->assertEquals(900.00, $topData[0]['revenue']);

        // 4. HSN Summary Tie-out
        $resHsn = $this->getJson('/api/reports/hsn-summary?store_id=' . $this->store->id . '&start_date=' . Carbon::today()->subDays(20)->toDateString() . '&end_date=' . Carbon::today()->toDateString());
        $resHsn->assertOk();
        $hsnData = $resHsn->json();
        $this->assertCount(1, $hsnData['hsn_records']);
        $this->assertEquals('300410', $hsnData['hsn_records'][0]['hsn_code']);
        $this->assertEquals(803.57, $hsnData['hsn_records'][0]['taxable_value']);
        $this->assertEquals(96.43, $hsnData['hsn_records'][0]['total_tax']);
    }
}
