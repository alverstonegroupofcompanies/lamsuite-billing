<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CNT-002 / CNT-006 — a till sets itself up with nothing but a code. The code
 * binds device -> counter, issues a per-device token, and can never create a
 * counter or move a device into another store.
 */
class CounterClaimTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private Counter $counter;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->owner = User::create([
            'name' => 'Owner', 'email' => 'owner@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => $this->storeA->id,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C01',
            'counter_name' => 'Main Counter',
            'location_name' => 'Shop Floor',
        ]);
    }

    private function code(array $options = []): string
    {
        return ActivationKey::generateForCounter($this->counter, $options)['raw_key'];
    }

    public function test_a_valid_code_binds_the_device_and_returns_a_token_once(): void
    {
        $raw = $this->code();

        $response = $this->postJson('/api/counters/claim', [
            'code' => $raw,
            'device_uuid' => 'uuid-till-1',
            'device_name' => 'Owner Home Laptop',
        ])->assertOk();

        $token = $response->json('device_token');
        $this->assertNotEmpty($token);

        $counter = $this->counter->fresh();
        $this->assertSame(Counter::STATUS_ACTIVE, $counter->status);
        $this->assertSame('uuid-till-1', $counter->device_uuid);
        $this->assertNotNull($counter->current_device_id);
        $this->assertSame((string) $counter->id, (string) $response->json('counter.id'));
        $this->assertSame('Main Counter', $response->json('counter.counter_name'));
        $this->assertSame($this->storeA->id, $response->json('store.id'));

        $device = Device::firstWhere('device_uuid', 'uuid-till-1');
        $this->assertNotNull($device);
        $this->assertSame($this->storeA->id, $device->store_id, 'IS2: the code decides the store');
        $this->assertSame(hash('sha256', $token), $device->device_token_hash);

        // CNT-006: the raw token exists only in this response, never in a column.
        foreach (['devices', 'counters'] as $table) {
            $row = (array) DB::table($table)->where('id', $table === 'devices' ? $device->id : $counter->id)->first();
            $this->assertStringNotContainsString($token, json_encode($row), "{$table} must not store the plaintext token");
        }

        $this->assertNotNull(ActivationKey::firstWhere('key_hash', ActivationKey::hashKey($raw))->consumed_at);

        // The token authenticates the workstation from now on.
        $this->withHeaders(['X-Device-Token' => $token])
            ->getJson('/api/staff/offline-cache')
            ->assertOk();
    }

    /** CNT-005: every failure looks and says exactly the same thing. */
    public function test_random_expired_revoked_and_reused_codes_are_indistinguishable(): void
    {
        $expired = $this->code();
        DB::table('activation_keys')->where('key_hash', ActivationKey::hashKey($expired))
            ->update(['expires_at' => now()->subMinute()]);

        $revoked = ActivationKey::generateForCounter($this->counter)['model'];
        $revoked->revoke('Owner changed their mind');

        $consumed = $this->code();
        $this->postJson('/api/counters/claim', ['code' => $consumed, 'device_uuid' => 'uuid-first'])->assertOk();

        $failures = [
            'LAM-C01-DEADBEEFDEADBEEF-DEADBEEFDEADBEEF',
            $expired,
            $revoked->key_prefix, // a masked prefix is not a code
            'nonsense',
        ];

        $bodies = [];
        foreach ($failures as $index => $candidate) {
            $response = $this->postJson('/api/counters/claim', [
                'code' => $candidate,
                'device_uuid' => 'uuid-fail-' . $index,
            ])->assertStatus(401);

            $bodies[] = $response->json();
            $this->assertSame('claim_failed', $response->json('error'));
        }

        // The reused code fails with the same shape.
        $reused = $this->postJson('/api/counters/claim', ['code' => $consumed, 'device_uuid' => 'uuid-another'])
            ->assertStatus(401);
        $bodies[] = $reused->json();

        $shapes = array_map(fn ($body) => [$body['error'], $body['message']], $bodies);
        $this->assertCount(1, array_unique(array_map(fn ($s) => implode('|', $s), $shapes)),
            'every refusal must carry the identical message');

        $this->assertSame(1, Device::count(), 'a refused claim must bind nothing');
        $this->assertSame(Counter::STATUS_ACTIVE, $this->counter->fresh()->status);
    }

    /** IS2 / IS3: presenting another store id alongside the code changes nothing. */
    public function test_a_code_never_binds_a_device_into_another_store(): void
    {
        $raw = $this->code();

        $this->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson('/api/counters/claim', [
                'code' => $raw,
                'device_uuid' => 'uuid-cross-store',
                'store_id' => $this->storeB->id,
            ])
            ->assertStatus(401)
            ->assertJson(['error' => 'claim_failed']);

        $this->assertSame(0, Device::where('store_id', $this->storeB->id)->count());
        $this->assertSame(0, Counter::where('store_id', $this->storeB->id)->count());
    }

    /** CNT-002: claiming never invents a counter. */
    public function test_claim_never_creates_a_counter(): void
    {
        $before = Counter::count();
        $raw = $this->code();

        $this->postJson('/api/counters/claim', ['code' => $raw, 'device_uuid' => 'uuid-till-2'])
            ->assertOk();

        $this->assertSame($before, Counter::count());
    }

    public function test_a_store_hint_only_matches_the_code_and_never_overrides_it(): void
    {
        $this->postJson('/api/counters/claim', [
            'code' => $this->code(),
            'device_uuid' => 'uuid-hint-ok',
            'store_id' => $this->storeA->code,
        ])->assertOk();

        $counterB = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C02',
            'counter_name' => 'Second Counter',
        ]);

        $this->postJson('/api/counters/claim', [
            'code' => ActivationKey::generateForCounter($counterB)['raw_key'],
            'device_uuid' => 'uuid-hint-bad',
            'store_id' => $this->storeB->code,
        ])->assertStatus(401)->assertJson(['error' => 'claim_failed']);
    }

    public function test_a_claim_needs_a_device_identity(): void
    {
        $this->postJson('/api/counters/claim', ['code' => $this->code()])
            ->assertStatus(422)
            ->assertJsonValidationErrors('device_uuid');
    }

    public function test_a_code_for_a_counter_that_no_longer_exists_is_refused(): void
    {
        $raw = $this->code();
        $this->counter->delete();

        $this->postJson('/api/counters/claim', ['code' => $raw, 'device_uuid' => 'uuid-orphan'])
            ->assertStatus(401)
            ->assertJson(['error' => 'claim_failed']);
    }
}
