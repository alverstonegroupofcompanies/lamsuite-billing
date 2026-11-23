<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Party;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AUD-01: a purchase bill has three identities — the till's running number, the
 * supplier's bill, and the counter that took it. The register has to retain all
 * three, or an owner cannot match the shelf receipt to the paper bill.
 */
class SyncPurchaseIdentifiersTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Party $supplier;
    private Product $product;
    private Counter $counter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Identity Store',
            'code' => 'IDENT01',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Main Counter',
            'location_name' => 'Shop Floor',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Kerala Wholesale Depot',
            'gstin' => '32AAAAA1111BB1Z9',
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Coconut Oil 500ml',
            'current_stock' => 0,
            'mrp' => 215.00,
            'sel_rate' => 200.00,
            'gst_percent' => 5.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);
    }

    private function push(array $overrides = []): \Illuminate\Testing\TestResponse
    {
        $payload = array_merge([
            'id' => 'pur_identity_1',
            'external_id' => 'pur_identity_1',
            'purchase_number' => 'C01-PUR-1001',
            'supplier_invoice_no' => 'QA-PB-002',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'purchase_date' => '2026-11-21',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'place_of_supply' => '32-State',
            'subtotal' => 11200,
            'tax_total' => 0,
            'round_off' => 0,
            'grand_total' => 11200,
            'status' => 'received',
            'items' => [[
                'product_id' => (string) $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'CO-01',
                'expiry_date' => '2027-12-31',
                'pack_qty' => 56,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'purchase_rate' => 200,
                'mrp' => 215,
                'gst_percent' => 5,
                'taxable_amount' => 11200,
                'tax_amount' => 0,
                'total_amount' => 11200,
            ]],
        ], $overrides);

        return $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/purchases', ['purchases' => [$payload]]);
    }

    public function test_synced_purchase_keeps_till_number_supplier_bill_counter_and_place_of_supply(): void
    {
        $this->push()->assertStatus(200)->assertJson(['ingested_count' => 1]);

        $purchase = Purchase::where('store_id', $this->store->id)
            ->where('invoice_number', 'QA-PB-002')
            ->firstOrFail();

        $this->assertSame('C01-PUR-1001', $purchase->document_number);
        $this->assertSame('QA-PB-002', $purchase->supplier_invoice_no);
        $this->assertSame('C01', $purchase->counter_code);
        $this->assertSame($this->counter->id, $purchase->counter_id);
        $this->assertSame('32', $purchase->place_of_supply, 'place of supply must not depend on charge heads');
    }

    public function test_purchase_stock_ledger_rows_carry_the_counter(): void
    {
        $this->push()->assertStatus(200);

        $purchase = Purchase::where('invoice_number', 'QA-PB-002')->firstOrFail();
        $entry = StockLedgerEntry::where('reference_type', 'PURCHASE')
            ->where('reference_id', (string) $purchase->id)
            ->firstOrFail();

        $this->assertSame($this->counter->id, $entry->counter_id);
        $this->assertSame('C01', $entry->counter_code);
        $this->assertSame('Shop Floor', $entry->location_name);
    }

    public function test_purchase_posting_writes_one_audit_row_and_resync_does_not_duplicate_it(): void
    {
        $this->push()->assertStatus(200);
        $purchase = Purchase::where('invoice_number', 'QA-PB-002')->firstOrFail();

        $this->assertSame(1, AuditLog::where('action', 'purchase_posted')
            ->where('entity_id', (string) $purchase->id)
            ->where('store_id', $this->store->id)
            ->count());

        $this->push()->assertStatus(200);

        $this->assertSame(1, AuditLog::where('action', 'purchase_posted')
            ->where('entity_id', (string) $purchase->id)
            ->count(), 'a queue retry must not add a second posting event');
        $this->assertSame(11200.0, (float) $this->supplier->fresh()->current_balance);
    }
}
