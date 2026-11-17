<?php

namespace Tests\Unit;

use App\Services\PermissionMap;
use PHPUnit\Framework\TestCase;

class PermissionMapTest extends TestCase
{
    public function test_expands_wildcards_and_dotted_actions(): void
    {
        $normalized = PermissionMap::normalize([
            'sales' => '*',
            'reports' => true,
            'purchases' => ['view', 'purchases.edit', 'delete', 'unknown-action'],
        ]);

        $this->assertSame(['view', 'create', 'edit', 'delete', 'export'], $normalized['sales']);
        $this->assertSame(['view', 'export'], $normalized['reports']);
        $this->assertSame(['view', 'edit', 'delete'], $normalized['purchases']);
    }

    public function test_drops_unknown_modules_and_empty_allow_lists_are_kept(): void
    {
        $normalized = PermissionMap::normalize([
            'not_a_module' => ['view'],
            'inventory' => [],
            'stores' => ['nonsense'],
        ]);

        $this->assertArrayNotHasKey('not_a_module', $normalized);
        $this->assertSame([], $normalized['inventory']);
        $this->assertSame([], $normalized['stores']);
    }

    public function test_rejects_list_shaped_and_non_array_input(): void
    {
        $this->assertSame([], PermissionMap::normalize(['*']));
        $this->assertSame([], PermissionMap::normalize('sales'));
        $this->assertSame([], PermissionMap::normalize(null));
    }
}
