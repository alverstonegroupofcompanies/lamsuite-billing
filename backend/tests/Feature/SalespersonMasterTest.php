<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GAP-01 / SPR-001..003, 005, 017 — the salesperson master the panel owns.
 *
 * A salesperson is a person of one store, named on the bill they sold, and the
 * bill keeps the name they had that day even after the master is renamed or
 * archived. A code repeats freely across stores and never inside one; a stale
 * edit loses to the row that moved first; and a till only ever sees the people
 * its own counter may carry.
 */
class SalespersonMasterTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $owner;
    private Counter $c01;
    private Counter $c02;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SPA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SPB', 'state_code' => '32', 'is_active' => true]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@sp-master.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->storeA->id,
        ]);

        $this->c01 = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => Counter::STATUS_ACTIVE,
        ]);
        $this->c02 = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C02',
            'counter_name' => 'Counter 02',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->product = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'Paracetamol 500mg',
            'current_stock' => 100,
            'mrp' => 120.00,
            'sel_rate' => 100.00,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->storeA->id,
            'product_id' => $this->product->id,
            'batch_no' => 'SP-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 100,
            'mrp' => 120.00,
            'selling_rate' => 100.00,
        ]);
    }

    /**
     * @param  array<string,mixed>  $overrides
     */
    private function create(array $overrides = [], ?Store $store = null): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) ($store ?? $this->storeA)->id])
            ->postJson('/api/admin/salespeople', array_merge([
                'name' => 'Rina Thomas',
                'code' => 'SP-01',
                'phone' => '9847000001',
            ], $overrides));
    }

    public function test_the_panel_creates_a_salesperson_pinned_to_the_active_store(): void
    {
        $created = $this->create()->assertCreated();

        $salesperson = Salesperson::firstWhere('code', 'SP-01');
        $this->assertNotNull($salesperson);
        $this->assertSame($this->storeA->id, (int) $salesperson->store_id);
        $this->assertTrue((bool) $salesperson->is_active);
        $this->assertNull($salesperson->archived_at);
        $this->assertSame(1, (int) $salesperson->version);
        $this->assertSame($this->storeA->id, (int) $created->json('salesperson.store_id'));

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'salesperson_created',
            'entity_type' => 'Salesperson',
            'entity_id' => (string) $salesperson->id,
            'store_id' => $this->storeA->id,
        ]);
    }

    /** SPR-001: the code is unique inside a store and means nothing outside it. */
    public function test_a_code_used_in_this_store_is_refused_and_allowed_in_another(): void
    {
        $this->create()->assertCreated();

        $clash = $this->create(['name' => 'Other Person'])->assertStatus(422);
        $this->assertArrayHasKey('code', (array) $clash->json('errors'));
        $this->assertSame(1, Salesperson::count(), 'the refused create wrote nothing');

        $this->create([], $this->storeB)
            ->assertCreated()
            ->assertJsonPath('salesperson.store_id', $this->storeB->id);
    }

    /** SPR-001: a personal PIN is stored as a PIN, never as the digits. */
    public function test_a_personal_pin_is_hashed_and_never_read_back(): void
    {
        $created = $this->create(['pin' => '739105'])->assertCreated();

        $salesperson = Salesperson::firstWhere('code', 'SP-01');
        $this->assertNotNull($salesperson->pin_hash);
        $this->assertNotSame('739105', $salesperson->pin_hash);
        $this->assertTrue(Hash::check('739105', (string) $salesperson->pin_hash));

        $this->assertStringNotContainsString('739105', json_encode($created->json()));
        $this->assertFalse(array_key_exists('pin_hash', (array) $created->json('salesperson')));
        $this->assertTrue((bool) $created->json('salesperson.has_pin'));

        // A PIN the policy would not accept for a person is refused outright.
        $this->create(['code' => 'SP-02', 'name' => 'Second', 'pin' => '1234'])
            ->assertStatus(422);
    }

    /** SPR-017: a list read never crosses into another store's people. */
    public function test_a_list_read_carries_only_this_stores_people(): void
    {
        $this->create()->assertCreated();
        $this->create(['code' => 'SP-02', 'name' => 'Abdul'], $this->storeB)
            ->assertCreated();

        $listed = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/admin/salespeople')
            ->assertOk()
            ->json('salespeople');

        $this->assertSame(['Rina Thomas'], array_column((array) $listed, 'name'));
    }

    /** SPR-005: an edit written against a stale version loses, and says why. */
    public function test_a_stale_version_is_refused_with_the_current_one(): void
    {
        $salesperson = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Rina Thomas',
            'code' => 'SP-01',
            'version' => 4,
            'is_active' => true,
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->putJson("/api/admin/salespeople/{$salesperson->id}", ['name' => 'Rina T.', 'version' => 3])
            ->assertStatus(409)
            ->assertJsonPath('current_version', 4);

        $this->assertSame('Rina Thomas', $salesperson->fresh()->name);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->putJson("/api/admin/salespeople/{$salesperson->id}", ['name' => 'Rina T.', 'version' => 4])
            ->assertOk()
            ->assertJsonPath('salesperson.version', 5);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'salesperson_updated',
            'entity_type' => 'Salesperson',
            'entity_id' => (string) $salesperson->id,
        ]);
    }

    /** SPR-003: a person who has sold something is archived, not erased. */
    public function test_deleting_a_salesperson_with_bills_archives_and_keeps_the_history(): void
    {
        $salesperson = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Rina Thomas',
            'code' => 'SP-01',
            'is_active' => true,
        ]);

        Invoice::create([
            'store_id' => $this->storeA->id,
            'counter_id' => $this->c01->id,
            'invoice_number' => 'INV-SP-01',
            'invoice_date' => now()->subDay(),
            'grand_total' => 100,
            'paid_amount' => 100,
            'status' => 'active',
            'salesperson_id' => $salesperson->id,
            'salesperson_name' => $salesperson->name,
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/salespeople/{$salesperson->id}")
            ->assertOk()
            ->assertJsonPath('archived', true);

        $kept = $salesperson->fresh();
        $this->assertNotNull($kept);
        $this->assertFalse((bool) $kept->is_active);
        $this->assertNotNull($kept->archived_at);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'salesperson_archived',
            'entity_id' => (string) $salesperson->id,
        ]);

        // A person who has never sold anything is simply removed.
        $spare = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Never Sold',
            'code' => 'SP-09',
            'is_active' => true,
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/salespeople/{$spare->id}")
            ->assertOk()
            ->assertJsonPath('deleted', true);

        $this->assertDatabaseMissing('salespeople', ['id' => $spare->id]);
    }

    /**
     * SPR-002: the type-ahead is the counter's own list. A person allowed on
     * C01 only is absent from C02, and an archived person is absent everywhere.
     */
    public function test_the_eligible_list_offers_only_people_this_counter_may_carry(): void
    {
        $c01Only = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Front Only',
            'code' => 'SP-01',
            'is_active' => true,
            'counter_ids' => [$this->c01->id],
        ]);
        $everywhere = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Floor Walker',
            'code' => 'SP-02',
            'is_active' => true,
            'counter_ids' => null,
        ]);
        $archived = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Left The Firm',
            'code' => 'SP-03',
            'is_active' => false,
            'archived_at' => now()->subDay(),
        ]);

        $atC01 = $this->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/salespeople/eligible?counter_code=C01')
            ->assertOk()
            ->json('salespeople');
        $names01 = array_column((array) $atC01, 'name');

        $this->assertContains('Front Only', $names01);
        $this->assertContains('Floor Walker', $names01);
        $this->assertNotContains('Left The Firm', $names01);
        $this->assertContains((int) $everywhere->id, array_column((array) $atC01, 'id'));
        $this->assertContains((int) $c01Only->id, array_column((array) $atC01, 'id'));
        $this->assertNotContains((int) $archived->id, array_column((array) $atC01, 'id'));

        $atC02 = $this->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/salespeople/eligible?counter_code=C02')
            ->assertOk()
            ->json('salespeople');

        $this->assertNotContains('Front Only', array_column((array) $atC02, 'name'));
        $this->assertContains('Floor Walker', array_column((array) $atC02, 'name'));
    }

    /**
     * SPR-002: hiding a person from the type-ahead is not the guard. The server
     * refuses the same id on a counter that may not carry them.
     */
    public function test_a_bill_cannot_name_a_salesperson_not_allowed_on_its_counter(): void
    {
        $c01Only = Salesperson::create([
            'store_id' => $this->storeA->id,
            'name' => 'Front Only',
            'code' => 'SP-01',
            'is_active' => true,
            'counter_ids' => [$this->c01->id],
        ]);

        $externalId = 'ext_sp_wrong_counter';

        $this->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/invoices', $this->billPayload([
                'counter_code' => 'C02',
                'salesperson_id' => $c01Only->id,
                'external_id' => $externalId,
                'idempotency_key' => $externalId,
            ]))
            ->assertStatus(422);

        $this->assertDatabaseMissing('invoices', ['external_id' => $externalId]);
    }

    /**
     * @param  array<string,mixed>  $overrides
     * @return array<string,mixed>
     */
    private function billPayload(array $overrides = []): array
    {
        $externalId = $overrides['external_id'] ?? 'ext_sp_' . uniqid();

        return array_merge([
            'counter_code' => 'C01',
            'store_id' => $this->storeA->id,
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'SP-B1',
                'qty' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 0.00,
            ]],
        ], $overrides);
    }
}
