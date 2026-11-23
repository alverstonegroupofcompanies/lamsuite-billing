<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\DeviceSession;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CNT-002 / CNT-010 — a counter name is unique among the live counters of one
 * store. Since CNT-013 the owner pre-creates counters from the admin panel, so
 * that is where the rule is enforced; a till no longer names itself.
 */
class CounterNameUniquenessTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Counter Name Store',
            'code' => 'NAME-01',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@name-test.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    private function makeCounter(string $name, string $code, string $status = 'active', ?string $uuid = null): Counter
    {
        return Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => $code,
            'counter_name' => $name,
            'device_name' => $name . ' Device',
            'device_uuid' => $uuid ?? ('uuid_' . strtolower($code)),
            'status' => $status,
        ]);
    }

    private function ownerCreatesCounter(string $name, string $code, ?Store $inStore = null)
    {
        return $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) ($inStore ?? $this->store)->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => $name,
                'counter_code' => $code,
            ]);
    }

    public function test_creating_a_duplicate_counter_name_is_refused_with_holder_details(): void
    {
        $this->makeCounter('Front Counter', 'C01');

        $res = $this->ownerCreatesCounter('Front Counter', 'C02');

        $res->assertStatus(422);
        $res->assertJsonPath(
            'errors.counter_name.0',
            'The name "Front Counter" (C01) is already live in this store. Revoked counters release their name.'
        );
        $this->assertFalse(Counter::where('counter_code', 'C02')->exists());
    }

    public function test_duplicate_detection_is_case_and_whitespace_insensitive(): void
    {
        $this->makeCounter('Front Counter', 'C01');

        $this->ownerCreatesCounter('  front COUNTER  ', 'C03')->assertStatus(422);
    }

    public function test_a_counter_may_keep_its_own_name_when_the_owner_edits_it(): void
    {
        $existing = $this->makeCounter('Front Counter', 'C01');

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/counters/{$existing->id}", [
                'counter_name' => 'Front Counter',
                'location_name' => 'Ground Floor',
            ])
            ->assertStatus(200);

        $this->assertSame('Ground Floor', $existing->fresh()->location_name);
    }

    public function test_revoked_counter_name_becomes_available_again(): void
    {
        $this->makeCounter('Retired Counter', 'C90', 'revoked');

        $this->ownerCreatesCounter('Retired Counter', 'C91')->assertCreated();
    }

    public function test_same_name_is_allowed_in_a_different_store(): void
    {
        $this->makeCounter('Front Counter', 'C01');

        $otherStore = Store::create([
            'name' => 'Second Branch',
            'code' => 'NAME-02',
            'is_active' => true,
        ]);

        $this->ownerCreatesCounter('Front Counter', 'C01', $otherStore)->assertCreated();
        $this->assertSame(1, Counter::where('store_id', $otherStore->id)->where('counter_name', 'Front Counter')->count());
    }

    public function test_rename_endpoint_rejects_duplicate_and_allows_free_name(): void
    {
        $this->makeCounter('Front Counter', 'C01');
        $this->makeCounter('Back Counter', 'C02');

        $session = DeviceSession::recordLogin(
            $this->store->id,
            'uuid_rename_target',
            'Back Counter Device',
            null,
            'Back Counter',
            'C02'
        );

        $conflict = $this->actingAs($this->owner, "sanctum")->postJson("/api/device-sessions/{$session->id}/rename", [
            'counter_name' => 'front counter',
        ]);
        $conflict->assertStatus(422);
        $conflict->assertJson(['error' => 'COUNTER_NAME_TAKEN']);

        $ok = $this->actingAs($this->owner, "sanctum")->postJson("/api/device-sessions/{$session->id}/rename", [
            'counter_name' => 'Express Counter',
        ]);
        $ok->assertStatus(200);
        $this->assertEquals('Express Counter', $session->fresh()->counter_name);
    }

    public function test_auto_naming_suffixes_when_name_is_taken(): void
    {
        $this->makeCounter('Counter Alpha', 'C01');

        $unique = Counter::uniqueNameForStore($this->store->id, 'Counter Alpha');

        $this->assertEquals('Counter Alpha (2)', $unique);
        $this->assertNull(Counter::nameConflict($this->store->id, $unique));
    }
}
