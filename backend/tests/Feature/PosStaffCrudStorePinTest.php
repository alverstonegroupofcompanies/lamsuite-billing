<?php

namespace Tests\Feature;

use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The POS terminal shares /api/admin/users with the admin panel, so tenant
 * limits live in the Sanctum token name: staff_session_token callers may only
 * create and manage accounts inside the branch they are signed in to.
 */
class PosStaffCrudStorePinTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $manager;
    private User $localStaff;
    private User $remoteStaff;
    private User $globalAccount;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Pinned Store',
            'code' => 'PIN-01',
            'is_active' => true,
        ]);

        $this->otherStore = Store::create([
            'name' => 'Other Store',
            'code' => 'PIN-02',
            'is_active' => true,
        ]);

        $this->manager = User::create([
            'name' => 'Branch Manager',
            'email' => 'manager@pin.test',
            'username' => 'pin_manager',
            'password' => Hash::make('manager123'),
            'role' => 'manager',
            'store_id' => $this->store->id,
            'permissions' => ['*'],
        ]);

        $this->localStaff = User::create([
            'name' => 'Local Cashier',
            'email' => 'local@pin.test',
            'username' => 'pin_local',
            'password' => Hash::make('local12345'),
            'pin_hash' => Hash::make('1111'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->remoteStaff = User::create([
            'name' => 'Remote Cashier',
            'email' => 'remote@pin.test',
            'username' => 'pin_remote',
            'password' => Hash::make('remote1234'),
            'pin_hash' => Hash::make('2222'),
            'role' => 'cashier',
            'store_id' => $this->otherStore->id,
            'failed_login_attempts' => 5,
            'locked_until' => now()->addMinute(30),
        ]);

        $this->globalAccount = User::create([
            'name' => 'Global Admin',
            'email' => 'global@pin.test',
            'username' => 'pin_global',
            'password' => Hash::make('global1234'),
            'role' => 'admin',
            'store_id' => null,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'super@pin.test',
            'username' => 'pin_super',
            'password' => Hash::make('super12345'),
            'role' => 'super_admin',
            'store_id' => null,
            'permissions' => ['*'],
        ]);
    }

    private function headers(User $user, string $tokenName): array
    {
        return ['Authorization' => 'Bearer ' . $user->createToken($tokenName)->plainTextToken];
    }

    private function terminal(): array
    {
        return $this->headers($this->manager, 'staff_session_token');
    }

    private function panel(?User $user = null): array
    {
        return $this->headers($user ?? $this->manager, 'admin_panel_token');
    }

    public function test_terminal_creates_staff_in_its_signed_in_store_without_store_id(): void
    {
        $res = $this->withHeaders($this->terminal())->postJson('/api/admin/users', [
            'name' => 'New Cashier',
            'email' => 'new@pin.test',
            'username' => 'pin_new',
            'password' => 'password123',
            'role' => 'cashier',
        ]);

        $res->assertStatus(201);
        $this->assertSame($this->store->id, $res->json('store_id'));
        $this->assertSame($this->store->id, User::where('email', 'new@pin.test')->value('store_id'));
    }

    public function test_terminal_rejects_a_store_id_that_is_not_its_own(): void
    {
        $res = $this->withHeaders($this->terminal())->postJson('/api/admin/users', [
            'name' => 'Elsewhere',
            'email' => 'elsewhere@pin.test',
            'username' => 'pin_elsewhere',
            'password' => 'password123',
            'role' => 'cashier',
            'store_id' => $this->otherStore->id,
        ]);

        // ScopeStore rejects the payload's foreign store id before the controller runs.
        $res->assertStatus(403);
        $this->assertFalse(User::where('email', 'elsewhere@pin.test')->exists());
    }

    public function test_terminal_cannot_grant_multi_branch_access(): void
    {
        $res = $this->withHeaders($this->terminal())->postJson('/api/admin/users', [
            'name' => 'Multi Branch',
            'email' => 'multi@pin.test',
            'username' => 'pin_multi',
            'password' => 'password123',
            'role' => 'cashier',
            'allowed_store_ids' => [$this->store->id],
        ]);

        $res->assertStatus(422);
        $this->assertFalse(User::where('email', 'multi@pin.test')->exists());
    }

    public function test_terminal_cannot_reassign_local_staff_to_another_store_or_make_it_global(): void
    {
        $res = $this->withHeaders($this->terminal())->putJson("/api/admin/users/{$this->localStaff->id}", [
            'store_id' => $this->otherStore->id,
        ]);
        $res->assertStatus(403);
        $this->assertSame($this->store->id, $this->localStaff->fresh()->store_id);

        $globalize = $this->withHeaders($this->terminal())->putJson("/api/admin/users/{$this->localStaff->id}", [
            'store_id' => null,
        ]);
        $globalize->assertStatus(200);
        $this->assertSame($this->store->id, $this->localStaff->fresh()->store_id);
    }

    public function test_terminal_cannot_edit_unlock_reset_pin_or_delete_accounts_outside_its_store(): void
    {
        $edit = $this->withHeaders($this->terminal())
            ->putJson("/api/admin/users/{$this->remoteStaff->id}", ['name' => 'Hijacked']);
        $edit->assertStatus(403);
        $this->assertSame('Remote Cashier', $this->remoteStaff->fresh()->name);

        $unlock = $this->withHeaders($this->terminal())
            ->postJson("/api/admin/users/{$this->remoteStaff->id}/unlock");
        $unlock->assertStatus(403);
        $this->assertNotNull($this->remoteStaff->fresh()->locked_until);

        $resetPin = $this->withHeaders($this->terminal())
            ->postJson("/api/admin/users/{$this->remoteStaff->id}/reset-pin", ['pin' => '9999']);
        $resetPin->assertStatus(403);
        $this->assertTrue(Hash::check('2222', $this->remoteStaff->fresh()->pin_hash));

        $forceLogout = $this->withHeaders($this->terminal())
            ->postJson("/api/admin/users/{$this->remoteStaff->id}/force-logout");
        $forceLogout->assertStatus(403);

        $delete = $this->withHeaders($this->terminal())
            ->deleteJson("/api/admin/users/{$this->remoteStaff->id}");
        $delete->assertStatus(403);
        $this->assertTrue($this->remoteStaff->exists());
    }

    public function test_terminal_cannot_touch_global_accounts(): void
    {
        $res = $this->withHeaders($this->terminal())
            ->putJson("/api/admin/users/{$this->globalAccount->id}", ['name' => 'Rewritten']);

        $res->assertStatus(403);
        $this->assertSame('Global Admin', $this->globalAccount->fresh()->name);
    }

    public function test_terminal_edits_and_deletes_its_own_staff(): void
    {
        $edit = $this->withHeaders($this->terminal())
            ->putJson("/api/admin/users/{$this->localStaff->id}", ['name' => 'Renamed Cashier']);
        $edit->assertStatus(200);
        $this->assertSame('Renamed Cashier', $this->localStaff->fresh()->name);
        $this->assertSame($this->store->id, $this->localStaff->fresh()->store_id);

        $delete = $this->withHeaders($this->terminal())
            ->deleteJson("/api/admin/users/{$this->localStaff->id}");
        $delete->assertStatus(200);
        $this->assertFalse(User::where('email', 'local@pin.test')->exists());
    }

    public function test_unregistered_terminal_cannot_manage_staff(): void
    {
        $homeless = User::create([
            'name' => 'Roaming Manager',
            'email' => 'roam@pin.test',
            'username' => 'pin_roam',
            'password' => Hash::make('manager123'),
            'role' => 'manager',
            'store_id' => null,
            'permissions' => ['*'],
        ]);

        $res = $this->withHeaders($this->headers($homeless, 'staff_session_token'))->postJson('/api/admin/users', [
            'name' => 'Nobody',
            'email' => 'nobody@pin.test',
            'username' => 'pin_nobody',
            'password' => 'password123',
            'role' => 'cashier',
        ]);

        $res->assertStatus(422);
        $this->assertFalse(User::where('email', 'nobody@pin.test')->exists());
    }

    public function test_admin_panel_token_still_grants_multi_branch_and_store_changes(): void
    {
        $res = $this->withHeaders($this->panel($this->superAdmin))->putJson("/api/admin/users/{$this->localStaff->id}", [
            'store_id' => $this->otherStore->id,
            'allowed_store_ids' => [$this->store->id, $this->otherStore->id],
        ]);

        $res->assertStatus(200);
        $fresh = $this->localStaff->fresh();
        $this->assertSame($this->otherStore->id, (int) $fresh->store_id);
        $this->assertEqualsCanonicalizing(
            [$this->store->id, $this->otherStore->id],
            array_map('intval', $fresh->allowed_store_ids)
        );
    }

    public function test_panel_caller_cannot_grant_branches_outside_its_own_scope(): void
    {
        $create = $this->withHeaders($this->panel())->postJson('/api/admin/users', [
            'name' => 'Escalated',
            'email' => 'escalated@pin.test',
            'username' => 'pin_escalated',
            'password' => 'password123',
            'role' => 'manager',
            'store_id' => $this->store->id,
            'allowed_store_ids' => [$this->store->id, $this->otherStore->id],
        ]);

        $create->assertStatus(403);
        $this->assertFalse(User::where('email', 'escalated@pin.test')->exists());

        $update = $this->withHeaders($this->panel())
            ->putJson("/api/admin/users/{$this->localStaff->id}", [
                'allowed_store_ids' => [$this->otherStore->id],
            ]);

        $update->assertStatus(403);
        $this->assertEmpty($this->localStaff->fresh()->allowed_store_ids);
    }

    public function test_panel_caller_can_grant_branches_it_can_reach(): void
    {
        $multi = User::create([
            'name' => 'Area Manager',
            'email' => 'area@pin.test',
            'username' => 'pin_area',
            'password' => Hash::make('manager123'),
            'role' => 'manager',
            'store_id' => $this->store->id,
            'allowed_store_ids' => [$this->otherStore->id],
            'permissions' => ['*'],
        ]);

        $res = $this->withHeaders($this->panel($multi))->putJson("/api/admin/users/{$this->localStaff->id}", [
            'allowed_store_ids' => [$this->store->id, $this->otherStore->id],
        ]);

        $res->assertStatus(200);
        $this->assertCount(2, $this->localStaff->fresh()->allowed_store_ids);
    }

    /**
     * APR-001 / Q6: an approver is a flagged person, not a role. The panel
     * decides the flag; the counter that shares this route may not — it can
     * manage its staff without minting someone who can overrule its ceiling.
     */
    public function test_only_the_panel_flags_who_may_approve(): void
    {
        $created = $this->withHeaders($this->panel())->postJson('/api/admin/users', [
            'name' => 'Floor Approver',
            'email' => 'approver@pin.test',
            'username' => 'pin_approver',
            'password' => 'password123',
            'pin' => '864213',
            'role' => 'manager',
            'is_approver' => true,
        ]);

        $created->assertStatus(201);
        $this->assertTrue((bool) $created->json('is_approver'));
        $this->assertTrue((bool) User::where('email', 'approver@pin.test')->value('is_approver'));

        // The guard caches the principal it resolved for the first call in a
        // test, so each request has to be authenticated as itself again.
        $this->app['auth']->forgetGuards();

        $target = User::where('email', 'approver@pin.test')->firstOrFail();
        $this->withHeaders($this->panel())->putJson("/api/admin/users/{$target->id}", [
            'is_approver' => false,
        ])->assertStatus(200);
        $this->assertFalse((bool) $target->fresh()->is_approver);

        $this->app['auth']->forgetGuards();

        // The terminal's create ignores the flag instead of honouring it.
        $terminalMade = $this->withHeaders($this->terminal())->postJson('/api/admin/users', [
            'name' => 'Counter Approver',
            'email' => 'counter-approver@pin.test',
            'username' => 'pin_counter_approver',
            'password' => 'password123',
            'role' => 'manager',
            'is_approver' => true,
        ]);

        $terminalMade->assertStatus(201);
        $this->assertFalse((bool) $terminalMade->json('is_approver'));
    }
}
