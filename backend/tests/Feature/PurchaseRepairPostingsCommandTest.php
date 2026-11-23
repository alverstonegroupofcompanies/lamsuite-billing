<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PUR-05 backfill. Bills saved through POST /purchases before the fix carry no stock movement
 * and count `qty` in base units (billed_units), while every other row counts packs. The repair
 * must post the units the bill really brought in — never qty × units_per_pack a second time —
 * and must name the debit notes it cannot repair because the server never received their lines.
 */
class PurchaseRepairPostingsCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Party $supplier;
    private Product $strip;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Repair Pharmacy',
            'code' => 'RPR01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Repair Distributors',
            'is_active' => true,
        ]);

        $this->strip = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Repair Paracet Strip',
            'current_stock' => 0,
            'mrp' => 90,
            'sel_rate' => 90,
            'gst_percent' => 12,
            'units_per_pack' => 15,
            'is_active' => true,
        ]);
    }

    /** A bill exactly as the old POST /purchases left it: qty = packs × 15, no ledger row. */
    private function legacyApiBill(string $number, array $item = []): Purchase
    {
        $purchase = Purchase::create([
            'store_id' => $this->store->id,
            'supplier_id' => $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'invoice_number' => $number,
            'supplier_invoice_no' => $number,
            'invoice_date' => '2026-11-21',
            'module_key' => 'purchase',
            'subtotal' => 6000,
            'tax_total' => 720,
            'grand_total' => 6720,
            'status' => 'received',
        ]);

        PurchaseItem::create(array_merge([
            'purchase_id' => $purchase->id,
            'product_id' => $this->strip->id,
            'product_name' => $this->strip->name,
            'batch_no' => 'PA-CHG',
            'expiry_date' => '2028-06-30',
            'pack_qty' => 100,
            'loose_qty' => 0,
            'free_qty' => 0,
            'units_per_pack' => 15,
            'qty' => 1500,
            'purchase_rate' => 60,
            'gst_percent' => 12,
            'taxable_amount' => 6000,
            'tax_amount' => 720,
            'total_amount' => 6720,
        ], $item));

        return $purchase;
    }

    private function batchStock(string $batchNo = 'PA-CHG'): float
    {
        return (float) ProductBatch::where('store_id', $this->store->id)->where('batch_no', $batchNo)->value('stock_qty');
    }

    public function test_dry_run_reports_the_unit_counted_line_and_changes_nothing(): void
    {
        $purchase = $this->legacyApiBill('QA-PB-003');

        $this->artisan('purchases:repair-postings')
            ->expectsOutputToContain('#' . $purchase->id . '  store')
            ->expectsOutputToContain('qty counted in units (1500) → 100 pack(s) of 15')
            ->assertSuccessful();

        $this->assertSame(0, ProductBatch::count());
        $this->assertEqualsWithDelta(1500.0, (float) PurchaseItem::firstOrFail()->qty, 0.001, 'a dry run writes nothing');
    }

    public function test_apply_posts_the_units_the_bill_brought_in_not_fifteen_times_them(): void
    {
        $purchase = $this->legacyApiBill('QA-PB-003');

        $this->artisan('purchases:repair-postings', ['--apply' => true])->assertSuccessful();

        $this->assertEqualsWithDelta(1500.0, $this->batchStock(), 0.001, 'a hundred strips of fifteen');
        $this->assertEqualsWithDelta(1500.0, (float) $this->strip->fresh()->current_stock, 0.001);
        $this->assertEqualsWithDelta(100.0, (float) PurchaseItem::firstOrFail()->qty, 0.001, 'qty is packs from now on');
        $this->assertEqualsWithDelta(1500.0, (float) StockLedgerEntry::where('reference_id', (string) $purchase->id)
            ->where('event_type', 'PURCHASE_RECEIPT')->sum('qty_delta'), 0.001);

        // A second run finds nothing left to post.
        $this->artisan('purchases:repair-postings', ['--apply' => true])->assertSuccessful();
        $this->assertEqualsWithDelta(1500.0, $this->batchStock(), 0.001);
    }

    public function test_a_pack_counted_line_is_left_as_packs(): void
    {
        // A single-unit product: qty 25 is both 25 packs and 25 units, so nothing is converted.
        $this->legacyApiBill('QA-PB-004', ['qty' => 4, 'pack_qty' => 4]);

        $this->artisan('purchases:repair-postings', ['--apply' => true])->assertSuccessful();

        $this->assertEqualsWithDelta(60.0, $this->batchStock(), 0.001, 'four strips of fifteen');
        $this->assertEqualsWithDelta(4.0, (float) PurchaseItem::firstOrFail()->qty, 0.001);
    }

    public function test_a_debit_note_saved_without_lines_is_named_for_the_owner(): void
    {
        $return = Purchase::create([
            'store_id' => $this->store->id,
            'supplier_id' => $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'invoice_number' => 'PR-4-1795278987',
            'invoice_date' => '2026-11-21',
            'module_key' => 'purchase_return',
            'subtotal' => 300,
            'tax_total' => 36,
            'grand_total' => 336,
            'status' => 'returned',
        ]);

        $this->artisan('purchases:repair-postings')
            ->expectsOutputToContain('#' . $return->id)
            ->expectsOutputToContain('no lines')
            ->assertSuccessful();
    }
}
