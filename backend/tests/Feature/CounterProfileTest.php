<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Store;
use App\Models\User;
use App\Support\Counter\CounterProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PRF-001 / PRF-008 (the half B8b needs) — one canonical, versioned permission
 * document per counter, and the till's boot path reads that document.
 *
 * The profile replaces the signed-in person's role: whoever stands at a claimed
 * counter works inside the owner's document. Templates, copy-from-counter and the
 * live propagation budget stay with the rest of Wave B.
 */
class CounterProfileTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'LamStone Profile Store',
            'code' => 'PRF01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'profile-owner@test.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    private function makeCounter(string $code = 'C01', array $attrs = []): Counter
    {
        return Counter::create(array_merge([
            'store_id' => $this->store->id,
            'counter_code' => $code,
            'counter_name' => "{$code} Counter",
        ], $attrs));
    }

    /** CNT-006: the claim is the first moment a counter owns a profile. */
    private function claim(Counter $counter, string $uuid): array
    {
        $issued = ActivationKey::generateForCounter($counter);

        return $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => $uuid,
        ])->assertOk()->json();
    }

    private function context(string $token): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api/counter/context', ['X-Device-Token' => $token]);
    }

    public function test_the_canonical_document_names_one_key_per_control(): void
    {
        $document = CounterProfile::defaults();

        // PRF-001: every control the requirement names has a documented key.
        foreach ([
            'version', 'modules', 'screens', 'cash_drawer', 'discount', 'price_override',
            'sell_beyond_stock', 'edits', 'cancellations', 'returns', 'purchase_entry',
            'stock_adjustments', 'transfers', 'reports', 'settings_editable', 'printers',
            'payment_modes_allowed', 'salesperson', 'approval_methods',
        ] as $key) {
            $this->assertArrayHasKey($key, $document, "the canonical profile must carry {$key}");
        }

        $this->assertSame(CounterProfile::VERSION, $document['version']);
        $this->assertEqualsCanonicalizing(CounterProfile::MODULES, $document['modules']);

        // The module ids are the store's menu ids (CFG-002): the ceiling and the
        // profile are intersected, so they have to speak one vocabulary.
        foreach (CounterProfile::MODULES as $module) {
            $this->assertMatchesRegularExpression('/^[a-z][a-z_]*$/', $module);
        }
    }

    public function test_a_claimed_counter_carries_the_canonical_document_from_the_claim_onward(): void
    {
        $counter = $this->makeCounter('C01');

        $claim = $this->claim($counter, 'dev-profile-1');

        $this->assertEqualsCanonicalizing(
            array_keys(CounterProfile::defaults()),
            array_keys($claim['profile']['permissions'] ?? [])
        );
        $this->assertSame(CounterProfile::VERSION, $claim['profile']['version']);

        $counter->refresh();
        $this->assertSame(CounterProfile::VERSION, (int) $counter->permission_profile_version);
        $this->assertSame(CounterProfile::normalize(null), $counter->permission_profile);

        $res = $this->context($claim['device_token'])->assertOk();
        $this->assertSame($counter->permission_profile, $res->json('profile.permissions'));
        $this->assertSame(CounterProfile::VERSION, $res->json('profile.version'));
    }

    public function test_a_partial_document_reads_complete(): void
    {
        $counter = $this->makeCounter('C02');
        $counter->update([
            'permission_profile' => ['modules' => ['pos', 'bills'], 'discount' => ['max_pct' => 5]],
            'permission_profile_version' => 7,
        ]);

        $issued = ActivationKey::generateForCounter($counter);
        $claim = $this->claim($counter, 'dev-profile-2');

        $permissions = $this->context($claim['device_token'])->assertOk()->json('profile.permissions');

        $this->assertSame(['pos', 'bills'], $permissions['modules'], 'the owner keeps what they set');
        $this->assertSame(5, $permissions['discount']['max_pct']);
        $this->assertSame(
            CounterProfile::defaults()['price_override'],
            $permissions['price_override'],
            'what the owner never set reads as the documented default, not as nothing'
        );
        $this->assertSame(7, $this->context($claim['device_token'])->json('profile.version'));

        // Reading is not editing: a partial row stays partial until it is saved.
        $this->assertSame(['modules' => ['pos', 'bills'], 'discount' => ['max_pct' => 5]], $counter->fresh()->permission_profile);
    }

    public function test_the_legacy_role_flags_survive_as_profile_keys(): void
    {
        $counter = $this->makeCounter('C03', [
            'role_profile' => [
                'allow_cancel' => false,
                'allow_price_change' => false,
                'allow_stock_adj' => false,
                'require_manager_pin' => true,
            ],
            'visible_menus' => ['pos', 'bills', 'not_a_module'],
        ]);

        $permissions = $this->claim($counter, 'dev-profile-3')['profile']['permissions'];

        $this->assertFalse($permissions['cancellations']['allowed']);
        $this->assertFalse($permissions['price_override']['allowed']);
        $this->assertFalse($permissions['stock_adjustments']['allowed']);
        $this->assertTrue($permissions['cancellations']['approval_required']);
        $this->assertSame(['pos', 'bills'], $permissions['modules'], 'an unknown legacy id grants nothing');
    }

    public function test_the_owner_narrows_a_profile_and_the_counter_sees_the_new_version(): void
    {
        $counter = $this->makeCounter('C04');
        $claim = $this->claim($counter, 'dev-profile-4');

        $profile = CounterProfile::defaults();
        $profile['modules'] = ['dashboard', 'pos', 'bills'];
        $profile['discount'] = ['max_pct' => 10, 'approval_pct' => null, 'max_amount' => 250];
        $profile['purchase_entry'] = false;

        $res = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/counters/{$counter->id}/profile", ['profile' => $profile])
            ->assertOk();

        $this->assertSame(CounterProfile::VERSION + 1, $res->json('profile.version'));
        $this->assertSame(['dashboard', 'pos', 'bills'], $res->json('profile.permissions.modules'));

        $context = $this->context($claim['device_token'])->assertOk();
        $this->assertSame(['dashboard', 'pos', 'bills'], $context->json('profile.permissions.modules'));
        $this->assertSame(CounterProfile::VERSION + 1, $context->json('profile.version'));
        $this->assertFalse($context->json('profile.permissions.purchase_entry'));

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'counter_profile_updated',
            'entity_type' => 'Counter',
            'entity_id' => (string) $counter->id,
            'store_id' => $this->store->id,
            'user_id' => $this->owner->id,
        ]);

        // PRF-008: the audit row says what changed, not a re-read of the row.
        $audit = \App\Models\AuditLog::where('action', 'counter_profile_updated')
            ->where('entity_id', (string) $counter->id)
            ->latest('id')
            ->firstOrFail();

        $this->assertArrayHasKey('modules', (array) $audit->old_values);
        $this->assertArrayHasKey('modules', (array) $audit->new_values);
        $this->assertSame(CounterProfile::VERSION, (int) $audit->old_values['version']);
        $this->assertSame(CounterProfile::VERSION + 1, (int) $audit->new_values['version']);

        // The owner can read the same document back.
        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson("/api/admin/counters/{$counter->id}/profile")
            ->assertOk()
            ->assertJsonPath('profile.version', CounterProfile::VERSION + 1);
    }

    public function test_an_unknown_control_key_is_refused_not_ignored(): void
    {
        $counter = $this->makeCounter('C05');

        $profile = CounterProfile::defaults();
        $profile['modulez'] = ['pos'];

        $res = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/counters/{$counter->id}/profile", ['profile' => $profile])
            ->assertStatus(422);

        $this->assertStringContainsString('modulez', json_encode($res->json()));

        $this->assertDatabaseMissing('audit_logs', ['action' => 'counter_profile_updated', 'entity_id' => (string) $counter->id]);
    }

    public function test_a_module_the_till_has_no_screen_for_grants_nothing(): void
    {
        $counter = $this->makeCounter('C06');

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/counters/{$counter->id}/profile", [
                'profile' => ['modules' => ['pos', 'warehouse']],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('profile.modules');
    }

    public function test_a_profile_never_carries_a_credential(): void
    {
        $document = CounterProfile::normalize([
            'modules' => ['pos'],
            'unlock_pin_hash' => '$2y$10$notreal',
            'discount' => ['max_pct' => 5, 'pin' => '1234'],
        ]);

        $raw = json_encode($document);

        foreach (['pin', 'password', 'token', 'hash', 'secret'] as $secret) {
            $this->assertStringNotContainsString($secret, strtolower($raw), "IS5: {$secret} has no place in a permission profile");
        }

        $this->assertArrayNotHasKey('unlock_pin_hash', $document);
        $this->assertSame(5, $document['discount']['max_pct'], 'a documented key keeps what the owner set');
        $this->assertArrayNotHasKey('pin', $document['discount']);
    }

    public function test_a_profile_of_another_stores_counter_is_not_reachable(): void
    {
        $elsewhere = Store::create([
            'name' => 'LamStone Elsewhere', 'code' => 'PRF02', 'state_code' => '34', 'is_active' => true,
        ]);
        $theirs = $this->makeCounter('C07');
        $theirs->update(['store_id' => $elsewhere->id]);

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson("/api/admin/counters/{$theirs->id}/profile")
            ->assertNotFound();

        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/counters/{$theirs->id}/profile", ['profile' => ['modules' => ['pos']]])
            ->assertNotFound();
    }

    public function test_a_profile_needs_an_admin_and_not_a_till(): void
    {
        $counter = $this->makeCounter('C08');
        $claim = $this->claim($counter, 'dev-profile-8');

        // The device token is not an owner credential: it reads its own profile
        // through the context and never writes one.
        $this->withHeaders(['X-Device-Token' => $claim['device_token']])
            ->putJson("/api/admin/counters/{$counter->id}/profile", ['profile' => ['modules' => ['pos']]])
            ->assertStatus(401);
    }
}
