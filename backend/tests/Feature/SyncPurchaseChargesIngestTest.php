<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseChargeAllocation;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * CR-C Task 4.11 / SYNC-007 — ingest. A till that was offline when the bill was keyed
 * pushes its charges inside the existing purchase entity: one queue entry, one aggregate,
 * idempotent on (store_id, external_id). The server re-derives every charge with the
 * shared engine, so the cloud's paisa equals the till's.
 */
class SyncPurchaseChargesIngestTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Charge Ingest Store',
            'code' => 'CIS01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $owner = User::create([
            'name' => 'Ingest Owner',
            'email' => 'owner@charge-ingest.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);
        Sanctum::actingAs($owner);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500mg (100 capsules)',
            'hsn_code' => '30041090',
            'mrp' => 150,
            'sel_rate' => 120,
            'gst_percent' => 12,
            'units_per_pack' => 1,
        ]);
    }

    private function item(array $overrides = []): array
    {
        return array_merge([
            'external_id' => 'item-1',
            'product_name' => 'Amoxicillin 500mg (100 capsules)',
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'qty' => 100,
            'loose_qty' => 0,
            'free_qty' => 0,
            'units_per_pack' => 1,
            'purchase_rate' => 100,
            'gst_percent' => 12,
            'hsn_code' => '30041090',
            'taxable_amount' => 10000,
            'tax_amount' => 1200,
            'cgst_amount' => 600,
            'sgst_amount' => 600,
            'total_amount' => 11200,
        ], $overrides);
    }

    private function charge(string $code, float $amount, array $overrides = []): array
    {
        return array_merge([
            'external_id' => 'chg-' . $code . '-' . $amount,
            'head_code' => $code,
            'amount' => $amount,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
        ], $overrides);
    }

    private function bill(array $overrides = []): array
    {
        return array_merge([
            'external_id' => 'pur-1',
            'supplier_invoice_no' => 'TILL-INV-1',
            'purchase_date' => '2026-11-15',
            'supplier_name' => 'Till Distributors',
            'subtotal' => 10000,
            'tax_total' => 1254,
            'cgst_total' => 627,
            'sgst_total' => 627,
            'grand_total' => 11554,
            'items' => [$this->item()],
            'charges' => [
                $this->charge('FREIGHT', 200),
                $this->charge('PACKING', 100),
            ],
        ], $overrides);
    }

    private function push(array $bill, int $storeId = null)
    {
        return $this->postJson('/api/sync/push/purchases', [
            'store_id' => $storeId ?? $this->store->id,
            'purchases' => [$bill],
        ]);
    }

    private function purchase(string $invoiceNumber = 'TILL-INV-1'): Purchase
    {
        return Purchase::with(['items', 'charges.allocations'])->where('invoice_number', $invoiceNumber)->firstOrFail();
    }

    public function test_charges_arrive_inside_the_purchase_entity_and_land_on_the_batch(): void
    {
        $this->push($this->bill())->assertOk()->assertJson(['success' => true, 'ingested_count' => 1]);

        $purchase = $this->purchase();

        $this->assertCount(1, $purchase->items);
        $this->assertCount(2, $purchase->charges, 'PUR-017: charges ride inside the bill, never as an orphan entity');

        $freight = $purchase->charges->firstWhere('head_code', 'FREIGHT');
        $this->assertSame('Freight', $freight->head_name);
        $this->assertSame('pur-1|chg-FREIGHT-200', $freight->external_id);
        $this->assertEqualsWithDelta(200.0, (float) $freight->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $freight->cgst_amount, 0.005);
        $this->assertEqualsWithDelta(236.0, (float) $freight->total_amount, 0.005);
        $this->assertEqualsWithDelta(200.0, (float) $freight->allocated_amount, 0.005);

        $item = $purchase->items->first();
        $this->assertEqualsWithDelta(300.0, (float) $item->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(103.0, (float) $item->landed_unit_cost, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $item->purchase_rate, 0.005);
        $this->assertEqualsWithDelta(11200.0, (float) $item->total_amount, 0.005,
            'PUR-017: the till already sent the line total; only the landed columns move');

        // SYNC-007: the header is the till's own document, not a restatement of it.
        $this->assertEqualsWithDelta(11554.0, (float) $purchase->grand_total, 0.005);

        $batch = ProductBatch::where('store_id', $this->store->id)->where('batch_no', 'B-1')->firstOrFail();
        $this->assertEqualsWithDelta(100.0, (float) $batch->stock_qty, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $batch->purchase_rate, 0.005);
        $this->assertEqualsWithDelta(103.0, (float) $batch->landed_cost_rate, 0.005);

        $this->assertSame($batch->id, (int) $freight->allocations->first()->batch_id);
        $this->assertEqualsWithDelta(10000.0, (float) $freight->allocations->first()->basis_amount, 0.005);
        $this->assertEqualsWithDelta(1.0, (float) $freight->allocations->first()->basis_share, 0.000001);
    }

    public function test_repeat_push_is_idempotent_to_the_paisa(): void
    {
        $this->push($this->bill())->assertOk();
        $purchaseId = $this->purchase()->id;
        $chargeIds = PurchaseCharge::where('purchase_id', $purchaseId)->pluck('id')->sort()->values();

        $this->push($this->bill())->assertOk();
        $this->push($this->bill())->assertOk();

        $this->assertSame(1, Purchase::where('invoice_number', 'TILL-INV-1')->count());
        $this->assertSame($purchaseId, $this->purchase()->id);
        $this->assertCount(1, $this->purchase()->items);
        $this->assertEquals($chargeIds, PurchaseCharge::where('purchase_id', $purchaseId)->pluck('id')->sort()->values(),
            'PUR-017: a retry must not re-key the charge rows');
        $this->assertSame(2, PurchaseCharge::where('purchase_id', $purchaseId)->count());
        $this->assertSame(2, PurchaseChargeAllocation::where('store_id', $this->store->id)->count());
        $this->assertEqualsWithDelta(100.0, (float) ProductBatch::where('batch_no', 'B-1')->value('stock_qty'), 0.005);
        $this->assertEqualsWithDelta(300.0, (float) PurchaseItem::where('purchase_id', $purchaseId)->sum('charge_allocation'), 0.005);
    }

    public function test_server_recompute_equals_the_till_for_the_pinned_vector(): void
    {
        $path = dirname(__DIR__, 2) . '/specs/gst_tax_test_vectors.json';
        if (!is_file($path)) {
            $path = dirname(__DIR__, 3) . '/specs/gst_tax_test_vectors.json';
        }
        $vectors = json_decode(file_get_contents($path), true)['test_cases'] ?? [];
        $tc11 = collect($vectors)->firstWhere('id', 'TC11_PURCHASE_CHARGES_WORKED_EXAMPLE_INTRA');

        $this->assertNotNull($tc11, 'TC11 must exist in the pinned vectors');

        $headByChargeId = collect($tc11['charges'])->mapWithKeys(fn ($c) => [$c['charge_id'] => $c['head_code']])->all();

        $charges = [];
        foreach ($tc11['charges'] as $idx => $charge) {
            $charges[] = [
                'external_id' => 'vec-' . $charge['charge_id'],
                'head_code' => $charge['head_code'],
                'amount' => $charge['amount'],
                'gst_percent' => $charge['gst_percent'],
                'treatment' => $charge['treatment'],
                'spread_method' => $charge['spread_method'],
                'itc_eligibility' => $charge['itc_eligibility'],
                'paid_separately' => $charge['paid_separately'],
                'sac_code' => $charge['sac_code'],
                'seq' => $idx + 1,
            ];
        }

        $this->push($this->bill([
            'supplier_invoice_no' => 'TILL-VEC-11554',
            'charges' => $charges,
        ]))->assertOk();

        $purchase = $this->purchase('TILL-VEC-11554');

        foreach ($tc11['expected_charges'] as $expected) {
            $row = $purchase->charges->firstWhere('external_id', 'pur-1|vec-' . $expected['charge_id']);

            $this->assertNotNull($row, 'Charge ' . $expected['charge_id'] . ' was not ingested');
            $this->assertSame($headByChargeId[$expected['charge_id']], $row->head_code);

            foreach (['taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'cess_amount', 'total_amount'] as $column) {
                if (array_key_exists($column, $expected)) {
                    $this->assertEqualsWithDelta((float) $expected[$column], (float) $row->$column, 0.005,
                        "Sync ingest moved a different paisa than the pinned vector on {$column}");
                }
            }

            $this->assertEqualsWithDelta(
                (float) $expected['allocations'][0]['allocated_amount'],
                (float) $row->allocations->sum('allocated_amount'),
                0.005,
                'SYNC-007: server spread must equal till spread'
            );
            $this->assertSame(
                (bool) $expected['allocations'][0]['is_remainder_paisa'],
                (bool) $row->allocations->first()->is_remainder_paisa
            );
        }

        $expectedLine = $tc11['expected_lines'][0];
        $this->assertEqualsWithDelta((float) $expectedLine['charge_allocation'], (float) $purchase->items->first()->charge_allocation, 0.005);
        $this->assertEqualsWithDelta((float) $expectedLine['landed_unit_cost'], (float) $purchase->items->first()->landed_unit_cost, 0.005);
        $this->assertEqualsWithDelta((float) $tc11['expected_totals']['grand_total'], (float) $purchase->grand_total, 0.005);
    }

    public function test_re_push_with_a_changed_charge_set_replaces_the_rows(): void
    {
        $this->push($this->bill())->assertOk();

        $this->push($this->bill([
            'items' => [$this->item(['taxable_amount' => 5000, 'total_amount' => 5600, 'tax_amount' => 600])],
            'grand_total' => 5777,
            'charges' => [$this->charge('INSURANCE', 50)],
        ]))->assertOk();

        $purchase = $this->purchase();
        $this->assertCount(1, $purchase->charges);
        $this->assertSame('INSURANCE', $purchase->charges->first()->head_code);
        $this->assertSame(50.0, (float) $purchase->charges->first()->allocated_amount);
        $this->assertSame(1, PurchaseChargeAllocation::where('store_id', $this->store->id)->count());
        $this->assertNull(PurchaseCharge::where('head_code', 'FREIGHT')->first());
        $this->assertEqualsWithDelta(50.0, (float) $purchase->items->first()->charge_allocation, 0.005);
    }

    public function test_expense_treated_synced_charge_posts_one_linked_expense(): void
    {
        $this->push($this->bill([
            'charges' => [
                $this->charge('OTHER', 100, [
                    'treatment' => 'expense',
                    'itc_eligibility' => 'blocked',
                    'external_id' => 'chg-expense-1',
                ]),
            ],
        ]))->assertOk();

        $expense = Expense::where('store_id', $this->store->id)->sole();
        $this->assertEqualsWithDelta(118.0, (float) $expense->amount, 0.005);
        $this->assertSame('Other', $expense->expense_head);
        $this->assertSame('blocked', $expense->itc_eligibility);
        $this->assertEqualsWithDelta(9.0, (float) $expense->cgst_amount, 0.005);
        $this->assertSame('2026-11-15', $expense->expense_date->toDateString());
        $this->assertSame($this->purchase()->id, (int) $expense->purchase_id);
        $this->assertNotNull($expense->purchase_charge_id);

        // A retry must not double-book the register.
        $this->push($this->bill([
            'charges' => [
                $this->charge('OTHER', 100, [
                    'treatment' => 'expense',
                    'itc_eligibility' => 'blocked',
                    'external_id' => 'chg-expense-1',
                ]),
            ],
        ]))->assertOk();
        $this->assertSame(1, Expense::where('store_id', $this->store->id)->count());
        $this->assertEqualsWithDelta(0.0, (float) $this->purchase()->items->first()->charge_allocation, 0.005);
    }

    public function test_legacy_freight_only_payload_lands_without_renaming_history(): void
    {
        $this->push($this->bill([
            'supplier_invoice_no' => 'TILL-LEGACY-1',
            'grand_total' => 11204,
            'charges' => [],
            'freight_charges' => 4,
        ]))->assertOk();

        $purchase = $this->purchase('TILL-LEGACY-1');
        $this->assertEqualsWithDelta(4.0, (float) $purchase->freight_charges, 0.005);
        $this->assertEqualsWithDelta(11204.0, (float) $purchase->grand_total, 0.005,
            'PUR-017: the till total is never restated on ingest');

        $this->assertCount(1, $purchase->charges);
        $freight = $purchase->charges->first();
        $this->assertSame('legacy_freight', $freight->source);
        $this->assertSame('FREIGHT', $freight->head_code);
        $this->assertEqualsWithDelta(4.0, (float) $freight->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $freight->total_amount - (float) $freight->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(4.0, (float) $purchase->items->first()->charge_allocation, 0.005);
    }

    public function test_charge_head_of_another_store_is_refused_before_anything_is_written(): void
    {
        $other = Store::create([
            'name' => 'Other Ingest Store', 'code' => 'CIS02', 'state_code' => '32', 'is_active' => true,
        ]);
        MasterLookup::create([
            'store_id' => $other->id,
            'type' => 'charge_head',
            'name' => 'Courier',
            'code' => 'COUR',
            'config' => ['allowed_sign' => 'positive', 'default_treatment' => 'add_to_cost'],
            'is_active' => true,
        ]);

        $this->push($this->bill([
            'supplier_invoice_no' => 'TILL-R12',
            'charges' => [$this->charge('COUR', 50)],
        ]))->assertStatus(422)->assertJsonValidationErrors('charges.0.head_code');

        $this->assertSame(0, Purchase::where('invoice_number', 'TILL-R12')->count());
        $this->assertSame(0, PurchaseCharge::where('store_id', $this->store->id)->count());
    }

    public function test_separately_paid_synced_charge_never_moves_the_supplier_total(): void
    {
        $this->push($this->bill([
            'grand_total' => 11200,
            'tax_total' => 1200,
            'cgst_total' => 600,
            'sgst_total' => 600,
            'charges' => [
                $this->charge('FREIGHT', 200, [
                    'paid_separately' => true,
                    'paid_to_label' => 'Deepak Transport',
                    'external_id' => 'chg-sep-1',
                ]),
            ],
        ]))->assertOk();

        $purchase = $this->purchase();
        $this->assertEqualsWithDelta(11200.0, (float) $purchase->grand_total, 0.05);

        $freight = $purchase->charges->first();
        $this->assertTrue((bool) $freight->paid_separately);
        $this->assertSame('Deepak Transport', $freight->paid_to_label);
        $this->assertEqualsWithDelta(200.0, (float) $freight->allocated_amount, 0.005);
        $this->assertEqualsWithDelta(200.0, (float) $purchase->items->first()->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(102.0, (float) $purchase->items->first()->landed_unit_cost, 0.005);
    }
}
