<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceActivationAttempt;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DeviceActivationSecurityTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'LamStone Security Test Store',
            'code' => 'SEC01',
            'state_code' => '32',
            'is_active' => true,
            'require_device_approval' => false,
        ]);

        $this->owner = User::create([
            'name' => 'Store Owner',
            'email' => 'owner@securitytest.com',
            'password' => bcrypt('StrongPassword123!'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
            'totp_enabled' => false,
            'is_active' => true,
        ]);
    }

    public function test_random_key_is_rejected_and_creates_no_device_or_counter(): void
    {
        $initialDevicesCount = Device::count();
        $initialCountersCount = Counter::count();

        $response = $this->postJson('/api/devices/register', [
            'activation_key' => 'RANDOM-INVALID-KEY-12345',
            'device_uuid' => 'dev_test_random_key_uuid',
            'device_name' => 'Counter Station Test',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);

        $this->assertEquals($initialDevicesCount, Device::count());
        $this->assertEquals($initialCountersCount, Counter::count());

        // Failed attempt recorded in device_activation_attempts
        $this->assertDatabaseHas('device_activation_attempts', [
            'device_uuid' => 'dev_test_random_key_uuid',
            'success' => false,
        ]);
    }

    public function test_malformed_key_is_rejected_without_creating_records(): void
    {
        $response = $this->postJson('/api/devices/register', [
            'activation_key' => 'ABC',
            'device_uuid' => 'dev_test_short_uuid',
            'device_name' => 'Counter Short',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);

        $this->assertDatabaseMissing('devices', ['device_uuid' => 'dev_test_short_uuid']);
    }

    public function test_expired_key_returns_same_generic_error(): void
    {
        $keyResult = ActivationKey::generateKey($this->store, [
            'expires_at' => now()->subDay(),
        ]);

        $response = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_test_expired_uuid',
            'device_name' => 'Counter Expired',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);

        $this->assertDatabaseMissing('devices', ['device_uuid' => 'dev_test_expired_uuid']);
    }

    public function test_revoked_key_returns_same_generic_error(): void
    {
        $keyResult = ActivationKey::generateKey($this->store);
        $keyResult['model']->revoke('Security key compromise test');

        $response = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_test_revoked_uuid',
            'device_name' => 'Counter Revoked',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);

        $this->assertDatabaseMissing('devices', ['device_uuid' => 'dev_test_revoked_uuid']);
    }

    public function test_key_for_inactive_store_is_rejected(): void
    {
        $inactiveStore = Store::create([
            'name' => 'Inactive Store',
            'code' => 'INACT',
            'state_code' => '32',
            'is_active' => false,
        ]);
        $keyResult = ActivationKey::generateKey($inactiveStore);

        $response = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_test_inactive_store_uuid',
            'device_name' => 'Counter Inactive Store',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);
    }

    public function test_reused_single_use_key_is_rejected(): void
    {
        $keyResult = ActivationKey::generateKey($this->store, [
            'is_single_use' => true,
            'max_devices' => 1,
        ]);

        // First activation: should succeed
        $res1 = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_single_use_1',
            'device_name' => 'Counter First',
        ]);
        $res1->assertStatus(200);

        // Second activation: must be rejected with generic error
        $res2 = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_single_use_2',
            'device_name' => 'Counter Second Attempt',
        ]);
        $res2->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);

        $this->assertDatabaseMissing('devices', ['device_uuid' => 'dev_single_use_2']);
    }

    public function test_key_past_device_limit_is_rejected(): void
    {
        $keyResult = ActivationKey::generateKey($this->store, [
            'max_devices' => 2,
        ]);

        // Device 1
        $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_limit_1',
            'device_name' => 'Counter 1',
        ])->assertStatus(200);

        // Device 2
        $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_limit_2',
            'device_name' => 'Counter 2',
        ])->assertStatus(200);

        // Device 3: exceeds limit of 2
        $res3 = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_limit_3',
            'device_name' => 'Counter 3',
        ]);
        $res3->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);

        $this->assertDatabaseMissing('devices', ['device_uuid' => 'dev_limit_3']);
    }

    public function test_brute_force_attempts_are_rate_limited_and_locked_out_with_owner_alert(): void
    {
        $testIp = '198.51.100.42';

        // 5 consecutive failed attempts
        for ($i = 1; $i <= 5; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => $testIp])
                ->postJson('/api/devices/register', [
                    'activation_key' => "WRONG-KEY-{$i}",
                    'device_uuid' => 'dev_bruteforce_target',
                    'device_name' => 'Bruteforce Attacker',
                ])->assertStatus(422);
        }

        // 6th attempt should be blocked with 429
        $response = $this->withServerVariables(['REMOTE_ADDR' => $testIp])
            ->postJson('/api/devices/register', [
                'activation_key' => 'ANOTHER-WRONG-KEY',
                'device_uuid' => 'dev_bruteforce_target',
                'device_name' => 'Bruteforce Attacker',
            ]);

        $response->assertStatus(429)
            ->assertJson([
                'locked' => true,
            ]);

        // Verify alert logged in AuditLog
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'activation_lockout_triggered',
        ]);
    }

    public function test_valid_activation_key_registers_device_and_records_tokens(): void
    {
        $keyResult = ActivationKey::generateKey($this->store);

        $response = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_clean_registration_uuid',
            'device_name' => 'Main Billing Counter 01',
            'is_hub' => true,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'status' => 'active',
                'store_id' => (string)$this->store->id,
                'counter_name' => 'Main Billing Counter 01',
            ]);

        $token = $response->json('device_token');
        $this->assertNotEmpty($token);

        // Verify device in database with hashed token
        $device = Device::where('device_uuid', 'dev_clean_registration_uuid')->first();
        $this->assertNotNull($device);
        $this->assertEquals(hash('sha256', $token), $device->device_token_hash);
        $this->assertEquals('activation_key', $device->registered_via);

        // Verify counter also created
        $this->assertDatabaseHas('counters', [
            'device_uuid' => 'dev_clean_registration_uuid',
            'store_id' => $this->store->id,
            'status' => 'active',
        ]);
    }

    public function test_device_validation_endpoint_locks_unrecognized_or_revoked_device(): void
    {
        // 1. Unrecognized token
        $unrecognizedRes = $this->postJson('/api/devices/validate', [
            'device_token' => 'fake_lsd_unrecognized_token_123',
            'device_uuid' => 'fake_uuid',
        ]);

        $unrecognizedRes->assertStatus(401)
            ->assertJson([
                'valid' => false,
                'action' => 'lock_and_reset',
            ]);

        // 2. Legitimate device then revoked
        $keyResult = ActivationKey::generateKey($this->store);
        $reg = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_uuid' => 'dev_to_be_revoked',
            'device_name' => 'Counter To Revoke',
        ]);
        $token = $reg->json('device_token');

        // Verify active first
        $validRes = $this->postJson('/api/devices/validate', [
            'device_token' => $token,
            'device_uuid' => 'dev_to_be_revoked',
        ]);
        $validRes->assertStatus(200)->assertJson(['valid' => true, 'status' => 'active']);

        // Now revoke device
        $device = Device::where('device_uuid', 'dev_to_be_revoked')->first();
        $device->update(['status' => 'revoked', 'revoke_reason' => 'Stolen terminal']);

        // Re-validate: should return 403 lock_and_reset
        $revokedRes = $this->postJson('/api/devices/validate', [
            'device_token' => $token,
            'device_uuid' => 'dev_to_be_revoked',
        ]);
        $revokedRes->assertStatus(403)
            ->assertJson([
                'valid' => false,
                'status' => 'revoked',
                'action' => 'lock_and_reset',
            ]);
    }

    public function test_owner_login_requires_valid_credentials_and_proper_authorization(): void
    {
        // Bad password
        $badRes = $this->postJson('/api/devices/register-owner', [
            'email' => $this->owner->email,
            'password' => 'WrongPassword',
            'store_id' => $this->store->id,
            'device_uuid' => 'dev_owner_test',
            'device_name' => 'Counter Owner',
        ]);
        $badRes->assertStatus(401);

        // Good credentials without 2FA
        $goodRes = $this->postJson('/api/devices/register-owner', [
            'email' => $this->owner->email,
            'password' => 'StrongPassword123!',
            'store_id' => $this->store->id,
            'device_uuid' => 'dev_owner_test',
            'device_name' => 'Counter Owner',
        ]);
        $goodRes->assertStatus(200)
            ->assertJson([
                'success' => true,
                'status' => 'active',
            ]);

        $this->assertDatabaseHas('devices', [
            'device_uuid' => 'dev_owner_test',
            'registered_via' => 'owner_login',
            'approved_by' => $this->owner->id,
        ]);
    }

    public function test_owner_login_enforces_2fa_and_rejects_demo_totp_code(): void
    {
        $this->owner->update([
            'totp_enabled' => true,
            'totp_secret' => 'JBSWY3DPEHPK3PXP', // standard test secret
        ]);

        // Attempt without TOTP
        $noTotpRes = $this->postJson('/api/devices/register-owner', [
            'email' => $this->owner->email,
            'password' => 'StrongPassword123!',
            'store_id' => $this->store->id,
            'device_uuid' => 'dev_owner_2fa',
            'device_name' => 'Counter Owner 2FA',
        ]);
        $noTotpRes->assertStatus(200)->assertJson(['requires_2fa' => true]);

        // Attempt with fake demo code '123456' - MUST BE REJECTED
        $demoTotpRes = $this->postJson('/api/devices/register-owner', [
            'email' => $this->owner->email,
            'password' => 'StrongPassword123!',
            'store_id' => $this->store->id,
            'device_uuid' => 'dev_owner_2fa',
            'device_name' => 'Counter Owner 2FA',
            'totp_code' => '123456',
        ]);
        $demoTotpRes->assertStatus(422)
            ->assertJson(['message' => 'Invalid two-factor authentication code.']);
    }
}
