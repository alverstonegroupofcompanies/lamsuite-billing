<?php

namespace Tests\Feature;

use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * CR-C Task 4.14 — the charges an accountants needs to see, as rows.
 *
 * The purchase register answers "what did this bill cost"; this endpoint answers "what did we pay
 * anybody for freight, packing and insurance this month, in which store, and is that money inside
 * what we owe the supplier or outside it". Every filter the requirement names has to work off the
 * stored row, because the row — not a re-derivation from today's settings — is what a posted bill
 * promised on paper (PUR-016).
 *
 * Read scope follows the same rule as every other admin screen: a store user never sees another
 * store's charges, and a cross-store read says which store each row belongs to.
 */
class AdminPurchaseChargesTest extends TestCase
{
    use RefreshDatabase;

    private Store $north;
    private Store $south;
    private User $owner;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->north = Store::create([
            'name' => 'North Store', 'code' => 'NST', 'store_type' => 'pharmacy',
            'state_code' => '32', 'is_active' => true,
        ]);
        $this->south = Store::create([
            'name' => 'South Store', 'code' => 'SST', 'store_type' => 'pharmacy',
            'state_code' => '27', 'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'North Owner', 'email' => 'owner@north-charges.in',
            'password' => bcrypt('secret-pass'), 'role' => 'store_owner',
            'store_id' => $this->north->id,
        ]);
        $this->admin = User::create([
            'name' => 'Chain Admin', 'email' => 'admin@chain-charges.in',
            'password' => bcrypt('secret-pass'), 'role' => 'super_admin',
            'store_id' => $this->north->id,
        ]);
    }

    // ------------------------------------------------------------------ helpers

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

    /**
     * Post one bill with these charges in this store, as that store's owner.
     *
     * @param array<int, array<string, mixed>> $charges
     */
    private function postBill(Store $store, User $as, array $charges, array $overrides = []): void
    {
        Sanctum::actingAs($as);

        $this->postJson('/api/purchases', array_merge([
            'store_id' => $store->id,
            'supplier_name' => 'Distributors ' . $store->code,
            'invoice_number' => 'CHG-' . substr(md5(uniqid('', true)), 0, 8),
            'invoice_date' => '2026-11-15',
            'lines' => [$this->line()],
            'charges' => $charges,
        ], $overrides))->assertCreated();
    }

    /** @param array<string, mixed> $query */
    private function charges(array $query = [], array $headers = []): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api/admin/purchase-charges?' . http_build_query($query), $headers);
    }

    private function allStores(): array
    {
        return ['HTTP_X-Store-Scope' => 'all'];
    }

    // -------------------------------------------------------------------- tests

    public function test_returns_charge_rows_with_their_bill_and_store_identity(): void
    {
        $this->postBill($this->north, $this->owner, [$this->charge('FREIGHT', 200)]);

        Sanctum::actingAs($this->admin);
        $response = $this->charges(['store_id' => $this->north->id])->assertOk();

        $rows = $response->json('data');
        $this->assertCount(1, $rows);

        $row = $rows[0];
        $this->assertSame('FREIGHT', $row['head_code']);
        $this->assertSame('Freight', $row['head_name']);
        $this->assertEqualsWithDelta(200.0, (float) $row['amount'], 0.005);
        $this->assertEqualsWithDelta(200.0, (float) $row['taxable_amount'], 0.005);
        $this->assertEqualsWithDelta(36.0, (float) $row['total_tax'], 0.005);
        $this->assertEqualsWithDelta(236.0, (float) $row['total_amount'], 0.005);
        $this->assertSame('add_to_cost', $row['treatment']);
        $this->assertSame('value', $row['spread_method']);
        $this->assertSame('eligible', $row['itc_eligibility']);
        $this->assertFalse((bool) $row['is_rcm']);
        $this->assertFalse((bool) $row['paid_separately']);
        $this->assertTrue((bool) $row['in_payable']);
        $this->assertSame('manual', $row['source']);

        // The row must be traceable to the bill it came from and to the store that posted it.
        $this->assertNotEmpty($row['purchase']['invoice_number'] ?? null);
        $this->assertSame('Distributors NST', $row['purchase']['supplier_name']);
        $this->assertSame($this->north->id, $row['store']['id']);
        $this->assertSame('North Store', $row['store']['name']);
        $this->assertSame('NST', $row['store']['code']);
    }

    public function test_scopes_to_one_store_for_a_store_user(): void
    {
        $this->postBill($this->north, $this->owner, [$this->charge('FREIGHT', 200)]);

        $southOwner = User::create([
            'name' => 'South Owner', 'email' => 'owner@south-charges.in',
            'password' => bcrypt('secret-pass'), 'role' => 'store_owner',
            'store_id' => $this->south->id,
        ]);
        $this->postBill($this->south, $southOwner, [$this->charge('PACKING', 100)]);

        // South's owner asks for North's charges by id: the store scope refuses, it does not shrink.
        Sanctum::actingAs($southOwner);
        $this->charges(['store_id' => $this->north->id])->assertForbidden();

        // And with no store parameter at all they still only ever see their own rows.
        $mine = $this->charges()->assertOk();
        $rows = $mine->json('data');
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertSame($this->south->id, $row['store']['id']);
        }
    }

    public function test_lists_every_accessible_store_when_the_scope_is_all(): void
    {
        $this->postBill($this->north, $this->owner, [$this->charge('FREIGHT', 200)]);
        $southOwner = User::create([
            'name' => 'South Owner 2', 'email' => 'owner2@south-charges.in',
            'password' => bcrypt('secret-pass'), 'role' => 'store_owner',
            'store_id' => $this->south->id,
        ]);
        $this->postBill($this->south, $southOwner, [$this->charge('PACKING', 100)]);

        Sanctum::actingAs($this->admin);
        $rows = $this->charges([], $this->allStores())->assertOk()->json('data');

        $this->assertCount(2, $rows);
        $this->assertEqualsCanonicalizing(
            [$this->north->id, $this->south->id],
            array_column(array_column($rows, 'store'), 'id')
        );
    }

    public function test_filters_on_the_facts_stored_with_the_charge(): void
    {
        // One bill with every shape of charge row, so each filter has something to keep and to drop.
        $this->postBill($this->north, $this->owner, [
            $this->charge('FREIGHT', 200),
            $this->charge('INSURANCE', 50, [
                'treatment' => 'expense', 'spread_method' => 'quantity',
                'itc_eligibility' => 'blocked', 'is_rcm' => true,
            ]),
            $this->charge('PACKING', 100, ['paid_separately' => true, 'paid_to_label' => 'Courier Co']),
        ]);

        Sanctum::actingAs($this->admin);
        $scoped = ['store_id' => $this->north->id];

        /** Every filter is answered by the head codes it keeps, sorted so order never flatters it. */
        $heads = fn (array $filters): array => $this->headCodes(array_column(
            $this->charges(array_merge($scoped, $filters))->assertOk()->json('data'),
            'head_code'
        ));

        $this->assertSame(['FREIGHT'], $heads(['head_code' => 'FREIGHT']));
        $this->assertSame(['INSURANCE'], $heads(['treatment' => 'expense']));
        $this->assertSame(['INSURANCE'], $heads(['spread_method' => 'quantity']));
        $this->assertSame(['INSURANCE'], $heads(['itc_eligibility' => 'blocked']));
        $this->assertSame(['INSURANCE'], $heads(['is_rcm' => '1']));
        $this->assertSame(['PACKING'], $heads(['paid_separately' => '1']));

        // The payable side is read from the row, not re-derived from today's policy.
        $this->assertSame(['PACKING'], $heads(['in_payable' => '0']));

        // Date window on the bill's own date: inside keeps, outside drops.
        $this->assertCount(3, $heads(['from' => '2026-11-01', 'to' => '2026-11-30']));
        $this->assertCount(0, $heads(['from' => '2026-12-01', 'to' => '2026-12-31']));

        // Free text reaches the payee written on a separately-paid row.
        $this->assertSame(['PACKING'], $heads(['search' => 'Courier']));
    }

    /** @param string[] $codes */
    private function headCodes(array $codes): array
    {
        sort($codes);

        return $codes;
    }

    public function test_totals_the_filtered_set_independently_of_pagination(): void
    {
        $this->postBill($this->north, $this->owner, [
            $this->charge('FREIGHT', 200),
            $this->charge('PACKING', 100, ['paid_separately' => true]),
        ]);

        Sanctum::actingAs($this->admin);
        $response = $this->charges(['store_id' => $this->north->id, 'per_page' => 1])->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame(2, $response->json('meta.total'));

        // The summary is the whole filtered answer: ₹200 inside the payable, ₹118 outside it
        // (₹100 + 18% GST), whatever page is on screen.
        $summary = $response->json('summary');
        $this->assertSame(2, $summary['row_count']);
        $this->assertEqualsWithDelta(300.0, (float) $summary['charge_amount_total'], 0.005);
        $this->assertEqualsWithDelta(236.0, (float) $summary['in_payable_total'], 0.005);
        $this->assertEqualsWithDelta(118.0, (float) $summary['outside_payable_total'], 0.005);
    }

    public function test_export_returns_the_whole_filtered_set_unpaginated(): void
    {
        $this->postBill($this->north, $this->owner, [
            $this->charge('FREIGHT', 200),
            $this->charge('PACKING', 100),
            $this->charge('OTHER', 50),
        ]);

        Sanctum::actingAs($this->admin);
        $response = $this->charges(['store_id' => $this->north->id, 'export' => 'true'])->assertOk();

        $this->assertCount(3, $response->json('data'));
        $this->assertNull($response->json('meta'));
        $this->assertSame(
            [1, 2, 3],
            array_column($response->json('data'), 'seq')
        );
    }

    public function test_a_bill_filed_before_the_charge_tables_contributes_nothing(): void
    {
        // PUR-017 materialises a Freight head only on the bill's first *edit*. A bill that has never
        // been opened since CR-C has no rows, and this view reads rows — it does not invent the
        // scalar's freight, which stays in the purchase register that reads `freight_charges`.
        Purchase::create([
            'store_id' => $this->north->id,
            'supplier_name' => 'Distributors NST',
            'invoice_number' => 'OLD-1',
            'invoice_date' => '2026-09-01',
            'subtotal' => 10000,
            'tax_total' => 1200,
            'freight_charges' => 500,
            'round_off' => 0,
            'grand_total' => 11700,
            'status' => 'received',
        ]);

        $this->assertSame(0, PurchaseCharge::where('store_id', $this->north->id)->count());

        Sanctum::actingAs($this->admin);
        $response = $this->charges(['store_id' => $this->north->id])->assertOk();
        $this->assertCount(0, $response->json('data'));
        $this->assertSame(0, $response->json('summary')['row_count']);
    }

    public function test_a_bill_posted_today_with_the_legacy_scalar_is_one_freight_row(): void
    {
        // The retired field does not stop being money: a till that still pushes `freight_charges`
        // gets it priced by the engine as one 0%-GST add-to-cost line, so the charge rows and the
        // landed cost agree on where the ₹500 went (PUR-017).
        $this->postBill($this->north, $this->owner, [], ['freight_charges' => 500]);

        Sanctum::actingAs($this->admin);
        $rows = $this->charges(['store_id' => $this->north->id])->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('FREIGHT', $rows[0]['head_code']);
        $this->assertEqualsWithDelta(0.0, (float) $rows[0]['gst_percent'], 0.005);
        $this->assertEqualsWithDelta(500.0, (float) $rows[0]['total_amount'], 0.005);
        $this->assertTrue((bool) $rows[0]['in_payable']);
    }

    public function test_requires_transactions_view_permission(): void
    {
        // The charges register is part of the transaction reading, so it asks for exactly the
        // permission `/admin/purchases` asks for — here a role whose baseline has none of it.
        $accountant = User::create([
            'name' => 'Chain Accountant', 'email' => 'accounts@charges-view.in',
            'password' => bcrypt('secret-pass'), 'role' => 'accountant',
            'store_id' => $this->north->id,
        ]);

        Sanctum::actingAs($accountant);
        $this->charges()->assertForbidden();

        // and a store user, whose role does carry it, may read their own rows
        $this->postBill($this->north, $this->owner, [$this->charge('FREIGHT', 200)]);
        Sanctum::actingAs($this->owner);
        $this->charges()->assertOk();
    }
}
