<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * G11-TAX / RC-6 — the survey that tells the owner what the fixed defects already
 * wrote into the books. It runs over stored documents only, so the test plants the
 * four marks and checks each one is named without a single figure moving.
 */
class AuditG11TaxCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Survey Pharmacy',
            'code' => 'SURVEY1',
            'state_code' => '29',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500 Strip',
            'hsn_sac_code' => '3004',
            'mrp' => 90,
            'sel_rate' => 90,
            'gst_percent' => 12,
            'units_per_pack' => 15,
            'current_stock' => 300,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'PA-01',
            'expiry_date' => '2028-01-31',
            'stock_qty' => 300,
            'mrp' => 90,
            'selling_rate' => 90,
        ]);
    }

    private function bill(array $header, array $items): Invoice
    {
        $invoice = Invoice::create(array_merge([
            'store_id' => $this->store->id,
            'module_key' => 'invoice',
            'invoice_number' => 'C01-INV-' . str_pad((string) (Invoice::count() + 1), 4, '0', STR_PAD_LEFT),
            'invoice_date' => '2026-11-10',
            'customer_name' => 'Walk-in Customer',
            'place_of_supply' => '29',
            'taxable_subtotal' => 0,
            'tax_total' => 0,
            'grand_total' => 0,
            'paid_amount' => 0,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ], $header));

        foreach ($items as $item) {
            InvoiceItem::create(array_merge([
                'invoice_id' => $invoice->id,
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'PA-01',
                'qty' => 1,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'unit_price' => 90,
                'gst_percent' => 12,
                'taxable_amount' => 90,
                'total_amount' => 90,
            ], $item));
        }

        return $invoice;
    }

    public function test_it_names_every_defect_the_fixed_rules_would_have_refused(): void
    {
        // TAX-02: a strip billed at Rs 150 against an MRP of Rs 90.
        $this->bill(['invoice_number' => 'C01-INV-MRP'], [[
            'unit_price' => 150,
            'taxable_amount' => 133.93,
            'tax_amount' => 16.07,
            'total_amount' => 150,
        ]]);

        // TAX-01: the Rs 9 that a 10% percent took was taken again, so an inclusive
        // line of Rs 90 came down to Rs 72 and the line holds Rs 18 of discount.
        $this->bill(['invoice_number' => 'C01-INV-DISC-INCLUSIVE'], [[
            'unit_price' => 90,
            'discount_percent' => 10,
            'discount_amount' => 18,
            'taxable_amount' => 64.29,
            'tax_amount' => 7.71,
            'total_amount' => 72,
        ]]);

        // TAX-01 again on an exclusive line: the same Rs 18, read as the gap to the
        // taxable figure rather than the gap to the total.
        $this->bill(['invoice_number' => 'C01-INV-DISC-EXCLUSIVE'], [[
            'unit_price' => 90,
            'discount_percent' => 10,
            'discount_amount' => 18,
            'taxable_amount' => 72,
            'tax_amount' => 8.64,
            'total_amount' => 80.64,
        ]]);

        // The Rs 90 strip priced by the fixed rules: the percent came off once. Naming
        // this would send the owner re-filing a bill that was always right.
        $this->bill(['invoice_number' => 'C01-INV-ECHO-OK'], [[
            'unit_price' => 90,
            'discount_percent' => 10,
            'discount_amount' => 9,
            'taxable_amount' => 72.32,
            'tax_amount' => 8.68,
            'total_amount' => 81,
        ]]);

        // A 10% trade percent beside a separate Rs 20 scheme amount is two real
        // discounts, and their sum is not twice the percent.
        $this->bill(['invoice_number' => 'C01-INV-TWO-OK'], [[
            'qty' => 10,
            'unit_price' => 90,
            'discount_percent' => 10,
            'discount_amount' => 110,
            'taxable_amount' => 705.36,
            'tax_amount' => 84.64,
            'total_amount' => 790,
        ]]);

        // TAX-03: a walk-in sale charged IGST although the counter stands in Karnataka.
        $this->bill(['igst_total' => 72, 'tax_total' => 72, 'taxable_subtotal' => 600, 'grand_total' => 672], []);

        // TAX-03 again, this time a place of supply the buyer never gave.
        $this->bill(['place_of_supply' => '07'], []);

        // RET-01: five of the fifteen tablets came back and the till re-added the tax.
        $this->bill(['invoice_number' => 'C01-INV-ORIG'], [[
            'qty' => 15,
            'unit_price' => 6,
            'taxable_amount' => 80.36,
            'tax_amount' => 9.64,
            'total_amount' => 90,
        ]]);
        $this->bill([
            'module_key' => 'credit_note',
            'invoice_number' => 'SR-0001',
            'original_invoice_number' => 'C01-INV-ORIG',
            'grand_total' => 33.60,
        ], [[
            'qty' => 5,
            'unit_price' => 6.72,
            'taxable_amount' => 30,
            'tax_amount' => 3.60,
            'total_amount' => 33.60,
        ]]);

        $before = [
            'invoices' => Invoice::count(),
            'items' => InvoiceItem::count(),
            'ledger' => StockLedgerEntry::count(),
            'money' => (float) Invoice::sum('grand_total'),
        ];

        $csv = tempnam(sys_get_temp_dir(), 'g11audit') . '.csv';
        $this->artisan('billing:audit-g11-tax', ['--out' => $csv])->assertExitCode(0);

        $this->assertSame($before, [
            'invoices' => Invoice::count(),
            'items' => InvoiceItem::count(),
            'ledger' => StockLedgerEntry::count(),
            'money' => (float) Invoice::sum('grand_total'),
        ], 'a survey that reports must not also rewrite');

        $report = array_map(
            fn (string $line): array => str_getcsv($line),
            array_slice(explode("\n", trim((string) file_get_contents($csv))), 1)
        );
        $findings = array_column($report, 5);

        foreach (['ABOVE_MRP', 'DOUBLE_DISCOUNT', 'IGST_ON_LOCAL_SALE', 'WRONG_PLACE_OF_SUPPLY', 'RETURN_REPRICED'] as $expected) {
            $this->assertContains($expected, $findings, "{$expected} should reach the owner's CSV");
        }

        $this->assertSame(2, count(array_filter($findings, fn (string $f): bool => $f === 'DOUBLE_DISCOUNT')),
            'the double take reaches the owner on both readings of a line, and nowhere else');

        $documents = array_column($report, 1);
        $this->assertNotContains('C01-INV-ECHO-OK', $documents,
            'a discount that came off once is not damage the owner has to re-file');
        $this->assertNotContains('C01-INV-TWO-OK', $documents,
            'a trade percent beside a scheme amount is two discounts the owner agreed to');

        // The tablet line that was credited Rs 33.60 for Rs 30.00 of billed value.
        $this->assertStringContainsString('the extra Rs 3.60 was GST', (string) file_get_contents($csv));

        unlink($csv);
    }

    public function test_it_only_reads_the_store_and_window_it_is_asked_to(): void
    {
        $csv = tempnam(sys_get_temp_dir(), 'g11audit') . '.csv';

        // Today's bill above MRP, and one from the previous month outside the window.
        $this->bill([], [['unit_price' => 150, 'taxable_amount' => 150, 'total_amount' => 150]]);

        $other = Store::create([
            'name' => 'Other Branch',
            'code' => 'SURVEY2',
            'state_code' => '29',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'is_active' => true,
        ]);
        $this->bill(['store_id' => $other->id, 'invoice_date' => '2026-09-05', 'invoice_number' => 'C02-INV-0001'], []);

        $this->artisan('billing:audit-g11-tax', [
            '--store' => $this->store->id,
            '--from' => '2026-10-01',
            '--to' => '2026-10-31',
            '--out' => $csv,
        ])->assertExitCode(0);

        $rows = array_slice(explode("\n", trim((string) file_get_contents($csv))), 1);

        // Nothing inside the window belongs to this store, so the file holds only its header.
        $this->assertSame([], array_filter($rows), 'the survey must keep to the store and dates it was given');

        unlink($csv);
    }
}
