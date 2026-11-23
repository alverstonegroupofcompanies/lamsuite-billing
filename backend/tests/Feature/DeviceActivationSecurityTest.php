<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceActivationAttempt;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CNT-005 / IS2 — activation is not an oracle. Every code that fails answers with
 * the same words and binds nothing, and the store a code opens is the store written
 * on the code, never the store the till claims to be joining.
 *
 * The legacy /devices/register* paths this file used to exercise are retired by
 * this release; the replacements are POST /api/counters/claim and the admin
 * counter endpoints.
 */
class DeviceActivationSecurityTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected Counter $counter;
    protected User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'LamStone Security Test Store',
            'code' => 'SEC01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Store Owner',
            'email' => 'owner@securitytest.com',
            'password' => bcrypt('StrongPassword123!'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
            'totp_enabled' => false,
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Main Counter',
        ]);
    }

    private function claim(string $code, string $deviceUuid = 'dev-uuid-1', array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/counters/claim', [
            'code' => $code,
            'device_uuid' => $deviceUuid,
        ] + $extra);
    }

    private function refusalMessage(): string
    {
        return 'That activation code is not valid here. Ask the store owner for a current counter code.';
    }

    public function test_random_code_is_refused_and_binds_nothing(): void
    {
        $this->claim('RANDOM-INVALID-KEY-12345')
            ->assertStatus(401)
            ->assertJson(['error' => 'claim_failed', 'message' => $this->refusalMessage()]);

        $this->assertSame(0, Device::count());
        $this->assertSame(Counter::STATUS_UNCLAIMED, $this->counter->fresh()->status);
        $this->assertDatabaseHas('device_activation_attempts', [
            'device_uuid' => 'dev-uuid-1',
            'success' => false,
            'failure_reason' => 'unknown_code',
        ]);
    }

    public function test_a_malformed_code_is_refused_exactly_like_a_wrong_one(): void
    {
        $short = $this->claim('ABC');
        $long = $this->claim(str_repeat('Z', 120));

        $short->assertStatus(401);
        $long->assertStatus(401);

        // A length or shape difference must not be a clue for a guesser.
        $this->assertSame($this->refusalMessage(), $short->json('message'));
        $this->assertSame($short->json('message'), $long->json('message'));
    }

    public function test_a_request_without_a_device_identity_is_a_validation_error(): void
    {
        $issued = ActivationKey::generateForCounter($this->counter)['raw_key'];

        $this->postJson('/api/counters/claim', ['code' => $issued])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['device_uuid']);

        $this->assertSame(0, Device::count());
        $this->assertDatabaseHas('activation_keys', ['consumed_at' => null]);
    }

    public function test_expired_revoked_and_used_codes_all_refuse_identically(): void
    {
        $expired = ActivationKey::generateForCounter($this->counter)['raw_key'];
        ActivationKey::findByCode($expired)->update(['expires_at' => now()->subMinute()]);

        $revoked = ActivationKey::generateForCounter($this->counter);
        $revoked['model']->revoke('Leaked');

        $used = ActivationKey::generateForCounter($this->counter)['raw_key'];
        $this->claim($used, 'dev-used-once')->assertOk();

        $messages = [];
        foreach (['expired' => $expired, 'revoked' => $revoked['raw_key'], 'used' => $used] as $case => $code) {
            $response = $this->claim($code, "dev-$case");
            $response->assertStatus(401)->assertJson(['error' => 'claim_failed']);
            $this->assertSame($this->refusalMessage(), $response->json('message'), $case);
            $messages[] = $response->json('message');
        }

        $this->assertCount(1, array_unique($messages), 'the refusal must not reveal which rule failed');
        $this->assertDatabaseHas('device_activation_attempts', ['failure_reason' => 'expired']);
        $this->assertDatabaseHas('device_activation_attempts', ['failure_reason' => 'revoked']);
        $this->assertDatabaseHas('device_activation_attempts', ['failure_reason' => 'consumed']);
    }

    public function test_a_code_belonging_to_a_suspended_store_is_refused(): void
    {
        $paused = Store::create([
            'name' => 'Paused Store', 'code' => 'PAU', 'state_code' => '32', 'is_active' => false,
        ]);
        $counter = Counter::create(['store_id' => $paused->id, 'counter_code' => 'C01', 'counter_name' => 'Desk']);
        $code = ActivationKey::generateForCounter($counter)['raw_key'];

        $this->claim($code)->assertStatus(401)->assertJson(['message' => $this->refusalMessage()]);
        $this->assertSame(0, Device::count());
    }

    public function test_a_shared_store_key_is_not_a_counter_code(): void
    {
        // CNT-013 dropped the store-wide key, but a row left over from that world
        // still has to be refused rather than guessed at.
        $legacy = 'LAM-SEC01-7F3A9C82B14D6E05-1A4370E8';
        ActivationKey::create([
            'store_id' => $this->store->id,
            'key_hash' => ActivationKey::hashKey($legacy),
            'key_prefix' => substr($legacy, 0, 14) . '****',
            'max_devices' => 5,
            'expires_at' => now()->addYear(),
        ]);

        $this->claim($legacy)
            ->assertStatus(401)
            ->assertJson(['message' => $this->refusalMessage()]);

        $this->assertSame(0, Device::count());
        $this->assertDatabaseHas('device_activation_attempts', ['failure_reason' => 'not_counter_code']);
    }

    public function test_a_code_never_opens_a_counter_in_a_store_it_was_not_minted_for(): void
    {
        $other = Store::create(['name' => 'Other', 'code' => 'OTH', 'state_code' => '32', 'is_active' => true]);
        $code = ActivationKey::generateForCounter($this->counter)['raw_key'];

        $this->claim($code, 'dev-wrong-store', ['store_id' => $other->id])
            ->assertStatus(401)
            ->assertJson(['message' => $this->refusalMessage()]);

        // IS2: nothing was created on either side of a refused claim.
        $this->assertSame(0, Device::count());
        $this->assertSame(Counter::STATUS_UNCLAIMED, $this->counter->fresh()->status);
        $this->assertDatabaseHas('device_activation_attempts', ['failure_reason' => 'store_mismatch']);
    }

    public function test_the_code_is_answered_only_once_and_stored_only_as_a_hash(): void
    {
        $issued = ActivationKey::generateForCounter($this->counter);
        $response = $this->claim($issued['raw_key'])->assertOk();

        $token = $response->json('device_token');
        $this->assertNotEmpty($token);
        $this->assertSame('hash_only', $response->json('token_stored_as'));

        $device = Device::firstWhere('device_uuid', 'dev-uuid-1');
        $this->assertNotNull($device);
        $this->assertNull($device->device_token);
        $this->assertSame(hash('sha256', $token), $device->device_token_hash);
        $this->assertSame('counter_code', $device->registered_via);

        $counter = $this->counter->fresh();
        $this->assertNull($counter->device_token);
        $this->assertSame(hash('sha256', $token), $counter->device_token_hash);
        $this->assertStringNotContainsString($issued['raw_key'], json_encode($device->toArray()));

        // CNT-003: the same code cannot open a second workstation.
        $this->claim($issued['raw_key'], 'dev-second')
            ->assertStatus(401)
            ->assertJson(['message' => $this->refusalMessage()]);
        $this->assertSame(1, Device::count());
    }

    public function test_the_validate_endpoint_locks_an_unknown_or_revoked_workstation(): void
    {
        $this->postJson('/api/devices/validate', [
            'device_token' => 'fake_lsd_unrecognized_token_123',
            'device_uuid' => 'fake_uuid',
        ])->assertStatus(401)->assertJson(['valid' => false, 'action' => 'lock_and_reset']);

        $issued = ActivationKey::generateForCounter($this->counter);
        $token = $this->claim($issued['raw_key'])->assertOk()->json('device_token');

        $this->postJson('/api/devices/validate', [
            'device_token' => $token,
            'device_uuid' => 'dev-uuid-1',
        ])->assertStatus(200)->assertJson(['valid' => true, 'status' => 'active']);

        Device::firstWhere('device_uuid', 'dev-uuid-1')->update([
            'status' => 'revoked',
            'revoke_reason' => 'Stolen terminal',
        ]);

        $this->postJson('/api/devices/validate', [
            'device_token' => $token,
            'device_uuid' => 'dev-uuid-1',
        ])->assertStatus(403)->assertJson(['valid' => false, 'status' => 'revoked', 'action' => 'lock_and_reset']);
    }

    public function test_attempt_rows_never_carry_the_code_itself(): void
    {
        $issued = ActivationKey::generateForCounter($this->counter);
        $raw = $issued['raw_key'];

        $this->claim('LAM-C01-AAAAAAAABBBBBBBB-CCCCCCCCDDDDDDDD');
        $this->claim($raw)->assertOk();

        $attempts = DeviceActivationAttempt::orderBy('id')->get();
        $this->assertCount(2, $attempts);

        foreach ($attempts as $attempt) {
            $this->assertStringNotContainsString($raw, json_encode($attempt->toArray()));
            $this->assertLessThanOrEqual(24, strlen((string) $attempt->attempted_key_prefix));
        }

        $this->assertTrue((bool) $attempts->last()->success);
        $this->assertSame($this->counter->id, (int) $attempts->last()->counter_id);
        $this->assertSame($this->store->id, (int) $attempts->last()->store_id);
    }
}
