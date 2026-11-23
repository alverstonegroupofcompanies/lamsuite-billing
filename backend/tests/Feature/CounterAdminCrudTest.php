<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CNT-002, CNT-009, CNT-010 — the owner pre-creates counters from the admin panel,
 * every action is audited, and deleting a counter that owns documents retires it
 * instead of erasing history.
 */
class CounterAdminCrudTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@test.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->storeA->id,
        ]);
    }

    public function test_admin_creates_an_unclaimed_counter_pinned_to_the_active_store(): void
    {
        $response = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => 'Owner Home Office',
                'counter_code' => 'c02',
                'location_name' => 'Owner Residence',
                'is_remote' => true,
            ])
            ->assertCreated();

        $counter = Counter::firstWhere('counter_name', 'Owner Home Office');
        $this->assertNotNull($counter);
        $this->assertSame($this->storeA->id, $counter->store_id);
        $this->assertSame('C02', $counter->counter_code, 'codes are normalised to upper case');
        $this->assertSame(Counter::STATUS_UNCLAIMED, $counter->status);
        $this->assertNull($counter->current_device_id);
        $this->assertSame($this->owner->id, $counter->created_by);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_created',
            'entity_type' => 'Counter',
            'entity_id' => (string) $counter->id,
            'store_id' => $this->storeA->id,
        ]);
    }

    /** CNT-001/CNT-009: a name already live in the store is refused and names its holder. */
    public function test_duplicate_live_counter_name_is_refused_naming_the_holder(): void
    {
        $holder = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C03',
            'counter_name' => 'Main Counter',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $response = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => 'main counter',
                'counter_code' => 'C04',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('counter_name');

        $this->assertStringContainsString(
            'Main Counter',
            $response->json('errors.counter_name.0'),
            'the refusal must name the counter holding the name'
        );
        $this->assertSame(1, Counter::where('store_id', $this->storeA->id)->count());
        $this->assertSame($holder->id, Counter::firstWhere('counter_code', 'C03')->id);
    }

    /** A revoked counter releases its name, so the same name may be recreated. */
    public function test_revoked_counter_name_can_be_reused(): void
    {
        Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C05',
            'counter_name' => 'Warehouse',
            'status' => Counter::STATUS_REVOKED,
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => 'Warehouse',
                'counter_code' => 'C06',
            ])
            ->assertCreated();
    }

    public function test_duplicate_counter_code_in_the_store_is_refused(): void
    {
        Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C07',
            'counter_name' => 'Existing',
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => 'Another',
                'counter_code' => 'C07',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('counter_code');
    }

    /** CNT-009: the store numbers its own counters, so an owner never has to invent a code. */
    public function test_counter_code_is_auto_numbered_when_the_owner_leaves_it_blank(): void
    {
        foreach (['C01', 'C09'] as $code) {
            Counter::create([
                'store_id' => $this->storeA->id,
                'counter_code' => $code,
                'counter_name' => "Counter {$code}",
            ]);
        }
        Counter::create([
            'store_id' => $this->storeB->id,
            'counter_code' => 'C01',
            'counter_name' => 'B Front',
        ]);

        $first = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/counters', ['counter_name' => 'Auto One'])
            ->assertCreated();
        $this->assertSame('C10', $first->json('counter.counter_code'));

        // The next blank create continues from the code it just issued.
        $second = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/counters', ['counter_name' => 'Auto Two'])
            ->assertCreated();
        $this->assertSame('C11', $second->json('counter.counter_code'));

        // Numbering is per store, and an empty string counts as "no code given".
        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson('/api/admin/counters', ['counter_name' => 'B Dock', 'counter_code' => ''])
            ->assertCreated()
            ->assertJsonPath('counter.counter_code', 'C02');

        $autoOne = Counter::firstWhere('counter_name', 'Auto One');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_created',
            'entity_type' => 'Counter',
            'entity_id' => (string) $autoOne->id,
            'store_id' => $this->storeA->id,
        ]);
        $this->assertSame('C10', $autoOne->counter_code, 'the issued code is the one that is stored');
    }

    /** IS1: a body store_id may not aim the write at another store. */
    public function test_counter_is_never_created_in_a_foreign_store(): void
    {
        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => 'Wrong Store',
                'counter_code' => 'C08',
                'store_id' => $this->storeB->id,
            ])
            ->assertCreated();

        $this->assertSame(0, Counter::where('store_id', $this->storeB->id)->count());
        $this->assertNotNull(Counter::where('store_id', $this->storeA->id)->firstWhere('counter_name', 'Wrong Store'));
    }

    public function test_admin_cannot_touch_a_counter_of_another_store(): void
    {
        $foreign = Counter::create([
            'store_id' => $this->storeB->id,
            'counter_code' => 'C01',
            'counter_name' => 'Store B Counter',
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->putJson("/api/admin/counters/{$foreign->id}", ['counter_name' => 'Hijacked'])
            ->assertNotFound();

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/counters/{$foreign->id}")
            ->assertNotFound();

        $this->assertSame('Store B Counter', $foreign->fresh()->counter_name);
    }

    /** CNT-009: rename and counter settings are audited with a before/after diff. */
    public function test_update_renames_and_records_an_audit_diff(): void
    {
        $counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C09',
            'counter_name' => 'Old Name',
            'location_name' => 'Shop Floor',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->putJson("/api/admin/counters/{$counter->id}", [
                'counter_name' => 'New Name',
                'location_name' => 'Warehouse',
                'is_digital_only' => true,
            ])
            ->assertOk();

        $fresh = $counter->fresh();
        $this->assertSame('New Name', $fresh->counter_name);
        $this->assertSame('Warehouse', $fresh->location_name);
        $this->assertTrue((bool) $fresh->is_digital_only);
        $this->assertSame(Counter::STATUS_ACTIVE, $fresh->status, 'editing details must not change lifecycle status');

        $audit = DB::table('audit_logs')
            ->where('action', 'counter_updated')
            ->where('entity_id', (string) $counter->id)
            ->latest('id')
            ->first();
        $this->assertNotNull($audit, 'counter edits must be audited (CNT-009)');
        $diff = json_decode($audit->new_values, true);
        $this->assertSame('New Name', $diff['counter_name'] ?? null);
        $this->assertSame('Old Name', json_decode($audit->old_values, true)['counter_name'] ?? null);
    }

    public function test_locking_and_unlocking_a_counter_is_audited(): void
    {
        $counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C10',
            'counter_name' => 'Locked Case',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$counter->id}/lock", ['reason' => 'Owner audit'])
            ->assertOk();
        $this->assertSame(Counter::STATUS_LOCKED, $counter->fresh()->status);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$counter->id}/unlock")
            ->assertOk();
        $this->assertSame(Counter::STATUS_ACTIVE, $counter->fresh()->status);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_locked',
            'entity_type' => 'Counter',
            'entity_id' => (string) $counter->id,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_unlocked',
            'entity_type' => 'Counter',
            'entity_id' => (string) $counter->id,
        ]);
    }

    /** CNT-010: a counter that owns documents is retired, never erased. */
    public function test_deleting_a_counter_with_documents_requires_an_explicit_retire(): void
    {
        $counter = $this->counterWithInvoice();

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/counters/{$counter->id}")
            ->assertStatus(409)
            ->assertJson(['error' => 'counter_has_documents']);

        $this->assertNotNull(Counter::find($counter->id), 'nothing may be deleted without the retire confirmation');

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/counters/{$counter->id}", ['confirm_retire' => true])
            ->assertOk()
            ->assertJson(['retired' => true]);

        $fresh = $counter->fresh();
        $this->assertSame(Counter::STATUS_REVOKED, $fresh->status);
        $this->assertNotNull($fresh->retired_at);

        // History and series stay queryable.
        $this->assertDatabaseHas('invoices', ['id' => $this->invoiceId, 'counter_id' => $counter->id]);
        $this->assertDatabaseHas('counter_sequences', ['counter_id' => $counter->id]);
    }
    /** CNT-010: an empty unclaimed counter may be erased outright. */
    public function test_counter_without_documents_is_erased(): void
    {
        $counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C11',
            'counter_name' => 'Never Used',
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->deleteJson("/api/admin/counters/{$counter->id}")
            ->assertOk()
            ->assertJson(['retired' => false]);

        $this->assertNull(Counter::find($counter->id));
    }

    private function counterWithInvoice(): Counter
    {
        $counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C12',
            'counter_name' => 'Busy Counter',
            'status' => Counter::STATUS_ACTIVE,
            'device_uuid' => 'uuid-busy-counter',
        ]);

        DB::table('counter_sequences')->insert([
            'store_id' => $this->storeA->id,
            'counter_id' => $counter->id,
            'doc_type' => 'invoice',
            'financial_year' => '2026-27',
            'prefix' => 'C12-INV',
            'next_number' => 1050,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->invoiceId = Invoice::create([
            'store_id' => $this->storeA->id,
            'counter_id' => $counter->id,
            'counter_code' => $counter->counter_code,
            'invoice_number' => 'INV-RETIRE-1',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 100,
            'status' => 'issued',
            'external_id' => 'inv-retire-1',
        ])->id;

        return $counter;
    }

    private ?int $invoiceId = null;
}
