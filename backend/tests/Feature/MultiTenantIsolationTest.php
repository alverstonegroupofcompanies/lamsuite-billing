<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MultiTenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store1;
    protected Store $store2;
    protected User $managerStore1;
    protected User $managerStore2;
    protected User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store1 = Store::create([
            'name' => 'Store Palakkad',
            'code' => 'ST-01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->store2 = Store::create([
            'name' => 'Store Kochi',
            'code' => 'ST-02',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->managerStore1 = User::create([
            'name' => 'Palakkad Manager',
            'email' => 'pkd@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->store1->id,
            'allowed_store_ids' => [$this->store1->id],
        ]);

        $this->managerStore2 = User::create([
            'name' => 'Kochi Manager',
            'email' => 'kch@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->store2->id,
            'allowed_store_ids' => [$this->store2->id],
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'super@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => null,
            'allowed_store_ids' => [$this->store1->id, $this->store2->id],
        ]);
    }

    public function test_manager_cannot_access_unauthorized_store(): void
    {
        // Manager of Store 1 attempts to pass X-Store-Id: 2 (Store 2)
        $response = $this->actingAs($this->managerStore1, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store2->id])
            ->getJson('/api/admin/products');

        $response->assertStatus(403);
        $response->assertJsonFragment([
            'message' => 'Tenant isolation violation: cross-store access denied.',
            'attempted_store_id' => $this->store2->id,
        ]);
    }

    public function test_manager_sees_only_own_store_products(): void
    {
        Product::create([
            'store_id' => $this->store1->id,
            'name' => 'Product PKD',
            'barcode' => 'PKD001',
            'hsn_sac_code' => '3004',
            'mrp' => 100,
            'sel_rate' => 90,
            'gst_percent' => 12,
            'current_stock' => 10,
        ]);

        Product::create([
            'store_id' => $this->store2->id,
            'name' => 'Product KCH',
            'barcode' => 'KCH001',
            'hsn_sac_code' => '3004',
            'mrp' => 200,
            'sel_rate' => 180,
            'gst_percent' => 12,
            'current_stock' => 20,
        ]);

        $response = $this->actingAs($this->managerStore1, 'sanctum')
            ->getJson('/api/admin/products');

        $response->assertStatus(200);
        $names = collect($response->json('data'))->pluck('name')->all();

        $this->assertContains('Product PKD', $names);
        $this->assertNotContains('Product KCH', $names);
    }

    public function test_super_admin_can_access_any_store(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store2->id])
            ->getJson('/api/admin/products');

        $response->assertStatus(200);
    }

    public function test_super_admin_all_stores_scope_returns_consolidated_data(): void
    {
        Product::create([
            'store_id' => $this->store1->id,
            'name' => 'Product PKD',
            'barcode' => 'PKD001',
            'hsn_sac_code' => '3004',
            'mrp' => 100,
            'sel_rate' => 90,
            'gst_percent' => 12,
            'current_stock' => 10,
        ]);

        Product::create([
            'store_id' => $this->store2->id,
            'name' => 'Product KCH',
            'barcode' => 'KCH001',
            'hsn_sac_code' => '3004',
            'mrp' => 200,
            'sel_rate' => 180,
            'gst_percent' => 12,
            'current_stock' => 20,
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/products');

        $response->assertStatus(200);
        $names = collect($response->json('data'))->pluck('name')->all();

        $this->assertContains('Product PKD', $names);
        $this->assertContains('Product KCH', $names);
    }

    public function test_single_store_manager_cannot_use_all_stores_scope(): void
    {
        $response = $this->actingAs($this->managerStore1, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/products');

        $response->assertStatus(403);
        $response->assertJsonFragment([
            'message' => 'All Stores scope requires access to every store.',
        ]);
    }

    public function test_all_stores_scope_is_read_only(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->postJson('/api/admin/products', [
                'name' => 'New Product',
                'barcode' => 'NEW001',
                'mrp' => 50,
                'sel_rate' => 45,
                'gst_percent' => 12,
            ]);

        $response->assertStatus(422);
        $response->assertJsonFragment([
            'message' => 'All Stores scope is read-only. Select a specific store before making changes.',
        ]);
    }

    public function test_all_stores_scope_keeps_session_endpoints_working(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->postJson('/api/admin/logout');

        $response->assertStatus(200);
        $response->assertJsonFragment(['success' => true]);
    }

    public function test_me_endpoint_exposes_all_stores_capability(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson('/api/admin/me')
            ->assertStatus(200)
            ->assertJsonPath('can_view_all_stores', true);

        $this->actingAs($this->managerStore1, 'sanctum')
            ->getJson('/api/admin/me')
            ->assertStatus(200)
            ->assertJsonPath('can_view_all_stores', false);
    }
}
