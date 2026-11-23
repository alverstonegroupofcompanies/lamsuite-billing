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
 * CR-C Task 4.10 — separately-paid charges (PUR-013).
 *
 * Money already handed to a transporter or insurer still belongs to the bill it bought,
 * but it must not inflate what the store owes the supplier. So a `paid_separately` line
 * spreads into landed cost and posts to the expense register exactly like a supplier-borne
 * one, and is absent from the payable, while its GST stays on the charge row for the
 * ITC summaries.
 */
class PurchaseChargeSeparatePaymentTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Separate Payment Store',
            'code' => 'SPS01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Payment Owner',
            'email' => 'owner@separate-payment.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        Sanctum::actingAs($this->owner);
    }

    private function line(array $overrides = []): array
    {
        return array_merge([
            'product_name' => 'Paracetamol 650mg',
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'pack_qty' => 100,
            'loose_qty' => 0,
            'free_qty' => 0,
            'units_per_pack' => 1,
            'purchase_rate' => 100,
            'gst_percent' => 12,
            'hsn_code' => '30049090',
        ], $overrides);
    }

    private function postBill(array $charges, array $overrides = []): Purchase
    {
        $response = $this->postJson('/api/purchases', array_merge([
            'store_id' => $this->store->id,
            'supplier_name' => 'Separate Payment Distributors',
            'invoice_number' => 'SPC-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => $charges,
        ], $overrides));

        $response->assertCreated();

        return Purchase::with(['items', 'charges.allocations'])->findOrFail($response->json('purchase.id'));
    }

    private function freightCharge(array $overrides = []): array
    {
        return array_merge([
            'head_code' => 'FREIGHT',
            'amount' => 200,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
            'sac_code' => '996714',
        ], $overrides);
    }

    /**
     * A charge only lands on a batch the store already stocks, so the cost tests need a
     * real product line rather than a name-only receipt.
     */
    private function stockedBatch(): int
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 650mg',
            'mrp' => 40,
            'sel_rate' => 30,
            'gst_percent' => 12,
        ]);

        ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 0,
            'mrp' => 40,
            'purchase_rate' => 100,
            'selling_rate' => 30,
        ]);

        return (int) $product->id;
    }

    public function test_separately_paid_charge_stays_out_of_the_payable(): void
    {
        $purchase = $this->postBill([
            $this->freightCharge(['paid_separately' => true, 'paid_to_label' => 'Ganga Courier']),
        ]);

        // Goods 10,000 + GST 1,200. The courier bill is settled, so it is not what the
        // store owes the supplier.
        $this->assertEqualsWithDelta(11200.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(1200.0, (float) $purchase->tax_total, 0.005);
        $this->assertEqualsWithDelta(600.0, (float) $purchase->cgst_total, 0.005);
        $this->assertEqualsWithDelta(600.0, (float) $purchase->sgst_total, 0.005);

        $charge = PurchaseCharge::where('purchase_id', $purchase->id)->first();
        $this->assertNotNull($charge, 'PUR-013: the outside payment must still be stored as a charge');
        $this->assertTrue((bool) $charge->paid_separately);
        $this->assertSame('Ganga Courier', $charge->paid_to_label);
        $this->assertEqualsWithDelta(236.0, (float) $charge->total_amount, 0.005);
    }

    public function test_separately_paid_tax_is_visible_on_the_charge_for_itc(): void
    {
        $charge = PurchaseCharge::where('purchase_id', $this->postBill([
            $this->freightCharge(['paid_separately' => true]),
        ])->id)->first();

        // Not in the bill header, but on the row the ITC summary reads (REP-009).
        $this->assertEqualsWithDelta(18.0, (float) $charge->cgst_amount, 0.005);
        $this->assertEqualsWithDelta(18.0, (float) $charge->sgst_amount, 0.005);
        $this->assertSame('eligible', $charge->itc_eligibility);
    }

    public function test_spread_and_landed_cost_are_identical_to_a_supplier_borne_charge(): void
    {
        $productId = $this->stockedBatch();
        $goods = ['lines' => [$this->line(['product_id' => $productId])]];

        $outside = $this->postBill([$this->freightCharge(['paid_separately' => true])], $goods);
        $inside = $this->postBill([$this->freightCharge()], $goods);

        $this->assertEqualsWithDelta(
            (float) PurchaseItem::where('purchase_id', $inside->id)->value('charge_allocation'),
            (float) PurchaseItem::where('purchase_id', $outside->id)->value('charge_allocation'),
            0.005,
            'PUR-010: the same amount spread the same way, paid separately or not'
        );

        foreach ([$outside, $inside] as $purchase) {
            $item = PurchaseItem::where('purchase_id', $purchase->id)->first();
            $this->assertEqualsWithDelta(200.0, (float) $item->charge_allocation, 0.005);
            $this->assertEqualsWithDelta(100.0, (float) $item->purchase_rate, 0.005);
            $this->assertEqualsWithDelta(102.0, (float) $item->landed_unit_cost, 0.005);
            $this->assertEqualsWithDelta(102.0,
                (float) ProductBatch::where('store_id', $this->store->id)->where('batch_no', 'B-1')->value('landed_cost_rate'),
                0.005);
        }

        $allocatedOf = fn (Purchase $purchase) => PurchaseChargeAllocation::where('purchase_charge_id',
            PurchaseCharge::where('purchase_id', $purchase->id)->value('id'))->pluck('allocated_amount')->all();

        $this->assertEquals($allocatedOf($inside), $allocatedOf($outside),
            'PUR-010: paid separately or not, the paisa sit on the same lines');

        // Only the payable differs: the supplier-borne twin carries the charge in its total.
        $this->assertEqualsWithDelta(11436.0, (float) $inside->grand_total, 0.005);
    }

    public function test_separately_paid_expense_charge_marks_the_register_row(): void
    {
        $purchase = $this->postBill([[
            'head_code' => 'INSURANCE',
            'amount' => 100,
            'gst_percent' => 18,
            'treatment' => 'expense',
            'spread_method' => 'value',
            'itc_eligibility' => 'blocked',
            'paid_separately' => true,
            'paid_to_label' => 'Star Insurance',
            'note' => 'Policy 2026-77',
        ]]);

        $expense = Expense::where('purchase_id', $purchase->id)->first();
        $this->assertNotNull($expense, 'PUR-012: an expensed charge books to the register');
        $this->assertSame('Paid Separately', $expense->payment_mode);
        $this->assertTrue((bool) $expense->paid_separately);
        // Ex-tax, plus the credit that can never be claimed back.
        $this->assertEqualsWithDelta(118.0, (float) $expense->amount, 0.005);
        $this->assertEqualsWithDelta(9.0, (float) $expense->cgst_amount, 0.005);
        $this->assertSame('blocked', $expense->itc_eligibility);
        $this->assertStringContainsString('Booked from charge Insurance', (string) $expense->notes);
        $this->assertStringContainsString('Policy 2026-77', (string) $expense->notes);
        $this->assertSame('Star Insurance',
            (string) PurchaseCharge::where('purchase_id', $purchase->id)->value('paid_to_label'));

        $this->assertEqualsWithDelta(11200.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(0.0,
            (float) PurchaseItem::where('purchase_id', $purchase->id)->value('charge_allocation'), 0.005);
    }

    public function test_no_master_party_record_is_needed(): void
    {
        $before = MasterLookup::where('store_id', $this->store->id)
            ->where('category', 'purchase_charge_head')->count();

        $purchase = $this->postBill([
            $this->freightCharge(['head_code' => 'FREIGHT', 'paid_separately' => true, 'paid_to_label' => 'Highway Haulage']),
        ]);

        $this->assertSame($before, MasterLookup::where('store_id', $this->store->id)
            ->where('category', 'purchase_charge_head')->count());
        $this->assertSame('Highway Haulage', PurchaseCharge::where('purchase_id', $purchase->id)->value('paid_to_label'));
    }
}
