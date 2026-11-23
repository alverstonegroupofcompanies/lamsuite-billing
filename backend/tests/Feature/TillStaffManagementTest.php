<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * CR 2026-11-19-counter-only-pos, A16b — the till's Staff panel used to call
 * /api/admin/users, which only answers for a person. With no sign-in at the POS
 * (B8b) those calls arrive carrying the counter's device token and nothing else,
 * so the counter has to open them the way A16a opened sales orders, loyalty and
 * the store profile — and it must not become a way to widen anyone's access.
 *
 * The terminal rules the panel already enforced stay enforced: the counter's own
 * store only, no Super Admin account created or promoted, no multi-branch grant,
 * and the audit trail names the counter instead of an email address that no
 * longer exists.
 */
class TillStaffManagementTest extends TestCase
{
    use RefreshDatabase;

    private Store $otherStore;
    private Store $store;
    private Counter $counter;
    private string $token;
    private User $owner;
    private User $cashier;
    private User $otherCashier;
    private User $headless;

    protected function setUp(): void
    {
        parent::setUp();

        $this->otherStore = Store::create([
            'name' => 'Other Branch',
            'code' => 'OTH',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->store = Store::create([
            'name' => 'Counter Store',
            'code' => 'CNT',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'till-staff-owner@test.in',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        $this->cashier = User::create([
            'name' => 'Own Cashier',
            'email' => 'own.cashier@test.in',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->otherCashier = User::create([
            'name' => 'Other Cashier',
            'email' => 'other.cashier@test.in',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->otherStore->id,
        ]);

        $this->headless = User::create([
            'name' => 'Head Office',
            'email' => 'headless@test.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => null,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Counter',
        ]);

        $issued = ActivationKey::generateForCounter($this->counter);
        $this->token = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => 'dev-till-staff',
        ])->assertOk()->json('device_token');
    }

    private function counterHeaders(): array
    {
        return ['X-Device-Token' => $this->token];
    }

    /** The next request in a test carries only what it puts in its own headers. */
    private function signOut(): void
    {
        $this->app['auth']->forgetGuards();
    }

    private function newStaff(string $email, array $extra = []): array
    {
        return array_merge([
            'name' => 'New Cashier',
            'email' => $email,
            'password' => 'password123',
            'role' => 'cashier',
        ], $extra);
    }

    public function test_the_counter_lists_only_its_own_store_staff(): void
    {
        $res = $this->withHeaders($this->counterHeaders())
            ->getJson('/api/till/staff')
            ->assertOk();

        $ids = array_column($res->json('data'), 'id');

        $this->assertContains($this->cashier->id, $ids);
        $this->assertNotContains($this->otherCashier->id, $ids);
        $this->assertNotContains($this->headless->id, $ids);

        foreach ($res->json('data') as $row) {
            $this->assertSame($this->store->id, (int) $row['store_id']);
            $this->assertArrayNotHasKey('pin_hash', $row);
            $this->assertArrayNotHasKey('password', $row);
        }
    }

    public function test_the_counter_creates_a_cashier_in_its_own_store(): void
    {
        $res = $this->withHeaders($this->counterHeaders())
            ->postJson('/api/till/staff', $this->newStaff('till-made@test.in', ['pin' => '246813']))
            ->assertStatus(201);

        $user = User::where('email', 'till-made@test.in')->firstOrFail();

        $this->assertSame($this->store->id, (int) $user->store_id);
        $this->assertNotSame('246813', $user->pin_hash);
        $this->assertStringNotContainsString('246813', $res->getContent());
    }

    public function test_a_body_naming_another_store_is_refused_before_any_account_exists(): void
    {
        // The device layer reads store_id from the body as part of the tenant
        // claim, so an attempt to place staff in another branch never reaches
        // the controller and nothing is written.
        $this->withHeaders($this->counterHeaders())
            ->postJson('/api/till/staff', $this->newStaff('grabbed@test.in', [
                'store_id' => $this->otherStore->id,
            ]))
            ->assertStatus(403);

        $this->assertNull(User::where('email', 'grabbed@test.in')->first());
        $this->assertSame($this->otherStore->id, (int) $this->otherCashier->fresh()->store_id);
    }

    public function test_the_counter_cannot_create_or_promote_a_super_admin(): void
    {
        $this->withHeaders($this->counterHeaders())
            ->postJson('/api/till/staff', $this->newStaff('tsar@test.in', ['role' => 'super_admin']))
            ->assertStatus(403);

        $this->withHeaders($this->counterHeaders())
            ->putJson("/api/till/staff/{$this->cashier->id}", ['role' => 'super_admin'])
            ->assertStatus(403);

        $this->assertNull(User::where('email', 'tsar@test.in')->first());
        $this->assertSame('cashier', $this->cashier->fresh()->role);
    }

    public function test_the_counter_cannot_grant_multi_branch_access(): void
    {
        $this->withHeaders($this->counterHeaders())
            ->postJson('/api/till/staff', $this->newStaff('wide@test.in', [
                'role' => 'manager',
                'allowed_store_ids' => [$this->otherStore->id],
            ]))
            ->assertStatus(422);

        $this->withHeaders($this->counterHeaders())
            ->putJson("/api/till/staff/{$this->cashier->id}", [
                'allowed_store_ids' => [$this->store->id, $this->otherStore->id],
            ])
            ->assertStatus(422);

        $this->assertNull(User::where('email', 'wide@test.in')->first());
        $this->assertEmpty($this->cashier->fresh()->allowed_store_ids);
    }

    public function test_staff_outside_the_counters_store_are_out_of_reach(): void
    {
        $this->withHeaders($this->counterHeaders())
            ->putJson("/api/till/staff/{$this->otherCashier->id}", ['name' => 'Renamed'])
            ->assertStatus(403);
        $this->withHeaders($this->counterHeaders())
            ->postJson("/api/till/staff/{$this->otherCashier->id}/unlock")
            ->assertStatus(403);
        $this->withHeaders($this->counterHeaders())
            ->postJson("/api/till/staff/{$this->otherCashier->id}/reset-pin", ['pin' => '246813'])
            ->assertStatus(403);
        $this->withHeaders($this->counterHeaders())
            ->deleteJson("/api/till/staff/{$this->otherCashier->id}")
            ->assertStatus(403);

        $this->assertSame('Other Cashier', $this->otherCashier->fresh()->name);
    }

    public function test_the_counter_unlocks_and_resets_the_pin_of_its_own_staff(): void
    {
        $this->cashier->update([
            'locked_until' => now()->addMinutes(15),
            'failed_login_attempts' => 5,
        ]);

        $res = $this->withHeaders($this->counterHeaders())
            ->postJson("/api/till/staff/{$this->cashier->id}/unlock")
            ->assertOk();

        $this->assertNull($res->json('user.locked_until'));
        $this->assertSame(0, (int) $res->json('user.failed_login_attempts'));

        $reset = $this->withHeaders($this->counterHeaders())
            ->postJson("/api/till/staff/{$this->cashier->id}/reset-pin", ['pin' => '246813'])
            ->assertOk()
            ->assertJsonMissingPath('user.pin_hash');

        $this->assertStringNotContainsString('246813', $reset->getContent());
        $this->assertTrue(Hash::check('246813', $this->cashier->fresh()->pin_hash));
    }

    public function test_a_persons_bearer_token_does_not_open_the_till_staff_uri(): void
    {
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/till/staff')->assertStatus(401);
        $this->postJson('/api/till/staff', $this->newStaff('nope@test.in'))->assertStatus(401);

        // The admin panel keeps its own door: nothing here moved the person route.
        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/admin/users')
            ->assertOk();
    }

    public function test_a_locked_counter_loses_staff_management_with_it(): void
    {
        Sanctum::actingAs($this->owner);
        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/counters/{$this->counter->id}/lock")
            ->assertOk();
        $this->signOut();

        $this->withHeaders($this->counterHeaders())
            ->getJson('/api/till/staff')
            ->assertStatus(403);
    }

    public function test_the_audit_trail_names_the_counter_and_carries_no_email_or_secret(): void
    {
        $this->withHeaders($this->counterHeaders())
            ->postJson("/api/till/staff/{$this->cashier->id}/reset-pin", ['pin' => '246813'])
            ->assertOk();
        $this->withHeaders($this->counterHeaders())
            ->postJson('/api/till/staff', $this->newStaff('audited@test.in'))
            ->assertStatus(201);
        $this->withHeaders($this->counterHeaders())
            ->putJson("/api/till/staff/{$this->cashier->id}", ['name' => 'Renamed By Counter'])
            ->assertOk();

        $created = AuditLog::where('action', 'create_user')->latest('id')->firstOrFail();
        $this->assertStringContainsString('C01', (string) $created->new_values['created_by']);
        $this->assertStringNotContainsString('@', (string) $created->new_values['created_by']);
        $this->assertSame($this->store->id, (int) $created->store_id);
        $this->assertNull($created->user_id);

        foreach (['reset_user_pin' => 'reset_by', 'update_user' => 'updated_by'] as $action => $key) {
            $log = AuditLog::where('action', $action)->latest('id')->firstOrFail();
            $actor = (string) $log->new_values[$key];
            $this->assertStringContainsString('C01', $actor);
            $this->assertStringNotContainsString('@', $actor);
            $this->assertStringNotContainsString($this->token, json_encode($log->new_values));
        }

        $pinLog = AuditLog::where('action', 'reset_user_pin')->latest('id')->firstOrFail();
        $this->assertStringNotContainsString('246813', json_encode($pinLog->new_values));
    }
}
