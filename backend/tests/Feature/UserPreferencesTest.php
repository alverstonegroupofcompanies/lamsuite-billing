<?php

namespace Tests\Feature;

use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserPreferencesTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Main Pharmacy',
            'code' => 'MAIN-01',
            'is_active' => true,
            'license_plan' => 'Pro',
        ]);

        $this->user = User::create([
            'name' => 'Owner',
            'email' => 'owner@lamstone.in',
            'username' => 'owner',
            'password' => Hash::make('owner123'),
            'role' => 'owner',
            'store_id' => $this->store->id,
            'permissions' => ['*'],
        ]);
    }

    public function test_returns_empty_preferences_by_default(): void
    {
        $this->actingAs($this->user, 'sanctum')
            ->getJson('/api/me/preferences')
            ->assertOk()
            ->assertJsonPath('preferences', []);
    }

    public function test_merges_and_persists_preferences_per_user(): void
    {
        $first = $this->actingAs($this->user, 'sanctum')
            ->putJson('/api/me/preferences', [
                'preferences' => ['bills.period' => 'this_month', 'pos.columns' => ['name', 'qty']],
            ])
            ->assertOk()
            ->json('preferences');

        $this->assertSame('this_month', $first['bills.period']);

        $merged = $this->actingAs($this->user, 'sanctum')
            ->putJson('/api/me/preferences', [
                'preferences' => ['bills.period' => 'yesterday'],
            ])
            ->assertOk()
            ->json('preferences');

        $this->assertSame('yesterday', $merged['bills.period']);
        $this->assertSame(['name', 'qty'], $merged['pos.columns']);

        $other = User::create([
            'name' => 'Cashier',
            'email' => 'cashier@lamstone.in',
            'username' => 'cashier',
            'password' => Hash::make('cashier123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
            'permissions' => ['pos'],
        ]);

        $this->actingAs($other, 'sanctum')
            ->getJson('/api/me/preferences')
            ->assertOk()
            ->assertJsonPath('preferences', []);
    }

    public function test_replace_flag_overwrites_preferences(): void
    {
        $this->actingAs($this->user, 'sanctum')
            ->putJson('/api/me/preferences', [
                'preferences' => ['a' => 1, 'b' => 2],
            ])
            ->assertOk();

        $this->actingAs($this->user, 'sanctum')
            ->putJson('/api/me/preferences', [
                'preferences' => ['c' => 3],
                'replace' => true,
            ])
            ->assertOk()
            ->assertJsonPath('preferences', ['c' => 3]);
    }

    public function test_rejects_missing_preferences_payload(): void
    {
        $this->actingAs($this->user, 'sanctum')
            ->putJson('/api/me/preferences', [])
            ->assertStatus(422);
    }
}
