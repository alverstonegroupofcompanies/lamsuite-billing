<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Expense;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use App\Services\Reports\PurchaseRegisterService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * CR-C-11 Tasks 4.17/4.18 — the store decides whether a separately-paid charge is money the
 * supplier is owed.
 *
 * `billing.purchase_charges.separately_paid_in_payable` is off by default, which is what CR-C
 * shipped with: freight handed to the transporter is a cost of the goods but not part of the
 * supplier's bill. A store whose supplier prints that freight on its own invoice turns the
 * switch on, and the same rupee then rides in the payable.
 *
 * Only the payable moves. Landed cost, the expense register and the ITC columns are charge-row
 * facts that never depended on who was paid. And the answer each line got is stored on it
 * (PUR-016), so flipping the policy cannot restate a bill that has already been printed — nor
 * let a later debit note credit money the original bill never billed.
 */
class PurchaseChargePayablePolicyTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Payable Policy Store',
            'code' => 'PPS01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Policy Owner',
            'email' => 'owner@payable-policy.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        Sanctum::actingAs($this->owner);
    }

    // ------------------------------------------------------------------ helpers

    private function setPolicy(bool $inPayable): void
    {
        CompanySetting::updateOrCreate(
            ['store_id' => $this->store->id, 'key' => 'billing'],
            ['value' => [
                'tax_mode' => 'exclusive',
                'purchase_charges' => ['separately_paid_in_payable' => $inPayable],
            ]]
        );
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

    /** Goods 10,000 at 12%: the payable alone is 11,200.00 before any charge. */
    private function postBill(array $charges, array $overrides = []): Purchase
    {
        $response = $this->postJson('/api/purchases', array_merge([
            'store_id' => $this->store->id,
            'supplier_name' => 'Payable Policy Distributors',
            'invoice_number' => 'PPC-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => $charges,
        ], $overrides));

        $response->assertCreated();

        return Purchase::with(['items', 'charges.allocations'])->findOrFail($response->json('purchase.id'));
    }

    /** Rs 200 freight at 18% = Rs 236 — the rupee the policy decides the fate of. */
    private function freight(array $overrides = []): array
    {
        return array_merge([
            'head_code' => 'FREIGHT',
            'amount' => 200,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
            'sac_code' => '996714',
            'paid_separately' => true,
            'paid_to_label' => 'Ganga Courier',
        ], $overrides);
    }

    private function chargeRow(Purchase $purchase, string $headCode): PurchaseCharge
    {
        $row = PurchaseCharge::where('purchase_id', $purchase->id)->where('head_code', $headCode)->first();

        $this->assertNotNull($row, "charge {$headCode} is not posted on bill {$purchase->invoice_number}");

        return $row;
    }

    private function taxOf(PurchaseCharge $charge): float
    {
        return round(
            (float) $charge->cgst_amount + (float) $charge->sgst_amount
            + (float) $charge->igst_amount + (float) $charge->cess_amount,
            2
        );
    }

    /**
     * The payable identity, keyed on the flag the bill was priced under rather than on who was
     * paid: goods + the charges inside the payable + all of their tax == the bill total.
     */
    private function assertPayableIdentity(Purchase $purchase): void
    {
        $items = PurchaseItem::where('purchase_id', $purchase->id)->get();
        $inside = PurchaseCharge::where('purchase_id', $purchase->id)->where('in_payable', true)->get();

        $netBeforeRound = round((float) $purchase->grand_total - (float) $purchase->round_off, 2);

        $this->assertEqualsWithDelta(
            round((float) $items->sum('taxable_amount') + (float) $inside->sum('taxable_amount'), 2)
            + round((float) $items->sum('tax_amount') + $inside->sum(fn (PurchaseCharge $c) => $this->taxOf($c)), 2),
            $netBeforeRound,
            0.005,
            'PUR-001/CR-C-11: the payable is the goods money plus the charges inside it'
        );

        $this->assertEqualsWithDelta(
            round((float) $items->sum('tax_amount') + $inside->sum(fn (PurchaseCharge $c) => $this->taxOf($c)), 2),
            (float) $purchase->tax_total,
            0.005
        );
    }

    // ------------------------------------------------------------------ the policy itself

    public function test_the_default_policy_keeps_a_separately_paid_charge_out_of_the_payable(): void
    {
        $purchase = $this->postBill([$this->freight()]);

        $charge = $this->chargeRow($purchase, 'FREIGHT');
        $this->assertTrue((bool) $charge->paid_separately);
        $this->assertFalse((bool) $charge->in_payable,
            'PUR-016: no policy set means the CR-C rule stands — the courier was already paid');

        $this->assertEqualsWithDelta(11200.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(1200.0, (float) $purchase->tax_total, 0.005);
        $this->assertPayableIdentity($purchase);
    }

    public function test_the_policy_bills_a_separately_paid_charge_into_what_the_supplier_is_owed(): void
    {
        $this->setPolicy(true);
        $purchase = $this->postBill([$this->freight()]);

        $charge = $this->chargeRow($purchase, 'FREIGHT');
        $this->assertTrue((bool) $charge->paid_separately,
            'CR-C-11: who was paid is a separate fact from what the supplier is owed');
        $this->assertSame('Ganga Courier', $charge->paid_to_label);
        $this->assertTrue((bool) $charge->in_payable);

        // The 236 the courier took is now on the supplier's own bill.
        $this->assertEqualsWithDelta(11436.0, (float) $purchase->grand_total, 0.005);
        $this->assertEqualsWithDelta(1236.0, (float) $purchase->tax_total, 0.005);
        $this->assertEqualsWithDelta(618.0, (float) $purchase->cgst_total, 0.005);
        $this->assertEqualsWithDelta(618.0, (float) $purchase->sgst_total, 0.005);
        $this->assertPayableIdentity($purchase);
    }

    public function test_a_supplier_paid_charge_is_in_the_payable_under_either_policy(): void
    {
        $outside = $this->postBill([$this->freight(['paid_separately' => false])]);
        $this->assertTrue((bool) $this->chargeRow($outside, 'FREIGHT')->in_payable);

        $this->setPolicy(true);
        $inside = $this->postBill([$this->freight(['paid_separately' => false])]);

        $this->assertTrue((bool) $this->chargeRow($inside, 'FREIGHT')->in_payable);
        $this->assertEqualsWithDelta((float) $outside->grand_total, (float) $inside->grand_total, 0.005,
            'CR-C-11: the switch speaks only for charges paid to someone else');
    }

    public function test_only_the_payable_moves_neither_landed_cost_nor_the_expense_row(): void
    {
        $this->setPolicy(false);
        $outside = $this->postBill([
            $this->freight(),
            $this->freight(['head_code' => 'INSURANCE', 'amount' => 100, 'treatment' => 'expense', 'paid_to_label' => 'Star Insurance']),
        ]);

        $this->setPolicy(true);
        $inside = $this->postBill([
            $this->freight(),
            $this->freight(['head_code' => 'INSURANCE', 'amount' => 100, 'treatment' => 'expense', 'paid_to_label' => 'Star Insurance']),
        ]);

        // Task 4.17: the goods money, plus the 236 and the 118 the two paid-separately heads carry.
        $this->assertEqualsWithDelta(11200.0, (float) $outside->grand_total, 0.005);
        $this->assertEqualsWithDelta(11554.0, (float) $inside->grand_total, 0.005);

        foreach ([$outside, $inside] as $purchase) {
            $item = PurchaseItem::where('purchase_id', $purchase->id)->first();
            $this->assertEqualsWithDelta(200.0, (float) $item->charge_allocation, 0.005,
                'PUR-010: freight lands on the goods whoever paid for it');
            $this->assertEqualsWithDelta(102.0, (float) $item->landed_unit_cost, 0.005);

            $expense = Expense::where('purchase_id', $purchase->id)->first();
            $this->assertNotNull($expense, 'PUR-012: an expensed charge books to the register either way');
            $this->assertEqualsWithDelta(100.0, (float) $expense->amount, 0.005);
            $this->assertSame('Paid Separately', $expense->payment_mode,
                'CR-C-11: the register still says the insurer was paid, not the supplier');

            $this->assertEqualsWithDelta(18.0, (float) $this->chargeRow($purchase, 'FREIGHT')->cgst_amount, 0.005);
            $this->assertPayableIdentity($purchase);
        }
    }

    public function test_a_legacy_spelling_of_the_switch_still_turns_it_on(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'billing',
            'value' => ['tax_mode' => 'exclusive', 'purchase_charges' => ['separately_paid_in_payable' => '1']],
        ]);

        $purchase = $this->postBill([$this->freight()]);
        $this->assertTrue((bool) $this->chargeRow($purchase, 'FREIGHT')->in_payable);

        // Anything else — including a value a settings form never meant — keeps the CR-C rule.
        foreach (['0', '', 'maybe', null] as $spelling) {
            CompanySetting::where('store_id', $this->store->id)->where('key', 'billing')
                ->update(['value' => ['tax_mode' => 'exclusive', 'purchase_charges' => ['separately_paid_in_payable' => $spelling]]]);

            $bill = $this->postBill([$this->freight(['head_code' => 'PACKING'])]);
            $this->assertFalse((bool) $this->chargeRow($bill, 'PACKING')->in_payable,
                "CR-C-11: \"{$spelling}\" is not the switch being on");
        }
    }

    // ------------------------------------------------------------------ posted bills and returns

    public function test_a_policy_change_does_not_restate_a_bill_already_printed(): void
    {
        $before = $this->postBill([$this->freight()]);
        $this->assertEqualsWithDelta(11200.0, (float) $before->grand_total, 0.005);

        $this->setPolicy(true);

        $after = $this->postBill([$this->freight(['paid_to_label' => 'Highway Haulage'])]);
        $this->assertEqualsWithDelta(11436.0, (float) $after->grand_total, 0.005);

        $register = app(PurchaseRegisterService::class);
        $before->unsetRelation('charges')->load('charges');

        // The older bill keeps its own answer: same total, same register split, nothing restated.
        $this->assertEqualsWithDelta(11200.0, (float) $before->fresh()->grand_total, 0.005);
        $this->assertFalse((bool) $this->chargeRow($before, 'FREIGHT')->fresh()->in_payable);

        $summary = $register->summary($before);
        $this->assertEqualsWithDelta(0.0, (float) $summary['charge_total'], 0.005);
        $this->assertEqualsWithDelta(236.0, (float) $summary['separately_paid']['total'], 0.005);

        $afterSummary = $register->summary($after);
        $this->assertEqualsWithDelta(236.0, (float) $afterSummary['charge_total'], 0.005);
        $this->assertEqualsWithDelta(0.0, (float) $afterSummary['separately_paid']['total'], 0.005);
    }

    public function test_a_debit_note_reverses_the_charge_onto_the_side_the_bill_was_billed_on(): void
    {
        $product = $this->stockedProduct();

        $this->setPolicy(true);
        $bill = $this->pushSyncBill($product, 'PPS-SUP-ON', [$this->freightPayload('chg-on', true)], true);
        $note = $this->pushSyncReturn($bill, $product, 'PPS-PR-ON');

        $reversal = PurchaseCharge::where('purchase_id', $note->id)->first();
        $this->assertNotNull($reversal, 'PUR-015: the returned freight share is a charge line on the note');
        $this->assertTrue((bool) $reversal->in_payable,
            'CR-C-11: a note returning a charge the supplier was billed for reduces what it is owed');
        // Half the goods gives back half the 200 the freight spread on them (PUR-003).
        $this->assertEqualsWithDelta(100.0, (float) $this->chargeRow($bill, 'FREIGHT')->fresh()->reversed_amount, 0.005);

        $this->setPolicy(false);
        $offBill = $this->pushSyncBill($product, 'PPS-SUP-OFF', [$this->freightPayload('chg-off', true)]);
        $offNote = $this->pushSyncReturn($offBill, $product, 'PPS-PR-OFF');

        $offReversal = PurchaseCharge::where('purchase_id', $offNote->id)->first();
        $this->assertNotNull($offReversal);
        $this->assertFalse((bool) $offReversal->in_payable,
            'PUR-013: under the default rule the note never touches the supplier ledger');
        $this->assertEqualsWithDelta(100.0, (float) $this->chargeRow($offBill, 'FREIGHT')->fresh()->reversed_amount, 0.005,
            'Task 4.18: the paisa given back is the same under either policy; only its routing moves');
    }

    public function test_a_note_written_after_a_flip_still_follows_the_bill_it_returns(): void
    {
        $product = $this->stockedProduct();

        // Freight the courier paid, kept out of the supplier's bill.
        $bill = $this->pushSyncBill($product, 'PPS-SUP-FLIP', [$this->freightPayload('chg-flip', true)]);
        $this->assertFalse((bool) $this->chargeRow($bill, 'FREIGHT')->in_payable);

        $this->setPolicy(true);
        $note = $this->pushSyncReturn($bill, $product, 'PPS-PR-FLIP');

        $reversal = PurchaseCharge::where('purchase_id', $note->id)->first();
        $this->assertNotNull($reversal);
        $this->assertFalse((bool) $reversal->in_payable,
            'PUR-016: the note gives back the charge as that bill was billed, so the two still net to zero');
    }

    // ------------------------------------------------------------------ sync-side scaffolding

    private function stockedProduct(): Product
    {
        return Product::create([
            'store_id' => $this->store->id,
            'name' => 'Payable Policy Drug',
            'current_stock' => 0,
            'mrp' => 200,
            'sel_rate' => 150,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);
    }

    private function goodsLine(Product $product): array
    {
        return [
            'product_id' => (string) $product->id,
            'product_name' => $product->name,
            'batch_no' => 'B-PPS',
            'expiry_date' => '2027-12-31',
            'pack_qty' => 100,
            'units_per_pack' => 1,
            'purchase_rate' => 100,
            'mrp' => 200,
            'gst_percent' => 12,
            'taxable_amount' => 10000,
            'tax_amount' => 1200,
            'total_amount' => 11200,
        ];
    }

    private function freightPayload(string $externalId, bool $paidSeparately): array
    {
        return [
            'external_id' => $externalId,
            'head_code' => 'FREIGHT',
            'amount' => 200,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
            'sac_code' => '996714',
            'paid_separately' => $paidSeparately,
            'paid_to_label' => 'Ganga Courier',
        ];
    }

    /**
     * A till push of a bill the till already priced — the server re-prices the charge rows.
     * `$chargedIntoPayable` is what a till under that policy would have printed on the header.
     */
    private function pushSyncBill(Product $product, string $number, array $charges, bool $chargedIntoPayable = false): Purchase
    {
        $this->postJson('/api/sync/push/purchases', ['purchases' => [[
            'id' => 'pur_' . $number,
            'invoice_number' => $number,
            'purchase_number' => 'PUR-' . $number,
            'supplier_name' => 'Payable Policy Distributors',
            'supplier_gstin' => '32AAAAA1111BB1Z9',
            'invoice_date' => '2026-11-10',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'subtotal' => 10000,
            'tax_total' => $chargedIntoPayable ? 1236 : 1200,
            'cgst_total' => $chargedIntoPayable ? 618 : 600,
            'sgst_total' => $chargedIntoPayable ? 618 : 600,
            'round_off' => 0,
            'grand_total' => $chargedIntoPayable ? 11436 : 11200,
            'status' => 'received',
            'items' => [$this->goodsLine($product)],
            'charges' => $charges,
        ]]])->assertStatus(200);

        return Purchase::with(['items', 'charges.allocations'])
            ->where('store_id', $this->store->id)->where('invoice_number', $number)->firstOrFail();
    }

    /** Half the goods going back, which takes half of every charge share with it. */
    private function pushSyncReturn(Purchase $bill, Product $product, string $number): Purchase
    {
        $this->postJson('/api/sync/push/purchases', ['purchases' => [[
            'id' => 'pr_' . $number,
            'return_number' => $number,
            'return_date' => '2026-11-20',
            'original_purchase_number' => $bill->invoice_number,
            'supplier_name' => 'Payable Policy Distributors',
            'supplier_gstin' => '32AAAAA1111BB1Z9',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase_return',
            'status' => 'completed',
            'subtotal' => 0,
            'tax_total' => 0,
            'round_off' => 0,
            'grand_total' => 0,
            'lines' => [[
                'product_id' => (string) $product->id,
                'product_name' => $product->name,
                'batch_no' => 'B-PPS',
                'return_qty' => 50,
                'purchase_rate' => 100,
                'gst_percent' => 12,
                'taxable_amount' => 5000,
                'cgst_amount' => 300,
                'sgst_amount' => 300,
                'total_amount' => 5600,
            ]],
        ]]])->assertStatus(200);

        return Purchase::with(['items', 'charges'])
            ->where('store_id', $this->store->id)->where('invoice_number', $number)->firstOrFail();
    }
}
