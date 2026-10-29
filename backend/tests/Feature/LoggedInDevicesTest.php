<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceSession;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LoggedInDevicesTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $adminUser;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Alverstone Central Pharmacy',
            'code' => 'CENTRAL-01',
            'is_active' => true,
            'tax_mode' => 'exclusive',
            'address' => 'Palakkad, Kerala',
        ]);

        $this->adminUser = User::create([
            'store_id' => $this->store->id,
            'name' => 'Store Owner',
            'username' => 'owner',
            'email' => 'owner@lamsuite.internal',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'is_active' => true,
        ]);
    }

    /**
     * 1. A device logs in and appears in the Logged-In Devices list.
     * 2. The displayed device name and counter name match the sign-in information.
     */
    public function test_device_login_appears_in_logged_in_devices_with_matching_names(): void
    {
        $counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01 (Front Desk)',
            'device_name' => 'POS Terminal Alpha',
            'device_uuid' => 'uuid_pos_alpha',
            'status' => 'active',
            'location_name' => 'Main Floor',
        ]);

        $user = User::create([
            'store_id' => $this->store->id,
            'name' => 'Cashier One',
            'username' => 'cashier1',
            'email' => 'cashier1@lamsuite.internal',
            'password' => bcrypt('secret123'),
            'pin_hash' => bcrypt('1234'),
            'role' => 'cashier',
            'is_active' => true,
        ]);

        // Staff logs in
        $loginRes = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'cashier1',
            'pin' => '1234',
            'counter_id' => 'C01',
            'device_uuid' => 'uuid_pos_alpha',
            'device_name' => 'POS Terminal Alpha',
        ]);
        $loginRes->assertStatus(200);

        // Fetch logged-in devices
        $res = $this->getJson('/api/devices/logged-in?store_id=' . $this->store->id);
        $res->assertStatus(200);
        $res->assertJson(['success' => true]);

        $devices = $res->json('devices');
        $this->assertNotEmpty($devices);

        $device = collect($devices)->firstWhere('device_uuid', 'uuid_pos_alpha');
        $this->assertNotNull($device);
        $this->assertEquals('POS Terminal Alpha', $device['device_name']);
        $this->assertEquals('Counter 01 (Front Desk)', $device['counter_name']);
        $this->assertEquals('C01', $device['counter_code']);
        $this->assertEquals('Online', $device['status']);
        $this->assertNotNull($device['login_time']);
        $this->assertNotNull($device['last_active']);
    }

    /**
     * 3. Multiple devices can log in simultaneously and appear as separate entries.
     */
    public function test_multiple_devices_appear_as_separate_entries(): void
    {
        $c1 = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'device_name' => 'Dell Optiplex 7050',
            'device_uuid' => 'uuid_terminal_1',
            'status' => 'active',
        ]);

        $c2 = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C02',
            'counter_name' => 'Counter 02',
            'device_name' => 'HP EliteDesk 800',
            'device_uuid' => 'uuid_terminal_2',
            'status' => 'active',
        ]);

        // Device 1 session
        DeviceSession::recordLogin(
            $this->store->id,
            'uuid_terminal_1',
            'Dell Optiplex 7050',
            $c1->id,
            $c1->counter_name,
            'C01',
            null,
            '192.168.1.10'
        );

        // Device 2 session
        DeviceSession::recordLogin(
            $this->store->id,
            'uuid_terminal_2',
            'HP EliteDesk 800',
            $c2->id,
            $c2->counter_name,
            'C02',
            null,
            '192.168.1.11'
        );

        $res = $this->getJson('/api/devices/logged-in?store_id=' . $this->store->id);
        $res->assertStatus(200);

        $devices = collect($res->json('devices'));
        $this->assertCount(2, $devices);

        $dev1 = $devices->firstWhere('device_uuid', 'uuid_terminal_1');
        $dev2 = $devices->firstWhere('device_uuid', 'uuid_terminal_2');

        $this->assertNotNull($dev1);
        $this->assertNotNull($dev2);
        $this->assertEquals('Dell Optiplex 7050', $dev1['device_name']);
        $this->assertEquals('HP EliteDesk 800', $dev2['device_name']);
        $this->assertEquals('192.168.1.10', $dev1['ip_address']);
        $this->assertEquals('192.168.1.11', $dev2['ip_address']);
    }

    /**
     * 4. A device becomes offline after its heartbeat stops or its session expires.
     */
    public function test_device_becomes_offline_when_heartbeat_stops(): void
    {
        $session = DeviceSession::recordLogin(
            $this->store->id,
            'uuid_inactive_dev',
            'Tablet POS',
            null,
            'Counter 03',
            'C03'
        );

        // Initial status is Online
        $this->assertEquals('Online', $session->computeStatus(120));

        // Simulate heartbeat stopping: set last_active_at to 10 minutes ago
        $session->update([
            'last_active_at' => now()->subMinutes(10),
        ]);

        $res = $this->getJson('/api/devices/logged-in?store_id=' . $this->store->id);
        $res->assertStatus(200);

        $dev = collect($res->json('devices'))->firstWhere('device_uuid', 'uuid_inactive_dev');
        $this->assertNotNull($dev);
        $this->assertEquals('Offline', $dev['status']);
    }

    /**
     * 5. Logging out updates the device status correctly to Session Expired.
     */
    public function test_logging_out_updates_device_status_to_session_expired(): void
    {
        $session = DeviceSession::recordLogin(
            $this->store->id,
            'uuid_logout_dev',
            'Register PC',
            null,
            'Counter 01',
            'C01'
        );

        $this->assertEquals('Online', $session->computeStatus());

        // Device calls logout
        $logoutRes = $this->postJson('/api/devices/logout', [
            'device_uuid' => 'uuid_logout_dev',
        ]);
        $logoutRes->assertStatus(200);

        $res = $this->getJson('/api/devices/logged-in?store_id=' . $this->store->id);
        $dev = collect($res->json('devices'))->firstWhere('device_uuid', 'uuid_logout_dev');
        $this->assertNotNull($dev);
        $this->assertEquals('Session Expired', $dev['status']);
        $this->assertFalse($dev['is_active']);
    }

    /**
     * 6. Admin can force-expire a session via API.
     */
    public function test_admin_can_expire_device_session(): void
    {
        $session = DeviceSession::recordLogin(
            $this->store->id,
            'uuid_admin_expire',
            'Remote Cashier',
            null,
            'Counter 02',
            'C02'
        );

        $expireRes = $this->postJson("/api/devices/sessions/{$session->id}/expire");
        $expireRes->assertStatus(200);
        $expireRes->assertJson(['success' => true]);

        $fresh = $session->fresh();
        $this->assertFalse($fresh->is_active);
        $this->assertEquals('Session Expired', $fresh->computeStatus());
    }

    /**
     * 7. Missing IP or location information returns null (so UI displays N/A cleanly without fabricated data).
     */
    public function test_missing_ip_or_location_returns_null_for_na_display(): void
    {
        DeviceSession::recordLogin(
            $this->store->id,
            'uuid_no_ip',
            'Minimal Device',
            null,
            'Counter 01',
            'C01',
            null,
            null, // No IP
            null  // No location
        );

        $res = $this->getJson('/api/devices/logged-in?store_id=' . $this->store->id);
        $res->assertStatus(200);

        $dev = collect($res->json('devices'))->firstWhere('device_uuid', 'uuid_no_ip');
        $this->assertNotNull($dev);
        $this->assertNull($dev['ip_address']);
        $this->assertNull($dev['location']);
    }

    /**
     * 8. Prevents duplicate active sessions for the same device UUID.
     */
    public function test_prevents_duplicate_active_entries_for_same_device(): void
    {
        // First login
        DeviceSession::recordLogin($this->store->id, 'uuid_duplicate_check', 'PC 1', null, 'Counter 01', 'C01');

        // Second login on same device (e.g. re-login or restart)
        DeviceSession::recordLogin($this->store->id, 'uuid_duplicate_check', 'PC 1 Renamed', null, 'Counter 01', 'C01');

        $activeSessions = DeviceSession::where('device_uuid', 'uuid_duplicate_check')
            ->where('is_active', true)
            ->get();

        $this->assertCount(1, $activeSessions);
        $this->assertEquals('PC 1 Renamed', $activeSessions->first()->device_name);
    }
}
