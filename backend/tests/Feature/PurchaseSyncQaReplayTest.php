<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * G3-PURCHASE-SYNC, QA round 3 replays. PurchasePostingGuardsTest pins each defect's main
 * case; these replay the exact shapes QA pushed (tests/qa/r3/j3_*, j5_03) and the edges
 * around them: both sides labelled "32-State", a return keyed like an inward bill, returns
 * with no number of their own, one bill number shared by two suppliers, and a server bill
 * naming another store's product or supplier.
 */
class PurchaseSyncQaReplayTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private Party $supplier;
    private Party $otherSupplier;
    private Product $strip;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Replay Pharmacy',
            'code' => 'RPL01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->otherStore = Store::create([
            'name' => 'Replay Cosmetics',
            'code' => 'RPL02',
            'store_type' => 'retail',
            'state_code' => '32',
            'is_active' => true,
        ]);

        Sanctum::actingAs(User::create([
            'name' => 'Replay Owner',
            'email' => 'owner@replay.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]));

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Replay Pharma Distributors',
            'gstin' => '32AAACQ1234A1Z1',
            'is_active' => true,
        ]);

        $this->otherSupplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Replay Surgicals',
            'gstin' => '32AAACR9999A1Z1',
            'is_active' => true,
        ]);

        // A strip of 15 tablets, as QA's PA-OLD / PA-NEW.
        $this->strip = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Replay Paracet 500 Strip',
            'current_stock' => 0,
            'mrp' => 90.00,
            'sel_rate' => 90.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 15,
            'is_active' => true,
        ]);
    }

    private function batchPush(array $payload, string $queueId = 'q-1')
    {
        return $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/batch', ['items' => [[
                'id' => $queueId,
                'entity_type' => 'purchase',
                'action' => 'create',
                'payload' => $payload,
            ]]]);
    }

    /** An inward of $packs strips of 15 into $batch, shaped as purchaseService enqueues it. */
    private function inward(string $billNo, int $packs = 10, array $overrides = []): array
    {
        $taxable = $packs * 60;
        $tax = round($taxable * 0.12, 2);

        return array_merge([
            'id' => 'pur_' . $billNo,
            'external_id' => 'pur_' . $billNo,
            'purchase_number' => 'C02-PUR-' . $billNo,
            'supplier_invoice_no' => $billNo,
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'purchase_date' => '2026-11-21',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'status' => 'received',
            'subtotal' => $taxable,
            'tax_total' => $tax,
            'cgst_total' => $tax / 2,
            'sgst_total' => $tax / 2,
            'grand_total' => $taxable + $tax,
            'items' => [[
                'product_id' => (string) $this->strip->id,
                'product_name' => $this->strip->name,
                'batch_no' => 'PA-NEW',
                'expiry_date' => '2028-01-31',
                'pack_qty' => $packs,
                'loose_qty' => 0,
                'units_per_pack' => 15,
                'purchase_rate' => 60,
                'mrp' => 90,
                'gst_percent' => 12,
                'taxable_amount' => $taxable,
                'tax_amount' => $tax,
                'total_amount' => $taxable + $tax,
            ]],
        ], $overrides);
    }

    /**
     * The return exactly as tests/qa/r3/j5_03_purchase_return.cjs pushed it: the inward bill's
     * shape (items[], purchase_number, packs + total_units) with module_key purchase_return and
     * no return_number.
     */
    private function qaReturn(string $no, int $packs, array $itemOverrides = [], array $overrides = []): array
    {
        $taxable = $packs * 60;
        $tax = round($taxable * 0.12, 2);

        return array_merge([
            'id' => 'pr_' . $no,
            'external_id' => 'pr_' . $no,
            'purchase_number' => $no,
            'module_key' => 'purchase_return',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'supplier_invoice_no' => $no,
            'original_purchase_number' => 'QA-PB-002',
            'purchase_date' => '2026-11-21',
            'place_of_supply' => '32',
            'store_id' => (string) $this->store->id,
            'subtotal' => $taxable,
            'tax_total' => $tax,
            'cgst_total' => $tax / 2,
            'sgst_total' => $tax / 2,
            'grand_total' => $taxable + $tax,
            'status' => 'returned',
            'items' => [array_merge([
                'id' => 'pri_' . $no,
                'product_id' => (string) $this->strip->id,
                'product_name' => $this->strip->name,
                'batch_no' => 'PA-NEW',
                'expiry_date' => '2028-01-31',
                'pack_qty' => $packs,
                'loose_qty' => 0,
                'units_per_pack' => 15,
                'total_units' => $packs * 15,
                'purchase_rate' => 60,
                'gst_percent' => 12,
                'taxable_amount' => $taxable,
                'cgst_amount' => $tax / 2,
                'sgst_amount' => $tax / 2,
                'tax_amount' => $tax,
                'total_amount' => $taxable + $tax,
            ], $itemOverrides)],
        ], $overrides);
    }

    private function batchStock(): float
    {
        return (float) ProductBatch::where('store_id', $this->store->id)
            ->where('product_id', $this->strip->id)
            ->where('batch_no', 'PA-NEW')
            ->value('stock_qty');
    }

    private function returns()
    {
        return Purchase::where('store_id', $this->store->id)->where('module_key', 'purchase_return');
    }

    // ── PUR-01 ────────────────────────────────────────────────────────────────

    public function test_bill_and_charges_both_labelled_32_state_post_with_their_charges(): void
    {
        $this->batchPush($this->inward('QA-PB-001', 10, [
            'place_of_supply' => '32-State',
            'charges' => [
                ['external_id' => 'chg-f', 'head_code' => 'FREIGHT', 'amount' => 200, 'gst_percent' => 18,
                    'treatment' => 'add_to_cost', 'place_of_supply' => '32-State'],
                ['external_id' => 'chg-p', 'head_code' => 'PACKING', 'amount' => 100, 'gst_percent' => 18,
                    'treatment' => 'expense', 'place_of_supply' => '32-State'],
            ],
        ]))->assertOk()->assertJson(['success' => true, 'results' => ['processed' => 1, 'failed' => 0]]);

        $purchase = Purchase::where('store_id', $this->store->id)->where('supplier_invoice_no', 'QA-PB-001')->firstOrFail();
        $this->assertSame(2, PurchaseCharge::where('purchase_id', $purchase->id)->count());
        $this->assertSame('32', $purchase->place_of_supply);
        $this->assertEqualsWithDelta(150.0, $this->batchStock(), 0.001, 'ten strips of fifteen reach the shelf');
    }

    public function test_a_charge_from_another_state_is_still_refused_and_reported_per_item(): void
    {
        $response = $this->batchPush($this->inward('QA-PB-001', 10, [
            'place_of_supply' => '32-State',
            'charges' => [
                ['external_id' => 'chg-f', 'head_code' => 'FREIGHT', 'amount' => 200, 'gst_percent' => 18,
                    'place_of_supply' => '29-Karnataka'],
            ],
        ]), 'q-charge');

        $response->assertOk()->assertJson(['success' => false, 'results' => ['processed' => 0, 'failed' => 1]]);
        $this->assertSame('q-charge', $response->json('results.errors.0.id'));
        $this->assertSame(0, Purchase::where('store_id', $this->store->id)->count());
    }

    // ── PUR-05 ────────────────────────────────────────────────────────────────

    public function test_server_bill_ledger_rows_add_up_to_every_line_including_loose_and_free(): void
    {
        $other = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Replay Cough Syrup',
            'current_stock' => 0,
            'mrp' => 120,
            'sel_rate' => 110,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->postJson('/api/purchases', [
            'supplier_id' => $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'invoice_number' => 'QA-PB-003',
            'invoice_date' => '2026-11-21',
            'place_of_supply' => '32',
            'charges' => [
                ['head_code' => 'FREIGHT', 'amount' => 200, 'gst_percent' => 18, 'treatment' => 'add_to_cost'],
            ],
            'lines' => [
                ['product_id' => $this->strip->id, 'product_name' => $this->strip->name, 'batch_no' => 'PA-CHG',
                    'expiry_date' => '2028-06-30', 'pack_qty' => 100, 'loose_qty' => 5, 'free_qty' => 2,
                    'units_per_pack' => 15, 'purchase_rate' => 60, 'gst_percent' => 12],
                ['product_id' => $other->id, 'product_name' => $other->name, 'batch_no' => 'CS-CHG',
                    'expiry_date' => '2028-06-30', 'pack_qty' => 25, 'units_per_pack' => 1,
                    'purchase_rate' => 80, 'gst_percent' => 12],
            ],
        ])->assertCreated();

        $purchase = Purchase::where('store_id', $this->store->id)->where('invoice_number', 'QA-PB-003')->firstOrFail();
        $ledger = StockLedgerEntry::where('reference_type', 'PURCHASE')->where('reference_id', (string) $purchase->id);

        // (100 + 2 free) × 15 + 5 loose = 1535 tablets, and 25 bottles.
        $this->assertSame(2, (clone $ledger)->where('event_type', 'PURCHASE_RECEIPT')->count());
        $this->assertEqualsWithDelta(1560.0, (float) (clone $ledger)->sum('qty_delta'), 0.001);
        $this->assertEqualsWithDelta(1535.0, (float) ProductBatch::where('batch_no', 'PA-CHG')->value('stock_qty'), 0.001);
        $this->assertEqualsWithDelta(25.0, (float) ProductBatch::where('batch_no', 'CS-CHG')->value('stock_qty'), 0.001);
        $this->assertGreaterThan(0, (float) ProductBatch::where('batch_no', 'PA-CHG')->value('landed_cost_rate'),
            'the freight share lands on the batch the bill created');
    }

    public function test_server_bill_naming_another_stores_product_is_refused_and_moves_nothing(): void
    {
        $foreign = Product::create([
            'store_id' => $this->otherStore->id,
            'name' => 'Replay Face Cream',
            'current_stock' => 7,
            'mrp' => 300,
            'sel_rate' => 280,
            'gst_percent' => 18,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->postJson('/api/purchases', [
            'supplier_id' => $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'invoice_number' => 'QA-PB-X1',
            'invoice_date' => '2026-11-21',
            'lines' => [[
                'product_id' => $foreign->id, 'product_name' => $foreign->name, 'batch_no' => 'X-1',
                'expiry_date' => '2028-06-30', 'pack_qty' => 3, 'purchase_rate' => 100, 'gst_percent' => 18,
            ]],
        ])->assertStatus(422)->assertJsonValidationErrors(['lines.0.product_id']);

        $this->assertSame(0, Purchase::count());
        $this->assertEqualsWithDelta(7.0, (float) $foreign->fresh()->current_stock, 0.001);
        $this->assertSame(0, ProductBatch::where('batch_no', 'X-1')->count());
    }

    public function test_server_bill_naming_another_stores_supplier_is_refused(): void
    {
        $foreignSupplier = Party::create([
            'store_id' => $this->otherStore->id,
            'type' => 'supplier',
            'name' => 'Replay Foreign Supplier',
            'is_active' => true,
        ]);

        $this->postJson('/api/purchases', [
            'supplier_id' => $foreignSupplier->id,
            'supplier_name' => $foreignSupplier->name,
            'invoice_number' => 'QA-PB-X2',
            'invoice_date' => '2026-11-21',
            'lines' => [[
                'product_id' => $this->strip->id, 'product_name' => $this->strip->name, 'batch_no' => 'X-2',
                'expiry_date' => '2028-06-30', 'pack_qty' => 1, 'units_per_pack' => 15,
                'purchase_rate' => 60, 'gst_percent' => 12,
            ]],
        ])->assertStatus(422)->assertJsonValidationErrors(['supplier_id']);

        $this->assertSame(0, Purchase::count());
        $this->assertEqualsWithDelta(0.0, (float) $foreignSupplier->fresh()->current_balance, 0.001);
    }

    // ── PUR-06 ────────────────────────────────────────────────────────────────

    public function test_two_suppliers_sharing_a_bill_number_keep_their_own_bills(): void
    {
        $this->batchPush($this->inward('1001', 2))->assertJson(['results' => ['failed' => 0]]);
        $this->batchPush($this->inward('1001', 3, [
            'id' => 'pur_1001_b',
            'external_id' => 'pur_1001_b',
            'purchase_number' => 'C02-PUR-1001-B',
            'supplier_id' => (string) $this->otherSupplier->id,
            'supplier_name' => $this->otherSupplier->name,
            'supplier_gstin' => $this->otherSupplier->gstin,
        ]))->assertJson(['results' => ['failed' => 0]]);

        $bills = Purchase::where('store_id', $this->store->id)->where('supplier_invoice_no', '1001')->get();
        $this->assertCount(2, $bills);
        $this->assertEqualsCanonicalizing([$this->supplier->id, $this->otherSupplier->id], $bills->pluck('supplier_id')->all());
        $this->assertEqualsWithDelta(75.0, $this->batchStock(), 0.001, 'two strips and three strips, fifteen each');
    }

    public function test_a_cancelled_bill_number_can_be_filed_again(): void
    {
        $this->batchPush($this->inward('QA-PB-009', 2))->assertJson(['results' => ['failed' => 0]]);
        $this->batchPush($this->inward('QA-PB-009', 2, ['status' => 'cancelled', 'items' => []]))
            ->assertJson(['results' => ['failed' => 0]]);

        $this->batchPush($this->inward('QA-PB-009', 4, [
            'id' => 'pur_QA-PB-009_again',
            'external_id' => 'pur_QA-PB-009_again',
            'purchase_number' => 'C02-PUR-QA-PB-009-2',
        ]))->assertJson(['results' => ['failed' => 0]]);

        $this->assertEqualsWithDelta(60.0, $this->batchStock(), 0.001, 'only the live bill holds stock');
    }

    // ── PUR-07 ────────────────────────────────────────────────────────────────

    public function test_qa_return_shape_saves_its_line_and_takes_the_tablets_back(): void
    {
        $this->batchPush($this->inward('QA-PB-002', 10))->assertJson(['results' => ['failed' => 0]]);
        $balanceBefore = (float) $this->supplier->fresh()->current_balance;

        $this->batchPush($this->qaReturn('C02-PR-QA2', 5))
            ->assertJson(['results' => ['processed' => 1, 'failed' => 0]]);

        $return = $this->returns()->firstOrFail();
        $this->assertSame('C02-PR-QA2', $return->invoice_number);
        $line = $return->items()->firstOrFail();
        $this->assertEqualsWithDelta(75.0, (float) $line->qty, 0.001, 'five strips go back as seventy-five tablets');
        $this->assertEqualsWithDelta(36.0, (float) $line->tax_amount, 0.001);
        $this->assertEqualsWithDelta(36.0, (float) $return->tax_total, 0.001);

        $this->assertEqualsWithDelta(75.0, $this->batchStock(), 0.001, '150 in, 75 back');
        $this->assertEqualsWithDelta(-75.0, (float) StockLedgerEntry::where('reference_type', 'PURCHASE_RETURN')
            ->where('reference_id', (string) $return->id)->sum('qty_delta'), 0.001);
        $this->assertEqualsWithDelta($balanceBefore - 336.0, (float) $this->supplier->fresh()->current_balance, 0.001);
    }

    public function test_items_shaped_return_counting_packs_without_total_units_is_still_in_tablets(): void
    {
        $this->batchPush($this->inward('QA-PB-002', 10))->assertJson(['results' => ['failed' => 0]]);

        // An inward-shaped line carries qty in packs, exactly as purchase_items stores it.
        $this->batchPush($this->qaReturn('C02-PR-QA3', 2, ['total_units' => null, 'pack_qty' => null, 'qty' => 2]))
            ->assertJson(['results' => ['failed' => 0]]);

        $this->assertEqualsWithDelta(120.0, $this->batchStock(), 0.001, 'two strips are thirty tablets, not two');
    }

    public function test_qa_over_return_is_refused_and_leaves_no_document(): void
    {
        $this->batchPush($this->inward('QA-PB-002', 10))->assertJson(['results' => ['failed' => 0]]);

        $response = $this->batchPush($this->qaReturn('C02-PR-QA1', 50), 'q-over');

        $response->assertJson(['success' => false, 'results' => ['processed' => 0, 'failed' => 1]]);
        $this->assertSame('q-over', $response->json('results.errors.0.id'));
        $this->assertStringContainsString('on hand', (string) $response->json('results.errors.0.error'));
        $this->assertSame(0, $this->returns()->count());
        $this->assertEqualsWithDelta(150.0, $this->batchStock(), 0.001);
    }

    public function test_qa_return_replay_moves_stock_once(): void
    {
        $this->batchPush($this->inward('QA-PB-002', 10))->assertJson(['results' => ['failed' => 0]]);

        $this->batchPush($this->qaReturn('C02-PR-QA2', 5))->assertJson(['results' => ['failed' => 0]]);
        $this->batchPush($this->qaReturn('C02-PR-QA2', 5))->assertJson(['results' => ['failed' => 0]]);

        $this->assertSame(1, $this->returns()->count());
        $this->assertEqualsWithDelta(75.0, $this->batchStock(), 0.001);
    }

    public function test_two_returns_with_no_number_of_their_own_never_overwrite_each_other(): void
    {
        $this->batchPush($this->inward('QA-PB-002', 10))->assertJson(['results' => ['failed' => 0]]);

        $unnumbered = fn (string $id, int $packs) => $this->qaReturn($id, $packs, [], [
            'purchase_number' => null,
            'supplier_invoice_no' => null,
        ]);

        // Pushed within the same second: the old fallback number was 'PR-{store}-{time()}'.
        $this->batchPush($unnumbered('A', 2))->assertJson(['results' => ['failed' => 0]]);
        $this->batchPush($unnumbered('B', 3))->assertJson(['results' => ['failed' => 0]]);

        $this->assertSame(2, $this->returns()->count());
        $this->assertSame(2, $this->returns()->distinct()->count('invoice_number'));
        $this->assertEqualsWithDelta(75.0, $this->batchStock(), 0.001, '150 in, 30 and 45 back');
    }
}
