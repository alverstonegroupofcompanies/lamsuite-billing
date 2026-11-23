<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Notification;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\User;
use App\Services\Parties\SupplierBalanceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * G9-LEDGER follow-up: the four holes left after the first pass.
 *  - a till's party push must never restate the server's supplier balance (PAY-01);
 *  - a purchase entered through POST /api/purchases names the counter that took it (AUD-01);
 *  - stock driven below zero by any till stock event raises an alert (AUD-02);
 *  - the balance rebuild never wipes a balance that no document explains.
 */
class LedgerGapsTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private Party $supplier;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Gap Store',
            'code' => 'GAP01',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        // The stock-event ingest files its legacy stock_adjustments row under user 1, so a
        // database without one refuses the push (a separate defect); give it one.
        User::create([
            'store_id' => $this->store->id,
            'name' => 'Gap Owner',
            'email' => 'gap-owner@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Main Counter',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'external_id' => 'sup_gap_1',
            'name' => 'Gap Distributors',
            'gstin' => '32AAAAA3333DD1Z5',
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Gap Tablet',
            'current_stock' => 2,
            'mrp' => 100.00,
            'sel_rate' => 100.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'GAP-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 2,
            'mrp' => 100.00,
            'selling_rate' => 100.00,
        ]);
    }

    private function pushInward(): void
    {
        $this->withHeader('X-Store-Id', $this->store->id)->postJson('/api/sync/push/purchases', ['purchases' => [[
            'id' => 'pur_gap_1',
            'external_id' => 'pur_gap_1',
            'purchase_number' => 'C01-PUR-3001',
            'supplier_invoice_no' => 'SUP-GAP-1',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'purchase_date' => '2026-11-21',
            'module_key' => 'purchase',
            'subtotal' => 10000,
            'tax_total' => 1200,
            'round_off' => 0,
            'grand_total' => 11200,
            'status' => 'received',
            'items' => [[
                'product_id' => (string) $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'GAP-B2',
                'expiry_date' => '2028-12-31',
                'pack_qty' => 100,
                'units_per_pack' => 1,
                'purchase_rate' => 100,
                'mrp' => 150,
                'gst_percent' => 12,
                'taxable_amount' => 10000,
                'tax_amount' => 1200,
                'total_amount' => 11200,
            ]],
        ]]])->assertStatus(200);
    }

    private function pushParty(array $party): void
    {
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/parties', ['parties' => [$party]])
            ->assertStatus(200);
    }

    // --- PAY-01: the till's party push -----------------------------------------------

    public function test_a_supplier_repush_does_not_restate_the_server_balance(): void
    {
        $this->pushInward();
        $this->assertSame(11200.0, (float) $this->supplier->fresh()->current_balance);

        // The till's own running figure travels with the record; it must not win.
        $this->pushParty([
            'external_id' => 'sup_gap_1',
            'type' => 'supplier',
            'name' => 'Gap Distributors (renamed)',
            'gstin' => $this->supplier->gstin,
            'outstanding_balance' => 0,
        ]);

        $supplier = $this->supplier->fresh();
        $this->assertSame('Gap Distributors (renamed)', $supplier->name, 'the rest of the record still syncs');
        $this->assertSame(11200.0, (float) $supplier->current_balance);
        $this->assertSame(0.0, (float) $supplier->opening_balance);
        $this->assertSame(11200.0, app(SupplierBalanceService::class)->expectedBalance($supplier));
    }

    public function test_a_changed_supplier_opening_balance_moves_the_balance_by_the_difference(): void
    {
        $this->pushInward();

        $this->pushParty([
            'external_id' => 'sup_gap_1',
            'type' => 'supplier',
            'name' => 'Gap Distributors',
            'opening_balance' => 500,
            'outstanding_balance' => 99999,
        ]);

        $supplier = $this->supplier->fresh();
        $this->assertSame(500.0, (float) $supplier->opening_balance);
        $this->assertSame(11700.0, (float) $supplier->current_balance);
        $this->assertSame(11700.0, app(SupplierBalanceService::class)->expectedBalance($supplier));
    }

    public function test_a_new_supplier_starts_at_its_opening_balance_not_the_till_running_total(): void
    {
        $this->pushParty([
            'external_id' => 'sup_gap_new',
            'type' => 'supplier',
            'name' => 'Fresh Supplier',
            'opening_balance' => 750,
            'outstanding_balance' => 4000,
        ]);

        $supplier = Party::where('external_id', 'sup_gap_new')->firstOrFail();
        $this->assertSame(750.0, (float) $supplier->opening_balance);
        $this->assertSame(750.0, (float) $supplier->current_balance);
    }

    // --- AUD-01: the direct purchase route ---------------------------------------------

    public function test_a_purchase_posted_through_the_api_names_its_counter(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)->postJson('/api/purchases', [
            'supplier_id' => $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'invoice_number' => 'SUP-GAP-API-1',
            'invoice_date' => '2026-11-21',
            'place_of_supply' => '32',
            'lines' => [[
                'product_id' => $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'GAP-API-B1',
                'expiry_date' => '2028-12-31',
                'pack_qty' => 10,
                'units_per_pack' => 1,
                'purchase_rate' => 100,
                'mrp' => 150,
                'gst_percent' => 12,
            ]],
        ]);
        $response->assertStatus(201);

        $purchase = Purchase::findOrFail($response->json('purchase.id'));
        $this->assertSame($this->counter->id, (int) $purchase->counter_id);
        $this->assertSame('C01', $purchase->counter_code);

        $rows = StockLedgerEntry::where('reference_id', (string) $purchase->id)
            ->where('event_type', 'PURCHASE_RECEIPT')
            ->get();
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertSame('C01', $row->counter_code);
        }
    }

    // --- AUD-02: negative stock from a till stock event ----------------------------------

    public function test_a_stock_event_that_drives_a_batch_negative_raises_one_alert(): void
    {
        $event = fn (string $id, float $delta) => [
            'id' => $id,
            'idempotency_key' => $id,
            'product_id' => $this->product->id,
            'batch_id' => $this->batch->id,
            'batch_no' => 'GAP-B1',
            'counter_code' => 'C01',
            'qty_delta' => $delta,
            'reference_type' => 'invoice',
            'reference_id' => 'C01-INV-' . $id,
        ];

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/stock-events', ['events' => [$event('gap_s1', -5)]])
            ->assertStatus(200);

        $this->assertSame(-3.0, (float) $this->batch->fresh()->stock_qty);
        $alert = Notification::where('type', 'negative_stock')->firstOrFail();
        $this->assertSame($this->store->id, (int) $alert->store_id);
        $this->assertSame($this->product->id, (int) $alert->data['product_id']);

        // A second sale off the same empty shelf the same day is the same problem, not a new one.
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/stock-events', ['events' => [$event('gap_s2', -1)]])
            ->assertStatus(200);

        $this->assertSame(1, Notification::where('type', 'negative_stock')->count());
    }

    public function test_a_stock_event_that_stays_positive_raises_nothing(): void
    {
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/stock-events', ['events' => [[
                'id' => 'gap_ok',
                'idempotency_key' => 'gap_ok',
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'GAP-B1',
                'qty_delta' => -1,
                'reference_type' => 'invoice',
                'reference_id' => 'C01-INV-OK',
            ]]])
            ->assertStatus(200);

        $this->assertSame(0, Notification::where('type', 'negative_stock')->count());
    }

    // --- the rebuild command -----------------------------------------------------------

    public function test_the_rebuild_leaves_a_balance_no_document_explains_unless_told(): void
    {
        // Imported from a previous system: a balance with no bills or payments behind it.
        $imported = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Imported Supplier',
            'opening_balance' => 0,
            'current_balance' => 5000,
            'is_active' => true,
        ]);

        $this->artisan('parties:rebuild-supplier-balances', ['--store' => $this->store->id, '--apply' => true])
            ->expectsOutputToContain('no documents')
            ->assertSuccessful();
        $this->assertSame(5000.0, (float) $imported->fresh()->current_balance);

        $this->artisan('parties:rebuild-supplier-balances', [
            '--store' => $this->store->id,
            '--apply' => true,
            '--include-undocumented' => true,
        ])->assertSuccessful();
        $this->assertSame(0.0, (float) $imported->fresh()->current_balance);
    }

    public function test_the_rebuild_still_corrects_a_supplier_whose_bills_were_never_counted(): void
    {
        $this->pushInward();
        Party::whereKey($this->supplier->id)->update(['current_balance' => 0]);

        $this->artisan('parties:rebuild-supplier-balances', ['--store' => $this->store->id, '--apply' => true])
            ->assertSuccessful();

        $this->assertSame(11200.0, (float) $this->supplier->fresh()->current_balance);
    }
}
