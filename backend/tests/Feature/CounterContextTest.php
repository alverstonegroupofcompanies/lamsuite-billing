<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CNT-011 / PRF-001 — the boot call a claimed counter makes to learn what it is.
 *
 * One endpoint answers for the counter it authenticates as: it takes no counter
 * id, it never repeats a secret, and it carries the profile, the locking clock,
 * the offline grace and the manifest of credential caches the till may fetch.
 */
class CounterContextTest extends TestCase
{
    use RefreshDatabase;

    private function store(string $name, string $code, string $type = 'retail'): Store
    {
        return Store::create([
            'name' => $name,
            'code' => $code,
            'state_code' => '32',
            'store_type' => $type,
            'tax_mode' => 'gst',
            'is_active' => true,
        ]);
    }

    /** @return array{counter:Counter, token:string, claim:array} */
    private function claimCounter(Store $store, string $counterCode = 'C01'): array
    {
        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => $counterCode,
            'counter_name' => "{$counterCode} Counter",
            'location_name' => 'Shop floor',
        ]);

        $issued = ActivationKey::generateForCounter($counter);

        $claim = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => "dev-{$store->id}-{$counterCode}",
        ])->assertOk()->json();

        return ['counter' => $counter, 'token' => $claim['device_token'], 'claim' => $claim];
    }

    private function context(string $token, array $query = []): \Illuminate\Testing\TestResponse
    {
        $url = '/api/counter/context'.($query ? '?'.http_build_query($query) : '');

        return $this->getJson($url, ['X-Device-Token' => $token]);
    }

    /** The identity half of an answer — the part the till boots from. */
    private function identity(array $payload, string $half): array
    {
        $keys = $half === 'counter'
            ? ['id', 'counter_code', 'counter_name', 'location_name', 'is_remote', 'is_digital_only']
            : ['id', 'name', 'code'];

        return array_intersect_key($payload[$half], array_flip($keys));
    }

    public function test_the_context_describes_the_counter_that_claimed_it(): void
    {
        $store = $this->store('LamStone Context Store', 'CTX01');
        $claimed = $this->claimCounter($store);

        $res = $this->context($claimed['token'])->assertOk()->assertJson(['success' => true]);

        // CNT-011: the boot path can be fed either answer, so the identity half
        // of the claim and the context must be the same object.
        $this->assertSame($this->identity($claimed['claim'], 'counter'), $this->identity($res->json(), 'counter'));
        $this->assertSame($this->identity($claimed['claim'], 'store'), $this->identity($res->json(), 'store'));
    }

    public function test_the_context_carries_the_profile_its_version_and_the_clock(): void
    {
        $store = $this->store('LamStone Profile Store', 'CTX02');
        $claimed = $this->claimCounter($store);

        $claimed['counter']->update([
            'permission_profile' => [
                'modules' => ['pos', 'bills'],
                'screens' => ['pos.billing', 'bills.past'],
                'discount' => ['max_pct' => 5],
            ],
            'permission_profile_version' => 7,
            'idle_lock_minutes' => 2,
            'grace_hours' => 6,
        ]);

        $res = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])->assertOk();

        // PRF-001: the till boots from one complete document. What the owner set
        // is what they set; what they never touched reads as the documented
        // default rather than as nothing.
        $this->assertSame(['pos', 'bills'], $res->json('profile.permissions.modules'));
        $this->assertSame(['pos.billing', 'bills.past'], $res->json('profile.permissions.screens'));
        $this->assertSame(5, $res->json('profile.permissions.discount.max_pct'));
        $this->assertTrue($res->json('profile.permissions.cash_drawer'));
        $this->assertSame(7, $res->json('profile.version'));
        $this->assertSame(2, $res->json('locking.idle_lock_minutes'));
        $this->assertSame(6, $res->json('offline.grace_hours'));
        $this->assertNotEmpty($res->json('server_time'));
    }

    public function test_a_counter_the_owner_never_tuned_reports_the_owner_defaults(): void
    {
        $store = $this->store('LamStone Default Store', 'CTX03');
        $claimed = $this->claimCounter($store);

        $res = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])->assertOk();

        $this->assertSame(5, $res->json('locking.idle_lock_minutes'));
        $this->assertSame(24, $res->json('offline.grace_hours'));
        $this->assertSame(1, $res->json('profile.version'));
        $this->assertSame(Counter::STATUS_ACTIVE, $res->json('counter.status'));
        $this->assertFalse($res->json('counter.is_locked'));
    }

    public function test_a_pharmacy_store_says_so_and_a_retail_store_gets_no_pharmacy_keys(): void
    {
        $pharmacy = $this->claimCounter($this->store('LamStone Pharmacy', 'CTX04', 'pharmacy'));
        $retail = $this->claimCounter($this->store('LamStone Retail', 'CTX05', 'retail'));

        $phRes = $this->getJson('/api/counter/context', ['X-Device-Token' => $pharmacy['token']])->assertOk();
        $retRes = $this->getJson('/api/counter/context', ['X-Device-Token' => $retail['token']])->assertOk();

        $this->assertTrue($phRes->json('store.is_pharmacy'));
        $this->assertFalse($retRes->json('store.is_pharmacy'));
        $this->assertNull($retRes->json('pharmacy'));
        $this->assertIsArray($phRes->json('pharmacy'));
    }

    public function test_the_context_repeats_no_secret(): void
    {
        $store = $this->store('LamStone Secret Store', 'CTX06');
        $claimed = $this->claimCounter($store);
        $claimed['counter']->update(['unlock_pin_hash' => bcrypt('4321')]);

        $res = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])->assertOk();
        $raw = $res->getContent();

        $this->assertStringNotContainsString('unlock_pin', $raw);
        $this->assertStringNotContainsString('device_token', $raw);
        $this->assertStringNotContainsString('key_hash', $raw);
        $this->assertStringNotContainsString($claimed['token'], $raw);
    }

    public function test_a_till_cannot_ask_for_another_stores_counter(): void
    {
        $mine = $this->claimCounter($this->store('LamStone Home Store', 'CTX07'));
        $other = $this->claimCounter($this->store('LamStone Elsewhere', 'CTX08'));

        // IS1/IS4: a counter id in the request is decoration — the token answers.
        $res = $this->context($mine['token'], ['counter_id' => $other['counter']->id])->assertOk();
        $this->assertSame($mine['counter']->id, $res->json('counter.id'));
        $this->assertSame($mine['counter']->store_id, $res->json('store.id'));

        // Naming another store is refused outright, not answered from it.
        $this->context($mine['token'], [
            'counter_id' => $other['counter']->id,
            'store_id' => $other['counter']->store_id,
        ])->assertStatus(403);
    }

    public function test_no_token_no_context(): void
    {
        $this->getJson('/api/counter/context')->assertStatus(401);
        $this->getJson('/api/counter/context', ['X-Device-Token' => 'lsd_not_a_real_token'])->assertStatus(401);
    }

    public function test_a_pin_locked_counter_locks_the_till_without_revealing_why(): void
    {
        $store = $this->store('LamStone Locked Store', 'CTX09');
        $claimed = $this->claimCounter($store);

        $claimed['counter']->update([
            'unlock_failed_attempts' => 5,
            'unlock_locked_until' => now()->addMinutes(10),
        ]);

        $res = $this->context($claimed['token'])->assertOk();

        $this->assertTrue($res->json('counter.is_locked'));
        $this->assertSame(5, $res->json('locking.unlock.failed_attempts'));
        $this->assertNotEmpty($res->json('locking.unlock.locked_until'));
        $this->assertStringNotContainsString('unlock_pin', $res->getContent());
    }

    public function test_an_administrator_locked_counter_is_refused_the_surface_entirely(): void
    {
        $claimed = $this->claimCounter($this->store('LamStone Sealed Store', 'CTX11'));

        $claimed['counter']->update(['status' => Counter::STATUS_LOCKED]);

        $this->context($claimed['token'])->assertStatus(403);

        $claimed['counter']->update(['status' => Counter::STATUS_REVOKED]);

        $this->context($claimed['token'])->assertStatus(403);
    }

    public function test_a_device_that_never_claimed_a_counter_is_told_so(): void
    {
        // A pre-2.2 owner-login device still has a working token but no counter.
        $store = $this->store('LamStone Legacy Store', 'CTX12');
        $device = Device::create([
            'store_id' => $store->id,
            'device_uuid' => 'dev-legacy-1',
            'device_name' => 'Legacy till',
            'device_token' => $token = 'lsd_legacy_'.strtolower(bin2hex(random_bytes(8))),
            'device_token_hash' => hash('sha256', $token),
            'status' => 'active',
        ]);

        $res = $this->context($token)->assertStatus(409);

        $this->assertSame('counter_unclaimed', $res->json('error'));
        $this->assertStringContainsString('activation code', $res->json('message'));
    }

    public function test_the_credential_manifest_admits_what_is_not_shipped_yet(): void
    {
        $claimed = $this->claimCounter($this->store('LamStone Manifest Store', 'CTX10', 'pharmacy'));

        $manifest = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])
            ->assertOk()
            ->assertJsonStructure(['credentials' => [['kind', 'available', 'url', 'offline_verification']]])
            ->json('credentials');

        $kinds = array_column($manifest, 'kind');
        sort($kinds);
        $this->assertSame(
            ['approver_pins', 'counter_unlock', 'drug_schedules', 'pharmacist_pins', 'salesperson_pins'],
            $kinds
        );

        foreach ($manifest as $entry) {
            if ($entry['kind'] === 'counter_unlock') {
                // B7 ships this one: the till verifies its own counter offline.
                $this->assertTrue($entry['available']);
                $this->assertSame('/api/credentials/offline-cache', $entry['url']);
                $this->assertSame('bcrypt_hash', $entry['offline_verification']);
                continue;
            }

            // Waves C, D and E light these up; the till must be told, not guess.
            $this->assertFalse($entry['available'], $entry['kind'].' is not shipped yet');
            $this->assertNull($entry['url']);
            $this->assertSame('not_shipped', $entry['offline_verification']);
        }
    }
}
