<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Covers the POS-side regressions where a legacy local registry key
 * ("store_main") was treated as a store identity: device presence was empty,
 * staff sign-in silently fell back to offline auth, and offline cache sync was
 * rejected as a tenant violation.
 */
class PosStoreKeyCompatibilityTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $cashier;
    private User $otherOwner;
    private User $globalAdmin;
    private User $owner;
    private Device $device;
    private string $deviceToken = 'lsd_pos_compat_token_01';
    private string $otherDeviceToken = 'lsd_pos_compat_token_02';

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Compat Store',
            'code' => 'COMPAT-01',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Compat Owner',
            'email' => 'owner@compat.test',
            'username' => 'compat_owner',
            'password' => Hash::make('owner12345'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
            'permissions' => ['*'],
        ]);

        $this->cashier = User::create([
            'name' => 'Compat Cashier',
            'email' => 'cashier@compat.test',
            'username' => 'compat_cashier',
            'password' => Hash::make('password123'),
            'pin_hash' => Hash::make('1357'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->globalAdmin = User::create([
            'name' => 'Global Super',
            'email' => 'global@compat.test',
            'username' => 'global_super',
            'password' => Hash::make('super12345'),
            'pin_hash' => Hash::make('2468'),
            'role' => 'super_admin',
            'store_id' => null,
            'permissions' => ['*'],
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Counter',
            'device_name' => 'Compat Terminal',
            'device_uuid' => 'uuid-compat-01',
            'status' => 'active',
        ]);

        $this->device = Device::create([
            'store_id' => $this->store->id,
            'device_name' => 'Compat Terminal',
            'device_uuid' => 'uuid-compat-01',
            'device_token' => $this->deviceToken,
            'device_token_hash' => hash('sha256', $this->deviceToken),
            'registered_via' => 'test',
            'status' => 'active',
            'approved_at' => now(),
        ]);

        $this->otherStore = Store::create([
            'name' => 'Compat Branch',
            'code' => 'COMPAT-02',
            'is_active' => true,
        ]);

        $this->otherOwner = User::create([
            'name' => 'Branch Owner',
            'email' => 'owner@branch.test',
            'username' => 'branch_owner',
            'password' => Hash::make('owner12345'),
            'role' => 'store_owner',
            'store_id' => $this->otherStore->id,
            'permissions' => ['*'],
        ]);

        Device::create([
            'store_id' => $this->otherStore->id,
            'device_name' => 'Branch Terminal',
            'device_uuid' => 'uuid-compat-02',
            'device_token' => $this->otherDeviceToken,
            'device_token_hash' => hash('sha256', $this->otherDeviceToken),
            'registered_via' => 'test',
            'status' => 'active',
            'approved_at' => now(),
        ]);
    }

    private function deviceHeaders(): array
    {
        return [
            'X-Device-Token' => $this->deviceToken,
            'X-Device-UUID' => $this->device->device_uuid,
        ];
    }

    public function test_staff_login_accepts_local_registry_key_with_device_token(): void
    {
        $res = $this->withHeaders($this->deviceHeaders())->postJson('/api/staff/login', [
            'store_id' => 'store_main',
            'username' => 'compat_cashier',
            'pin' => '1357',
            'counter_id' => 'C01',
            'device_uuid' => 'uuid-compat-01',
            'device_name' => 'Compat Terminal',
        ]);

        $res->assertStatus(200)->assertJson(['success' => true]);
        $this->assertNotEmpty($res->json('token'));
    }

    public function test_device_roster_resolves_store_from_token_for_local_registry_key(): void
    {
        $this->withHeaders($this->deviceHeaders())->postJson('/api/staff/login', [
            'store_id' => 'store_main',
            'username' => 'compat_cashier',
            'pin' => '1357',
            'counter_id' => 'C01',
            'device_uuid' => 'uuid-compat-01',
            'device_name' => 'Compat Terminal',
        ])->assertStatus(200);

        $res = $this->withHeaders($this->deviceHeaders())
            ->getJson('/api/device-sessions?store_id=store_main&current_device_uuid=uuid-compat-01');

        $res->assertStatus(200)->assertJson(['success' => true]);
        $device = collect($res->json('devices'))->firstWhere('device_uuid', 'uuid-compat-01');
        $this->assertNotNull($device, 'Signed-in workstation missing from the roster.');
        $this->assertSame('Compat Cashier', $device['user_name']);
        $this->assertTrue($device['is_this_device']);
    }

    public function test_heartbeat_accepts_local_registry_key_with_device_token(): void
    {
        $this->withHeaders($this->deviceHeaders())->postJson('/api/staff/login', [
            'store_id' => 'store_main',
            'username' => 'compat_cashier',
            'pin' => '1357',
            'counter_id' => 'C01',
            'device_uuid' => 'uuid-compat-01',
            'device_name' => 'Compat Terminal',
        ])->assertStatus(200);

        $res = $this->withHeaders($this->deviceHeaders())->postJson('/api/device-sessions/heartbeat', [
            'device_uuid' => 'uuid-compat-01',
            'store_id' => 'store_main',
            'device_name' => 'Compat Terminal',
            'counter_code' => 'C01',
            'status' => 'Active',
        ]);

        $res->assertStatus(200)->assertJson(['success' => true]);
        $this->assertSame((string) $this->store->id, $res->json('store_id'));
    }

    public function test_offline_cache_tolerates_local_registry_key_header(): void
    {
        $res = $this->withHeaders([
            'X-Device-Token' => $this->deviceToken,
            'X-Device-UUID' => $this->device->device_uuid,
            'X-Store-Id' => 'store_main',
        ])->getJson('/api/staff/offline-cache');

        $res->assertStatus(200)->assertJson(['success' => true]);
    }

    public function test_offline_cache_lists_global_admins_without_credentials(): void
    {
        $res = $this->withHeaders($this->deviceHeaders())
            ->getJson('/api/staff/offline-cache');

        $res->assertStatus(200);

        $staffNames = collect($res->json('staff'))->pluck('username');
        $this->assertTrue($staffNames->contains('compat_cashier'));
        $this->assertFalse($staffNames->contains('global_super'));

        $globalAdmins = collect($res->json('global_admins'));
        $super = $globalAdmins->firstWhere('username', 'global_super');
        $this->assertNotNull($super);
        $this->assertTrue($super['online_only']);
        $this->assertArrayNotHasKey('password_hash', $super);
        $this->assertArrayNotHasKey('pin_hash', $super);
    }

    public function test_staff_creation_defaults_to_callers_store_when_store_id_omitted(): void
    {
        Sanctum::actingAs($this->owner);

        $res = $this->postJson('/api/admin/users', [
            'name' => 'New Operator',
            'email' => 'operator@compat.test',
            'password' => 'operator123',
            'role' => 'cashier',
            'pin' => '1122',
        ]);

        $res->assertStatus(201);
        $this->assertSame($this->store->id, $res->json('store_id'));
    }

    public function test_settings_resolves_local_key_from_device_token_instead_of_first_store(): void
    {
        $res = $this->withHeaders(['X-Device-Token' => $this->otherDeviceToken])
            ->getJson('/api/settings?store_id=store_main');

        $res->assertStatus(200);
        $this->assertSame((string) $this->otherStore->id, $res->json('store_id'));
    }

    public function test_settings_resolves_local_key_from_bearer_token(): void
    {
        Sanctum::actingAs($this->otherOwner);

        $res = $this->withHeaders(['X-Store-Id' => 'store_main'])
            ->getJson('/api/settings');

        $res->assertStatus(200);
        $this->assertSame((string) $this->otherStore->id, $res->json('store_id'));
    }

    public function test_pull_deltas_resolves_local_key_from_device_token(): void
    {
        $res = $this->withHeaders(['X-Device-Token' => $this->otherDeviceToken])
            ->getJson('/api/sync/pull/deltas?store_id=store_main&since_watermark=0');

        $res->assertStatus(200);
        $this->assertSame($this->otherStore->id, $res->json('store_id'));
        $this->assertArrayNotHasKey('error', $res->json());
    }

    public function test_numeric_store_id_is_left_unchanged(): void
    {
        $res = $this->getJson('/api/settings?store_id=' . $this->otherStore->id);

        $res->assertStatus(200);
        $this->assertSame((string) $this->otherStore->id, $res->json('store_id'));
    }
}
