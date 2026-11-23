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
 * CR-C Task 4.9 — posting. A charge line entered on a supplier bill is stored with its
 * own paisa-exact tax split, spread onto the goods lines of that bill, lands on the
 * batch as a cost while the supplier's rate stays visible, and an expense-treated
 * charge appears in the expense register. The bill's payable carries supplier-borne
 * charges in both treatments and never a separately-paid one.
 */
class PurchaseChargePostingTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Charge Posting Store',
            'code' => 'CPS01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Posting Owner',
            'email' => 'owner@charge-posting.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        Sanctum::actingAs($this->owner);
    }

    private function line(array $overrides = []): array
    {
        return array_merge([
            'product_name' => 'Amoxicillin 500mg',
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'pack_qty' => 100,
            'loose_qty' => 0,
            'free_qty' => 0,
            'units_per_pack' => 1,
            'purchase_rate' => 100,
            'gst_percent' => 12,
            'hsn_code' => '30041090',
        ], $overrides);
    }

    private function charge(string $headCode, float $amount, array $overrides = []): array
    {
        return array_merge([
            'head_code' => $headCode,
            'amount' => $amount,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
        ], $overrides);
    }

    private function postBill(array $overrides = []): Purchase
    {
        $response = $this->postJson('/api/purchases', array_merge([
            'store_id' => $this->store->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CPC-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [],
        ], $overrides));

        $response->assertCreated();

        return Purchase::with(['items', 'charges.allocations'])->findOrFail($response->json('purchase.id'));
    }

    private function chargeRow(string $headCode): ?PurchaseCharge
    {
        return PurchaseCharge::where('store_id', $this->store->id)
            ->where('head_code', $headCode)
            ->first();
    }

    private function taxOf(PurchaseCharge $charge): float
    {
        return round(
            (float) $charge->cgst_amount + (float) $charge->sgst_amount
            + (float) $charge->igst_amount + (float) $charge->cess_amount,
            2
        );
    }

    private function nonCreditableOf(PurchaseCharge $charge): float
    {
        return $charge->itc_eligibility === 'eligible' ? 0.0 : $this->taxOf($charge);
    }

    public function test_worked_example_lands_charges_on_the_goods_lines(): void
    {
        // specs/gst_tax_test_vectors.json TC11: goods 10,000 @12% + freight 200 @18% + packing 100 @18%.
        $purchase = $this->postBill([
            'charges' => [
                $this->charge('FREIGHT', 200, ['sac_code' => '996714']),
                $this->charge('PACKING', 100, ['sac_code' => '996799']),
            ],
        ]);

        $this->assertEqualsWithDelta(11554.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(10000.0, (float) $purchase->subtotal, 0.005);
        $this->assertEqualsWithDelta(1254.0, (float) $purchase->tax_total, 0.005);
        $this->assertEqualsWithDelta(627.0, (float) $purchase->cgst_total, 0.005);
        $this->assertEqualsWithDelta(627.0, (float) $purchase->sgst_total, 0.005);
        $this->assertSame('32', $purchase->place_of_supply);

        $freight = $this->chargeRow('FREIGHT');
        $packing = $this->chargeRow('PACKING');
        $this->assertNotNull($freight, 'PUR-011: the charge line must be stored');
        $this->assertSame('Freight', $freight->head_name);
        $this->assertEqualsWithDelta(200.0, (float) $freight->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $freight->cgst_amount, 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $freight->sgst_amount, 0.005);
        $this->assertEqualsWithDelta(236.0, (float) $freight->total_amount, 0.005);
        $this->assertEqualsWithDelta(200.0, (float) $freight->allocated_amount, 0.005);
        $this->assertSame('value', $freight->spread_basis_used);
        $this->assertSame('add_to_cost', $freight->treatment);
        $this->assertSame('manual', $freight->source);
        $this->assertEqualsWithDelta(100.0, (float) $packing->allocated_amount, 0.005);

        // PUR-010: Σ allocations == charge taxable + non-creditable tax, per charge line.
        $this->assertEqualsWithDelta(200.0, (float) $freight->allocations->sum('allocated_amount'), 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $packing->allocations->sum('allocated_amount'), 0.005);

        $item = $purchase->items->first();
        $this->assertEqualsWithDelta(300.0, (float) $item->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(103.0, (float) $item->landed_unit_cost, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $item->purchase_rate, 0.005,
            'PUR-011: the supplier rate is never rewritten by an allocation');

        $this->assertChargeIdentity($purchase);
    }

    public function test_head_sac_is_taken_from_the_store_master_when_the_payload_omits_it(): void
    {
        $purchase = $this->postBill([
            'charges' => [$this->charge('FREIGHT', 200)],
        ]);

        $this->assertSame('996731', $this->chargeRow('FREIGHT')->sac_code);
        $this->assertCount(1, $purchase->charges);
    }

    public function test_expense_treated_charges_post_to_the_expense_register_and_leave_landed_cost(): void
    {
        $purchase = $this->postBill([
            'charges' => [
                $this->charge('FREIGHT', 200, ['treatment' => 'expense']),
                $this->charge('PACKING', 100, ['treatment' => 'expense']),
            ],
        ]);

        $this->assertEqualsWithDelta(11554.0, (float) $purchase->grand_total, 0.005,
            'PUR-012: an expensed supplier-borne charge still rides in the payable');

        $expenses = Expense::where('store_id', $this->store->id)->orderBy('id')->get();
        $this->assertCount(2, $expenses);
        $this->assertEqualsWithDelta(300.0, (float) $expenses->sum('amount'), 0.005,
            'PUR-012: the register takes the ex-GST amount');
        $this->assertSame('Freight', $expenses[0]->expense_head);
        $this->assertEqualsWithDelta(18.0, (float) $expenses[0]->cgst_amount, 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $expenses[0]->sgst_amount, 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $expenses[0]->gst_percent, 0.005);
        $this->assertSame('eligible', $expenses[0]->itc_eligibility);
        $this->assertSame($purchase->id, (int) $expenses[0]->purchase_id);
        $this->assertSame($purchase->invoice_date->toDateString(), $expenses[0]->expense_date->toDateString());
        $this->assertEqualsWithDelta(100.0, (float) $expenses[1]->amount, 0.005);

        // Both expense rows are traceable to their charge line, and no allocation was written.
        foreach ($purchase->charges as $charge) {
            $this->assertSame('expense', $charge->treatment);
            $this->assertEqualsWithDelta(0.0, (float) $charge->allocated_amount, 0.005);
            $this->assertNotNull($charge->expense_id);
            $this->assertTrue(Expense::where('id', $charge->expense_id)
                ->where('purchase_charge_id', $charge->id)->exists());
        }

        $item = $purchase->items->first();
        $this->assertEqualsWithDelta(0.0, (float) $item->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $item->landed_unit_cost, 0.005);

        $this->assertChargeIdentity($purchase);
    }

    public function test_non_creditable_tax_never_disappears_from_the_books(): void
    {
        // Blocked ITC on an expensed charge: the register takes taxable + the tax that
        // can never be claimed back. Blocked ITC on a costed charge: the same tax rides
        // into landed cost.
        $this->postBill([
            'charges' => [
                $this->charge('FREIGHT', 200, ['treatment' => 'expense', 'itc_eligibility' => 'blocked']),
            ],
        ]);
        $this->assertEqualsWithDelta(236.0, (float) Expense::where('store_id', $this->store->id)->sum('amount'), 0.005);
        Expense::where('store_id', $this->store->id)->delete();

        $costed = $this->postBill([
            'invoice_number' => 'CPC-BLOCKED-COST',
            'charges' => [
                $this->charge('PACKING', 200, ['itc_eligibility' => 'ineligible']),
            ],
        ]);

        $this->assertEqualsWithDelta(236.0, (float) $this->chargeRow('PACKING')->allocated_amount, 0.005);
        $this->assertEqualsWithDelta(236.0, (float) $costed->items->first()->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(102.36, (float) $costed->items->first()->landed_unit_cost, 0.005);
        $this->assertSame(0, Expense::where('store_id', $this->store->id)->count());

        $this->assertChargeIdentity($costed);
    }

    public function test_separately_paid_charge_is_spread_but_excluded_from_the_payable(): void
    {
        $purchase = $this->postBill([
            'lines' => [$this->line(['pack_qty' => 10, 'purchase_rate' => 100])],
            'charges' => [
                $this->charge('FREIGHT', 100, ['paid_separately' => true, 'paid_to_label' => 'Deepak Transport']),
            ],
        ]);

        // Goods 1,000 + GST 120 = 1,120. The transporter was paid outside the bill.
        $this->assertEqualsWithDelta(1120.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(120.0, (float) $purchase->tax_total, 0.005);

        $freight = $this->chargeRow('FREIGHT');
        $this->assertTrue((bool) $freight->paid_separately);
        $this->assertSame('Deepak Transport', $freight->paid_to_label);
        $this->assertEqualsWithDelta(118.0, (float) $freight->total_amount, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $freight->allocated_amount, 0.005);

        $item = $purchase->items->first();
        $this->assertEqualsWithDelta(100.0, (float) $item->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(110.0, (float) $item->landed_unit_cost, 0.005);

        $this->assertChargeIdentity($purchase);
    }

    public function test_inter_state_bill_splits_nothing_and_books_igst_on_the_charge(): void
    {
        $purchase = $this->postBill([
            'supplier_gstin' => '29AAAPL1234C1Z5',
            'charges' => [$this->charge('FREIGHT', 200)],
        ]);

        $this->assertTrue((bool) $purchase->is_interstate);
        $this->assertEqualsWithDelta(1236.0, (float) $purchase->igst_total, 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $purchase->cgst_total, 0.005);
        $this->assertSame('29', $purchase->place_of_supply);

        $freight = $this->chargeRow('FREIGHT');
        $this->assertEqualsWithDelta(36.0, (float) $freight->igst_amount, 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $freight->cgst_amount, 0.005);
        $this->assertSame('29', $freight->place_of_supply);

        $this->assertChargeIdentity($purchase);
    }

    public function test_quantity_basis_counts_free_units(): void
    {
        $purchase = $this->postBill([
            'lines' => [
                $this->line(['product_name' => 'Line one', 'pack_qty' => 2, 'free_qty' => 1, 'purchase_rate' => 100, 'gst_percent' => 0]),
                $this->line(['product_name' => 'Line two', 'pack_qty' => 1, 'free_qty' => 0, 'purchase_rate' => 100, 'gst_percent' => 0]),
            ],
            'charges' => [$this->charge('LOADING', 100, ['gst_percent' => 0, 'spread_method' => 'quantity'])],
        ]);

        // 3 units on line one against 1 unit on line two, so 75 / 25.
        $this->assertEqualsWithDelta(75.0, (float) $purchase->items[0]->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(25.0, (float) $purchase->items[1]->charge_allocation, 0.005);
        $this->assertSame('quantity', $this->chargeRow('LOADING')->spread_basis_used);
        $this->assertEqualsWithDelta(0.0, $this->taxOf($this->chargeRow('LOADING')), 0.005);

        $this->assertChargeIdentity($purchase);
    }

    public function test_weight_basis_spreads_by_kg_and_falls_back_to_value_when_a_line_lacks_it(): void
    {
        $weighted = $this->postBill([
            'lines' => [
                $this->line(['product_name' => 'Heavy', 'pack_qty' => 1, 'purchase_rate' => 100, 'gst_percent' => 0, 'gross_weight_kg' => 300]),
                $this->line(['product_name' => 'Light', 'pack_qty' => 1, 'purchase_rate' => 100, 'gst_percent' => 0, 'gross_weight_kg' => 100]),
            ],
            'charges' => [$this->charge('FREIGHT', 400, ['gst_percent' => 0, 'spread_method' => 'weight'])],
        ]);

        $this->assertEqualsWithDelta(300.0, (float) $weighted->items[0]->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $weighted->items[1]->charge_allocation, 0.005);
        $this->assertSame('weight', $this->chargeRow('FREIGHT')->spread_basis_used);
        $this->assertEqualsWithDelta(300.0, (float) PurchaseChargeAllocation::where('store_id', $this->store->id)->where('purchase_item_id', $weighted->items[0]->id)->value('basis_amount'), 0.005);

        $mixed = $this->postBill([
            'invoice_number' => 'CPC-WEIGHT-FALLBACK',
            'lines' => [
                $this->line(['product_name' => 'Heavy', 'pack_qty' => 1, 'purchase_rate' => 100, 'gst_percent' => 0, 'gross_weight_kg' => 300]),
                $this->line(['product_name' => 'No weight', 'pack_qty' => 1, 'purchase_rate' => 300, 'gst_percent' => 0]),
            ],
            'charges' => [$this->charge('PACKING', 400, ['gst_percent' => 0, 'spread_method' => 'weight'])],
        ]);

        // PUR-010: a mixed basis is forbidden — the whole charge falls back to value (100 / 300).
        $this->assertSame('value', $this->chargeRow('PACKING')->spread_basis_used);
        $this->assertEqualsWithDelta(100.0, (float) $mixed->items[0]->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(300.0, (float) $mixed->items[1]->charge_allocation, 0.005);

        $this->assertChargeIdentity($mixed);
    }

    public function test_remainder_paisa_goes_to_the_first_line_in_grid_order(): void
    {
        $purchase = $this->postBill([
            'lines' => [
                $this->line(['product_name' => 'One', 'pack_qty' => 1, 'purchase_rate' => 100, 'gst_percent' => 0]),
                $this->line(['product_name' => 'Two', 'pack_qty' => 1, 'purchase_rate' => 100, 'gst_percent' => 0]),
                $this->line(['product_name' => 'Three', 'pack_qty' => 1, 'purchase_rate' => 100, 'gst_percent' => 0]),
            ],
            'charges' => [$this->charge('FREIGHT', 100, ['gst_percent' => 0])],
        ]);

        $this->assertEqualsWithDelta(33.34, (float) $purchase->items[0]->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(33.33, (float) $purchase->items[1]->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(33.33, (float) $purchase->items[2]->charge_allocation, 0.005);

        $allocations = PurchaseChargeAllocation::where('store_id', $this->store->id)
            ->where('purchase_charge_id', $this->chargeRow('FREIGHT')->id)
            ->orderBy('purchase_item_id')
            ->get();

        $this->assertTrue((bool) $allocations[0]->is_remainder_paisa);
        $this->assertFalse((bool) $allocations[1]->is_remainder_paisa);
        $this->assertEqualsWithDelta(100.0, (float) $allocations->sum('allocated_amount'), 0.005);

        $this->assertChargeIdentity($purchase);
    }

    public function test_negative_charge_reduces_the_payable_and_the_landed_cost(): void
    {
        $purchase = $this->postBill([
            'lines' => [$this->line(['pack_qty' => 10, 'purchase_rate' => 100])],
            'charges' => [$this->charge('OTHER', -100)],
        ]);

        // Goods 1,000 + GST 120, then the credit note line -100 and its -18: exactly 1,002,
        // so nothing is left to round and the payable is still positive.
        $this->assertEqualsWithDelta(0.0, (float) $purchase->round_off, 0.005);
        $this->assertEqualsWithDelta(1002.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(102.0, (float) $purchase->tax_total, 0.005);

        $other = $this->chargeRow('OTHER');
        $this->assertEqualsWithDelta(-100.0, (float) $other->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(-118.0, (float) $other->total_amount, 0.005);
        $this->assertEqualsWithDelta(-100.0, (float) $other->allocated_amount, 0.005);

        $item = $purchase->items->first();
        $this->assertEqualsWithDelta(-100.0, (float) $item->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(90.0, (float) $item->landed_unit_cost, 0.005);

        $this->assertChargeIdentity($purchase);
    }

    public function test_negative_amount_on_a_positive_only_head_is_refused(): void
    {
        $this->postJson('/api/purchases', [
            'store_id' => $this->store->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CPC-SIGN',
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [$this->charge('FREIGHT', -50, ['head_code' => 'OTHER'])],
        ])->assertCreated();

        $this->postJson('/api/purchases', [
            'store_id' => $this->store->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CPC-SIGN-2',
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [$this->charge('FREIGHT', -50)],
        ])->assertStatus(422)->assertJsonValidationErrors('charges.0.amount');
    }

    public function test_unknown_head_and_cross_store_head_are_refused(): void
    {
        $this->postJson('/api/purchases', [
            'store_id' => $this->store->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CPC-UNKNOWN',
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [$this->charge('NOPE', 50)],
        ])->assertStatus(422)->assertJsonValidationErrors('charges.0.head_code');

        $otherStore = Store::create([
            'name' => 'Other Charge Store', 'code' => 'CPS02', 'state_code' => '32', 'is_active' => true,
        ]);
        MasterLookup::create([
            'store_id' => $otherStore->id,
            'type' => 'charge_head',
            'name' => 'Vendor Courier',
            'code' => 'VCOU',
            'config' => ['allowed_sign' => 'positive', 'default_treatment' => 'add_to_cost'],
            'is_active' => true,
        ]);

        $this->postJson('/api/purchases', [
            'store_id' => $this->store->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CPC-CROSS-STORE',
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [$this->charge('VCOU', 50)],
        ])->assertStatus(422)->assertJsonValidationErrors('charges.0.head_code');

        $this->assertSame(0, PurchaseCharge::where('store_id', $this->store->id)->count());
    }

    public function test_deactivated_head_is_refused_and_custom_head_is_accepted(): void
    {
        MasterLookup::create([
            'store_id' => $this->store->id,
            'type' => 'charge_head',
            'name' => 'Cold Chain',
            'code' => 'COLD',
            'config' => [
                'sac_code' => '996710',
                'allowed_sign' => 'both',
                'default_treatment' => 'add_to_cost',
                'default_spread_method' => 'weight',
                'default_itc_eligibility' => 'eligible',
            ],
            'is_active' => true,
        ]);

        $purchase = $this->postBill([
            'invoice_number' => 'CPC-CUSTOM',
            'lines' => [
                $this->line(['product_name' => 'Vaccine', 'pack_qty' => 1, 'purchase_rate' => 1000, 'gst_percent' => 12, 'gross_weight_kg' => 4]),
                $this->line(['product_name' => 'Saline', 'pack_qty' => 1, 'purchase_rate' => 1000, 'gst_percent' => 12, 'gross_weight_kg' => 1]),
            ],
            // treatment/spread/itc come from the store's own head when the payload leaves them out.
            'charges' => [[
                'head_code' => 'COLD',
                'amount' => 500,
                'gst_percent' => 18,
            ]],
        ]);

        $cold = $this->chargeRow('COLD');
        $this->assertSame('Cold Chain', $cold->head_name);
        $this->assertSame('996710', $cold->sac_code);
        $this->assertSame('add_to_cost', $cold->treatment);
        $this->assertSame('weight', $cold->spread_method);
        $this->assertSame('weight', $cold->spread_basis_used);
        $this->assertEqualsWithDelta(400.0, (float) $purchase->items[0]->charge_allocation, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $purchase->items[1]->charge_allocation, 0.005);

        MasterLookup::where('store_id', $this->store->id)->where('code', 'COLD')->update(['is_active' => false]);

        $this->postJson('/api/purchases', [
            'store_id' => $this->store->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CPC-INACTIVE',
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [[
                'head_code' => 'COLD',
                'amount' => 100,
                'gst_percent' => 18,
                'treatment' => 'add_to_cost',
                'spread_method' => 'value',
                'itc_eligibility' => 'eligible',
            ]],
        ])->assertStatus(422)->assertJsonValidationErrors('charges.0.head_code');
    }

    public function test_charges_cannot_push_the_bill_below_zero(): void
    {
        $this->postJson('/api/purchases', [
            'store_id' => $this->store->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CPC-BELOW-ZERO',
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line(['pack_qty' => 1, 'purchase_rate' => 100])],
            'charges' => [$this->charge('OTHER', -500, ['gst_percent' => 0])],
        ])->assertStatus(422)->assertJsonValidationErrors('charges');

        $this->assertSame(0, Purchase::where('invoice_number', 'CPC-BELOW-ZERO')->count());
    }

    public function test_landed_cost_reaches_the_batch_and_keeps_the_original_rate(): void
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500mg',
            'mrp' => 150,
            'sel_rate' => 120,
            'gst_percent' => 12,
        ]);

        $batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 0,
            'mrp' => 150,
            'purchase_rate' => 100,
            'selling_rate' => 120,
        ]);

        $this->postBill([
            'lines' => [$this->line(['product_id' => $product->id])],
            'charges' => [
                $this->charge('FREIGHT', 200),
                $this->charge('PACKING', 100, ['treatment' => 'expense']),
            ],
        ]);

        $batch->refresh();
        $this->assertEqualsWithDelta(100.0, (float) $batch->purchase_rate, 0.005,
            'PUR-011: the batch keeps the supplier rate untouched');
        $this->assertEqualsWithDelta(102.0, (float) $batch->landed_cost_rate, 0.005,
            'PUR-011: only the add-to-cost charge lands on the batch (200 over 100 units)');

        $allocation = PurchaseChargeAllocation::where('store_id', $this->store->id)
            ->where('purchase_charge_id', $this->chargeRow('FREIGHT')->id)
            ->first();
        $this->assertSame($batch->id, (int) $allocation->batch_id);
    }

    public function test_legacy_freight_scalar_becomes_one_freight_charge_line(): void
    {
        $purchase = $this->postBill([
            'invoice_number' => 'CPC-LEGACY',
            'lines' => [$this->line(['pack_qty' => 1, 'discount_percent' => 10, 'discount_type' => 'percent'])],
            'bill_discount_type' => 'percent',
            'bill_discount' => 10,
            'freight_charges' => 5,
        ]);

        // Gross 100 → line discount 10 → bill discount 9 → taxable 81 → GST 9.72 → freight 5.
        $this->assertEqualsWithDelta(96.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(0.28, (float) $purchase->round_off, 0.005);

        $this->assertCount(1, $purchase->charges);
        $freight = $purchase->charges->first();
        $this->assertSame('FREIGHT', $freight->head_code);
        $this->assertSame('legacy_freight', $freight->source);
        $this->assertSame('996731', $freight->sac_code);
        $this->assertEqualsWithDelta(5.0, (float) $freight->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(0.0, $this->taxOf($freight), 0.005);
        $this->assertEqualsWithDelta(5.0, (float) $purchase->items->first()->charge_allocation, 0.005);
        $this->assertSame(0, Expense::where('store_id', $this->store->id)->count());

        $this->assertChargeIdentity($purchase);
    }

    public function test_rcm_and_note_are_stored_on_the_charge_row(): void
    {
        $purchase = $this->postBill([
            'charges' => [$this->charge('OTHER', 250, ['is_rcm' => true, 'note' => 'Freight paid by transporter under RCM'])],
        ]);

        $other = $this->chargeRow('OTHER');
        $this->assertTrue((bool) $other->is_rcm);
        $this->assertSame('Freight paid by transporter under RCM', $other->note);
        $this->assertSame(1, (int) $other->seq);
        $this->assertNotEmpty($other->external_id);
        $this->assertSame($this->owner->id, (int) $other->created_by);
        $this->assertEqualsWithDelta(250.0, (float) $other->allocated_amount, 0.005);

        $this->assertChargeIdentity($purchase);
    }

    /**
     * PUR-010/PUR-012/NFR: the three paisa-exact relationships every later phase is
     * checked against — the bill total, the spread and the expense register.
     */
    private function assertChargeIdentity(Purchase $purchase): void
    {
        $charges = PurchaseCharge::with('allocations')->where('purchase_id', $purchase->id)->get();
        $items = PurchaseItem::where('purchase_id', $purchase->id)->get();

        $goodsTaxable = round((float) $items->sum('taxable_amount'), 2);
        $goodsTax = round((float) $items->sum('tax_amount'), 2);
        $supplierBorne = $charges->where('paid_separately', false);
        $supplierBorneTaxable = round((float) $supplierBorne->sum('taxable_amount'), 2);
        $supplierBorneTax = round($supplierBorne->sum(fn (PurchaseCharge $c) => $this->taxOf($c)), 2);

        $netBeforeRound = round((float) $purchase->grand_total - (float) $purchase->round_off, 2);
        $this->assertEqualsWithDelta(
            $goodsTaxable + $supplierBorneTaxable + $goodsTax + $supplierBorneTax,
            $netBeforeRound,
            0.005,
            'The bill total must equal goods + supplier-borne charges + all their tax'
        );

        $this->assertEqualsWithDelta($goodsTax + $supplierBorneTax, (float) $purchase->tax_total, 0.005);

        // Σ allocations == charge taxable + non-creditable tax, per charge, and on the grid.
        $spreadTotal = 0.0;
        $expenseExpected = 0.0;
        foreach ($charges as $charge) {
            $expected = $charge->treatment === 'add_to_cost'
                ? round((float) $charge->taxable_amount + $this->nonCreditableOf($charge), 2)
                : 0.0;
            $this->assertEqualsWithDelta($expected, round((float) $charge->allocations->sum('allocated_amount'), 2), 0.005);
            $this->assertEqualsWithDelta($expected, (float) $charge->allocated_amount, 0.005);
            $spreadTotal += $expected;

            if ($charge->treatment === 'expense') {
                $expenseExpected += round((float) $charge->taxable_amount + $this->nonCreditableOf($charge), 2);
            }
        }

        $this->assertEqualsWithDelta($spreadTotal, round((float) $items->sum('charge_allocation'), 2), 0.005);

        $this->assertEqualsWithDelta(
            round($expenseExpected, 2),
            round((float) Expense::where('store_id', $purchase->store_id)
                ->whereIn('purchase_charge_id', $charges->pluck('id')->all())
                ->sum('amount'), 2),
            0.005,
            'PUR-012: the expense register must hold taxable + non-creditable tax, nothing else'
        );
    }
}
