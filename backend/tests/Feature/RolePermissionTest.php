<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RolePermissionTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $superAdmin;
    protected User $supportUser;
    protected User $accountantUser;
    protected User $managerUser;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Store Test',
            'code' => 'ST-TEST',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'super@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->supportUser = User::create([
            'name' => 'Support Desk',
            'email' => 'support@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'support',
            'store_id' => $this->store->id,
        ]);

        $this->accountantUser = User::create([
            'name' => 'Chief Accountant',
            'email' => 'accountant@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'accountant',
            'store_id' => $this->store->id,
        ]);

        $this->managerUser = User::create([
            'name' => 'Floor Manager',
            'email' => 'manager@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->store->id,
        ]);
    }

    public function test_support_user_can_view_but_cannot_create_or_edit(): void
    {
        // View products -> Allowed
        $viewRes = $this->actingAs($this->supportUser, 'sanctum')
            ->getJson('/api/admin/products');
        $viewRes->assertStatus(200);

        // Create product -> 403 Forbidden
        $createRes = $this->actingAs($this->supportUser, 'sanctum')
            ->postJson('/api/admin/products', [
                'store_id' => $this->store->id,
                'name' => 'Blocked Item',
                'hsn_sac_code' => '3004',
                'mrp' => 50,
                'sel_rate' => 45,
                'gst_percent' => 12,
            ]);
        $createRes->assertStatus(403);
    }

    public function test_accountant_user_sees_reports_only_and_cannot_cancel_invoice(): void
    {
        // Access reports -> Allowed
        $repRes = $this->actingAs($this->accountantUser, 'sanctum')
            ->getJson('/api/admin/reports/sales');
        $repRes->assertStatus(200);

        // Attempting to cancel an invoice -> 403 Forbidden
        $inv = Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => 'INV-001',
            'invoice_date' => date('Y-m-d'),
            'grand_total' => 100,
            'status' => 'issued',
        ]);

        $cancelRes = $this->actingAs($this->accountantUser, 'sanctum')
            ->postJson("/api/admin/invoices/{$inv->id}/cancel", ['reason' => 'Testing unauthorized cancellation']);
        $cancelRes->assertStatus(403);
    }

    public function test_manager_cannot_reset_store(): void
    {
        $resetRes = $this->actingAs($this->managerUser, 'sanctum')
            ->postJson("/api/admin/stores/{$this->store->id}/reset", [
                'confirmation_phrase' => 'RESET STORE STORE TEST',
                'reason' => 'Unauthorized manager reset attempt',
            ]);

        $resetRes->assertStatus(403);
    }

    public function test_permission_matrix_payload_is_normalized_when_saving_a_user(): void
    {
        $res = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/users', [
                'name' => 'Counter Cashier',
                'email' => 'cashier@lamstone.in',
                'username' => 'cashier1',
                'password' => 'password123',
                'role' => 'cashier',
                'store_id' => $this->store->id,
                'permissions' => [
                    'sales' => true,
                    'reports' => [],
                    'purchases' => ['view', 'purchases.edit', 'bogus'],
                    'not_a_module' => ['view'],
                ],
            ]);

        $res->assertStatus(201);

        $saved = User::where('email', 'cashier@lamstone.in')->firstOrFail();
        $this->assertSame(['view', 'create', 'edit', 'delete', 'export'], $saved->permissions['sales']);
        $this->assertSame([], $saved->permissions['reports']);
        $this->assertSame(['view', 'edit'], $saved->permissions['purchases']);
        $this->assertArrayNotHasKey('not_a_module', $saved->permissions);

        $this->assertFalse($saved->hasPermission('reports', 'view'));
        $this->assertTrue($saved->hasPermission('sales', 'edit'));
    }

    public function test_non_super_admin_cannot_create_or_modify_super_admin_accounts(): void
    {
        $createRes = $this->actingAs($this->managerUser, 'sanctum')
            ->postJson('/api/admin/users', [
                'name' => 'Rogue Admin',
                'email' => 'rogue@lamstone.in',
                'password' => 'password123',
                'role' => 'super_admin',
                'store_id' => $this->store->id,
            ]);
        $createRes->assertStatus(403);

        $updateRes = $this->actingAs($this->managerUser, 'sanctum')
            ->putJson("/api/admin/users/{$this->superAdmin->id}", [
                'name' => 'Hijacked Admin',
            ]);
        $updateRes->assertStatus(403);
    }
}
