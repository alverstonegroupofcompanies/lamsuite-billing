<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminFeatureController
{
    public function show(Request $request, string $storeId): JsonResponse
    {
        $store = Store::findOrFail($storeId);

        $allPossibleMenus = [
            ['id' => 'pos', 'name' => 'POS Billing', 'description' => 'Fast checkout, barcode scan & invoice generation'],
            ['id' => 'bills', 'name' => 'Bills & Invoices', 'description' => 'History of issued sales invoices & thermal reprint'],
            ['id' => 'purchases', 'name' => 'Purchase Management', 'description' => 'Inward stock bills, supplier invoice entry & debit notes'],
            ['id' => 'stock', 'name' => 'Stock & Inventory', 'description' => 'Stock ledger, batch view, near-expiry alerts & adjustments'],
            ['id' => 'reports', 'name' => 'Reports & GST', 'description' => 'GSTR-1, HSN summary, collections, daily sales & doctor reports'],
            ['id' => 'masters', 'name' => 'Master Data', 'description' => 'Catalog products, batches, customers, doctors & suppliers'],
            ['id' => 'settings', 'name' => 'Store Settings', 'description' => 'Printers, invoice sequences, GST rates & company profile'],
            ['id' => 'expenses', 'name' => 'Expenses Tracker', 'description' => 'Daily petty cash & store overhead payments'],
            ['id' => 'returns', 'name' => 'Returns & Refunds', 'description' => 'Sales return memos & customer credit note management'],
        ];

        $defaultFeatureFlags = [
            'allow_offline_billing' => true,
            'require_doctor_on_schedule_h' => true,
            'allow_custom_discounts' => true,
            'auto_print_thermal' => true,
            'enable_wallet_credit' => true,
            'enforce_mrp_capping' => true,
            'gstr1_auto_push' => false,
            'dark_mode_allowed' => true,
        ];

        return response()->json([
            'store_id' => $store->id,
            'store_name' => $store->name,
            'all_available_menus' => $allPossibleMenus,
            'enabled_menu_items' => $store->enabled_menu_items ?? ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings'],
            'feature_flags' => array_merge($defaultFeatureFlags, $store->feature_flags ?? []),
            'version' => $store->version,
        ]);
    }

    public function update(Request $request, string $storeId): JsonResponse
    {
        $store = Store::findOrFail($storeId);

        $validated = $request->validate([
            'enabled_menu_items' => 'required|array',
            'feature_flags' => 'nullable|array',
        ]);

        $oldMenus = $store->enabled_menu_items;
        $oldFlags = $store->feature_flags;

        $store->update([
            'enabled_menu_items' => $validated['enabled_menu_items'],
            'feature_flags' => $validated['feature_flags'] ?? $store->feature_flags,
            'version' => $store->version + 1,
        ]);

        AuditLog::log(
            'update_store_features',
            'Store',
            (string)$store->id,
            ['menus' => $oldMenus, 'flags' => $oldFlags],
            ['menus' => $store->enabled_menu_items, 'flags' => $store->feature_flags],
            $store->id
        );

        return response()->json([
            'success' => true,
            'enabled_menu_items' => $store->enabled_menu_items,
            'feature_flags' => $store->feature_flags,
            'version' => $store->version,
            'message' => 'Menu and feature flags updated. Active desktop workstations will apply changes live upon next sync cycle.',
        ]);
    }
}
