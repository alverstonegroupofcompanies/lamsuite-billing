<?php

namespace Tests\Unit;

use App\Models\User;
use Tests\TestCase;

class UserModelTest extends TestCase
{
    public function test_user_roles_and_permissions_logic(): void
    {
        $super = new User(['role' => 'super_admin']);
        $this->assertTrue($super->isSuperAdmin());
        $this->assertTrue($super->hasPermission('stores', 'delete'));

        $support = new User(['role' => 'support']);
        $this->assertTrue($support->hasPermission('stores', 'view'));
        $this->assertTrue($support->hasPermission('stores', 'export'));
        $this->assertFalse($support->hasPermission('stores', 'delete'));
        $this->assertFalse($support->hasPermission('stores', 'create'));

        $accountant = new User(['role' => 'accountant']);
        $this->assertTrue($accountant->hasPermission('reports', 'view'));
        $this->assertFalse($accountant->hasPermission('invoices', 'delete'));
        $this->assertFalse($accountant->hasPermission('stores', 'create'));
    }

    public function test_explicit_permissions_override_role_baselines(): void
    {
        $cashier = new User([
            'role' => 'cashier',
            'permissions' => ['sales' => ['view'], 'reports' => []],
        ]);
        $this->assertTrue($cashier->hasPermission('sales', 'view'));
        $this->assertFalse($cashier->hasPermission('sales', 'edit'));
        $this->assertFalse($cashier->hasPermission('reports', 'view'));

        $cashierGranted = new User([
            'role' => 'cashier',
            'permissions' => ['purchases' => ['view', 'create']],
        ]);
        $this->assertTrue($cashierGranted->hasPermission('purchases', 'create'));
        $this->assertFalse($cashierGranted->hasPermission('purchases', 'delete'));

        $manager = new User(['role' => 'manager', 'permissions' => ['purchases' => false]]);
        $this->assertFalse($manager->hasPermission('purchases', 'view'));
        $this->assertTrue($manager->hasPermission('stores', 'edit'));

        $supportGranted = new User(['role' => 'support', 'permissions' => ['stores' => ['create']]]);
        $this->assertTrue($supportGranted->hasPermission('stores', 'create'));
    }

    public function test_permission_wildcards_and_legacy_lists(): void
    {
        $wildcardMap = new User(['role' => 'cashier', 'permissions' => ['sales' => '*']]);
        $this->assertTrue($wildcardMap->hasPermission('sales', 'delete'));

        $wildcardList = new User(['role' => 'cashier', 'permissions' => ['*']]);
        $this->assertTrue($wildcardList->hasPermission('purchases', 'delete'));

        $dotted = new User(['role' => 'cashier', 'permissions' => ['sales' => ['sales.edit']]]);
        $this->assertTrue($dotted->hasPermission('sales', 'edit'));
        $this->assertFalse($dotted->hasPermission('sales', 'view'));

        $super = new User(['role' => 'super_admin', 'permissions' => ['sales' => []]]);
        $this->assertTrue($super->hasPermission('sales', 'view'));
    }
}
