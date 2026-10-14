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
            ['id' => 'sales_returns', 'name' => 'Sales Returns & Credit Notes', 'description' => 'Customer returns, batch restock & refunds'],
            ['id' => 'customer_debit_notes', 'name' => 'Customer Debit Notes (B2B)', 'description' => 'Multi-invoice reconciliation & GST credit notes'],
            ['id' => 'purchases', 'name' => 'Purchase Management', 'description' => 'Inward stock bills, supplier invoice entry & ITC'],
            ['id' => 'purchase_returns', 'name' => 'Purchase Returns (Debit Notes)', 'description' => 'Stock debit notes & supplier return notes'],
            ['id' => 'stock', 'name' => 'Stock & Inventory', 'description' => 'Stock ledger, batch view, near-expiry alerts & adjustments'],
            ['id' => 'stock_transfers', 'name' => 'Inter-Store Transfers', 'description' => 'Multi-item branch dispatch, receipt & delivery challans'],
            ['id' => 'reports', 'name' => 'Reports & GST Hub', 'description' => 'GSTR-1, HSN summary, collections, daily sales & doctor reports'],
            ['id' => 'masters', 'name' => 'Master Data', 'description' => 'Catalog products, batches, customers, doctors & suppliers'],
            ['id' => 'counters', 'name' => 'Store Counters & Fleet', 'description' => 'Multi-counter LAN topology, cashier shifts & drawer management'],
            ['id' => 'import_export', 'name' => 'Universal Import / Export Hub', 'description' => 'Excel/CSV templates, data exchange & backups'],
            ['id' => 'settings', 'name' => 'Store Settings', 'description' => 'Printers, invoice sequences, GST rates & company profile'],
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
