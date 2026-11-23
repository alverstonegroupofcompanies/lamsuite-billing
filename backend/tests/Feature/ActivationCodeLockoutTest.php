<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\DeviceActivationAttempt;
use App\Models\Store;
use App\Models\User;
use App\Services\CounterClaimService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CNT-005 — wrong, expired, reused, revoked or random input never activates
 * anything; repeated attempts lock the counter and alert the owner.
 */
class ActivationCodeLockoutTest extends TestCase
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

    private function claim(string $code, string $deviceUuid = 'uuid-till-1')
    {
        return $this->postJson('/api/counters/claim', [
            'code' => $code,
            'device_uuid' => $deviceUuid,
        ]);
    }

    private function failFiveTimes(string $deviceUuid = 'uuid-till-1'): void
    {
        for ($i = 0; $i < 5; $i++) {
            $status = $this->claim('LAM-C01-AAAAAAAABBBBBBBB-CCCCCCCCDDDDDDDD', $deviceUuid)
                ->getStatusCode();
            $this->assertContains($status, [401, 429], 'a refused claim is never a success');
        }
    }

    public function test_repeated_bad_codes_lock_the_endpoint_even_for_a_valid_code(): void
    {
        $this->failFiveTimes();
        $valid = ActivationKey::generateForCounter($this->counter)['raw_key'];

        $locked = $this->claim($valid)->assertStatus(429);
        $this->assertSame('claim_locked', $locked->json('error'));
        // ACT-01: the till is told the lock is its own, not the shop's.
        $this->assertSame('device', $locked->json('scope'));
        $this->assertStringContainsString('This workstation', $locked->json('message'));
        $this->assertEmpty($locked->json('device_token'));

        $this->assertSame(Counter::STATUS_UNCLAIMED, $this->counter->fresh()->status);
        $this->assertDatabaseCount('devices', 0);

        // CNT-005: the owner is alerted, in the store that owns the counter.
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_claim_lockout_triggered',
            'store_id' => $this->storeA->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'store_id' => $this->storeA->id,
            'type' => 'counter_claim_lockout',
        ]);
    }

    public function test_the_lockout_expires_after_the_window(): void
    {
        $this->failFiveTimes();
        DB::table('device_activation_attempts')
            ->where('success', false)
            ->update(['created_at' => now()->subMinutes(16)]);

        $this->claim(ActivationKey::generateForCounter($this->counter)['raw_key'])->assertOk();
    }

    public function test_a_valid_code_from_a_second_till_still_claims_after_five_failures_on_the_first(): void
    {
        $this->failFiveTimes('uuid-till-a');

        $response = $this->claim(ActivationKey::generateForCounter($this->counter)['raw_key'], 'uuid-till-b')
            ->assertOk();

        $this->assertNotEmpty($response->json('device_token'));
        $this->assertSame('uuid-till-b', $this->counter->fresh()->device_uuid);
    }

    public function test_the_ip_ceiling_stops_a_till_rotating_device_uuids_but_not_below_it(): void
    {
        // Five workstations, five refusals each: 25 from one address, still below
        // the ceiling that protects a shared shop network.
        for ($i = 0; $i < 5; $i++) {
            $this->failFiveTimes('uuid-rotating-' . $i);
        }

        $this->claim(ActivationKey::generateForCounter($this->counter)['raw_key'], 'uuid-honest-till')
            ->assertOk();

        // Five more reach the ceiling of 30, the only IP-wide lock that remains.
        $this->failFiveTimes('uuid-rotating-5');
        $this->assertSame(30, CounterClaimService::IP_CEILING_FAILURES);

        $second = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C02',
            'counter_name' => 'Second Counter',
        ]);

        $locked = $this->claim(ActivationKey::generateForCounter($second)['raw_key'], 'uuid-fresh-till')
            ->assertStatus(429);
        $this->assertSame('network', $locked->json('scope'));
        $this->assertStringContainsString('this network', $locked->json('message'));
    }

    public function test_each_locked_workstation_raises_its_own_alert_naming_it(): void
    {
        $this->failFiveTimes('uuid-till-a');
        $this->claim(ActivationKey::generateForCounter($this->counter)['raw_key'], 'uuid-till-a')->assertStatus(429);

        $this->failFiveTimes('uuid-till-b');
        $this->claim(ActivationKey::generateForCounter($this->counter)['raw_key'], 'uuid-till-b')->assertStatus(429);

        // A repeat from a till already alerted on stays quiet inside the window.
        $this->claim(ActivationKey::generateForCounter($this->counter)['raw_key'], 'uuid-till-a')->assertStatus(429);

        $alerts = DB::table('notifications')->where('type', 'counter_claim_lockout')->orderBy('id')->get();
        $this->assertCount(2, $alerts);
        $this->assertStringContainsString('uuid-till-a', $alerts[0]->message);
        $this->assertStringContainsString('uuid-till-b', $alerts[1]->message);
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'counter_claim_lockout_triggered')->count());
    }

    public function test_failures_are_recorded_without_the_code_itself(): void
    {
        $raw = ActivationKey::generateForCounter($this->counter)['raw_key'];
        DB::table('activation_keys')->where('key_hash', ActivationKey::hashKey($raw))
            ->update(['expires_at' => now()->subMinute()]);

        $this->claim($raw)->assertStatus(401);
        $this->claim('total-nonsense')->assertStatus(401);

        $attempts = DB::table('device_activation_attempts')->orderBy('id')->get();
        $this->assertCount(2, $attempts);
        $this->assertContains('expired', $attempts->pluck('failure_reason')->all());
        $this->assertContains('unknown_code', $attempts->pluck('failure_reason')->all());

        foreach ($attempts as $attempt) {
            $this->assertStringNotContainsString($raw, json_encode((array) $attempt), 'IS5: no code in the attempt log');
            $this->assertLessThanOrEqual(12, strlen((string) $attempt->attempted_key_prefix));
        }
    }

    public function test_a_successful_claim_is_recorded_against_the_counter(): void
    {
        $raw = ActivationKey::generateForCounter($this->counter)['raw_key'];
        $this->claim($raw)->assertOk();

        $attempt = DeviceActivationAttempt::orderBy('id', 'desc')->first();
        $this->assertTrue((bool) $attempt->success);
        $this->assertSame($this->counter->id, (int) $attempt->counter_id);
        $this->assertSame($this->storeA->id, (int) $attempt->store_id);
    }

    public function test_a_revoked_code_stops_working_at_once(): void
    {
        $issued = ActivationKey::generateForCounter($this->counter);
        $open = ActivationKey::generateForCounter($this->counter)['raw_key'];

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$this->counter->id}/activation-codes/{$issued['model']->id}/revoke", [
                'reason' => 'Sent to the wrong address',
            ])
            ->assertOk();

        $this->assertTrue($issued['model']->fresh()->is_revoked);
        $this->assertSame('Sent to the wrong address', $issued['model']->fresh()->revoke_reason);

        // The open code is revoked too, because only one may ever be live.
        $this->claim($open)->assertStatus(401)->assertJson(['error' => 'claim_failed']);

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_activation_code_revoked',
            'store_id' => $this->storeA->id,
        ]);
    }

    public function test_a_code_cannot_be_revoked_from_another_store(): void
    {
        $otherStore = Store::create(['name' => 'Other', 'code' => 'SX', 'state_code' => '32', 'is_active' => true]);
        $otherCounter = Counter::create(['store_id' => $otherStore->id, 'counter_code' => 'C01', 'counter_name' => 'Other']);
        $key = ActivationKey::generateForCounter($otherCounter)['model'];

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/counters/{$otherCounter->id}/activation-codes/{$key->id}/revoke")
            ->assertNotFound();

        $this->assertFalse($key->fresh()->is_revoked);
    }
}
