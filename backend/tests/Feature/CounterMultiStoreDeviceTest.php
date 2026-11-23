<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CNT-008 — one workstation, one claimed counter per store.
 *
 * A machine may work a counter in Store A and a counter in Store B: identity is
 * per store, so neither claim overwrites the other and each token keeps naming
 * only its own tenant. What one machine may NOT do is hold two live counters
 * inside the same store — that would put two number series, two permission
 * profiles and two audit trails behind a single till. Releasing the first
 * counter is the only way in.
 */
class CounterMultiStoreDeviceTest extends TestCase
{
    use RefreshDatabase;

    private const MACHINE = 'uuid-multi-store-till';

    private Store $storeA;
    private Store $storeB;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create([
            'name' => 'LamStone Main', 'code' => 'LSM', 'state_code' => '32',
            'tax_mode' => 'gst', 'is_active' => true,
        ]);
        $this->storeB = Store::create([
            'name' => 'LamStone North', 'code' => 'LSN', 'state_code' => '32',
            'tax_mode' => 'gst', 'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner', 'email' => 'multi-owner@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => $this->storeA->id,
        ]);
    }

    private function counterIn(Store $store, string $code, string $name): Counter
    {
        return Counter::create([
            'store_id' => $store->id,
            'counter_code' => $code,
            'counter_name' => $name,
        ]);
    }

    /** @return array{counter:Counter, token:string} */
    private function claim(Counter $counter, string $deviceUuid = self::MACHINE): array
    {
        $issued = ActivationKey::generateForCounter($counter);

        $body = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => $deviceUuid,
        ])->assertOk()->json();

        return ['counter' => $counter->fresh(), 'token' => $body['device_token']];
    }

    private function adminHeaders(Store $store): array
    {
        return ['X-Store-Id' => (string) $store->id];
    }

    public function test_one_machine_holds_a_counter_in_each_store_at_the_same_time(): void
    {
        $a = $this->claim($this->counterIn($this->storeA, 'C01', 'Main Counter'));
        $b = $this->claim($this->counterIn($this->storeB, 'C01', 'North Counter'));

        $this->assertNotSame($a['token'], $b['token'], 'each store issues its own credential');

        $this->assertSame(Counter::STATUS_ACTIVE, $a['counter']->fresh()->status);
        $this->assertSame(Counter::STATUS_ACTIVE, $b['counter']->fresh()->status);
        $this->assertSame(self::MACHINE, $a['counter']->fresh()->device_uuid);
        $this->assertSame(self::MACHINE, $b['counter']->fresh()->device_uuid);

        // One device identity per store, not one for the whole machine.
        $this->assertSame(2, Device::where('device_uuid', self::MACHINE)->count());
        $this->assertEqualsCanonicalizing(
            [$this->storeA->id, $this->storeB->id],
            Device::where('device_uuid', self::MACHINE)->pluck('store_id')->all()
        );

        // Store B's claim never moved store A's device row.
        $this->assertSame($a['counter']->id, (int) Device::firstWhere('store_id', $this->storeA->id)->counter_id);
        $this->assertSame($b['counter']->id, (int) Device::firstWhere('store_id', $this->storeB->id)->counter_id);
    }

    /** IS1: the token names the tenant, so a header cannot trade stores. */
    public function test_each_stores_token_answers_only_for_its_own_counter(): void
    {
        $a = $this->claim($this->counterIn($this->storeA, 'C01', 'Main Counter'));
        $b = $this->claim($this->counterIn($this->storeB, 'C01', 'North Counter'));

        $this->withHeaders(['X-Device-Token' => $a['token']])
            ->getJson('/api/counter/context')
            ->assertOk()
            ->assertJsonPath('counter.id', $a['counter']->id)
            ->assertJsonPath('store.id', $this->storeA->id);

        $this->withHeaders(['X-Device-Token' => $b['token']])
            ->getJson('/api/counter/context')
            ->assertOk()
            ->assertJsonPath('counter.id', $b['counter']->id)
            ->assertJsonPath('store.id', $this->storeB->id);

        // The same machine asking for the other store by name is refused, not redirected.
        $this->withHeaders([
            'X-Device-Token' => $a['token'],
            'X-Store-Id' => (string) $this->storeB->id,
        ])->getJson('/api/counter/context')->assertStatus(403);
    }

    public function test_a_machine_already_on_a_counter_is_refused_a_second_one_in_the_same_store(): void
    {
        $held = $this->claim($this->counterIn($this->storeA, 'C01', 'Main Counter'));
        $second = $this->counterIn($this->storeA, 'C02', 'Second Counter');

        $issued = ActivationKey::generateForCounter($second);

        $refused = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => self::MACHINE,
        ]);

        $refused->assertStatus(409)->assertJson([
            'success' => false,
            'error' => 'device_on_another_counter',
            'counter_name' => 'Main Counter',
        ]);

        $this->assertStringContainsString('Main Counter', (string) $refused->json('message'));

        $this->assertSame(Counter::STATUS_UNCLAIMED, $second->fresh()->status, 'a refusal binds nothing');
        $this->assertNull($second->fresh()->device_uuid);
        $this->assertNull(ActivationKey::firstWhere('key_hash', ActivationKey::hashKey($issued['raw_key']))->consumed_at,
            'a refused claim must not burn the code');
        $this->assertSame(1, Device::where('device_uuid', self::MACHINE)->count());

        // The counter it already works stays working.
        $this->withHeaders(['X-Device-Token' => $held['token']])
            ->getJson('/api/counter/context')
            ->assertOk()
            ->assertJsonPath('counter.id', $held['counter']->id);
    }

    public function test_releasing_the_first_counter_lets_the_machine_take_the_second(): void
    {
        $held = $this->claim($this->counterIn($this->storeA, 'C01', 'Main Counter'));
        $second = $this->counterIn($this->storeA, 'C02', 'Second Counter');

        $this->postJson('/api/counters/claim', [
            'code' => ActivationKey::generateForCounter($second)['raw_key'],
            'device_uuid' => self::MACHINE,
        ])->assertStatus(409);

        $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/admin/counters/{$held['counter']->id}/reissue", [], $this->adminHeaders($this->storeA))
            ->assertOk();

        $this->assertSame(
            Counter::STATUS_UNCLAIMED,
            Counter::find($held['counter']->id)->status,
            're-issue releases the machine from the counter it was on'
        );

        $taken = $this->postJson('/api/counters/claim', [
            'code' => ActivationKey::generateForCounter($second)['raw_key'],
            'device_uuid' => self::MACHINE,
        ])->assertOk()->json();

        $this->assertSame($second->fresh()->id, $taken['counter']['id']);
        $this->assertSame($second->fresh()->id, (int) Device::firstWhere('store_id', $this->storeA->id)->counter_id);
    }

    /** The other store's work must survive a release, a rename or a lock next door. */
    public function test_admin_action_in_one_store_never_touches_the_others_claim(): void
    {
        $a = $this->claim($this->counterIn($this->storeA, 'C01', 'Main Counter'));
        $b = $this->claim($this->counterIn($this->storeB, 'C01', 'North Counter'));

        $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/admin/counters/{$a['counter']->id}/reissue", [], $this->adminHeaders($this->storeA))
            ->assertOk();

        $this->assertSame(Counter::STATUS_ACTIVE, $b['counter']->fresh()->status);
        $this->assertSame(self::MACHINE, $b['counter']->fresh()->device_uuid);
        $this->withHeaders(['X-Device-Token' => $b['token']])
            ->getJson('/api/counter/context')
            ->assertOk()
            ->assertJsonPath('counter.id', $b['counter']->id);
    }

    /**
     * A security audit purging this machine's device row in Store A must not
     * revoke the counter it works in Store B — the device identity is per store.
     */
    public function test_purging_a_rogue_device_releases_only_that_stores_counter(): void
    {
        $a = $this->claim($this->counterIn($this->storeA, 'C01', 'Main Counter'));
        $b = $this->claim($this->counterIn($this->storeB, 'C01', 'North Counter'));

        $deviceA = Device::firstWhere('store_id', $this->storeA->id);

        $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/admin/devices/audit/purge/{$deviceA->id}", [], $this->adminHeaders($this->storeA))
            ->assertOk();

        $this->assertSame(Counter::STATUS_REVOKED, $a['counter']->fresh()->status);
        $this->assertSame(Counter::STATUS_ACTIVE, $b['counter']->fresh()->status,
            'CNT-008: a purge in one store cannot revoke another store\'s counter');

        $this->withHeaders(['X-Device-Token' => $b['token']])
            ->getJson('/api/counter/context')
            ->assertOk()
            ->assertJsonPath('counter.id', $b['counter']->id);
    }

    /** A heartbeat is per store, so the machine names the counter it is beating for. */
    public function test_a_heartbeat_resolves_the_counter_of_the_store_beating_for(): void
    {
        $a = $this->claim($this->counterIn($this->storeA, 'C01', 'Main Counter'));
        $b = $this->claim($this->counterIn($this->storeB, 'C01', 'North Counter'));

        $this->withHeaders(['X-Device-Token' => $b['token']])
            ->postJson('/api/devices/heartbeat', ['device_uuid' => self::MACHINE])
            ->assertOk();

        $beatFor = DB::table('device_sessions')
            ->where('device_uuid', self::MACHINE)
            ->orderByDesc('id')
            ->first();

        $this->assertSame($this->storeB->id, (int) $beatFor->store_id);
        $this->assertSame($b['counter']->id, (int) $beatFor->counter_id,
            'CNT-008: a shared machine must not beat for whichever counter the lookup found first');

        $this->withHeaders(['X-Device-Token' => $a['token']])
            ->postJson('/api/devices/heartbeat', ['device_uuid' => self::MACHINE])
            ->assertOk();
    }

    public function test_the_machine_is_the_unique_key_per_store_not_globally(): void
    {
        $stamp = now();

        DB::table('counters')->insert([
            ['store_id' => $this->storeA->id, 'counter_code' => 'C01', 'counter_name' => 'Main',
                'status' => Counter::STATUS_ACTIVE, 'device_uuid' => self::MACHINE,
                'created_at' => $stamp, 'updated_at' => $stamp],
            ['store_id' => $this->storeB->id, 'counter_code' => 'C01', 'counter_name' => 'North',
                'status' => Counter::STATUS_ACTIVE, 'device_uuid' => self::MACHINE,
                'created_at' => $stamp, 'updated_at' => $stamp],
        ]);

        $this->assertSame(2, Counter::where('device_uuid', self::MACHINE)->count(),
            'the same machine may be recorded in two stores');

        $this->expectException(QueryException::class);

        DB::table('counters')->insert([
            'store_id' => $this->storeA->id, 'counter_code' => 'C02', 'counter_name' => 'Duplicate',
            'status' => Counter::STATUS_ACTIVE, 'device_uuid' => self::MACHINE,
            'created_at' => $stamp, 'updated_at' => $stamp,
        ]);
    }
}
