<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Expense;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseItem;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CR-C Task 4.12 — what happens to a supplier bill's charges when goods go back.
 *
 * A debit note reverses the returned share of each charge line by line, never by a
 * document-level percentage, and the figure is re-derived from the live returns so a
 * retried push, a second part-return or a cancelled note cannot reverse the same paisa
 * twice (PUR-015, PUR-003, PUR-016, SYNC-002).
 *
 * These read the charge rows, not the document headers: a till's header totals stay as it
 * sent them (PUR-017), and what a return gives back is a charge-row fact.
 */
class PurchaseChargeReversalTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $a;
    private Product $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Charge Reversal Store',
            'code' => 'CRS01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        // Two goods lines of different value, so a 1,500 charge spread by value lands 1,000
        // on the first and 500 on the second and a part-return of one line is provable.
        $this->a = $this->product('Reversal Drug A', 100);
        $this->b = $this->product('Reversal Drug B', 50);
    }

    private function product(string $name, float $rate): Product
    {
        return Product::create([
            'store_id' => $this->store->id,
            'name' => $name,
            'current_stock' => 0,
            'mrp' => $rate * 2,
            'sel_rate' => (int) ($rate * 1.5),
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);
    }

    private function batchNo(Product $product): string
    {
        return 'BCH-' . strtoupper(substr(md5($product->name), 0, 6));
    }

    private function goodsLine(Product $product, float $rate, int $units = 100): array
    {
        return [
            'product_id' => (string) $product->id,
            'product_name' => $product->name,
            'batch_no' => $this->batchNo($product),
            'expiry_date' => '2027-12-31',
            'pack_qty' => $units,
            'units_per_pack' => 1,
            'purchase_rate' => $rate,
            'mrp' => $rate * 2,
            'gst_percent' => 12,
            'taxable_amount' => $units * $rate,
            'tax_amount' => round($units * $rate * 0.12, 2),
            'total_amount' => round($units * $rate * 1.12, 2),
        ];
    }

    /**
     * The worked bill: goods 10,000 + 5,000 at 12%, so a value spread splits the charge 2 to 1.
     */
    private function pushBill(array $charges = [], array $overrides = []): Purchase
    {
        $payload = array_merge([
            'id' => 'pur_crs_1',
            'invoice_number' => 'CRS-SUP-0001',
            'purchase_number' => 'CRS-PUR-0001',
            'supplier_name' => 'Reversal Distributors',
            'supplier_gstin' => '32AAAAA1111BB1Z9',
            'invoice_date' => '2026-11-10',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'subtotal' => 15000,
            'tax_total' => 1800,
            'cgst_total' => 900,
            'sgst_total' => 900,
            'round_off' => 0,
            'grand_total' => 16800,
            'status' => 'received',
            'items' => [$this->goodsLine($this->a, 100), $this->goodsLine($this->b, 50)],
            'charges' => $charges,
        ], $overrides);

        $this->postJson('/api/sync/push/purchases', ['purchases' => [$payload]])->assertStatus(200);

        return $this->bill($payload['invoice_number']);
    }

    private function bill(string $number): Purchase
    {
        return Purchase::with(['items', 'charges.allocations'])
            ->where('store_id', $this->store->id)
            ->where('invoice_number', $number)
            ->firstOrFail();
    }

    private function pushReturn(array $lines, array $overrides = []): Purchase
    {
        $payload = $this->returnPayload($lines, $overrides);

        $this->postJson('/api/sync/push/purchases', ['purchases' => [$payload]])->assertStatus(200);

        return $this->bill($payload['return_number']);
    }

    private function returnPayload(array $lines, array $overrides = []): array
    {
        return array_merge([
            'id' => 'pr_crs_1',
            'return_number' => 'CRS-PR-0001',
            'return_date' => '2026-11-20',
            'original_purchase_number' => 'CRS-SUP-0001',
            'supplier_name' => 'Reversal Distributors',
            'supplier_gstin' => '32AAAAA1111BB1Z9',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase_return',
            'status' => 'completed',
            'subtotal' => 0,
            'tax_total' => 0,
            'round_off' => 0,
            'grand_total' => 0,
            'lines' => $lines,
        ], $overrides);
    }

    private function returnLine(Product $product, float $rate, int $units): array
    {
        return [
            'product_id' => (string) $product->id,
            'product_name' => $product->name,
            'batch_no' => $this->batchNo($product),
            'return_qty' => $units,
            'purchase_rate' => $rate,
            'gst_percent' => 12,
            'taxable_amount' => $units * $rate,
            'cgst_amount' => round($units * $rate * 0.06, 2),
            'sgst_amount' => round($units * $rate * 0.06, 2),
            'total_amount' => round($units * $rate * 1.12, 2),
        ];
    }

    private function freight(float $amount, array $overrides = []): array
    {
        return array_merge([
            'external_id' => 'chg-' . $amount,
            'head_code' => 'FREIGHT',
            'amount' => $amount,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
            'sac_code' => '996731',
        ], $overrides);
    }

    private function charge(Purchase $purchase, string $externalId): PurchaseCharge
    {
        $row = PurchaseCharge::where('purchase_id', $purchase->id)
            ->where('external_id', 'like', '%' . $externalId)
            ->orderBy('seq')
            ->first();

        $this->assertNotNull($row, "charge {$externalId} is not posted on bill {$purchase->invoice_number}");

        return $row;
    }

    /** @return \Illuminate\Support\Collection<int, PurchaseCharge> */
    private function noteCharges(Purchase $note)
    {
        return PurchaseCharge::where('purchase_id', $note->id)->orderBy('seq')->get();
    }

    private function batch(Product $product): ProductBatch
    {
        return ProductBatch::where('store_id', $this->store->id)
            ->where('product_id', $product->id)
            ->where('batch_no', $this->batchNo($product))
            ->firstOrFail();
    }

    public function test_the_bill_lands_its_charge_where_the_goods_are(): void
    {
        $bill = $this->pushBill([$this->freight(1500)]);

        $freight = $this->charge($bill, 'chg-1500');
        $this->assertEqualsWithDelta(1500.0, (float) $freight->allocated_amount, 0.005);

        $this->assertEqualsWithDelta(1000.0,
            (float) PurchaseItem::where('purchase_id', $bill->id)->where('product_id', $this->a->id)->value('charge_allocation'),
            0.005);
        $this->assertEqualsWithDelta(500.0,
            (float) PurchaseItem::where('purchase_id', $bill->id)->where('product_id', $this->b->id)->value('charge_allocation'),
            0.005);
        $this->assertEqualsWithDelta(110.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);
        $this->assertEqualsWithDelta(55.0, (float) $this->batch($this->b)->landed_cost_rate, 0.005);
    }

    public function test_a_part_return_reverses_only_that_line_s_share(): void
    {
        $bill = $this->pushBill([$this->freight(1500)]);
        $note = $this->pushReturn([$this->returnLine($this->a, 100, 50)]);

        // PUR-003: the line the note names, not the note's own percentage.
        $linked = PurchaseItem::where('purchase_id', $note->id)->firstOrFail();
        $originalLine = PurchaseItem::where('purchase_id', $bill->id)->where('product_id', $this->a->id)->firstOrFail();
        $this->assertSame((int) $originalLine->id, (int) $linked->original_purchase_item_id);

        $reversal = $this->noteCharges($note)->firstOrFail();
        $this->assertSame('Freight', $reversal->head_name);
        $this->assertSame('return_reversal', $reversal->source);
        $this->assertEqualsWithDelta(-500.0, (float) $reversal->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(-90.0,
            (float) $reversal->total_amount - (float) $reversal->taxable_amount, 0.005);
        $this->assertEqualsWithDelta(-590.0, (float) $reversal->total_amount, 0.005);
        $this->assertSame('add_to_cost', $reversal->treatment);

        $this->assertEqualsWithDelta(500.0, (float) $this->charge($bill, 'chg-1500')->reversed_amount, 0.005);

        // PUR-011: the batch is valued on what it still costs, and the supplier's rate holds.
        $this->assertEqualsWithDelta(105.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $this->batch($this->a)->purchase_rate, 0.005);
        $this->assertEqualsWithDelta(55.0, (float) $this->batch($this->b)->landed_cost_rate, 0.005);
    }

    public function test_a_full_return_reverses_every_charge_to_the_paisa(): void
    {
        $bill = $this->pushBill([
            $this->freight(1500),
            $this->freight(333, ['external_id' => 'chg-load-333', 'head_code' => 'LOADING']),
        ]);

        $note = $this->pushReturn([
            $this->returnLine($this->a, 100, 100),
            $this->returnLine($this->b, 50, 100),
        ]);

        $freight = $this->charge($bill, 'chg-1500');
        $loading = $this->charge($bill, 'chg-load-333');

        // 1,500 spread 1,000/500 and 333 spread 222/111 — every paisa of both lines came back.
        $this->assertEqualsWithDelta(1500.0, (float) $freight->reversed_amount, 0.005);
        $this->assertEqualsWithDelta(333.0, (float) $loading->reversed_amount, 0.005);
        $this->assertTrue($freight->isFullyReversed());
        $this->assertTrue($loading->isFullyReversed(), 'the remainder paisa must reverse too');

        $this->assertEqualsWithDelta(-1833.0, (float) $this->noteCharges($note)->sum('taxable_amount'), 0.005);

        // Nothing of this bill is left in stock, so nothing of its charge is left in the cost.
        $this->assertEqualsWithDelta(100.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);
        $this->assertEqualsWithDelta(50.0, (float) $this->batch($this->b)->landed_cost_rate, 0.005);
    }

    public function test_two_part_returns_together_reverse_what_one_full_return_would(): void
    {
        // 1,000 will not split into exact paisa halves of a 2:1 value basis, so what a naive
        // per-return percentage leaves behind is exactly what this proves away.
        $bill = $this->pushBill([$this->freight(1000)]);

        $first = $this->pushReturn([$this->returnLine($this->a, 100, 33)], ['return_number' => 'CRS-PR-A']);
        $second = $this->pushReturn([$this->returnLine($this->a, 100, 67)],
            ['return_number' => 'CRS-PR-B', 'id' => 'pr_crs_2']);

        // Line A absorbed 666.67 of the charge. 33 units give back 220.00, and the remaining 67
        // give back the 446.67 that is left over — not 67% of 666.67.
        $this->assertEqualsWithDelta(-220.0, (float) $this->noteCharges($first)->sum('taxable_amount'), 0.005);
        $this->assertEqualsWithDelta(-446.67, (float) $this->noteCharges($second)->sum('taxable_amount'), 0.005);

        $freight = $this->charge($bill, 'chg-1000');
        $this->assertEqualsWithDelta(666.67, (float) $freight->reversed_amount, 0.005);
        $this->assertFalse($freight->isFullyReversed(),
            'line B never went back, so a third of the charge stays where it landed');

        $this->assertEqualsWithDelta(100.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);
        $this->assertEqualsWithDelta(53.33, (float) $this->batch($this->b)->landed_cost_rate, 0.005);
    }

    public function test_repushing_the_same_debit_note_does_not_double_reverse(): void
    {
        $bill = $this->pushBill([$this->freight(1500)]);
        $lines = [$this->returnLine($this->a, 100, 50)];

        $this->pushReturn($lines);
        $chargeIds = $this->noteCharges($this->bill('CRS-PR-0001'))->pluck('id')->sort()->values();

        $this->pushReturn($lines);
        $this->pushReturn($lines);

        $this->assertSame(1, Purchase::where('invoice_number', 'CRS-PR-0001')->count());
        $this->assertEquals($chargeIds, $this->noteCharges($this->bill('CRS-PR-0001'))->pluck('id')->sort()->values(),
            'SYNC-002: a retried note must re-key the same reversal rows, not add to them');
        $this->assertEqualsWithDelta(500.0, (float) $this->charge($bill, 'chg-1500')->reversed_amount, 0.005);
        $this->assertEqualsWithDelta(105.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);
    }

    public function test_cancelling_the_debit_note_gives_the_share_back(): void
    {
        $bill = $this->pushBill([$this->freight(1500)]);
        $this->pushReturn([$this->returnLine($this->a, 100, 50)]);

        $this->assertEqualsWithDelta(500.0, (float) $this->charge($bill, 'chg-1500')->reversed_amount, 0.005);

        $this->pushReturn([$this->returnLine($this->a, 100, 50)],
            ['status' => 'cancelled', 'cancel_reason' => 'Keyed the wrong batch']);

        $this->assertEqualsWithDelta(0.0, (float) $this->charge($bill, 'chg-1500')->reversed_amount, 0.005);
        $this->assertEqualsWithDelta(110.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005,
            'the landed cost a cancelled note took back must come back with it');
        $this->assertEqualsWithDelta(100.0, (float) $this->batch($this->a)->stock_qty, 0.005,
            'and so must the stock it had taken out');
    }

    public function test_a_sunk_policy_leaves_the_original_charges_alone(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'billing',
            'value' => ['tax_mode' => 'exclusive', 'purchase_charges' => ['reverse_on_return' => 'sunk']],
        ]);

        $bill = $this->pushBill([$this->freight(1500)]);
        $note = $this->pushReturn([$this->returnLine($this->a, 100, 50)]);

        $this->assertSame(0, PurchaseCharge::where('purchase_id', $note->id)->count(),
            'PUR-016: a sunk store gives no charge back on a return');

        $freight = $this->charge($bill, 'chg-1500');
        $this->assertEqualsWithDelta(0.0, (float) $freight->reversed_amount, 0.005);
        $this->assertFalse($freight->isFullyReversed());
        $this->assertEqualsWithDelta(110.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);
    }

    public function test_a_later_note_may_claim_only_the_charge_its_units_absorbed(): void
    {
        $bill = $this->pushBill([$this->freight(1500)]);

        // 80 of line A's 100 units go back, leaving 20 on the shelf.
        $this->pushReturn([$this->returnLine($this->a, 100, 80)], ['return_number' => 'CRS-PR-A']);

        // A note for more units than the batch still holds is refused outright (PUR-07), so a
        // book can no longer go negative to make a document balance.
        $this->postJson('/api/sync/push/purchases', ['purchases' => [
            $this->returnPayload([$this->returnLine($this->a, 100, 40)],
                ['return_number' => 'CRS-PR-X', 'id' => 'pr_crs_x']),
        ]])->assertStatus(422);

        // The 20 that remain can only give back the last 200 of the 1,000 line A absorbed.
        $second = $this->pushReturn([$this->returnLine($this->a, 100, 20)],
            ['return_number' => 'CRS-PR-B', 'id' => 'pr_crs_2']);

        $freight = $this->charge($bill, 'chg-1500');
        $this->assertEqualsWithDelta(1000.0, (float) $freight->reversed_amount, 0.005,
            'PUR-015: the 100 units that went back reverse only the 1,000 line A carried');
        $this->assertFalse($freight->isFullyReversed(), 'the 500 that line B absorbed is untouched');
        $this->assertEqualsWithDelta(100.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);

        // The second note may claim only the 200 left, never the 400 its own units suggest.
        $this->assertEqualsWithDelta(-200.0, (float) $this->noteCharges($second)->sum('taxable_amount'), 0.005);
    }

    public function test_an_expense_treated_charge_returns_as_a_credit_to_the_register(): void
    {
        $bill = $this->pushBill([
            $this->freight(1000),
            ['external_id' => 'chg-ins', 'head_code' => 'INSURANCE', 'amount' => 200,
             'gst_percent' => 18, 'treatment' => 'expense', 'spread_method' => 'value', 'itc_eligibility' => 'blocked'],
        ]);

        $insurance = $this->charge($bill, 'chg-ins');
        $this->assertNotNull($expense = Expense::find($insurance->expense_id), 'PUR-012: the expense row the bill posted');
        $this->assertEqualsWithDelta(236.0, (float) $expense->amount, 0.005,
            'a blocked head expenses the tax it can never claim back');

        $note = $this->pushReturn([$this->returnLine($this->a, 100, 100)]);

        // Line A held 157.33 of that 236, so returning it in full credits 157.33 back.
        $reversal = $this->noteCharges($note)->firstWhere('head_code', 'INSURANCE');
        $this->assertNotNull($reversal, 'PUR-015: an expensed charge is reversed against the register');
        $this->assertSame('expense', $reversal->treatment);
        $this->assertEqualsWithDelta(157.33, (float) $this->charge($bill, 'chg-ins')->fresh()->reversed_amount, 0.005);

        $credit = Expense::where('purchase_charge_id', $reversal->id)->first();
        $this->assertNotNull($credit, 'the reversal must land in the expense register as a credit');
        $this->assertEqualsWithDelta(-157.33, (float) $credit->amount, 0.005);

        $this->assertEqualsWithDelta(666.67, (float) $this->charge($bill, 'chg-1000')->fresh()->reversed_amount, 0.005);
    }

    public function test_a_separately_paid_charge_returns_outside_the_supplier_payable(): void
    {
        $this->pushBill([$this->freight(1500, ['paid_separately' => true, 'paid_to_label' => 'Ganga Courier'])]);

        $note = $this->pushReturn([$this->returnLine($this->a, 100, 50)]);

        $reversal = $this->noteCharges($note)->firstOrFail();
        $this->assertTrue((bool) $reversal->paid_separately, 'PUR-013: the transporter was never owed this by the supplier');
        $this->assertSame('Ganga Courier', $reversal->paid_to_label);
        $this->assertEqualsWithDelta(-500.0, (float) $reversal->taxable_amount, 0.005);
    }

    public function test_cancelling_the_inward_bill_reverses_every_charge(): void
    {
        $bill = $this->pushBill([
            $this->freight(1500),
            ['external_id' => 'chg-other', 'head_code' => 'OTHER', 'amount' => 100,
             'gst_percent' => 18, 'treatment' => 'expense', 'spread_method' => 'value', 'itc_eligibility' => 'eligible'],
        ]);

        $freight = $this->charge($bill, 'chg-1500');
        $other = $this->charge($bill, 'chg-other');
        $expenseId = $other->expense_id;
        $this->assertNotNull(Expense::find($expenseId));

        // A till cancels by pushing the header with no lines, so the postings stay and read as
        // reversed instead of vanishing from the books (PUR-015).
        $this->pushBill([], ['status' => 'cancelled', 'cancel_reason' => 'Bill was never received', 'items' => []]);

        $freight = $freight->fresh();
        $other = $other->fresh();

        $this->assertEqualsWithDelta(1500.0, (float) $freight->reversed_amount, 0.005);
        $this->assertEqualsWithDelta(100.0, (float) $other->reversed_amount, 0.005);
        $this->assertTrue($freight->isFullyReversed());
        $this->assertTrue($other->isFullyReversed());
        $this->assertNull(Expense::find($expenseId), 'a cancelled bill leaves no register entry behind');

        $this->assertEqualsWithDelta(100.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);
        $this->assertEqualsWithDelta(50.0, (float) $this->batch($this->b)->landed_cost_rate, 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $this->batch($this->a)->stock_qty, 0.005);
    }

    public function test_an_edit_of_the_bill_keeps_the_return_already_filed_against_it(): void
    {
        $this->pushBill([$this->freight(1500)]);
        $this->pushReturn([$this->returnLine($this->a, 100, 50)]);

        // The freight is re-keyed at twice the money; the half of line A already returned
        // now reverses 1,000 of the new 2,000 rather than the 500 of the old one.
        $edited = $this->pushBill([$this->freight(3000)]);

        $freight = $this->charge($edited, 'chg-3000');
        $this->assertEqualsWithDelta(2000.0,
            (float) PurchaseItem::where('purchase_id', $edited->id)->where('product_id', $this->a->id)->value('charge_allocation'),
            0.005);
        $this->assertEqualsWithDelta(1000.0, (float) $freight->reversed_amount, 0.005);
        $this->assertEqualsWithDelta(110.0, (float) $this->batch($this->a)->landed_cost_rate, 0.005);

        $this->assertNotNull(
            PurchaseItem::where('purchase_id', $this->bill('CRS-PR-0001')->id)->firstOrFail()->original_purchase_item_id,
            'PUR-015: re-keying the bill must not orphan the debit note filed against it'
        );
    }

    public function test_a_return_with_no_original_bill_posts_no_charges(): void
    {
        $this->pushBill([$this->freight(1500)]);

        $note = $this->pushReturn([$this->returnLine($this->a, 100, 50)], [
            'original_purchase_number' => 'A-BILL-THAT-DOES-NOT-EXIST',
            'supplier_invoice_no' => 'NOT-EITHER',
        ]);

        $this->assertSame(0, PurchaseCharge::where('purchase_id', $note->id)->count());
        $this->assertNull(PurchaseItem::where('purchase_id', $note->id)->firstOrFail()->original_purchase_item_id);
    }
}
