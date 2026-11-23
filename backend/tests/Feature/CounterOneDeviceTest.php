<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CNT-007 — one counter holds one active device. A second claim is refused until
 * the owner re-issues, and re-issue revokes the device it replaces.
 */
class CounterOneDeviceTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Counter $counter;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);

        $this->owner = User::create([
            'name' => 'Owner', 'email' => 'owner@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => $this->storeA->id,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C01',
            'counter_name' => 'Main Counter',
        ]);
    }

    private function claim(string $code, string $deviceUuid): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/counters/claim', [
            'code' => $code,
            'device_uuid' => $deviceUuid,
        ]);
    }

    public function test_a_second_device_cannot_claim_a_live_counter_even_with_a_valid_code(): void
    {
        $first = ActivationKey::generateForCounter($this->counter)['raw_key'];
        $this->claim($first, 'uuid-device-one')->assertOk();

        // A code handed out directly (bypassing the "unclaimed" guard) still cannot
        // move a live counter onto a second machine.
        $second = ActivationKey::generateForCounter($this->counter)['raw_key'];

        $this->claim($second, 'uuid-device-two')
            ->assertStatus(409)
            ->assertJson(['error' => 'counter_already_claimed']);

        $counter = $this->counter->fresh();
        $this->assertSame('uuid-device-one', $counter->device_uuid);
        $this->assertSame(1, Device::where('counter_id', $counter->id)->count());
        $this->assertNull(ActivationKey::firstWhere('key_hash', ActivationKey::hashKey($second))->consumed_at,
            'a refused claim must not burn the code');
    }

    public function test_reissue_revokes_the_previous_device_and_lets_a_new_one_claim(): void
    {
        $firstCode = ActivationKey::generateForCounter($this->counter)['raw_key'];
        $token = $this->claim($firstCode, 'uuid-device-one')->assertOk()->json('device_token');

        $response = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$this->counter->id}/reissue", ['label' => 'Replacement laptop'])
            ->assertOk();

        $newCode = $response->json('code');
        $this->assertNotEmpty($newCode);
        $this->assertSame('uuid-device-one', $response->json('revoked_device_uuid'));

        // The old workstation is refused from its very next call.
        $this->withHeaders(['X-Device-Token' => $token])
            ->getJson('/api/staff/offline-cache')
            ->assertStatus(403);

        $counter = $this->counter->fresh();
        $this->assertSame(Counter::STATUS_UNCLAIMED, $counter->status);
        $this->assertNull($counter->current_device_id);
        $this->assertSame('revoked', Device::firstWhere('device_uuid', 'uuid-device-one')->status);

        // The superseded code can no longer be redeemed either.
        $this->claim($firstCode, 'uuid-device-late')->assertStatus(401);

        $this->claim($newCode, 'uuid-device-two')->assertOk();
        $this->assertSame('uuid-device-two', $this->counter->fresh()->device_uuid);
    }

    public function test_reissue_revokes_the_open_codes_of_that_counter(): void
    {
        ActivationKey::generateForCounter($this->counter);
        $open = ActivationKey::generateForCounter($this->counter)['raw_key'];

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$this->counter->id}/reissue")
            ->assertOk();

        $this->assertTrue(ActivationKey::firstWhere('key_hash', ActivationKey::hashKey($open))->is_revoked);
    }

    public function test_reissue_is_recorded_in_the_audit_log(): void
    {
        $firstCode = ActivationKey::generateForCounter($this->counter)['raw_key'];
        $this->claim($firstCode, 'uuid-device-one')->assertOk();

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$this->counter->id}/reissue")
            ->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_reissued',
            'entity_type' => 'Counter',
            'entity_id' => (string) $this->counter->id,
            'store_id' => $this->storeA->id,
        ]);
    }
}
