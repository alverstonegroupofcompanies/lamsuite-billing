<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\DeviceSession;
use App\Models\Store;
use App\Models\User;
use App\Models\UserSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class StaffSessionPolicyTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Policy Store',
            'code' => 'POLICY-01',
            'is_active' => true,
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Counter',
            'device_name' => 'Workstation A',
            'device_uuid' => 'uuid_policy_a',
            'status' => 'active',
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C02',
            'counter_name' => 'Back Counter',
            'device_name' => 'Workstation B',
            'device_uuid' => 'uuid_policy_b',
            'status' => 'active',
        ]);
    }

    private function makeUser(string $role = 'cashier', array $extra = []): User
    {
        return User::create(array_merge([
            'store_id' => $this->store->id,
            'name' => ucfirst($role) . ' User',
            'username' => $role . '_user',
            'email' => $role . '@policy.test',
            'password' => Hash::make('StorePass@2026'),
            'pin_hash' => Hash::make('4826'),
            'role' => $role,
            'is_active' => true,
        ], $extra));
    }

    private function loginAs(User $user, string $deviceUuid, string $counter = 'C01', array $extra = [])
    {
        return $this->withHeaders(['X-Device-UUID' => $deviceUuid])
            ->postJson('/api/staff/login', array_merge([
                'store_id' => $this->store->id,
                'user_id' => $user->id,
                'pin' => '4826',
                'counter_id' => $counter,
                'device_uuid' => $deviceUuid,
                'device_name' => 'Device ' . $deviceUuid,
            ], $extra));
    }

    public function test_cashier_cannot_sign_in_on_a_second_counter_while_active(): void
    {
        $cashier = $this->makeUser('cashier');

        $this->loginAs($cashier, 'uuid_policy_a', 'C01')->assertStatus(200);

        $res = $this->loginAs($cashier, 'uuid_policy_b', 'C02');

        $res->assertStatus(409);
        $res->assertJson([
            'success' => false,
            'error' => 'ACTIVE_SESSION_ELSEWHERE',
            'can_force_out' => false,
        ]);
        $this->assertEquals('Front Counter', $res->json('active_session.counter_name'));
        $this->assertEquals('uuid_policy_a', $res->json('active_session.device_uuid'));

        // The attempted second device did not get a session.
        $this->assertEquals(
            0,
            DeviceSession::where('device_uuid', 'uuid_policy_b')->count()
        );
    }

    public function test_cashier_cannot_self_force_out(): void
    {
        $cashier = $this->makeUser('cashier');
        $this->loginAs($cashier, 'uuid_policy_a', 'C01')->assertStatus(200);

        $res = $this->loginAs($cashier, 'uuid_policy_b', 'C02', ['force_out' => true]);

        $res->assertStatus(409);
        $res->assertJson(['error' => 'ACTIVE_SESSION_ELSEWHERE', 'can_force_out' => false]);
        $this->assertEquals(
            1,
            DeviceSession::where('device_uuid', 'uuid_policy_a')->where('is_active', true)->count()
        );
    }

    public function test_manager_can_force_out_the_previous_counter(): void
    {
        $manager = $this->makeUser('manager');

        $first = $this->loginAs($manager, 'uuid_policy_a', 'C01');
        $first->assertStatus(200);
        $firstToken = $first->json('token');
        $this->assertNotEmpty($firstToken);

        $res = $this->loginAs($manager, 'uuid_policy_b', 'C02', ['force_out' => true]);
        $res->assertStatus(200);

        $oldSession = DeviceSession::where('device_uuid', 'uuid_policy_a')->latest('id')->first();
        $this->assertFalse((bool)$oldSession->is_active);
        $this->assertEquals('expired', $oldSession->status);
        $this->assertNotNull($oldSession->force_logged_out_at);
        $this->assertEquals('Replaced by a new sign-in', $oldSession->force_logout_reason);

        // All prior tokens are revoked; only the fresh sign-in token remains.
        $this->assertEquals(1, PersonalAccessToken::where('tokenable_id', $manager->id)->count());

        $this->assertTrue(
            DeviceSession::where('device_uuid', 'uuid_policy_b')->where('is_active', true)->exists()
        );
    }

    public function test_role_allowed_by_setting_can_hold_multiple_counters(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'allow_multi_counter_roles',
            'value' => ['roles' => ['cashier']],
            'is_secret' => false,
        ]);

        $cashier = $this->makeUser('cashier');

        $this->loginAs($cashier, 'uuid_policy_a', 'C01')->assertStatus(200);
        $this->loginAs($cashier, 'uuid_policy_b', 'C02')->assertStatus(200);

        $this->assertEquals(
            2,
            DeviceSession::where('user_id', $cashier->id)->where('is_active', true)->count()
        );
    }

    public function test_stale_active_session_does_not_block_a_new_sign_in(): void
    {
        $cashier = $this->makeUser('cashier');
        $this->loginAs($cashier, 'uuid_policy_a', 'C01')->assertStatus(200);

        DeviceSession::where('device_uuid', 'uuid_policy_a')->update([
            'last_active_at' => now()->subHours(2),
        ]);

        $this->loginAs($cashier, 'uuid_policy_b', 'C02')->assertStatus(200);

        $this->assertEquals(
            0,
            DeviceSession::where('device_uuid', 'uuid_policy_a')->where('is_active', true)->count()
        );
        $this->assertTrue(
            DeviceSession::where('device_uuid', 'uuid_policy_b')->where('is_active', true)->exists()
        );
    }

    public function test_repeating_login_on_the_same_device_does_not_conflict(): void
    {
        $cashier = $this->makeUser('cashier');

        $this->loginAs($cashier, 'uuid_policy_a', 'C01')->assertStatus(200);
        $this->loginAs($cashier, 'uuid_policy_a', 'C01')->assertStatus(200);

        $this->assertEquals(
            1,
            DeviceSession::where('device_uuid', 'uuid_policy_a')->where('is_active', true)->count()
        );
    }

    public function test_force_logout_endpoint_revokes_tokens_and_marks_the_session(): void
    {
        $cashier = $this->makeUser('cashier');
        $this->loginAs($cashier, 'uuid_policy_a', 'C01')->assertStatus(200);

        $session = DeviceSession::where('device_uuid', 'uuid_policy_a')->where('is_active', true)->firstOrFail();

        UserSession::create([
            'user_id' => $cashier->id,
            'ip_address' => '127.0.0.1',
            'user_agent' => 'test',
            'last_activity' => now(),
            'is_active' => true,
        ]);

        $res = $this->postJson("/api/device-sessions/{$session->id}/force-logout", [
            'reason' => 'Policy test termination',
        ]);
        $res->assertStatus(200);

        $fresh = $session->fresh();
        $this->assertFalse((bool)$fresh->is_active);
        $this->assertEquals('expired', $fresh->status);
        $this->assertNotNull($fresh->force_logged_out_at);
        $this->assertEquals('Policy test termination', $fresh->force_logout_reason);

        $this->assertEquals(0, PersonalAccessToken::where('tokenable_id', $cashier->id)->count());
        $this->assertEquals(0, UserSession::where('user_id', $cashier->id)->where('is_active', true)->count());
    }
}
