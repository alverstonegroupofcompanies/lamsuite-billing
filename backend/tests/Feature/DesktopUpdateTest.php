<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Store;
use App\Models\DeviceSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DesktopUpdateTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_serves_latest_manifest(): void
    {
        $response = $this->getJson('/api/app/update/latest.json');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'version',
                'notes',
                'pub_date',
                'platforms' => [
                    'windows-x86_64' => ['signature', 'url'],
                ],
            ]);
    }

    public function test_it_serves_legacy_windows_manifest(): void
    {
        $response = $this->getJson('/api/app/update/latest-legacy-win7.json');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'version',
                'notes',
                'pub_date',
                'platforms' => [
                    'windows-x86_64' => ['signature', 'url'],
                ],
            ]);
    }

    public function test_dynamic_update_returns_204_when_up_to_date(): void
    {
        $response = $this->getJson('/api/app/update/windows-x86_64/2.0.26');

        $response->assertStatus(204);
    }

    public function test_dynamic_update_returns_200_with_package_when_older(): void
    {
        $response = $this->getJson('/api/app/update/windows-x86_64/2.0.25');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'url',
                'version',
                'notes',
                'pub_date',
                'signature',
            ]);
    }

    public function test_it_downloads_updater_binary_file(): void
    {
        $fakeDir = storage_path('app/updates');
        if (!\Illuminate\Support\Facades\File::exists($fakeDir)) {
            \Illuminate\Support\Facades\File::makeDirectory($fakeDir, 0755, true);
        }
        $fakeFile = "{$fakeDir}/LamSuite-Billing_2.0.26_x64-setup.nsis.zip";
        \Illuminate\Support\Facades\File::put($fakeFile, "DUMMY_ZIP_CONTENT");

        try {
            $response = $this->get('/api/app/update/download/LamSuite-Billing_2.0.26_x64-setup.nsis.zip');
            $response->assertStatus(200);
            $response->assertHeader('Content-Type', 'application/octet-stream');
        } finally {
            \Illuminate\Support\Facades\File::delete($fakeFile);
        }
    }

    public function test_admin_can_get_and_set_min_required_desktop_version(): void
    {
        $store = Store::create([
            'name' => 'Main Test Store',
            'code' => 'TEST01',
            'state_code' => '32',
            'store_type' => 'Pharmacy',
            'is_active' => true,
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@test.com',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $store->id,
            'is_admin' => true,
        ]);

        $this->actingAs($admin, 'sanctum');

        // Get initial min version
        $resGet = $this->getJson('/api/admin/settings/min-app-version');
        $resGet->assertStatus(200)
            ->assertJsonPath('min_version', '2.0.21');

        // Set min version to 2.0.22
        $resPost = $this->postJson('/api/admin/settings/min-app-version', [
            'min_version' => '2.0.22',
        ]);
        $resPost->assertStatus(200)
            ->assertJsonPath('min_version', '2.0.22');

        // Verify device session flags out-of-date device
        DeviceSession::create([
            'store_id' => $store->id,
            'session_id' => 'sess_001',
            'device_uuid' => 'dev_001',
            'device_name' => 'Counter 1 POS',
            'counter_name' => 'Front Desk',
            'user_id' => $admin->id,
            'user_role' => 'Admin',
            'ip_address' => '192.168.1.50',
            'app_version' => '2.0.21', // Older than 2.0.22
            'unsynced_items_count' => 0,
            'is_active' => true,
            'login_time' => now(),
            'last_active_at' => now(),
        ]);

        $resDevices = $this->getJson('/api/device-sessions?store_id=' . $store->id);
        $resDevices->assertStatus(200)
            ->assertJsonPath('devices.0.is_out_of_date', true)
            ->assertJsonPath('out_of_date_count', 1);
    }
}
