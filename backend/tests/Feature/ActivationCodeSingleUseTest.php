<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * CNT-003 / CNT-004 — an activation code belongs to exactly one counter, is
 * generated server-side with >=128 bits of randomness, is shown once, is stored
 * hashed, and is hard single-use. IS2 keeps it inside one store.
 */
class ActivationCodeSingleUseTest extends TestCase
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
            'name' => 'Owner',
            'email' => 'owner@test.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->storeA->id,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C01',
            'counter_name' => 'Main Counter',
            'status' => Counter::STATUS_UNCLAIMED,
        ]);
    }

    private function admin(): static
    {
        return $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id]);
    }

    private function issue(array $payload = []): array
    {
        $response = $this->admin()->postJson("/api/admin/counters/{$this->counter->id}/activation-code", $payload);
        $response->assertOk();

        return $response->json();
    }

    public function test_owner_issues_a_hashed_single_use_code_bound_to_one_counter(): void
    {
        $json = $this->issue(['label' => 'New laptop']);

        $raw = $json['code'];
        $this->assertNotEmpty($raw);
        $this->assertMatchesRegularExpression('/^LAM-C01-[0-9A-F]{16}-[0-9A-F]{16}$/', $raw);

        $key = ActivationKey::findOrFail($json['activation_key_id']);
        $this->assertSame($this->counter->id, $key->counter_id);
        $this->assertSame($this->storeA->id, $key->store_id);
        $this->assertSame('New laptop', $key->label);
        $this->assertTrue($key->is_single_use);
        $this->assertTrue($key->isValid());

        // CNT-003: at least 128 bits of randomness (32 hex characters).
        $hex = preg_replace('/[^0-9A-F]/', '', substr($raw, strlen('LAM-C01-')));
        $this->assertGreaterThanOrEqual(32, strlen($hex));

        // Hash-only at rest: the raw code appears in no column of the row.
        $row = (array) DB::table('activation_keys')->where('id', $key->id)->first();
        $this->assertStringNotContainsString($raw, json_encode($row), 'IS5: the code must never be stored plaintext');
        $this->assertSame(ActivationKey::hashKey($raw), $row['key_hash']);
    }

    /** CNT-003: the code is revealed once; every later read is masked. */
    public function test_the_raw_code_is_never_returned_again(): void
    {
        $raw = $this->issue()['code'];

        $list = $this->admin()->getJson("/api/admin/counters/{$this->counter->id}/activation-codes");
        $list->assertOk();

        $this->assertStringNotContainsString($raw, json_encode($list->json()));
        $this->assertNotEmpty($list->json('codes.0.key_prefix'));
        $this->assertStringContainsString('****', $list->json('codes.0.key_prefix'));
    }

    public function test_default_ttl_is_24_hours_and_the_owner_can_shorten_it(): void
    {
        $default = ActivationKey::findOrFail($this->issue()['activation_key_id']);
        $this->assertEqualsWithDelta(
            24 * 3600,
            $default->expires_at->getTimestamp() - $default->created_at->getTimestamp(),
            60
        );

        $short = ActivationKey::findOrFail($this->issue(['ttl_hours' => 1])['activation_key_id']);
        $this->assertEqualsWithDelta(3600, $short->expires_at->getTimestamp() - now()->getTimestamp(), 60);
    }

    /** CNT-003: single use is enforced even when max_devices says otherwise. */
    public function test_a_consumed_code_is_never_valid_again(): void
    {
        $key = ActivationKey::findOrFail($this->issue(['max_devices' => 5])['activation_key_id']);
        $this->assertTrue($key->isValid());

        $key->markConsumed('device-uuid-1');

        $fresh = $key->fresh();
        $this->assertFalse($fresh->isValid(), 'a code may bind exactly one device');
        $this->assertNotNull($fresh->consumed_at);
        $this->assertSame('device-uuid-1', $fresh->consumed_device_uuid);
    }

    public function test_expired_revoked_and_foreign_store_codes_are_not_valid(): void
    {
        $expired = ActivationKey::findOrFail($this->issue()['activation_key_id']);
        DB::table('activation_keys')->where('id', $expired->id)->update(['expires_at' => now()->subMinute()]);
        $this->assertFalse($expired->fresh()->isValid());

        $revoked = ActivationKey::findOrFail($this->issue()['activation_key_id']);
        $revoked->revoke('Owner cancelled');
        $this->assertFalse($revoked->fresh()->isValid());

        // IS2: a code issued in store A can never be redeemed in store B.
        $raw = $this->issue()['code'];
        $this->assertNull(ActivationKey::resolveForClaim($raw, $this->storeB->id));
        $this->assertNotNull(ActivationKey::resolveForClaim($raw, $this->storeA->id));
        $this->assertNull(ActivationKey::resolveForClaim('LAM-C01-DEADBEEFDEADBEEF-DEADBEEFDEADBEEF', $this->storeA->id));
    }

    /** CNT-004: the QR payload carries the same text that is typed, so both paths agree. */
    public function test_qr_payload_carries_the_exact_code(): void
    {
        $json = $this->issue();

        $this->assertSame($json['code'], $json['qr_payload']['code']);
        $this->assertSame($this->storeA->id, $json['qr_payload']['store_id']);
        $this->assertSame($this->counter->id, $json['qr_payload']['counter_id']);
    }

    public function test_only_an_unclaimed_counter_can_be_issued_a_code(): void
    {
        $this->counter->update(['status' => Counter::STATUS_ACTIVE]);

        $this->admin()
            ->postJson("/api/admin/counters/{$this->counter->id}/activation-code")
            ->assertStatus(422)
            ->assertJson(['error' => 'counter_not_unclaimed']);
    }

    public function test_no_plaintext_key_column_exists_on_activation_keys(): void
    {
        $this->assertFalse(Schema::hasColumn('activation_keys', 'key'));
        $this->assertFalse(Schema::hasColumn('activation_keys', 'raw_key'));
        $this->assertFalse(Schema::hasColumn('activation_keys', 'plain_key'));
    }
}
