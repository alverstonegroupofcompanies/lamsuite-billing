<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * CR-C Task 4.14 — the charge policy is a store decision the screen can actually make.
 *
 * `PUR-016` lists the keys; this file proves two things about them: the admin Settings screen can
 * write and read them back on one store only (R12 — no store inherits another's policy), and the
 * keys are not decoration. `allow_negative_charges` and `max_percent_of_goods` were declared with no
 * code reading them, which is the worst state a policy key can be in: an owner flips it off and
 * believes the till will now refuse what it no longer allows. Either the switch decides something or
 * the spec stops promising it. This build decides.
 */
class AdminSettingsTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $other;
    private User $owner;
    private User $otherOwner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Policy Store', 'code' => 'POL', 'store_type' => 'pharmacy',
            'state_code' => '32', 'is_active' => true,
        ]);
        $this->other = Store::create([
            'name' => 'Other Policy Store', 'code' => 'OPP', 'store_type' => 'pharmacy',
            'state_code' => '27', 'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Policy Owner', 'email' => 'owner@policy-settings.in',
            'password' => bcrypt('secret-pass'), 'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);
        $this->otherOwner = User::create([
            'name' => 'Other Owner', 'email' => 'owner@otherpolicy-settings.in',
            'password' => bcrypt('secret-pass'), 'role' => 'store_owner',
            'store_id' => $this->other->id,
        ]);
    }

    // ------------------------------------------------------------------ helpers

    private function policy(?array $charges): array
    {
        return [
            'billing' => array_merge(
                ['tax_mode' => 'exclusive', 'gst_type' => 'regular'],
                $charges === null ? [] : ['purchase_charges' => $charges]
            ),
        ];
    }

    private function savePolicy(array $charges): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($this->owner);

        return $this->postJson('/api/admin/settings', $this->policy($charges));
    }

    private function line(array $overrides = []): array
    {
        return array_merge([
            'product_name' => 'Amoxicillin 500mg',
            'batch_no' => 'B-9',
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

    /** @return \Illuminate\Testing\TestResponse */
    private function postBill(array $charges, array $overrides = [])
    {
        Sanctum::actingAs($this->owner);

        return $this->postJson('/api/purchases', array_merge([
            'store_id' => $this->store->id,
            'supplier_name' => 'Policy Distributors',
            'invoice_number' => 'POL-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => $charges,
        ], $overrides));
    }

    // -------------------------------------------------------------------- tests

    public function test_charge_policy_round_trips_through_the_settings_screen(): void
    {
        $this->savePolicy([
            'separately_paid_in_payable' => true,
            'allow_negative_charges' => false,
            'max_percent_of_goods' => 5,
            'reverse_on_return' => 'sunk',
        ])->assertOk();

        Sanctum::actingAs($this->owner);
        $billing = $this->getJson('/api/admin/settings')->assertOk()->json('billing.purchase_charges');

        $this->assertTrue((bool) $billing['separately_paid_in_payable']);
        $this->assertFalse((bool) $billing['allow_negative_charges']);
        $this->assertEqualsWithDelta(5.0, (float) $billing['max_percent_of_goods'], 0.001);
        $this->assertSame('sunk', $billing['reverse_on_return']);
    }

    public function test_a_policy_never_leaks_to_another_store(): void
    {
        $this->savePolicy(['allow_negative_charges' => false]);

        Sanctum::actingAs($this->owner);
        $billing = $this->getJson('/api/admin/settings')->assertOk()->json('billing.purchase_charges');
        $this->assertFalse((bool) $billing['allow_negative_charges']);

        // The other store's owner was never asked this question, so their bill is still priced under
        // the shipped default — one store's switch may not tighten another's rules (R12).
        Sanctum::actingAs($this->otherOwner);
        $otherBilling = $this->getJson('/api/admin/settings', ['HTTP_X-Store-Id' => $this->other->id])
            ->assertOk()
            ->json('billing.purchase_charges');
        $this->assertTrue((bool) ($otherBilling['allow_negative_charges'] ?? true));

        $this->postJson('/api/purchases', [
            'store_id' => $this->other->id,
            'supplier_name' => 'Other Distributors',
            'invoice_number' => 'OPP-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => [$this->charge('OTHER', -50)],
        ])->assertCreated();

        $this->assertDatabaseHas('purchase_charges', [
            'store_id' => $this->other->id,
            'head_code' => 'OTHER',
            'amount' => -50.0,
        ]);
    }

    public function test_negative_charges_post_while_the_store_allows_them(): void
    {
        // PUR-014: cash discount and TCS-style adjustments are negative rows, and the shipped
        // default is to allow them.
        $this->postBill([$this->charge('OTHER', -50)])->assertCreated();

        $charge = PurchaseCharge::where('store_id', $this->store->id)->first();
        $this->assertEqualsWithDelta(-50.0, (float) $charge->amount, 0.005);
    }

    public function test_a_store_that_turns_negative_charges_off_has_its_bill_refused(): void
    {
        $this->savePolicy(['allow_negative_charges' => false]);

        $response = $this->postBill([$this->charge('OTHER', -50)])->assertStatus(422);

        $messages = $response->json('errors')['charges.0.amount'] ?? [];
        $this->assertNotEmpty($messages, 'a refused charge line must be named in the errors');
        $this->assertStringContainsString('negative', strtolower(implode(' ', $messages)));
        $this->assertSame(0, PurchaseCharge::where('store_id', $this->store->id)->count());
        $this->assertSame(0, Purchase::where('store_id', $this->store->id)->count());
    }

    public function test_a_positive_charge_line_survives_the_negative_switch_being_off(): void
    {
        $this->savePolicy(['allow_negative_charges' => false]);

        $this->postBill([$this->charge('FREIGHT', 200)])->assertCreated();
    }

    public function test_charge_total_above_the_stored_cap_is_refused_and_at_it_is_accepted(): void
    {
        // Goods ₹10,000.00 taxable; 5% of that is ₹500.00 of charge.
        $this->savePolicy(['max_percent_of_goods' => 5]);

        $this->postBill([$this->charge('FREIGHT', 600)])->assertStatus(422);
        $this->assertSame(0, Purchase::where('store_id', $this->store->id)->count());

        $this->postBill([$this->charge('FREIGHT', 500)])->assertCreated();
    }

    public function test_the_cap_counts_every_row_on_the_bill_not_just_the_first(): void
    {
        $this->savePolicy(['max_percent_of_goods' => 5]);

        // ₹300 + ₹300 is ₹600 against a ₹500 allowance — a per-row check would pass this bill.
        $this->postBill([
            $this->charge('FREIGHT', 300),
            $this->charge('PACKING', 300),
        ])->assertStatus(422);

        $this->assertSame(0, Purchase::where('store_id', $this->store->id)->count());
    }

    public function test_no_cap_is_set_when_the_key_is_absent_or_zero(): void
    {
        // The default is unlimited: a store that never touched the switch must keep the money it
        // could key before CR-C-14.
        $this->postBill([$this->charge('FREIGHT', 9000)])->assertCreated();

        $this->savePolicy(['max_percent_of_goods' => 0]);
        $this->postBill([$this->charge('PACKING', 9000)])->assertCreated();
    }

    public function test_a_legacy_policy_spellings_of_booleans_are_read_as_booleans(): void
    {
        // Profiles saved by older builds spelled a switch as "1"/"true" (CFG-003); the enforcement
        // must not treat the string "0" as a decision.
        CompanySetting::updateOrCreate(
            ['store_id' => $this->store->id, 'key' => 'billing'],
            ['value' => ['purchase_charges' => ['allow_negative_charges' => '0']]]
        );

        $this->postBill([$this->charge('OTHER', -50)])->assertStatus(422);
    }

    public function test_an_already_posted_bill_is_not_rewritten_by_a_policy_change(): void
    {
        $this->postBill([$this->charge('FREIGHT', 200)])->assertCreated();

        $this->savePolicy(['allow_negative_charges' => false, 'max_percent_of_goods' => 1]);

        // The rows the bill was posted with are untouched; the policy only decides the next bill.
        $charge = PurchaseCharge::where('store_id', $this->store->id)->firstOrFail();
        $this->assertEqualsWithDelta(200.0, (float) $charge->amount, 0.005);
        $this->assertDatabaseHas('purchase_charges', ['id' => $charge->id, 'in_payable' => true]);
    }
}
