<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GAP-02 / PHR-011 — the pharmacist rule stays inside the pharmacy.
 *
 * The gate is a drug-law rule, so a kirana counter must not inherit it: no
 * schedule list to mark, no product allowed to carry one, no staff member who
 * can be a pharmacist, no bill stopped for a confirmation, and no pharmacy
 * surface handed to its till. A pack restricted one street over is ordinary
 * rice here, even when an import left the old schedule code stamped on it.
 *
 * Each call is made straight at the API the way the till or the panel makes
 * it, so the isolation is measured at the server and not at a screen.
 */
class PharmacyOnlyLeakTest extends TestCase
{
    use RefreshDatabase;

    private Store $pharmacy;
    private Store $grocery;
    private User $owner;
    private Product $rice;
    private ProductBatch $riceBatch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->pharmacy = Store::create([
            'name' => 'LamStone Medicos',
            'code' => 'LMS',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);
        $this->grocery = Store::create([
            'name' => 'Fresh Mart',
            'code' => 'FRM',
            'state_code' => '32',
            'store_type' => 'kirana_general',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@pharmacy-only.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->pharmacy->id,
        ]);

        Counter::create([
            'store_id' => $this->grocery->id,
            'counter_code' => 'C05',
            'counter_name' => 'Counter C05',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $h1 = MasterLookup::create([
            'store_id' => $this->pharmacy->id,
            'type' => 'drug_schedule',
            'code' => 'H1',
            'name' => 'Schedule H1',
            'config' => ['restricted' => true, 'prescription_required' => true],
            'is_active' => true,
        ]);

        $this->rice = Product::create([
            'store_id' => $this->grocery->id,
            'name' => 'Sona Masoori Rice 5kg',
            'barcode' => 'LEAK-RICE',
            'hsn_sac_code' => '1006',
            'current_stock' => 40,
            'mrp' => 500.00,
            'sel_rate' => 450.00,
            'gst_percent' => 5.00,
            'units_per_pack' => 1,
            // An import carried the neighbouring pharmacy's stamp across.
            'schedule_code' => 'H1',
            'is_active' => true,
        ]);

        $this->riceBatch = ProductBatch::create([
            'store_id' => $this->grocery->id,
            'product_id' => $this->rice->id,
            'batch_no' => 'BCH-RICE',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 40,
            'mrp' => 500.00,
            'selling_rate' => 450.00,
        ]);
    }

    /** @return \Illuminate\Testing\TestResponse */
    private function asGrocery(array $extra = [])
    {
        return $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(array_merge(['X-Store-Id' => (string) $this->grocery->id], $extra));
    }

    public function test_a_grocery_bill_never_stops_for_a_pharmacist(): void
    {
        $this->withHeader('X-Store-Id', (string) $this->grocery->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C05',
                'store_id' => $this->grocery->id,
                'external_id' => 'ext_leak_' . uniqid(),
                'idempotency_key' => 'ext_leak_' . uniqid(),
                'customer_name' => 'Walk-in Customer',
                'payment_mode' => 'Cash',
                'items' => [[
                    'product_id' => $this->rice->id,
                    'product_name' => $this->rice->name,
                    'batch_id' => $this->riceBatch->id,
                    'batch_no' => $this->riceBatch->batch_no,
                    'qty' => 2,
                    'unit_price' => 450.00,
                    'gst_percent' => 5.00,
                ]],
            ])
            ->assertStatus(201);

        $this->assertSame(1, Invoice::query()->count(), 'the grocery bill was not written');

        // Nobody was asked to vouch, so nobody is named: the columns are there
        // for every store, but only a pharmacy ever fills them.
        $invoice = Invoice::query()->first();
        $this->assertNull($invoice->pharmacist_id);
        $this->assertNull($invoice->pharmacist_name);
        $this->assertDatabaseCount('pharmacist_confirmations', 0);
    }

    public function test_a_grocery_store_keeps_no_drug_schedule_list(): void
    {
        $refused = $this->asGrocery()->postJson('/api/admin/lookups', [
            'type' => 'drug_schedule',
            'code' => 'H1',
            'name' => 'Schedule H1',
            'config' => ['restricted' => true],
        ])->assertStatus(422);

        $this->assertStringContainsString(
            'pharmacy',
            strtolower((string) $refused->json('message'))
        );
        $this->assertSame(
            1,
            MasterLookup::query()->where('type', 'drug_schedule')->count(),
            'the refused row was written, or the pharmacy list leaked'
        );

        $listed = $this->asGrocery()->getJson('/api/admin/lookups?type=drug_schedule')->assertOk();
        $this->assertSame([], $listed->json('data'), "a grocery till was handed the pharmacy's list");
    }

    public function test_a_grocery_product_cannot_be_marked_with_a_schedule(): void
    {
        $scheduleId = MasterLookup::query()
            ->where('type', 'drug_schedule')
            ->where('store_id', $this->pharmacy->id)
            ->value('id');

        $refused = $this->asGrocery()->postJson('/api/admin/products', [
            'store_id' => (string) $this->grocery->id,
            'name' => 'Imported Alprazolam',
            'barcode' => 'LEAK-ALP',
            'hsn_sac_code' => '3004',
            'mrp' => 42.00,
            'sel_rate' => 38.00,
            'gst_percent' => 5.00,
            'drug_schedule_id' => $scheduleId,
        ])->assertStatus(422);

        $this->assertArrayHasKey('drug_schedule_id', (array) $refused->json('errors'));
        $this->assertSame(1, Product::query()->count(), 'the refused product wrote a row');
    }

    public function test_a_grocery_store_cannot_register_a_pharmacist(): void
    {
        $refused = $this->asGrocery()->postJson('/api/admin/salespeople', [
            'name' => 'Ganesh Prasad',
            'is_pharmacist' => true,
            'reg_no' => 'KPK-2021-77112',
            'reg_valid_from' => '2021-01-01',
            'reg_valid_until' => '2031-12-31',
            'pin' => '701945',
        ])->assertStatus(422);

        $this->assertArrayHasKey('is_pharmacist', (array) $refused->json('errors'));
        $this->assertSame(0, Salesperson::query()->count(), 'the refused staff row was written');
    }

    /**
     * The panel decides which pharmacy-only screens to draw from the store list
     * it is handed at sign-in. A row that arrives without its type is read as a
     * pharmacy, so a kirana scope shows the drug schedule master and the
     * pharmacist fields it must never see.
     */
    public function test_the_panel_is_told_which_stores_are_pharmacies(): void
    {
        $rows = $this->actingAs($this->owner, 'sanctum')
            ->getJson('/api/admin/me')
            ->assertOk()
            ->json('stores');

        $byId = collect($rows)->keyBy('id');

        $this->assertSame(
            'pharmacy',
            $byId[$this->pharmacy->id]['store_type'] ?? null,
            'the panel cannot tell the chemist is a pharmacy'
        );
        $this->assertSame(
            'kirana_general',
            $byId[$this->grocery->id]['store_type'] ?? null,
            'a store with no type reads as a pharmacy in the panel'
        );
    }

    public function test_a_grocery_counter_is_handed_no_pharmacy_surface(): void
    {
        $context = $this->withHeaders(['X-Store-Id' => (string) $this->grocery->id])
            ->getJson('/api/counter/context')
            ->assertOk()
            ->json();

        $this->assertFalse((bool) $context['store']['is_pharmacy']);
        $this->assertNull($context['pharmacy'], 'the pharmacy block was sent to a grocery till');
    }

    /**
     * A staff row can arrive already marked as a pharmacist — from an import or
     * from a store that was a pharmacy until this morning. The till is still
     * told who works here, and is never told who may confirm a restricted drug.
     */
    public function test_a_grocery_till_is_never_told_who_may_confirm_a_restricted_drug(): void
    {
        Salesperson::create([
            'store_id' => $this->grocery->id,
            'name' => 'Ganesh Prasad',
            'code' => 'FRM-01',
            'is_pharmacist' => true,
            'reg_no' => 'KPK-2021-77112',
            'reg_valid_from' => '2021-01-01',
            'reg_valid_until' => '2031-12-31',
            'pin' => '701945',
            'is_active' => true,
        ]);

        $rows = $this->withHeaders(['X-Store-Id' => (string) $this->grocery->id])
            ->getJson('/api/salespeople/eligible')
            ->assertOk()
            ->json('salespeople');

        $this->assertCount(1, $rows);
        $this->assertSame('Ganesh Prasad', $rows[0]['name']);
        foreach (['is_pharmacist', 'reg_no', 'registration_valid', 'registration_refusal'] as $field) {
            $this->assertArrayNotHasKey($field, $rows[0], "the grocery till was told about {$field}");
        }
    }
}
