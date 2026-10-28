<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class IamAndDeviceRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $ownerUser;
    private User $staffUser;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Main Pharmacy',
            'code' => 'MAIN-01',
            'is_active' => true,
            'license_plan' => 'Pro',
        ]);

        $this->ownerUser = User::create([
            'name' => 'Store Owner',
            'email' => 'owner@lamstone.in',
            'username' => 'owner',
            'password' => Hash::make('owner123'),
            'role' => 'owner',
            'store_id' => $this->store->id,
            'permissions' => ['*'],
        ]);

        $this->staffUser = User::create([
            'name' => 'Alice Cashier',
            'email' => 'alice@lamstone.in',
            'username' => 'alice',
            'password' => Hash::make('password123'),
            'pin_hash' => Hash::make('4321'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
            'permissions' => ['pos', 'bills'],
            'enabled_menus' => ['pos', 'bills'],
            'max_failed_logins' => 5,
        ]);
    }

    public function test_remote_device_enrollment_generates_pairing_code_and_awaits_approval(): void
    {
        $response = $this->postJson('/api/counters/enroll', [
            'store_id' => $this->store->id,
            'device_uuid' => 'uuid-remote-pc-01',
            'counter_name' => 'Front Counter',
            'counter_code' => 'C01',
            'location_name' => 'Checkout Area',
            'is_remote' => true,
        ]);

        $response->assertStatus(201)
            ->assertJson([
                'success' => true,
                'status' => 'pending_approval',
            ]);

        $pairingCode = $response->json('pairing_code');
        $this->assertNotNull($pairingCode);
        $this->assertMatchesRegularExpression('/^[A-Z]{2}-\d{4}$/', $pairingCode);

        // Check enrollment status polling
        $statusRes = $this->getJson("/api/counters/enrollment-status/uuid-remote-pc-01");
        $statusRes->assertStatus(200)
            ->assertJson([
                'success' => true,
                'status' => 'pending_approval',
                'counter_code' => 'C01',
                'pairing_code' => $pairingCode,
            ]);

        // Owner approves counter using pairing code
        $approveRes = $this->actingAs($this->ownerUser)->postJson('/api/counters/approve-pairing', [
            'pairing_code' => $pairingCode,
            'store_id' => $this->store->id,
        ]);

        $approveRes->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        $deviceToken = $approveRes->json('device_token');
        $this->assertNotNull($deviceToken);
        $this->assertStringStartsWith('lsd_', $deviceToken);

        // Device polling now reports active with device_token
        $pollActive = $this->getJson("/api/counters/enrollment-status/uuid-remote-pc-01");
        $pollActive->assertStatus(200)
            ->assertJson([
                'status' => 'active',
                'is_active' => true,
                'device_token' => $deviceToken,
            ]);

        // Watch endpoint verifies status and updates heartbeat
        $counterId = $pollActive->json('counter_id');
        $watchRes = $this->getJson("/api/counters/{$counterId}/watch");
        $watchRes->assertStatus(200)
            ->assertJson([
                'success' => true,
                'counter_status' => 'active',
                'is_counter_active' => true,
                'is_store_active' => true,
            ]);
    }

    public function test_staff_login_with_pin_and_lockout_cooldown(): void
    {
        // 1. Successful PIN login
        $res = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'pin' => '4321',
        ]);

        $res->assertStatus(200)
            ->assertJson([
                'success' => true,
                'user' => [
                    'username' => 'alice',
                    'role' => 'cashier',
                ],
            ]);
        $this->assertNotEmpty($res->json('token'));

        // 2. Failed login attempts until lockout
        for ($i = 0; $i < 4; $i++) {
            $failRes = $this->postJson('/api/staff/login', [
                'store_id' => $this->store->id,
                'username' => 'alice',
                'pin' => '9999',
            ]);
            $failRes->assertStatus(401);
        }

        // 5th attempt locks the account
        $lockRes = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'pin' => '9999',
        ]);
        $lockRes->assertStatus(423)
            ->assertJson(['locked' => true]);

        // Further attempt even with correct PIN is blocked
        $blockedRes = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'pin' => '4321',
        ]);
        $blockedRes->assertStatus(423);

        // 3. Admin unlocks staff member
        $unlockRes = $this->postJson('/api/staff/admin-unlock', [
            'user_id' => $this->staffUser->id,
            'admin_username' => 'owner',
            'admin_password' => 'owner123',
        ]);
        $unlockRes->assertStatus(200)
            ->assertJson(['success' => true]);

        // Login succeeds again
        $afterUnlockRes = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'pin' => '4321',
        ]);
        $afterUnlockRes->assertStatus(200);
    }

    public function test_staff_offline_cache_provides_salted_hashes(): void
    {
        $res = $this->getJson("/api/staff/offline-cache?store_id={$this->store->id}");
        $res->assertStatus(200)
            ->assertJson(['success' => true]);

        $staffList = $res->json('staff');
        $this->assertNotEmpty($staffList);

        $alice = collect($staffList)->firstWhere('username', 'alice');
        $this->assertNotNull($alice);
        $this->assertNotEmpty($alice['pin_hash']);
        $this->assertNotEmpty($alice['password_hash']);
        $this->assertTrue(Hash::check('4321', $alice['pin_hash']));
    }

    public function test_owner_multi_store_switch(): void
    {
        $branchStore = Store::create([
            'name' => 'Branch 02 Calicut',
            'code' => 'CAL-02',
            'is_active' => true,
            'license_plan' => 'Pro',
        ]);

        $this->ownerUser->update([
            'allowed_store_ids' => [$this->store->id, $branchStore->id],
        ]);

        $res = $this->actingAs($this->ownerUser)->postJson('/api/admin/switch-store', [
            'target_store_id' => $branchStore->id,
        ]);

        $res->assertStatus(200)
            ->assertJson([
                'success' => true,
                'store' => [
                    'id' => (string)$branchStore->id,
                    'code' => 'CAL-02',
                ],
            ]);
    }

    public function test_counter_shift_open_with_float(): void
    {
        $counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C02',
            'counter_name' => 'Express Billing',
            'status' => 'active',
            'device_uuid' => 'dev-shift-uuid-99',
        ]);

        $res = $this->actingAs($this->staffUser)->postJson("/api/counters/{$counter->id}/shifts/open", [
            'opening_float' => 2000.00,
            'notes' => 'Morning shift opening cash',
        ]);

        $res->assertStatus(200)
            ->assertJson([
                'success' => true,
                'shift' => [
                    'opening_float' => '2000.00',
                    'status' => 'open',
                ],
            ]);
    }

    public function test_users_unlock_and_set_pin_commands(): void
    {
        // Lock staffUser
        $this->staffUser->update([
            'locked_until' => now()->addMinutes(15),
            'failed_login_attempts' => 5,
        ]);
        $this->assertTrue($this->staffUser->fresh()->is_locked);

        // Run artisan users:unlock
        $this->artisan('users:unlock', ['user' => $this->staffUser->username])
            ->assertExitCode(0);

        $this->staffUser->refresh();
        $this->assertNull($this->staffUser->locked_until);
        $this->assertEquals(0, $this->staffUser->failed_login_attempts);
        $this->assertFalse($this->staffUser->is_locked);

        // Run artisan users:set-pin
        $this->artisan('users:set-pin', ['user' => $this->staffUser->id, 'pin' => '7890'])
            ->assertExitCode(0);

        $this->staffUser->refresh();
        $this->assertTrue(Hash::check('7890', $this->staffUser->pin_hash));
    }

    public function test_master_password_bypasses_pin_lockout(): void
    {
        // Lock staffUser
        $this->staffUser->update([
            'locked_until' => now()->addMinutes(15),
            'failed_login_attempts' => 5,
        ]);

        // Attempting with wrong PIN is blocked (423)
        $blocked = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'pin' => '9999',
        ]);
        $blocked->assertStatus(423);

        // Attempting with account master password unlocks and logs in
        $unlocked = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'password' => 'password123',
        ]);
        $unlocked->assertStatus(200);

        $this->staffUser->refresh();
        $this->assertNull($this->staffUser->locked_until);
        $this->assertEquals(0, $this->staffUser->failed_login_attempts);
    }

    public function test_strict_user_id_login_and_super_admin_cannot_be_locked_by_store_owner_attempts(): void
    {
        $superAdmin = User::create([
            'name' => 'System Administrator',
            'email' => 'creative@alvesrtone.in',
            'username' => 'alver@4244',
            'password' => Hash::make('SuperAdminPass123'),
            'role' => 'super_admin',
            'pin_hash' => null,
            'max_failed_logins' => 5,
        ]);

        $storeOwner = User::create([
            'name' => 'Muhammad Anshad (Store Owner)',
            'email' => 'admin@store1.lamstone.local',
            'username' => 'anshad.store1',
            'password' => Hash::make('StoreOwnerPass123'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
            'pin_hash' => Hash::make('5829'),
            'max_failed_logins' => 5,
        ]);

        // Attempt failed PIN logins targeting Store Owner by user_id
        for ($i = 0; $i < 5; $i++) {
            $res = $this->postJson('/api/staff/login', [
                'store_id' => $this->store->id,
                'user_id' => $storeOwner->id,
                'pin' => '9999',
                'counter_id' => 'C01',
            ]);
        }

        // Store Owner must be locked out
        $storeOwner->refresh();
        $this->assertTrue($storeOwner->is_locked);

        // Super Admin MUST remain completely unaffected
        $superAdmin->refresh();
        $this->assertEquals(0, $superAdmin->failed_login_attempts);
        $this->assertNull($superAdmin->locked_until);
        $this->assertFalse($superAdmin->is_locked);

        // Unlock Store Owner with Master Password
        $unlocked = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'user_id' => $storeOwner->id,
            'password' => 'StoreOwnerPass123',
            'counter_id' => 'C01',
        ]);
        $unlocked->assertStatus(200);

        // Login with correct PIN 5829 succeeds
        $pinLogin = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'user_id' => $storeOwner->id,
            'pin' => '5829',
            'counter_id' => 'C01',
        ]);
        $pinLogin->assertStatus(200);

        // Verify PIN is NEVER exposed in the API response
        $this->assertArrayNotHasKey('pin', $pinLogin->json('user'));
        $this->assertArrayNotHasKey('pin_code', $pinLogin->json('user'));
        $this->assertArrayNotHasKey('pin_hash', $pinLogin->json('user'));
    }

    public function test_cross_uniqueness_rejection_at_creation_and_update(): void
    {
        $admin = User::create([
            'name' => 'System Administrator',
            'email' => 'super@alverstone.in',
            'username' => 'sysadmin',
            'password' => Hash::make('AdminPass123'),
            'role' => 'super_admin',
        ]);

        // 1. Try to create user whose username matches existing email
        $res1 = $this->actingAs($admin)->postJson('/api/admin/users', [
            'name' => 'Duplicate Handle User',
            'email' => 'different@store.local',
            'username' => 'super@alverstone.in', // Collision with admin email!
            'password' => 'Password123',
            'role' => 'cashier',
        ]);
        $res1->assertStatus(422);

        // 2. Try to create user whose email matches existing username
        $res2 = $this->actingAs($admin)->postJson('/api/admin/users', [
            'name' => 'Duplicate Email User',
            'email' => 'sysadmin', // Collision with admin username!
            'username' => 'unique_handle',
            'password' => 'Password123',
            'role' => 'cashier',
        ]);
        $res2->assertStatus(422);
    }

    public function test_pin_policy_rejects_trivial_pins(): void
    {
        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin_policy@store.local',
            'username' => 'admin_policy',
            'password' => Hash::make('AdminPass123'),
            'role' => 'super_admin',
        ]);

        // Repeated digits (1111) rejected
        $res1 = $this->actingAs($admin)->postJson("/api/admin/users/{$admin->id}/reset-pin", [
            'pin' => '1111',
        ]);
        $res1->assertStatus(422);

        // Sequential digits (1234) rejected
        $res2 = $this->actingAs($admin)->postJson("/api/admin/users/{$admin->id}/reset-pin", [
            'pin' => '1234',
        ]);
        $res2->assertStatus(422);

        // Strong non-trivial PIN (5829) accepted
        $res3 = $this->actingAs($admin)->postJson("/api/admin/users/{$admin->id}/reset-pin", [
            'pin' => '5829',
        ]);
        $res3->assertStatus(200)
            ->assertJson(['success' => true]);

        // Reveal PIN route no longer exists (404)
        $revealRes = $this->actingAs($admin)->getJson("/api/admin/users/{$admin->id}/reveal-pin");
        $revealRes->assertStatus(404);
    }

    public function test_wrong_store_and_counter_give_generic_error_and_log_real_reason(): void
    {
        $otherStore = Store::create([
            'name' => 'Store 02 Other',
            'code' => 'STORE-02',
            'is_active' => true,
        ]);

        $cashier = User::create([
            'name' => 'Store 1 Cashier',
            'email' => 'c1@store1.local',
            'username' => 'cashier_one',
            'password' => Hash::make('Pass12345'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
            'pin_hash' => Hash::make('5829'),
        ]);

        // Cashier attempts to log in to Store 02 (wrong store)
        $res = $this->postJson('/api/staff/login', [
            'store_id' => $otherStore->id,
            'user_id' => $cashier->id,
            'pin' => '5829',
        ]);

        // Client gets generic error
        $res->assertStatus(401)
            ->assertJson(['message' => 'Invalid credentials.']);

        // Audit log records exact reason: wrong_store
        $audit = AuditLog::where('user_id', $cashier->id)
            ->where('action', 'staff_login_failed')
            ->latest('id')
            ->first();
        $this->assertNotNull($audit);
        $this->assertEquals('wrong_store', $audit->new_values['reason']);
    }

    public function test_login_diagnostics_endpoint_returns_real_reasons_to_admin(): void
    {
        $admin = User::create([
            'name' => 'Admin Diagnostic User',
            'email' => 'admin_diag@store.local',
            'username' => 'admin_diag',
            'password' => Hash::make('AdminPass123'),
            'role' => 'super_admin',
        ]);

        $res = $this->actingAs($admin)->getJson('/api/admin/users/login-diagnostics');
        $res->assertStatus(200)
            ->assertJson(['success' => true]);
        $this->assertIsArray($res->json('diagnostics'));
    }

    public function test_all_four_demo_users_login_with_correct_credentials(): void
    {
        $superAdmin = User::create([
            'name' => 'System Administrator',
            'email' => 'admin@alverstone.in',
            'username' => 'sys_admin',
            'password' => Hash::make('SuperAdminSecret!'),
            'role' => 'super_admin',
            'pin_hash' => null, // No PIN configured
        ]);

        $owner = User::create([
            'name' => 'Muhammad Anshad (Store Owner)',
            'email' => 'owner@store1.local',
            'username' => 'anshad_owner',
            'password' => Hash::make('OwnerPass123'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
            'pin_hash' => Hash::make('5829'),
        ]);

        $manager = User::create([
            'name' => 'Rahul Verma (Floor Manager)',
            'email' => 'manager@store1.local',
            'username' => 'rahul_mgr',
            'password' => Hash::make('ManagerPass123'),
            'role' => 'manager',
            'store_id' => $this->store->id,
            'pin_hash' => Hash::make('7391'),
        ]);

        $cashier = User::create([
            'name' => 'Ananya Nair (Counter Cashier)',
            'email' => 'cashier@store1.local',
            'username' => 'ananya_csh',
            'password' => Hash::make('CashierPass123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
            'pin_hash' => Hash::make('8246'),
        ]);

        // 1. Super Admin logs in via Password (global)
        $res1 = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'user_id' => $superAdmin->id,
            'password' => 'SuperAdminSecret!',
            'counter_id' => 'C01',
        ]);
        $res1->assertStatus(200)
            ->assertJson(['success' => true]);
        $this->assertNotEmpty($res1->json('token'));

        // 2. Store Owner logs in via PIN
        $res2 = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'user_id' => $owner->id,
            'pin' => '5829',
            'counter_id' => 'C01',
        ]);
        $res2->assertStatus(200)
            ->assertJson(['success' => true]);

        // 3. Floor Manager logs in via PIN
        $res3 = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'user_id' => $manager->id,
            'pin' => '7391',
            'counter_id' => 'C01',
        ]);
        $res3->assertStatus(200)
            ->assertJson(['success' => true]);

        // 4. Counter Cashier logs in via PIN
        $res4 = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'user_id' => $cashier->id,
            'pin' => '8246',
            'counter_id' => 'C01',
        ]);
        $res4->assertStatus(200)
            ->assertJson(['success' => true]);
    }
}
