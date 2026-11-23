<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Expense;
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
 * CR-C Task 4.15 — the release gate of specs/02-plan.md 6.6.
 *
 * A charge line is booked in four places at once: the spread rows that say which goods line
 * absorbed it, the batch's landed cost, the expense register, and the GST columns that decide
 * what the working papers credit. Those are four separate writes, so nothing in the earlier
 * suites proves they still agree. This reads every figure back out of the tables — never from
 * the request that filled them — and closes the identity:
 *
 *   Σ goods taxable + Σ add_to_cost allocations + Σ expense postings (incl. non-creditable tax)
 *                   + Σ creditable input tax (goods and charges)
 *       = (grand_total − round_off) + Σ charge totals left outside the payable
 *
 * in paise, so a difference of one paisa anywhere in any of the four is a failing test. It runs
 * over a bill that was only posted, one that was edited, one with a part return, one returned in
 * full, one cancelled, one whose charge was paid separately, and a store holding a bill in every
 * one of those states at once.
 */
class PurchaseChargeReconciliationTest extends TestCase
{
    use RefreshDatabase;

    private const RETURN_MODULES = ['purchase_return', 'debit_note'];

    private Store $store;
    private User $owner;
    private Product $a;
    private Product $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Reconciliation Store',
            'code' => 'RCS01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Reconciliation Owner',
            'email' => 'owner@charge-reconciliation.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        Sanctum::actingAs($this->owner);

