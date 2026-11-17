<?php

namespace App\Services;

/**
 * Canonical module/action surface for per-user permission overrides.
 *
 * Kept in sync with the admin PermissionMatrix registry and the POS
 * accessControl module map so a saved override always maps to a real check.
 */
class PermissionMap
{
    public const MODULES = [
        // POS desktop
        'dashboard' => ['view'],
        'billing' => ['view', 'create', 'edit'],
        'sales' => ['view', 'create', 'edit', 'delete', 'export'],
        'purchases' => ['view', 'create', 'edit', 'delete', 'export'],
        'inventory' => ['view', 'create', 'edit', 'delete', 'export'],
        'masters' => ['view', 'create', 'edit', 'delete', 'export'],
        'reports' => ['view', 'export'],
        'devices' => ['view', 'create', 'edit', 'delete'],
        'import_export' => ['view', 'create', 'edit', 'export'],
        'migration' => ['view', 'edit'],
        'settings' => ['view', 'edit'],

        // Admin panel
        'stores' => ['view', 'create', 'edit', 'delete'],
        'users' => ['view', 'create', 'edit', 'delete'],
        'features' => ['view', 'edit'],
        'transactions' => ['view', 'create', 'edit', 'delete', 'export'],
        'sales_orders' => ['view', 'create', 'edit', 'delete'],
        'pricing' => ['view', 'edit'],
        'loyalty' => ['view', 'create', 'edit', 'delete'],
        'compliance' => ['view', 'edit', 'export'],
        'sync' => ['view', 'edit'],
        'audit' => ['view', 'export'],
        'notifications' => ['view'],
    ];

    /**
     * Restricts a submitted permission map to known modules/actions and expands
     * true / "*" / "module.action" entries into an explicit allow-list.
     * Unknown keys are dropped; an empty array means "no override".
     */
    public static function normalize(mixed $raw): array
    {
        if (!is_array($raw) || array_is_list($raw)) {
            return [];
        }

        $result = [];
        foreach ($raw as $module => $value) {
            if (!is_string($module) || !isset(self::MODULES[$module])) {
                continue;
            }

            $allowed = self::MODULES[$module];

            if ($value === true || $value === 1 || $value === '1' || $value === '*') {
                $result[$module] = $allowed;
                continue;
            }

            $list = is_string($value) ? [$value] : (is_array($value) ? $value : null);
            if ($list === null) {
                continue;
            }

            $actions = [];
            foreach ($list as $entry) {
                if (!is_string($entry)) {
                    continue;
                }
                $entry = trim($entry);
                if ($entry === '*') {
                    $actions = $allowed;
                    break;
                }
                if (str_starts_with($entry, $module . '.')) {
                    $entry = substr($entry, strlen($module) + 1);
                }
                if (in_array($entry, $allowed, true)) {
                    $actions[] = $entry;
                }
            }

            $result[$module] = array_values(array_unique($actions));
        }

        return $result;
    }
}
