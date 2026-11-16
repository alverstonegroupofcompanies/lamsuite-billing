<?php

namespace Tests\Feature;

use App\Models\Store;
use App\Models\User;
use App\Services\Auth\PasswordResetService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        // The throttle middleware keeps counters in the array cache across
        // tests; clear them so each scenario starts with a fresh budget.
        cache()->flush();

        $this->store = Store::create(['name' => 'Reset Store', 'code' => 'RST01', 'is_active' => true]);

        $this->admin = User::create([
            'name' => 'Reset Admin',
            'email' => 'reset-admin@test.local',
            'username' => 'resetadmin',
            'password' => bcrypt('OldPassword!123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
            'must_change_password' => true,
            'failed_login_attempts' => 3,
            'locked_until' => now()->addMinutes(10),
        ]);
    }

    public function test_forgot_password_issues_reset_code_without_revealing_accounts(): void
    {
        config(['app.debug' => true]);

        $response = $this->postJson('/api/auth/forgot-password', [
            'email' => 'reset-admin@test.local',
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('delivery', 'manual')
            ->assertJsonStructure(['reset_token', 'reset_url', 'expires_in_minutes']);

        $token = $response->json('reset_token');
        $this->assertNotEmpty($token);

        $row = DB::table('password_reset_tokens')->where('email', 'reset-admin@test.local')->first();
        $this->assertNotNull($row);
        $this->assertNotSame($token, $row->token, 'Reset tokens must be stored hashed.');
        $this->assertTrue(Hash::check($token, $row->token));
        $this->assertStringContainsString('reset-password', $response->json('reset_url'));

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'password_reset_requested',
            'entity_id' => (string) $this->admin->id,
        ]);

        $unknown = $this->postJson('/api/auth/forgot-password', [
            'email' => 'nobody@test.local',
        ]);
        $unknown->assertOk()->assertJsonPath('success', true);
        $this->assertStringNotContainsString('reset_token', $unknown->getContent() ?? '');
        $this->assertSame(1, DB::table('password_reset_tokens')->count());
    }

    public function test_forgot_password_hides_code_when_debug_is_off(): void
    {
        config(['app.debug' => false]);

        $response = $this->postJson('/api/auth/forgot-password', [
            'email' => 'resetadmin',
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('delivery', 'manual');

        $this->assertArrayNotHasKey('reset_token', $response->json());
        $this->assertSame(1, DB::table('password_reset_tokens')->count());
    }

    public function test_reset_password_accepts_code_and_clears_lockout(): void
    {
        $this->admin->createToken('desktop-session');
        $this->assertSame(1, $this->admin->tokens()->count());

        $token = app(PasswordResetService::class)->issue($this->admin);

        $response = $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => $token,
            'password' => 'NewPassword!456',
            'password_confirmation' => 'NewPassword!456',
        ]);

        $response->assertOk()->assertJsonPath('success', true);

        $fresh = $this->admin->fresh();
        $this->assertTrue(Hash::check('NewPassword!456', $fresh->password));
        $this->assertFalse((bool) $fresh->must_change_password);
        $this->assertNull($fresh->locked_until);
        $this->assertSame(0, (int) $fresh->failed_login_attempts);
        $this->assertSame(0, $fresh->tokens()->count(), 'Existing sessions must be revoked.');
        $this->assertSame(0, DB::table('password_reset_tokens')->count(), 'Codes are single-use.');

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'password_reset_completed',
            'entity_id' => (string) $this->admin->id,
        ]);
    }

    public function test_reset_password_rejects_invalid_expired_and_reused_codes(): void
    {
        $token = app(PasswordResetService::class)->issue($this->admin);

        $invalid = $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => 'not-the-code',
            'password' => 'NewPassword!456',
            'password_confirmation' => 'NewPassword!456',
        ]);
        $invalid->assertStatus(422);

        DB::table('password_reset_tokens')->where('email', 'reset-admin@test.local')->update([
            'created_at' => now()->subMinutes(PasswordResetService::TOKEN_TTL_MINUTES + 5),
        ]);

        $expired = $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => $token,
            'password' => 'NewPassword!456',
            'password_confirmation' => 'NewPassword!456',
        ]);
        $expired->assertStatus(422);

        $freshToken = app(PasswordResetService::class)->issue($this->admin);
        $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => $freshToken,
            'password' => 'NewPassword!456',
            'password_confirmation' => 'NewPassword!456',
        ])->assertOk();

        $reused = $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => $freshToken,
            'password' => 'AnotherPassword!789',
            'password_confirmation' => 'AnotherPassword!789',
        ]);
        $reused->assertStatus(422);
        $this->assertTrue(Hash::check('NewPassword!456', $this->admin->fresh()->password));
    }

    public function test_reset_password_validates_confirmation_and_strength(): void
    {
        $token = app(PasswordResetService::class)->issue($this->admin);

        $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => $token,
            'password' => 'short',
            'password_confirmation' => 'short',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['password']);

        $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => $token,
            'password' => 'NewPassword!456',
            'password_confirmation' => 'DifferentPassword!456',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['password']);
    }

    public function test_new_password_can_log_in_and_old_password_is_rejected(): void
    {
        $token = app(PasswordResetService::class)->issue($this->admin);

        $this->postJson('/api/auth/reset-password', [
            'email' => 'reset-admin@test.local',
            'token' => $token,
            'password' => 'NewPassword!456',
            'password_confirmation' => 'NewPassword!456',
        ])->assertOk();

        $this->postJson('/api/auth/login', [
            'email' => 'reset-admin@test.local',
            'password' => 'OldPassword!123',
        ])->assertStatus(401);

        $this->postJson('/api/auth/login', [
            'email' => 'reset-admin@test.local',
            'password' => 'NewPassword!456',
        ])->assertOk()->assertJsonStructure(['token', 'user']);
    }

    public function test_forgot_password_requires_an_email_value(): void
    {
        $this->postJson('/api/auth/forgot-password', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['email']);
    }
}
