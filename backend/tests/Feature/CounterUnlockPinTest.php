<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * PRF-006 / B7 — the counter's own unlock PIN.
 *
 * The owner sets it from the admin panel (admin-only reset), the server keeps only
 * a bcrypt hash, the till verifies it to lift its idle lock, five wrong attempts
 * lock it until the owner resets, and the hash reaches tills through exactly one
 * counter-scoped endpoint. No response anywhere carries the PIN or its hash to a
 * screen that displays it.
 */
class CounterUnlockPinTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'LamStone Unlock Store',
            'code' => 'UNL01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'unlock-owner@test.in',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);
    }

    /** @return array{counter:Counter, token:string} */
    private function claimCounter(string $counterCode = 'C01'): array
    {
        $counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => $counterCode,
            'counter_name' => "{$counterCode} Counter",
        ]);

        $issued = ActivationKey::generateForCounter($counter);

        $claim = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => "dev-{$counterCode}",
        ])->assertOk()->json();

        return ['counter' => $counter, 'token' => $claim['device_token']];
    }

    private function setPin(Counter $counter, string $pin): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/counters/{$counter->id}/unlock-pin/reset", ['pin' => $pin]);
    }

    public function test_the_owner_sets_a_pin_the_server_stores_only_as_a_hash(): void
    {
        $counter = $this->claimCounter()['counter'];

        $this->setPin($counter, '582913')->assertOk();

        $fresh = $counter->fresh();
        $this->assertNotNull($fresh->unlock_pin_hash);
        $this->assertNotSame('582913', $fresh->unlock_pin_hash);
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('582913', $fresh->unlock_pin_hash));

        $row = DB::table('counters')->where('id', $counter->id)->first();
        $this->assertStringNotContainsString('582913', (string) $row->unlock_pin_hash);

        $audit = DB::table('audit_logs')
            ->where('action', 'counter_unlock_pin_reset')
            ->where('entity_id', (string) $counter->id)
            ->first();
        $this->assertNotNull($audit, 'setting the PIN is an audited owner action');
        $this->assertStringNotContainsString(
            '582913',
            json_encode([$audit->old_values, $audit->new_values]),
            'the audit trail must not hold the PIN'
        );
    }

    public function test_trivial_and_short_pins_are_refused_by_the_shared_policy(): void
    {
        $counter = $this->claimCounter()['counter'];

        foreach (['123456', '111111', '000000', '543210', '12345', '5829139', '58a913'] as $weak) {
            $this->setPin($counter, $weak)
                ->assertStatus(422)
                ->assertJsonValidationErrors('pin');
        }

        $this->assertNull($counter->fresh()->unlock_pin_hash, 'a refused PIN leaves no credential behind');
    }

    public function test_only_an_administrator_can_reset_it_and_only_for_their_store(): void
    {
        $counter = $this->claimCounter()['counter'];

        $cashier = User::create([
            'name' => 'Cashier',
            'email' => 'unlock-cashier@test.in',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->actingAs($cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/counters/{$counter->id}/unlock-pin/reset", ['pin' => '582913'])
            ->assertForbidden();

        $other = Store::create(['name' => 'Other', 'code' => 'UNL02', 'state_code' => '32', 'is_active' => true]);
        $this->owner->update(['store_id' => $other->id]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $other->id])
            ->postJson("/api/admin/counters/{$counter->id}/unlock-pin/reset", ['pin' => '582913'])
            ->assertNotFound();

        $this->assertNull($counter->fresh()->unlock_pin_hash);
    }

    public function test_the_till_lifts_its_lock_with_the_counters_own_pin(): void
    {
        $claimed = $this->claimCounter();
        $this->setPin($claimed['counter'], '582913');

        $claimed['counter']->update(['unlock_failed_attempts' => 2]);

        $this->postJson('/api/counter/unlock', ['pin' => '582913'], ['X-Device-Token' => $claimed['token']])
            ->assertOk()
            ->assertJson(['success' => true]);

        $this->assertSame(0, $claimed['counter']->fresh()->unlock_failed_attempts);
    }

    public function test_a_wrong_pin_is_refused_and_the_fifth_locks_the_counter_until_the_owner_resets(): void
    {
        $claimed = $this->claimCounter();
        $counter = $claimed['counter'];
        $this->setPin($counter, '582913');

        for ($attempt = 1; $attempt <= 4; $attempt++) {
            $res = $this->postJson('/api/counter/unlock', ['pin' => '999999'], ['X-Device-Token' => $claimed['token']]);
            $res->assertStatus(422);
            $this->assertSame($attempt, $counter->fresh()->unlock_failed_attempts);
            $this->assertNull($counter->fresh()->unlock_locked_until);
            $this->assertSame(5 - $attempt, $res->json('remaining_attempts'));
        }

        $locked = $this->postJson('/api/counter/unlock', ['pin' => '999999'], ['X-Device-Token' => $claimed['token']]);
        $locked->assertStatus(423)->assertJson(['code' => 'counter_unlock_locked']);

        $fresh = $counter->fresh();
        $this->assertNotNull($fresh->unlock_locked_until);
        $this->assertEqualsWithDelta(15, now()->diffInMinutes($fresh->unlock_locked_until, false), 1);

        // Even the right PIN cannot resume work inside the lockout window.
        $this->postJson('/api/counter/unlock', ['pin' => '582913'], ['X-Device-Token' => $claimed['token']])
            ->assertStatus(423);

        $this->assertStringNotContainsString(
            '582913',
            json_encode(DB::table('audit_logs')->latest('id')->take(6)->get()->toArray()),
            'no audit row may repeat a PIN'
        );
    }

    public function test_an_owner_reset_clears_the_lockout_so_the_till_works_again(): void
    {
        $claimed = $this->claimCounter();
        $counter = $claimed['counter'];
        $this->setPin($counter, '582913');

        $counter->update([
            'unlock_failed_attempts' => 5,
            'unlock_locked_until' => now()->addMinutes(15),
        ]);

        $this->postJson('/api/counter/unlock', ['pin' => '582913'], ['X-Device-Token' => $claimed['token']])
            ->assertStatus(423);

        $this->setPin($counter, '731964')->assertOk();

        $fresh = $counter->fresh();
        $this->assertSame(0, $fresh->unlock_failed_attempts);
        $this->assertNull($fresh->unlock_locked_until);

        $this->postJson('/api/counter/unlock', ['pin' => '731964'], ['X-Device-Token' => $claimed['token']])
            ->assertOk();
    }

    public function test_a_counter_without_a_pin_says_so_instead_of_locking_the_store_out(): void
    {
        $claimed = $this->claimCounter();

        $this->postJson('/api/counter/unlock', ['pin' => '582913'], ['X-Device-Token' => $claimed['token']])
            ->assertStatus(409)
            ->assertJson(['code' => 'counter_unlock_pin_not_set']);

        $this->assertSame(
            0,
            $claimed['counter']->fresh()->unlock_failed_attempts,
            'a counter with no PIN is not punished for trying'
        );
        $this->assertNull($claimed['counter']->fresh()->unlock_locked_until);
    }

    public function test_a_second_attempt_against_a_counter_with_no_pin_still_says_so(): void
    {
        $claimed = $this->claimCounter();

        $this->postJson('/api/counter/unlock', ['pin' => '111111'], ['X-Device-Token' => $claimed['token']])
            ->assertStatus(409);
        $this->postJson('/api/counter/unlock', ['pin' => '582913'], ['X-Device-Token' => $claimed['token']])
            ->assertStatus(409);

        $this->assertSame(0, $claimed['counter']->fresh()->unlock_failed_attempts);
    }

    public function test_the_context_admits_a_pin_exists_without_repeating_it(): void
    {
        $claimed = $this->claimCounter();
        $this->setPin($claimed['counter'], '582913');

        $res = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])->assertOk();

        $this->assertTrue($res->json('locking.unlock.pin_set'));
        $this->assertStringNotContainsString('unlock_pin', $res->getContent());
        $this->assertStringNotContainsString('$2y$', $res->getContent(), 'a hash is not boot metadata');
    }

    public function test_the_credential_manifest_points_the_till_at_the_cache_that_ships(): void
    {
        $claimed = $this->claimCounter();
        $this->setPin($claimed['counter'], '582913');

        $manifest = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])
            ->assertOk()
            ->json('credentials');

        $entry = collect($manifest)->firstWhere('kind', 'counter_unlock');
        $this->assertNotNull($entry, 'the till is told which credential caches exist');
        $this->assertTrue($entry['available']);
        $this->assertSame('/api/credentials/offline-cache', $entry['url']);
        $this->assertSame('bcrypt_hash', $entry['offline_verification']);
    }

    public function test_the_offline_cache_hands_this_counter_its_own_hash_and_nothing_else(): void
    {
        $mine = $this->claimCounter('C01');
        $this->setPin($mine['counter'], '582913');

        $res = $this->getJson('/api/credentials/offline-cache', ['X-Device-Token' => $mine['token']])
            ->assertOk();

        $entry = collect($res->json('credentials'))->firstWhere('kind', 'counter_unlock');
        $this->assertTrue($entry['pin_set']);
        $this->assertSame('bcrypt', $entry['algorithm']);
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('582913', $entry['hash']));
        $this->assertNotSame('582913', $entry['hash']);
        $this->assertStringNotContainsString('582913', $res->getContent());

        // IS1: no counter id in the request moves the answer off the token.
        $other = $this->claimCounter('C02');
        $foreign = $this->getJson(
            '/api/credentials/offline-cache?counter_id='.$mine['counter']->id,
            ['X-Device-Token' => $other['token']]
        )->assertOk();

        $this->assertSame($other['counter']->id, $foreign->json('counter_id'));
        $this->assertNotSame(
            $entry['hash'],
            collect($foreign->json('credentials'))->firstWhere('kind', 'counter_unlock')['hash']
        );
        $this->assertFalse(
            collect($foreign->json('credentials'))->firstWhere('kind', 'counter_unlock')['pin_set'],
            'a counter with no PIN is answered plainly, not with someone else hash'
        );

        $this->getJson('/api/credentials/offline-cache')->assertUnauthorized();
        $this->getJson('/api/credentials/offline-cache', ['X-Device-Token' => 'lsd_not_a_token'])
            ->assertUnauthorized();
    }

    public function test_the_unlock_endpoint_belongs_to_the_counter_token_alone(): void
    {
        $claimed = $this->claimCounter();
        $this->setPin($claimed['counter'], '582913');

        $this->postJson('/api/counter/unlock', ['pin' => '582913'])->assertUnauthorized();

        $this->postJson('/api/counter/unlock', ['pin' => '582913'], ['X-Device-Token' => 'lsd_not_a_token'])
            ->assertUnauthorized();

        // A request naming another counter cannot spend that counter's PIN: the
        // token's own counter is the only subject (IS1).
        $claimed['counter']->update(['unlock_failed_attempts' => 3]);

        $this->postJson('/api/counter/unlock', ['pin' => '582913', 'counter_id' => $claimed['counter']->id + 500], ['X-Device-Token' => $claimed['token']])
            ->assertOk();

        $this->assertSame(0, $claimed['counter']->fresh()->unlock_failed_attempts);
    }

    public function test_an_idle_lock_setting_of_zero_never_locks_and_still_answers(): void
    {
        $claimed = $this->claimCounter();
        $claimed['counter']->update(['idle_lock_minutes' => 0]);
        $this->setPin($claimed['counter'], '582913');

        $res = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])->assertOk();

        $this->assertSame(0, $res->json('locking.idle_lock_minutes'));
        $this->assertTrue($res->json('locking.unlock.pin_set'));
    }
}
