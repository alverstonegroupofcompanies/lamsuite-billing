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
}
