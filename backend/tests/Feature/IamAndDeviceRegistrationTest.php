<?php

namespace Tests\Feature;

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
}
