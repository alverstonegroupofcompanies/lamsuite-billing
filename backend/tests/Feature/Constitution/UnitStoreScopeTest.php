<?php

namespace Tests\Feature\Constitution;

use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution guard — units carve-out reversed.
 * Units are store-scoped: defaults are seeded per store at app start, they are
 * never shared across stores, and an assigned unit cannot be deleted until its
 * products are reassigned to a replacement unit.
 */
class UnitStoreScopeTest extends TestCase
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

        // Created via the model, so controller-path unit seeding is not triggered.
        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin', 'email' => 'super@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => null, 'allowed_store_ids' => null,
        ]);
    }

    private function seedDefaults(): void
    {
        $this->artisan('units:seed-store-defaults')->assertSuccessful();
    }

    private function createUnit(Store $store, string $name, string $code): MasterLookup
    {
        return MasterLookup::create([
            'store_id' => $store->id, 'type' => 'unit', 'name' => $name, 'code' => $code, 'is_active' => true,
        ]);
    }

    private function createProduct(Store $store, string $name, string $barcode, ?string $unitId): Product
    {
        return Product::create([
            'store_id' => $store->id, 'name' => $name, 'barcode' => $barcode,
            'hsn_sac_code' => '30049099', 'mrp' => 10, 'sel_rate' => 9, 'gst_percent' => 12,
            'unit_id' => $unitId,
        ]);
    }

    public function test_creating_a_store_via_admin_api_seeds_default_units_for_it(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/stores', [
                'name' => 'New Store', 'code' => 'NS1', 'state_code' => '32',
            ])
            ->assertCreated();

        $newStore = Store::where('code', 'NS1')->firstOrFail();

        $units = MasterLookup::where('store_id', $newStore->id)->where('type', 'unit')->get();
        $this->assertSame(17, $units->count(), 'a new store must start with the default unit set');
        $this->assertTrue($units->pluck('name')->contains('Strip'));
        $this->assertTrue($units->pluck('name')->contains('Kilogram'));
        $this->assertSame(3, (int) $units->firstWhere('name', 'Kilogram')->config['precision']);

        $this->assertSame(
            0,
            MasterLookup::where('type', 'unit')->whereNull('store_id')->count(),
            'units must never be seeded as shared NULL-store rows'
        );
    }

    public function test_seed_command_seeds_every_store_and_removes_legacy_shared_units(): void
    {
        $shared = MasterLookup::create(['type' => 'unit', 'name' => 'Legacy Shared', 'code' => 'LSH', 'is_active' => true]);

        $this->artisan('units:seed-store-defaults')->assertSuccessful();

        foreach ([$this->storeA, $this->storeB] as $store) {
            $names = MasterLookup::where('store_id', $store->id)->where('type', 'unit')->pluck('name')->all();
            $this->assertCount(17, $names, "store {$store->code} must own the default unit set");
            $this->assertContains('Strip', $names);
            $this->assertContains('Millilitre', $names);
        }

        $this->assertNull(MasterLookup::find($shared->id), 'legacy shared unit rows must be removed once stores own their units');
        $this->assertSame(0, MasterLookup::where('type', 'unit')->whereNull('store_id')->count());
    }

    public function test_seed_command_is_idempotent(): void
    {
        $this->seedDefaults();
        $countAfterFirst = MasterLookup::where('type', 'unit')->count();

        $this->seedDefaults();

        $this->assertSame($countAfterFirst, MasterLookup::where('type', 'unit')->count());
    }

    public function test_units_listing_is_scoped_to_the_active_store(): void
    {
        $this->createUnit($this->storeA, 'Vial A', 'VIA');
        $this->createUnit($this->storeB, 'Sachet B', 'SAC');

        $rows = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/admin/lookups?type=unit')
            ->assertOk()
            ->json('data');

        $names = collect($rows)->pluck('name')->all();
        $this->assertContains('Vial A', $names);
        $this->assertNotContains('Sachet B', $names, 'a store must never see another store\'s units');
    }

    public function test_first_units_listing_seeds_defaults_for_a_store_without_units(): void
    {
        $rows = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/admin/lookups?type=unit')
            ->assertOk()
            ->json('data');

        $names = collect($rows)->pluck('name')->all();
        $this->assertCount(17, $names);
        $this->assertContains('Strip', $names);

        foreach ($rows as $row) {
            $this->assertSame($this->storeA->id, (int) $row['store_id']);
        }
    }

    public function test_deleting_an_assigned_unit_is_rejected_until_products_are_reassigned(): void
    {
        $this->seedDefaults();
        $unit = $this->createUnit($this->storeA, 'Vial', 'VIL');
        $this->createProduct($this->storeA, 'Inj Alpha', 'ALPHA-1', 'Vial');
        $this->createProduct($this->storeA, 'Inj Beta', 'BETA-1', (string) $unit->id);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/lookups/{$unit->id}")
            ->assertStatus(409);

        $this->assertTrue($response->json('reassignment_required'));
        $this->assertContains('Inj Alpha', $response->json('referencing_products'));
        $this->assertContains('Inj Beta', $response->json('referencing_products'));
        $this->assertNotEmpty($response->json('candidate_units'));

        $this->assertNotNull($unit->fresh(), 'an assigned unit must survive the guarded delete');
        $this->assertSame('Vial', Product::where('store_id', $this->storeA->id)->where('barcode', 'ALPHA-1')->first()->unit_id);
    }

    public function test_reassign_then_delete_moves_products_to_the_replacement_unit(): void
    {
        $this->seedDefaults();
        $unit = $this->createUnit($this->storeA, 'Vial', 'VIL');
        $product = $this->createProduct($this->storeA, 'Inj Alpha', 'ALPHA-1', 'Vial');
        $replacement = MasterLookup::where('store_id', $this->storeA->id)->where('type', 'unit')->where('name', 'Box')->firstOrFail();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/lookups/{$unit->id}?reassign_to={$replacement->id}")
            ->assertOk()
            ->assertJsonFragment(['reassigned_count' => 1]);

        $this->assertNull($unit->fresh(), 'the unit must be gone after reassignment');
        $this->assertSame('Box', $product->fresh()->unit_id);
    }

    public function test_a_store_cannot_update_or_delete_another_stores_unit(): void
    {
        $foreign = $this->createUnit($this->storeB, 'Sachet B', 'SAC');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->putJson("/api/admin/lookups/{$foreign->id}", ['name' => 'Hacked'])
            ->assertNotFound();

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/lookups/{$foreign->id}")
            ->assertNotFound();

        $this->assertSame('Sachet B', $foreign->fresh()->name);
        $this->assertNotNull($foreign->fresh());
    }

    public function test_reset_restores_missing_defaults_and_removes_only_unused_custom_units(): void
    {
        $this->seedDefaults();

        // Remove a default and add a custom one, one referenced by a product.
        MasterLookup::where('store_id', $this->storeA->id)->where('type', 'unit')->where('name', 'Strip')->delete();
        $unused = $this->createUnit($this->storeA, 'Dropper', 'DRP');
        $used = $this->createUnit($this->storeA, 'Vial', 'VIL');
        $product = $this->createProduct($this->storeA, 'Inj Alpha', 'ALPHA-1', 'Vial');

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/lookups/reset-units')
            ->assertOk();

        $this->assertContains('Strip', $response->json('seeded'));
        $this->assertContains('Dropper', $response->json('removed'));
        $this->assertContains('Vial', $response->json('kept'));

        $names = MasterLookup::where('store_id', $this->storeA->id)->where('type', 'unit')->pluck('name')->all();
        $this->assertContains('Strip', $names, 'missing defaults must come back on reset');
        $this->assertNotContains('Dropper', $names, 'unused custom units must be removed on reset');
        $this->assertContains('Vial', $names, 'assigned custom units must survive reset');

        // Store B untouched by store A's reset.
        $this->assertTrue(
            MasterLookup::where('store_id', $this->storeB->id)->where('type', 'unit')->where('name', 'Strip')->exists()
        );
        $this->assertSame('Vial', $product->fresh()->unit_id);
    }

    public function test_reset_requires_a_store_context(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/lookups/reset-units')
            ->assertStatus(422);
    }

    public function test_pull_delta_delivers_only_own_store_units(): void
    {
        $this->createUnit($this->storeA, 'Vial A', 'VIA');
        $this->createUnit($this->storeB, 'Sachet B', 'SAC');
        MasterLookup::create(['type' => 'unit', 'name' => 'Legacy Shared', 'code' => 'LSH', 'is_active' => true]);
        MasterLookup::create(['type' => 'bank', 'name' => 'Shared Bank', 'is_active' => true]);

        $lookups = $this->getJson('/api/sync/pull/deltas?since_watermark=0', ['X-Store-Id' => (string) $this->storeA->id])
            ->assertOk()
            ->json('lookups');

        $names = collect($lookups)->pluck('name')->all();
        $this->assertContains('Vial A', $names);
        $this->assertNotContains('Sachet B', $names, 'another store\'s units must never arrive in a pull delta');
        $this->assertNotContains('Legacy Shared', $names, 'units are no longer shared, so NULL-store unit rows must not be delivered');
        $this->assertContains('Shared Bank', $names, 'non-unit shared lookups keep the shared+own rule');
    }
}