        $this->a = $this->product('Reconciliation Drug A', 100, 'BCH-A');
        $this->b = $this->product('Reconciliation Drug B', 50, 'BCH-B');
    }

    // ---------------------------------------------------------------- fixtures

    private function product(string $name, float $rate, string $batchNo): Product
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => $name,
            'current_stock' => 0,
            'mrp' => $rate * 2,
            'sel_rate' => (int) ($rate * 1.5),
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => $batchNo,
            'expiry_date' => '2027-12-31',
            'stock_qty' => 0,
            'mrp' => $rate * 2,
            'purchase_rate' => $rate,
            'selling_rate' => (int) ($rate * 1.5),
        ]);

        return $product;
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

    private function batchNo(Product $product): string
    {
        return $product->id === $this->a->id ? 'BCH-A' : 'BCH-B';
    }

    /**
     * The HTTP path, which prices the document itself — so here the header is a fact the server
     * owes an explanation for, not a figure a till asserted.
     */
    private function postBill(array $charges, array $overrides = []): Purchase
    {
        $response = $this->postJson('/api/purchases', array_merge([
            'store_id' => $this->store->id,
            'supplier_name' => 'Reconciliation Distributors',
            'invoice_number' => 'RCS-SUP-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [array_merge($this->goodsLine($this->a, 100), ['hsn_code' => '30041090'])],
            'charges' => $charges,
        ], $overrides));

        $response->assertCreated();

        return $this->bill($this->billNumberOf((int) $response->json('purchase.id')));
    }

    private function billNumberOf(int $purchaseId): string
    {
        return (string) Purchase::findOrFail($purchaseId)->invoice_number;
    }

    private function charge(float $amount, array $overrides = []): array
    {
        return array_merge([
            'external_id' => 'rcs-chg-' . uniqid(),
            'head_code' => 'FREIGHT',
            'amount' => $amount,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
            'sac_code' => '996731',
        ], $overrides);
    }

    /** The worked bill of Task 4.11: 10,000 of A and 5,000 of B, so a value spread splits 2:1. */
    private function pushBill(array $charges = [], array $overrides = []): Purchase
    {
        $payload = array_merge([
            'id' => 'rcs_pur_' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_number' => 'RCS-PUSH-' . strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'purchase_number' => 'RCS-PUR-' . strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'supplier_name' => 'Reconciliation Distributors',
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

    private function pushReturn(Purchase $original, array $lines, array $overrides = []): Purchase
    {
        $payload = array_merge([
            'id' => 'rcs_ret_' . substr(md5(uniqid('', true)), 0, 8),
            'return_number' => 'RCS-PR-' . strtoupper(substr(md5(uniqid('', true)), 0, 6)),
            'return_date' => '2026-11-20',
            'original_purchase_number' => $original->invoice_number,
            'supplier_name' => 'Reconciliation Distributors',
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

        $this->postJson('/api/sync/push/purchases', ['purchases' => [$payload]])->assertStatus(200);

        return $this->bill($payload['return_number']);
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

    private function bill(string $number): Purchase
    {
        return Purchase::with(['items', 'charges.allocations'])
            ->where('store_id', $this->store->id)
            ->where('invoice_number', $number)
            ->firstOrFail();
    }

    // ---------------------------------------------------------------- the gate

    /**
     * Every term of the identity, read out of the posting tables for the live documents of this
     * store. A cancelled document is not in the set: it gave all four legs back, so counting it
     * would count money the books no longer hold. Charge and expense rows carry their own sign
     * (a debit note reverses in the negative), goods lines do not, so they take the document's.
     *
     * @return array<string, float>
     */
    private function terms(?array $invoiceNumbers = null): array
    {
        $docs = Purchase::where('store_id', $this->store->id)
            ->where('status', '!=', 'cancelled')
            ->when($invoiceNumbers !== null, fn ($q) => $q->whereIn('invoice_number', $invoiceNumbers))
            ->with(['items', 'charges'])
            ->get();

        $t = [
            'goods_taxable' => 0.0,
            'goods_tax' => 0.0,
            'round_off' => 0.0,
            'stock_cost' => 0.0,
            'expense_register' => 0.0,
            'charge_creditable_tax' => 0.0,
            'charge_tax' => 0.0,
            'charge_in_payable' => 0.0,
            'charge_outside_payable' => 0.0,
        ];

        $chargeIds = $docs->flatMap(fn (Purchase $d) => $d->charges->pluck('id'))->all();

        foreach ($docs as $doc) {
            $sign = in_array((string) $doc->module_key, self::RETURN_MODULES, true) ? -1 : 1;

            foreach ($doc->items as $item) {
                $t['goods_taxable'] += $sign * (float) $item->taxable_amount;
                $t['goods_tax'] += $sign * round(
                    (float) $item->cgst_amount + (float) $item->sgst_amount
                    + (float) $item->igst_amount + (float) $item->cess_amount,
                    2
                );
            }

            $t['round_off'] += $sign * (float) $doc->round_off;

            foreach ($doc->charges as $charge) {
                $tax = $charge->taxAmount();
                $t['charge_tax'] += $tax;
                // The engine capitalises or expenses by eligibility alone; a reverse-charge line's
                // tax is still money the books must put somewhere (REP-009 treats it as self-paid).
                $t['charge_creditable_tax'] += $charge->itc_eligibility === 'eligible' ? $tax : 0.0;

                if ($charge->isInPayable()) {
                    $t['charge_in_payable'] += (float) $charge->total_amount;
                } else {
                    $t['charge_outside_payable'] += (float) $charge->total_amount;
                }
            }
        }

        // The two independent postings, not the charge columns that describe them.
        $t['stock_cost'] = $chargeIds === [] ? 0.0 : round((float) PurchaseChargeAllocation::whereIn(
            'purchase_charge_id', $chargeIds
        )->sum('allocated_amount'), 2);

        $t['expense_register'] = $chargeIds === [] ? 0.0 : round((float) Expense::whereIn(
            'purchase_charge_id', $chargeIds
        )->sum('amount'), 2);

        return array_map(fn (float $v): float => round($v, 2), $t);
    }

    /** PUR-002: the units a charge is spread over include the free ones. */
    private function unitsOf(PurchaseItem $item): float
    {
        $upp = max(1, (float) ($item->units_per_pack ?: 1));

        return round(((float) $item->qty + (float) $item->free_qty) * $upp
            + (float) $item->loose_qty + (float) $item->free_loose_qty, 4);
    }

    /**
     * The fourth book on its own, and the one the identity cannot see on its own: what a batch
     * says it cost to get here. Read per goods line, it is the spread rows of that line's bill
     * less the spread rows of the live debit notes that were filed against it — so a landed rate
     * a return took down but the rows did not, or the reverse, fails here.
     *
     * It holds only where one inward bill owns the batch, which is the case in every scenario
     * that calls it; a batch receipted by two bills carries the second one's cost alone (PUR-011).
     */
    private function assertLandedCostMatchesTheSpreadRows(Purchase $bill, string $context): void
    {
        foreach ($bill->fresh()->items as $item) {
            $held = round((float) PurchaseChargeAllocation::where('purchase_item_id', $item->id)->sum('allocated_amount'), 2);

            $returnedItemIds = PurchaseItem::where('original_purchase_item_id', $item->id)
                ->whereIn('purchase_id', Purchase::where('store_id', $this->store->id)
                    ->whereIn('module_key', self::RETURN_MODULES)
                    ->where('status', '!=', 'cancelled')
                    ->pluck('id'))
                ->pluck('id');

            $givenBack = $returnedItemIds->isEmpty() ? 0.0 : round((float) PurchaseChargeAllocation::whereIn(
                'purchase_item_id', $returnedItemIds
            )->sum('allocated_amount'), 2);

            $net = round($held + $givenBack, 2);
            $units = $this->unitsOf($item);
            $batch = ProductBatch::where('store_id', $this->store->id)
                ->where('product_id', $item->product_id)
                ->where('batch_no', $item->batch_no)
                ->firstOrFail();

            $this->assertSame(
                round((float) $item->purchase_rate + $net / $units, 4),
                // A batch no charge has ever landed on still reads at the supplier's rate.
                round($batch->landed_cost_rate === null
                    ? (float) $batch->purchase_rate
                    : (float) $batch->landed_cost_rate, 4),
                $context . ": batch {$batch->batch_no} of {$item->product_name} is not valued at the "
                . number_format($net, 2, '.', '') . " this bill's spread rows left on its {$units} units"
            );
            $this->assertEqualsWithDelta((float) $item->purchase_rate, (float) $batch->purchase_rate, 0.005,
                $context . ': PUR-011, a charge must never rewrite the supplier rate on the batch');
        }
    }

    /**
     * @param array<string, float> $t
     */
    private function assertIdentityClosed(array $t, string $context): void
    {
        // The supplier ledger: what the bill owes, from the lines and the charges inside the payable.
        $ledger = round($t['goods_taxable'] + $t['goods_tax'] + $t['charge_in_payable'] + $t['round_off'], 2);

        $delta = round(
            $t['goods_taxable'] + $t['stock_cost'] + $t['expense_register']
            + $t['goods_tax'] + $t['charge_creditable_tax']
            - $ledger - $t['charge_outside_payable'],
            2
        );

        $this->assertSame(
            '0.00',
            number_format($delta, 2, '.', ''),
            $context . ' — identity terms: ' . json_encode($t + ['ledger_credit' => $ledger])
        );
    }

    // ---------------------------------------------------------------- the two treatments

    public function test_the_worked_example_closes_added_to_cost_in_all_four_books(): void
    {
        // specs/02-plan.md 6.6: goods 10,000 @12% + freight 200 @18% + packing 100 @18% = 11,554.
        $bill = $this->postBill([
            $this->charge(200),
            $this->charge(100, ['head_code' => 'PACKING', 'sac_code' => '996799']),
        ]);

        $t = $this->terms([$bill->invoice_number]);

        $this->assertSame(10000.00, $t['goods_taxable']);
        $this->assertSame(300.00, $t['stock_cost'], 'the charge money the spread rows landed on the goods');
        $this->assertSame(0.00, $t['expense_register'], 'nothing of it went to the expense register');
        $this->assertSame(1200.00, $t['goods_tax'], 'the goods GST alone; the 54 of charge GST is in the charge rows');
        $this->assertSame(11554.00, $t['charge_in_payable'] + $t['goods_taxable'] + $t['goods_tax']);
        $this->assertSame(11554.00, round((float) $bill->grand_total - (float) $bill->round_off, 2),
            'and the payable the server priced is the same money');
        $this->assertIdentityClosed($t, 'a worked example with add-to-cost charges');
        $this->assertLandedCostMatchesTheSpreadRows($bill, 'the worked example as cost');
    }

    public function test_the_worked_example_closes_expensed_in_all_four_books(): void
    {
        $bill = $this->postBill([
            $this->charge(200, ['treatment' => 'expense']),
            $this->charge(100, ['head_code' => 'PACKING', 'sac_code' => '996799', 'treatment' => 'expense']),
        ]);

        $t = $this->terms([$bill->invoice_number]);

        $this->assertSame(0.00, $t['stock_cost'], 'an expensed charge never touches landed cost');
        $this->assertSame(300.00, $t['expense_register'], 'the register takes the whole ex-GST amount');
        $this->assertSame(11554.00, round((float) $bill->grand_total - (float) $bill->round_off, 2),
            'PUR-012: an expensed supplier-borne charge still rides in the payable');
        $this->assertIdentityClosed($t, 'the same example with expensed charges');
        $this->assertLandedCostMatchesTheSpreadRows($bill, 'the worked example as expense');
    }

    public function test_a_blocked_head_closes_with_its_tax_capitalised_rather_than_claimed(): void
    {
        // 200 of freight with no ITC: the 36 that can never be claimed is cost, not input tax.
        $bill = $this->postBill([
            $this->charge(200, ['itc_eligibility' => 'blocked']),
            $this->charge(100, ['head_code' => 'INSURANCE', 'treatment' => 'expense', 'itc_eligibility' => 'blocked']),
        ]);

        $t = $this->terms([$bill->invoice_number]);

        $this->assertSame(236.00, $t['stock_cost'], 'the expensed part alone: 200 + 36 of unclaimable GST');
        $this->assertSame(118.00, $t['expense_register']);
        $this->assertSame(0.00, $t['charge_creditable_tax']);
        $this->assertIdentityClosed($t, 'a bill whose charge tax can never be claimed');
        $this->assertLandedCostMatchesTheSpreadRows($bill, 'a capitalised charge with no ITC');
    }

    // ---------------------------------------------------------------- membership of the payable

    public function test_a_charge_paid_separately_outside_the_payable_is_still_fully_booked(): void
    {
        $bill = $this->postBill([
            $this->charge(200, ['paid_separately' => true, 'paid_to_label' => 'Ganga Courier']),
        ]);

        $charge = $bill->charges->first();
        $this->assertFalse($charge->isInPayable(), 'the answer the bill was priced with is stored on the row');

        $t = $this->terms([$bill->invoice_number]);

        $this->assertSame(11200.00, round((float) $bill->grand_total - (float) $bill->round_off, 2),
            'CR-C-11: money paid to the courier is not money owed to the supplier');
        $this->assertSame(236.00, $t['charge_outside_payable']);
        $this->assertSame(200.00, $t['stock_cost'], 'but the freight is still cost of these goods');
        $this->assertIdentityClosed($t, 'a separately-paid charge left outside the payable');
        $this->assertLandedCostMatchesTheSpreadRows($bill, 'a courier paid outside the bill');
    }

    public function test_a_policy_flip_moves_the_next_bill_and_restates_the_last_one_not_at_all(): void
    {
        $before = $this->postBill([$this->charge(200, ['paid_separately' => true])]);

        CompanySetting::updateOrCreate(
            ['store_id' => $this->store->id, 'key' => 'billing'],
            ['value' => ['tax_mode' => 'exclusive', 'purchase_charges' => ['separately_paid_in_payable' => true]]]
        );

        $after = $this->postBill([
            $this->charge(200, ['paid_separately' => true, 'external_id' => 'rcs-after']),
        ]);

        $this->assertFalse($before->charges()->first()->isInPayable(), 'PUR-016');
        $this->assertTrue($after->charges()->first()->isInPayable(), 'PUR-016');

        $this->assertSame(11200.00, round((float) $before->grand_total - (float) $before->round_off, 2));
        $this->assertSame(11436.00, round((float) $after->grand_total - (float) $after->round_off, 2));

        $this->assertIdentityClosed($this->terms([$before->invoice_number]), 'the bill priced under the old policy');
        $this->assertIdentityClosed($this->terms([$after->invoice_number]), 'the bill priced under the new policy');
        $this->assertIdentityClosed($this->terms(), 'both bills together, each with its own stored answer');
    }

    // ---------------------------------------------------------------- the lifecycle

    public function test_a_part_return_closes_the_identity_across_the_bill_and_the_note(): void
    {
        $bill = $this->pushBill([$this->charge(1500)]);
        $note = $this->pushReturn($bill, [$this->returnLine($this->a, 100, 50)]);

        $t = $this->terms();

        // The note reverses half of what line A absorbed: 1,000 of the 1,500 spread 2:1 by value.
        $this->assertSame(1000.00, $t['stock_cost'], 'the spread rows the note gave back are gone from stock');
        $this->assertSame(10000.00, $t['goods_taxable'], '15,000 billed less the 5,000 sent back');
        $this->assertNotSame(0.0, $note->charges->sum('allocated_amount'), 'reversed in the note\'s own rows');
        $this->assertIdentityClosed($t, 'a bill with a part return filed against it');
        $this->assertLandedCostMatchesTheSpreadRows($bill, 'a batch half of whose goods went back');
    }

    public function test_a_full_return_leaves_no_charge_money_in_any_of_the_four_books(): void
    {
        $bill = $this->pushBill([
            $this->charge(1500),
            $this->charge(200, ['head_code' => 'INSURANCE', 'treatment' => 'expense', 'itc_eligibility' => 'blocked']),
        ]);
        $this->pushReturn($bill, [$this->returnLine($this->a, 100, 100), $this->returnLine($this->b, 50, 100)]);

        $t = $this->terms();

        $this->assertSame(0.00, $t['goods_taxable']);
        $this->assertSame(0.00, $t['stock_cost']);
        $this->assertSame(0.00, $t['expense_register'], 'the register keeps the credit row, so it nets to nothing');
        $this->assertSame(0.00, $t['charge_outside_payable']);
        $this->assertIdentityClosed($t, 'a bill returned in full');
        $this->assertLandedCostMatchesTheSpreadRows($bill, 'a batch whose every unit went back');

        foreach (ProductBatch::where('store_id', $this->store->id)->get() as $batch) {
            $this->assertEqualsWithDelta((float) $batch->purchase_rate, (float) $batch->landed_cost_rate, 0.005,
                "batch {$batch->batch_no} still carries charge cost after everything came back");
        }
    }

    public function test_cancelling_the_inward_bill_takes_the_whole_document_out_of_the_books(): void
    {
        $bill = $this->pushBill([
            $this->charge(1500),
            $this->charge(200, ['head_code' => 'PACKING', 'treatment' => 'expense']),
        ]);

        $expenseId = Expense::where('store_id', $this->store->id)->value('id');
        $this->assertNotNull($expenseId);

        // A till cancels by re-pushing the same invoice number with no lines, so the postings stay
        // in place and read as reversed rather than vanishing from the books (PUR-015).
        $this->pushBill([], [
            'invoice_number' => $bill->invoice_number,
            'status' => 'cancelled',
            'cancel_reason' => 'Bill was never received',
            'items' => [],
        ]);

        $this->assertNull(Expense::find($expenseId), 'a cancelled bill leaves no register entry behind');

        foreach (PurchaseCharge::where('store_id', $this->store->id)->get() as $charge) {
            $this->assertSame((float) $charge->reversibleAmount(), (float) $charge->reversed_amount,
                "charge {$charge->head_code} is not fully reversed");
        }

        $t = $this->terms();
        $this->assertSame(0.00, $t['stock_cost']);
        $this->assertSame(0.00, $t['expense_register']);
        $this->assertIdentityClosed($t, 'a store whose only bill was cancelled');

        $live = $this->terms([$bill->invoice_number]);
        $this->assertIdentityClosed($live, 'the cancelled bill read as if it were still live');
    }

    public function test_an_edit_replaces_the_postings_instead_of_adding_a_second_set(): void
    {
        $first = $this->pushBill([$this->charge(1500, ['external_id' => 'rcs-edit-freight'])]);

        // The same invoice number, re-pushed with the freight at twice the money: the till's edit
        // path, which reverses the old postings and re-posts from the new payload as one write.
        $edited = $this->pushBill(
            [$this->charge(3000, ['external_id' => 'rcs-edit-freight'])],
            ['invoice_number' => $first->invoice_number]
        );

        $this->assertSame($first->id, $edited->id, 'the edit re-keyed the same bill');
        $this->assertSame(1, PurchaseCharge::where('store_id', $this->store->id)->count());
        $this->assertSame(2, PurchaseChargeAllocation::where('store_id', $this->store->id)->count(),
            'the old spread rows were replaced, not added to');

        $t = $this->terms();
        $this->assertSame(3000.00, $t['stock_cost']);
        $this->assertIdentityClosed($t, 'a bill edited from 1,500 of freight to 3,000');
        $this->assertLandedCostMatchesTheSpreadRows($edited, 'the batch after the edit re-spread it');
    }

    // ---------------------------------------------------------------- the store-wide gate

    public function test_a_store_holding_a_bill_in_every_state_reconciles_to_the_paisa(): void
    {
        $plain = $this->pushBill([$this->charge(1500)]);
        $expensed = $this->pushBill([
            $this->charge(200, ['head_code' => 'INSURANCE', 'treatment' => 'expense', 'itc_eligibility' => 'blocked']),
            $this->charge(100, ['head_code' => 'PACKING']),
        ]);
        $returned = $this->pushBill([$this->charge(1500)]);
        $this->pushReturn($returned, [$this->returnLine($this->b, 50, 40)]);
        $partPaid = $this->pushBill([
            $this->charge(500, ['head_code' => 'OTHER', 'paid_separately' => true, 'paid_to_label' => 'Ganga Courier']),
        ]);
        $cancelled = $this->pushBill([$this->charge(1000)]);
        $this->pushBill([], [
            'invoice_number' => $cancelled->invoice_number,
            'status' => 'cancelled',
            'cancel_reason' => 'Duplicate invoice',
            'items' => [],
        ]);

        $t = $this->terms();

        $this->assertCount(5, Purchase::where('store_id', $this->store->id)->where('status', '!=', 'cancelled')->get());
        $this->assertGreaterThan(0.0, $t['stock_cost']);
        $this->assertGreaterThan(0.0, $t['expense_register']);
        $this->assertGreaterThan(0.0, $t['charge_outside_payable']);
        $this->assertIdentityClosed($t, 'five live documents, four treatments, two return sizes');

        $this->assertFalse($partPaid->charges()->first()->isInPayable(),
            'the note a till synced kept the membership its own policy answered');
        // The header line of the identity — `grand_total` equals the ledger the lines and charges
        // describe — is proved on the documents the server prices, in the worked examples above:
        // a synced bill's header stays exactly as the till sent it (PUR-017).
    }

    // ---------------------------------------------------------------- the gate is not vacuous

    public function test_the_gate_fails_when_one_paisa_of_a_spread_row_does_not_exist(): void
    {
        $bill = $this->postBill([$this->charge(200)]);

        $t = $this->terms([$bill->invoice_number]);
        $this->assertIdentityClosed($t, 'untouched postings');

        // One paisa missing from the spread rows is exactly what this gate must catch.
        $allocation = PurchaseChargeAllocation::where('store_id', $this->store->id)->firstOrFail();
        $allocation->update(['allocated_amount' => round((float) $allocation->allocated_amount - 0.01, 2)]);

        $broken = $this->terms([$bill->invoice_number]);
        $ledger = round($broken['goods_taxable'] + $broken['goods_tax']
            + $broken['charge_in_payable'] + $broken['round_off'], 2);
        $delta = round($broken['goods_taxable'] + $broken['stock_cost'] + $broken['expense_register']
            + $broken['goods_tax'] + $broken['charge_creditable_tax']
            - $ledger - $broken['charge_outside_payable'], 2);

        $this->assertSame('0.01', number_format(abs($delta), 2, '.', ''),
            'a gate that closes on a paisa it should not is not a gate');
    }
}
