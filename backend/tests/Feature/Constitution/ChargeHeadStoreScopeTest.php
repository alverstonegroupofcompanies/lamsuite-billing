<?php

namespace Tests\Feature\Constitution;

use App\Models\MasterLookup;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CR-C rule R12 — charge heads are store-scoped, exactly like units are under R11:
 * seeded per store, never shared, reset-able, and a head that posted charges reference
 * cannot be deleted until those charges are reassigned.
 */
class ChargeHeadStoreScopeTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        // G1-SEC: till routes need a claimed counter; this stands one in for the store each request names.
        $this->actAsClaimedCounterOfRequestedStore();

        // Created through the model, so the controller-path seeding is not triggered.
        $this->storeA = Store::create(['name' => 'Head Store A', 'code' => 'HA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Head Store B', 'code' => 'HB', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin', 'email' => 'heads@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => null, 'allowed_store_ids' => null,
        ]);
    }

    private function asStoreA()
    {
        return $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id]);
    }

    private function createHead(Store $store, string $name, string $code, array $config = []): MasterLookup
    {
        return MasterLookup::create([
            'store_id' => $store->id,
            'type' => 'charge_head',
            'name' => $name,
            'code' => $code,
            'config' => $config,
            'is_active' => true,
        ]);
    }

    /**
     * A posted bill with one charge line of the given head.
     */
    private function billWithCharge(Store $store, string $invoiceNumber, MasterLookup $head): PurchaseCharge
    {
        $purchase = Purchase::create([
            'store_id' => $store->id,
            'supplier_name' => 'Head Distributors',
            'invoice_number' => $invoiceNumber,
            'invoice_date' => '2026-11-01',
            'subtotal' => 100,
            'tax_total' => 12,
            'grand_total' => 118,
        ]);

        PurchaseItem::create([
            'purchase_id' => $purchase->id,
            'product_name' => 'Paracetamol 500',
            'batch_no' => 'B-' . $invoiceNumber,
            'expiry_date' => '2027-12-31',
            'qty' => 1,
            'purchase_rate' => 100,
            'taxable_amount' => 100,
            'gst_percent' => 12,
            'tax_amount' => 12,
            'total_amount' => 112,
        ]);

        return PurchaseCharge::create([
            'store_id' => $store->id,
            'purchase_id' => $purchase->id,
            'external_id' => 'chg-' . $invoiceNumber,
            'seq' => 1,
            'head_code' => $head->code,
            'head_name' => $head->name,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'spread_basis_used' => 'value',
            'itc_eligibility' => 'eligible',
            'amount' => 50,
            'gst_percent' => 18,
            'taxable_amount' => 50,
            'cgst_amount' => 9,
            'sgst_amount' => 9,
            'total_amount' => 68,
            'allocated_amount' => 50,
            'source' => 'manual',
        ]);
    }

    public function test_creating_a_store_seeds_the_default_charge_heads_for_it(): void
    {
        $this->asStoreA()
            ->postJson('/api/admin/stores', ['name' => 'New Head Store', 'code' => 'NH1', 'state_code' => '32'])
            ->assertCreated();

        $store = Store::where('code', 'NH1')->firstOrFail();
        $heads = MasterLookup::where('store_id', $store->id)->where('type', 'charge_head')->get();

        $this->assertSame(
            ['Freight', 'Packing', 'Loading/Unloading', 'Insurance', 'Other'],
            $heads->pluck('name')->values()->all(),
            'a new store must start with the seeded charge head set'
        );

        $freight = $heads->firstWhere('code', 'FREIGHT');
        $this->assertSame('add_to_cost', $freight->config['default_treatment']);
        $this->assertSame('996731', $freight->config['sac_code']);
        $this->assertTrue($freight->config['seeded']);

        $this->assertSame('expense', $heads->firstWhere('code', 'OTHER')->config['default_treatment']);
        $this->assertSame('both', $heads->firstWhere('code', 'OTHER')->config['allowed_sign']);

        $this->assertSame(
            0,
            MasterLookup::where('type', 'charge_head')->whereNull('store_id')->count(),
            'R12: charge heads are never seeded as shared NULL-store rows'
        );
    }

    public function test_first_head_listing_seeds_defaults_for_a_store_without_heads(): void
    {
        $rows = $this->asStoreA()
            ->getJson('/api/admin/lookups?type=charge_head')
            ->assertOk()
            ->json('data');

        $this->assertCount(5, $rows);
        foreach ($rows as $row) {
            $this->assertSame((int) $this->storeA->id, (int) $row['store_id']);
        }

        // Idempotent: a second read creates nothing.
        $this->assertCount(5, $this->asStoreA()->getJson('/api/admin/lookups?type=charge_head')->assertOk()->json('data'));
    }

    public function test_head_listing_never_shows_another_stores_heads_or_a_shared_row(): void
    {
        $this->createHead($this->storeA, 'Cold Chain Freight', 'CCF');
        $this->createHead($this->storeB, 'Export Freight', 'EXP');

        $names = collect($this->asStoreA()->getJson('/api/admin/lookups?type=charge_head')->assertOk()->json('data'))
            ->pluck('name')
            ->all();

        $this->assertContains('Cold Chain Freight', $names);
        $this->assertNotContains('Export Freight', $names, 'a store must never see another store\'s charge heads');
    }

    public function test_an_untyped_listing_excludes_another_stores_store_scoped_rows(): void
    {
        $this->createHead($this->storeB, 'Export Freight', 'EXP');
        MasterLookup::create(['type' => 'bank', 'name' => 'Shared Bank', 'is_active' => true]);

        $names = collect($this->asStoreA()->getJson('/api/admin/lookups')->assertOk()->json('data'))
            ->pluck('name')
            ->all();

        $this->assertContains('Shared Bank', $names, 'shared lookups keep the shared+own rule');
        $this->assertNotContains('Export Freight', $names, 'store-scoped types must not leak into an untyped listing');
    }

    public function test_a_charge_head_without_a_store_is_refused(): void
    {
        $orphan = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/lookups', ['type' => 'charge_head', 'name' => 'Global Freight', 'code' => 'GFR'])
            ->assertStatus(422);

        $this->assertStringContainsString('must belong to a store', $orphan->json('message'));
        $this->assertSame(0, MasterLookup::where('type', 'charge_head')->whereNull('store_id')->count());
    }

    public function test_a_head_config_outside_the_engine_enums_is_refused(): void
    {
        $this->asStoreA()
            ->postJson('/api/admin/lookups', [
                'type' => 'charge_head',
                'name' => 'Weird Head',
                'code' => 'WIR',
                'config' => ['default_treatment' => 'capitalize'],
            ])
            ->assertStatus(422);

        $this->asStoreA()
            ->postJson('/api/admin/lookups', [
                'type' => 'charge_head',
                'name' => 'Weird Sac',
                'code' => 'WSAC',
                'config' => ['sac_code' => 'ABCD'],
            ])
            ->assertStatus(422);

        $this->assertSame(0, MasterLookup::where('code', 'WIR')->count());
        $this->assertSame(0, MasterLookup::where('code', 'WSAC')->count());
    }

    public function test_a_store_cannot_update_or_delete_another_stores_head(): void
    {
        $foreign = $this->createHead($this->storeB, 'Export Freight', 'EXP');

        $this->asStoreA()->putJson("/api/admin/lookups/{$foreign->id}", ['name' => 'Hacked'])->assertNotFound();
        $this->asStoreA()->deleteJson("/api/admin/lookups/{$foreign->id}")->assertNotFound();

        $this->assertSame('Export Freight', $foreign->fresh()->name);
    }

    public function test_deleting_a_referenced_head_is_rejected_until_charges_are_reassigned(): void
    {
        $head = $this->createHead($this->storeA, 'Freight', 'FREIGHT');
        $replacement = $this->createHead($this->storeA, 'Transport', 'TRANS');
        $charge = $this->billWithCharge($this->storeA, 'INV-H-1', $head);

        $response = $this->asStoreA()
            ->deleteJson("/api/admin/lookups/{$head->id}")
            ->assertStatus(409);

        $this->assertTrue($response->json('reassignment_required'));
        $this->assertSame('INV-H-1', $response->json('referencing_bills.0.invoice_number'));
        $this->assertSame(68.0, (float) $response->json('referencing_bills.0.amount'));
        $this->assertContains('TRANS', collect($response->json('candidate_heads'))->pluck('code')->all());

        $this->assertNotNull($head->fresh(), 'a referenced head must survive the guarded delete');
        $this->assertSame('FREIGHT', $charge->fresh()->head_code);
    }

    public function test_reassign_then_delete_moves_the_charges_and_keeps_the_posted_money(): void
    {
        $head = $this->createHead($this->storeA, 'Freight', 'FREIGHT');
        $replacement = $this->createHead($this->storeA, 'Transport', 'TRANS');
        $charge = $this->billWithCharge($this->storeA, 'INV-H-2', $head);

        $this->asStoreA()
            ->deleteJson("/api/admin/lookups/{$head->id}?reassign_to={$replacement->id}")
            ->assertOk()
            ->assertJsonFragment(['reassigned_count' => 1]);

        $this->assertNull($head->fresh(), 'the head must be gone after reassignment');

        $charge->refresh();
        $this->assertSame('TRANS', $charge->head_code);
        $this->assertSame('Transport', $charge->head_name);
        $this->assertSame(50.0, (float) $charge->amount, 'reassigning a head never restates the posted charge');
        $this->assertSame(68.0, (float) $charge->total_amount);
    }

    public function test_reset_restores_missing_defaults_and_removes_only_unused_custom_heads(): void
    {
        $this->asStoreA()->getJson('/api/admin/lookups?type=charge_head')->assertOk();

        MasterLookup::where('store_id', $this->storeA->id)->where('type', 'charge_head')->where('code', 'FREIGHT')->delete();
        $unused = $this->createHead($this->storeA, 'Challan', 'CHL');
        $used = $this->createHead($this->storeA, 'E-COM FEE', 'ECOM');
        $this->billWithCharge($this->storeA, 'INV-H-3', $used);

        $response = $this->asStoreA()->postJson('/api/admin/lookups/reset-charge-heads')->assertOk();

        $this->assertContains('Freight', $response->json('seeded'));
        $this->assertContains('Challan', $response->json('removed'));
        $this->assertContains('E-COM FEE', $response->json('kept'));

        $names = MasterLookup::where('store_id', $this->storeA->id)->where('type', 'charge_head')->pluck('name')->all();
        $this->assertContains('Freight', $names, 'missing defaults must come back on reset');
        $this->assertNotContains('Challan', $names, 'unreferenced custom heads must be removed on reset');
        $this->assertContains('E-COM FEE', $names, 'referenced custom heads must survive reset');

        // Store B is untouched by store A's reset.
        $this->assertSame(
            0,
            MasterLookup::where('store_id', $this->storeB->id)->where('type', 'charge_head')->count()
        );
    }

    public function test_reset_requires_a_store_context(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/lookups/reset-charge-heads')
            ->assertStatus(422);
    }

    public function test_pull_delta_delivers_only_own_store_heads(): void
    {
        $this->createHead($this->storeA, 'Cold Chain Freight', 'CCF');
        $this->createHead($this->storeB, 'Export Freight', 'EXP');

        $lookups = $this->getJson('/api/sync/pull/deltas?since_watermark=0', ['X-Store-Id' => (string) $this->storeA->id])
            ->assertOk()
            ->json('lookups');

        $heads = collect($lookups)->where('type', 'charge_head')->pluck('name')->all();

        $this->assertContains('Cold Chain Freight', $heads);
        $this->assertNotContains('Export Freight', $heads, 'another store\'s heads must never arrive in a pull delta');
    }

    public function test_pull_delta_seeds_the_default_heads_for_a_store_without_any(): void
    {
        $this->createHead($this->storeA, 'Cold Chain Freight', 'CCF');

        $lookups = $this->getJson('/api/sync/pull/deltas?since_watermark=0', ['X-Store-Id' => (string) $this->storeB->id])
            ->assertOk()
            ->json('lookups');

        $heads = collect($lookups)->where('type', 'charge_head')->pluck('name')->all();

        $this->assertContains('Freight', $heads, 'a store that predates CR-C is seeded on the till\'s first pull');
        $this->assertNotContains('Cold Chain Freight', $heads);

        $stored = MasterLookup::where('store_id', $this->storeB->id)->where('type', 'charge_head')->get();
        $this->assertCount(5, $stored);
        $this->assertSame(0, $stored->whereNull('store_id')->count());
    }
}
