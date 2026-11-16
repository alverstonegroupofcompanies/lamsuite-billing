<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class DeviceAuthHardeningTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $owner;
    private User $staffUser;
    private User $globalAdmin;
    private Device $device;
    private string $deviceToken = 'lsd_hardening_token_01';

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Main Pharmacy',
            'code' => 'MAIN-01',
            'is_active' => true,
            'license_plan' => 'Pro',
        ]);

        $this->otherStore = Store::create([
            'name' => 'Branch Pharmacy',
            'code' => 'BR-02',
            'is_active' => true,
            'license_plan' => 'Pro',
        ]);

        $this->owner = User::create([
            'name' => 'Store Owner',
            'email' => 'owner@example.test',
            'username' => 'owner',
            'password' => Hash::make('owner123'),
            'role' => 'owner',
            'store_id' => $this->store->id,
            'permissions' => ['*'],
        ]);

        $this->staffUser = User::create([
            'name' => 'Alice Cashier',
            'email' => 'alice@example.test',
            'username' => 'alice',
            'password' => Hash::make('password123'),
            'pin_hash' => Hash::make('4321'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
            'permissions' => ['pos'],
        ]);

        $this->globalAdmin = User::create([
            'name' => 'Global Super Admin',
            'email' => 'super@example.test',
            'username' => 'super',
            'password' => Hash::make('super123'),
            'role' => 'super_admin',
            'store_id' => null,
            'permissions' => ['*'],
        ]);

        $this->device = Device::create([
            'store_id' => $this->store->id,
            'device_name' => 'Counter 01',
            'device_uuid' => 'uuid-hardening-counter-01',
            'device_token' => $this->deviceToken,
            'device_token_hash' => hash('sha256', $this->deviceToken),
            'registered_via' => 'test',
            'status' => 'active',
            'approved_at' => now(),
        ]);
    }

    private function headers(?string $token = null, ?int $storeId = null): array
    {
        return [
            'X-Device-Token' => $token ?? $this->deviceToken,
            'X-Device-UUID' => $this->device->device_uuid,
            'X-Store-Id' => (string) ($storeId ?? $this->store->id),
        ];
    }

    public function test_offline_cache_requires_a_device_token(): void
    {
        $this->getJson("/api/staff/offline-cache?store_id={$this->store->id}")
            ->assertStatus(401)
            ->assertJson(['error' => 'DEVICE_AUTH_FAILED']);
    }

    public function test_offline_cache_rejects_a_token_for_another_store(): void
    {
        $this->withHeaders($this->headers(null, $this->otherStore->id))
            ->getJson("/api/staff/offline-cache?store_id={$this->otherStore->id}")
            ->assertStatus(403)
            ->assertJson(['error' => 'DEVICE_AUTH_FAILED']);
    }

    public function test_offline_cache_is_scoped_to_the_device_store_and_excludes_global_admins(): void
    {
        $res = $this->withHeaders($this->headers())
            ->getJson("/api/staff/offline-cache?store_id={$this->store->id}");

        $res->assertStatus(200)->assertJson(['success' => true]);

        $usernames = collect($res->json('staff'))->pluck('username');
        $this->assertTrue($usernames->contains('alice'));
        $this->assertFalse($usernames->contains('super'));
        $this->assertFalse($usernames->contains('branch_user'));
    }

    public function test_revoked_device_is_rejected_everywhere(): void
    {
        $this->device->update(['status' => 'revoked']);

        $this->withHeaders($this->headers())
            ->getJson("/api/staff/offline-cache?store_id={$this->store->id}")
            ->assertStatus(403)
            ->assertJson(['error' => 'DEVICE_AUTH_FAILED']);

        $this->withHeaders($this->headers())
            ->postJson('/api/sync/push/staff', ['staff' => []])
            ->assertStatus(403);
    }

    public function test_sync_push_requires_a_device_token(): void
    {
        $this->postJson('/api/sync/push/staff', ['staff' => []])
            ->assertStatus(401)
            ->assertJson(['error' => 'DEVICE_AUTH_FAILED']);
    }

    public function test_sync_push_cannot_write_into_another_store(): void
    {
        $this->withHeaders($this->headers())
            ->postJson('/api/sync/push/staff', [
                'store_id' => $this->otherStore->id,
                'staff' => [[
                    'id' => 'usr_injected_01',
                    'store_id' => $this->otherStore->id,
                    'username' => 'injected',
                    'full_name' => 'Injected User',
                    'role' => 'manager',
                    'password' => 'InjectedPass#123',
                ]],
            ])
            ->assertStatus(200);

        $injected = User::where('username', 'injected')->first();
        $this->assertNotNull($injected);
        $this->assertSame((int) $this->store->id, (int) $injected->store_id);
        $this->assertNull(User::where('store_id', $this->otherStore->id)->where('username', 'injected')->first());
    }

    public function test_admin_unlock_requires_a_device_token(): void
    {
        $this->postJson('/api/staff/admin-unlock', [
            'user_id' => $this->staffUser->id,
            'admin_username' => 'owner',
            'admin_password' => 'owner123',
        ])->assertStatus(401);
    }

    public function test_admin_unlock_cannot_reach_users_in_another_store(): void
    {
        $foreign = User::create([
            'name' => 'Branch Cashier',
            'email' => 'branch@example.test',
            'username' => 'branch_user',
            'password' => Hash::make('password123'),
            'role' => 'cashier',
            'store_id' => $this->otherStore->id,
            'permissions' => ['pos'],
            'failed_login_attempts' => 5,
            'locked_until' => now()->addMinutes(15),
        ]);

        $this->withHeaders($this->headers())
            ->postJson('/api/staff/admin-unlock', [
                'user_id' => $foreign->id,
                'admin_username' => 'owner',
                'admin_password' => 'owner123',
            ])
            ->assertStatus(404);

        $this->assertNotNull($foreign->fresh()->locked_until);
    }

    public function test_admin_unlock_keeps_working_for_same_store_staff(): void
    {
        $this->staffUser->update([
            'failed_login_attempts' => 5,
            'locked_until' => now()->addMinutes(15),
        ]);

        $this->withHeaders($this->headers())
            ->postJson('/api/staff/admin-unlock', [
                'user_id' => $this->staffUser->id,
                'admin_username' => 'owner',
                'admin_password' => 'owner123',
            ])
            ->assertStatus(200)
            ->assertJson(['success' => true]);

        $this->assertNull($this->staffUser->fresh()->locked_until);
    }
}
