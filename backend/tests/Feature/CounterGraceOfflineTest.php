<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Device;
use App\Models\Invoice;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * CNT-011 — the offline clock and the handshake that ends it.
 *
 * A counter keeps billing for the grace the owner set, measured from the last
 * time the store server saw it. The server cannot reach into a dark machine, so
 * its job is to hand the till an absolute deadline it can trust, renew that
 * deadline on every clean handshake, and refuse the token outright once the
 * counter has been revoked or retired. A lock is a pause, not a revocation: it
 * must never eject a workstation that is only waiting for an unlock.
 */
class CounterGraceOfflineTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Grace Store',
            'code' => 'GR',
            'state_code' => '32',
            'tax_mode' => 'gst',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'grace-owner@test.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    /** @return array{counter:Counter, token:string} */
    private function claim(?int $graceHours = null): array
    {
        $counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Shop Counter',
            'grace_hours' => $graceHours ?? Counter::DEFAULT_GRACE_HOURS,
        ]);

        $issued = ActivationKey::generateForCounter($counter);

        $claim = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => 'grace-device-01',
        ])->assertOk()->json();

        return ['counter' => $counter->fresh(), 'token' => $claim['device_token']];
    }

    private function validate(string $token): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/devices/validate', [], ['X-Device-Token' => $token]);
    }

    /** An instant the till reads out of JSON, against the moment the test wrote. */
    private function assertInstant(string $iso, Carbon $expected, string $message): void
    {
        $this->assertLessThanOrEqual(
            2,
            abs(Carbon::parse($iso)->diffInSeconds($expected, true)),
            "{$message} (answered {$iso}, expected near {$expected->toIso8601String()})"
        );
    }

    /**
     * A claim that says nothing about grace leaves the till to guess. CNT-011
     * gives the owner a window, so the answer that opens the counter must carry
     * the window the till starts counting from.
     */
    public function test_a_claim_hands_the_till_its_offline_window(): void
    {
        $counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C02',
            'counter_name' => 'Second Counter',
            'grace_hours' => 6,
        ]);

        $claimed = $this->postJson('/api/counters/claim', [
            'code' => ActivationKey::generateForCounter($counter)['raw_key'],
            'device_uuid' => 'grace-device-02',
        ])->assertOk()->json();

        $this->assertSame(6, $claimed['offline']['grace_hours']);
        $this->assertArrayHasKey('grace_until', $claimed['offline']);
        $this->assertArrayHasKey('server_time', $claimed);

        $deadline = Carbon::parse($claimed['offline']['grace_until']);
        $server = Carbon::parse($claimed['server_time']);
        $this->assertTrue($deadline->greaterThan($server), 'the window must open ahead of the clock it is read against');
        $this->assertTrue($deadline->lessThanOrEqualTo($server->copy()->addHours(6)->addMinutes(1)),
            'the window is the hours the owner set, not a day the till may invent');
    }

    /** The boot call repeats the window next to the watermark it was measured from. */
    public function test_the_context_publishes_an_absolute_deadline_from_the_last_seen_watermark(): void
    {
        ['counter' => $counter, 'token' => $token] = $this->claim(3);

        $lastSeen = now()->subHour();
        $counter->forceFill(['last_seen_at' => $lastSeen])->save();

        $context = $this->getJson('/api/counter/context', ['X-Device-Token' => $token])
            ->assertOk()
            ->json();

        $this->assertSame(3, $context['offline']['grace_hours']);
        $this->assertInstant($context['offline']['last_seen_at'], $lastSeen, 'the watermark the till is told is the one the server holds');
        $this->assertInstant(
            $context['offline']['grace_until'],
            $lastSeen->copy()->addHours(3),
            'the deadline is the watermark plus the owner-set window'
        );
        $this->assertNotEmpty($context['server_time'], 'the till needs the server clock to place the deadline on its own');
    }

    /** An owner who allows no offline work must not get a window by default. */
    public function test_a_counter_with_no_grace_is_told_it_has_no_offline_window(): void
    {
        ['counter' => $counter, 'token' => $token] = $this->claim(0);

        $lastSeen = now()->subMinutes(20);
        $counter->forceFill(['last_seen_at' => $lastSeen])->save();

        $context = $this->getJson('/api/counter/context', ['X-Device-Token' => $token])->assertOk()->json();

        $this->assertSame(0, $context['offline']['grace_hours']);
        $this->assertInstant(
            $context['offline']['grace_until'],
            $lastSeen,
            'a zero window expires the moment contact is lost'
        );
        $this->assertTrue(
            Carbon::parse($context['offline']['grace_until'])->lessThanOrEqualTo(Carbon::parse($context['server_time'])),
            'the till must read the deadline as already spent'
        );
    }

    /** A counter that has never been seen still gets a window from when it was opened. */
    public function test_a_counter_without_a_watermark_measures_grace_from_the_day_it_was_claimed(): void
    {
        ['counter' => $counter, 'token' => $token] = $this->claim(24);

        $approved = $counter->fresh()->approved_at;
        $this->assertNotNull($approved);
        $counter->forceFill(['last_seen_at' => null, 'last_sync_at' => null])->save();

        $context = $this->getJson('/api/counter/context', ['X-Device-Token' => $token])->assertOk()->json();

        $this->assertSame(
            $approved->copy()->addHours(24)->toIso8601String(),
            Carbon::parse($context['offline']['grace_until'])->toIso8601String()
        );
    }

    /** Every clean handshake is a renewal: the watermark moves and so does the deadline. */
    public function test_a_live_handshake_renews_the_grace_clock(): void
    {
        ['counter' => $counter, 'token' => $token] = $this->claim(2);

        $counter->forceFill(['last_seen_at' => now()->subHour()])->save();

        $answered = $this->validate($token)
            ->assertOk()
            ->assertJson(['valid' => true, 'status' => 'active'])
            ->json();

        $this->assertSame(2, $answered['offline']['grace_hours']);
        $this->assertTrue(
            Carbon::parse($answered['offline']['grace_until'])->greaterThan(now()->addMinutes(119)),
            'the renewed window must run from the contact that just happened'
        );
        $this->assertGreaterThan(
            Carbon::parse($answered['server_time'])->subMinute(),
            Carbon::parse($answered['offline']['last_seen_at']),
            'the answer must report the watermark it just wrote'
        );
        $this->assertNotNull($counter->fresh()->last_seen_at);
    }

    /**
     * The claim writes its token to both the counter and the device row, so a
     * revoked counter whose device row still reads "active" must not validate.
     */
    public function test_a_revoked_counter_is_locked_on_its_next_connection(): void
    {
        ['counter' => $counter, 'token' => $token] = $this->claim(24);

        $counter->forceFill([
            'status' => Counter::STATUS_REVOKED,
            'revoke_reason' => 'Counter moved to the new shop',
        ])->save();

        $this->assertSame('active', Device::where('device_uuid', 'grace-device-01')->value('status'),
            'the device row is untouched — it is the counter that was revoked');

        $response = $this->validate($token)->assertStatus(403);

        $body = $response->json();
        $this->assertFalse($body['valid']);
        $this->assertSame('revoked', $body['status']);
        $this->assertSame('lock_and_reset', $body['action']);
        $this->assertSame('Counter moved to the new shop', $body['reason']);
        $this->assertStringNotContainsString($token, $response->getContent(), 'a refusal must never repeat the token it refused');
        $this->assertArrayNotHasKey('device_token', $body);
        $this->assertArrayNotHasKey('offline', $body, 'a revoked counter gets no clock to work against');
    }

    /** Retirement is a revocation with history kept: the handshake refuses either way. */
    public function test_a_retired_counter_is_refused_by_the_handshake(): void
    {
        ['counter' => $counter, 'token' => $token] = $this->claim(24);

        Invoice::create([
            'store_id' => $this->store->id,
            'counter_id' => $counter->id,
            'counter_code' => $counter->counter_code,
            'invoice_number' => 'C01-INV-1001',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 100,
            'status' => 'issued',
            'external_id' => 'inv-grace-retire',
        ]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->deleteJson("/api/admin/counters/{$counter->id}", ['confirm_retire' => true])
            ->assertOk()
            ->assertJson(['retired' => true]);

        $this->validate($token)
            ->assertStatus(403)
            ->assertJson(['valid' => false, 'status' => 'revoked', 'action' => 'lock_and_reset']);

        $this->assertDatabaseHas('invoices', ['external_id' => 'inv-grace-retire', 'counter_id' => $counter->id]);
    }

    /**
     * A lock pauses a till; it does not revoke it. The answer must not read as
     * lock_and_reset, or a temporary lock would wipe a working claim.
     */
    public function test_a_locked_counter_is_refused_without_losing_its_claim(): void
    {
        ['counter' => $counter, 'token' => $token] = $this->claim(24);

        $counter->forceFill(['status' => Counter::STATUS_LOCKED])->save();

        $body = $this->validate($token)
            ->assertStatus(403)
            ->assertJson(['valid' => false, 'status' => 'locked'])
            ->json();

        $this->assertNotSame('lock_and_reset', $body['action'] ?? null);
        $this->assertStringNotContainsString($token, json_encode($body));

        // Unlocking puts the same token back to work.
        $counter->forceFill(['status' => Counter::STATUS_ACTIVE])->save();
        $this->validate($token)->assertOk()->assertJson(['valid' => true]);
    }
}
