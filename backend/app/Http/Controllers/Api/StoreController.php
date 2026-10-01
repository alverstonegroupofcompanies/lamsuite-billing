<?php

namespace App\Http\Controllers\Api;

use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class StoreController
{
    public function show(Request $request): JsonResponse
    {
        $storeId = $request->header('X-Store-Id') ?? ($request->user() ? $request->user()->store_id : 1);
        $store = Store::find($storeId) ?? Store::first();

        if (!$store) {
            return response()->json([
                'id' => 1,
                'name' => 'LamStone Pharmacy & Retail',
                'code' => 'STORE-01',
                'is_active' => true,
                'enabled_menu_items' => ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings'],
            ]);
        }

        return response()->json([
            'id' => $store->id,
            'name' => $store->name,
            'code' => $store->code,
            'phone' => $store->phone,
            'email' => $store->email,
            'address' => $store->address,
            'state_code' => $store->state_code,
            'gstin' => $store->gstin,
            'drug_license_numbers' => $store->drug_license_numbers ?? ['20B-123456', '21B-123457'],
            'fssai_no' => $store->fssai_no ?? '10020041000123',
            'tax_mode' => $store->tax_mode,
            'invoice_prefix' => $store->invoice_prefix,
            'is_active' => (bool)$store->is_active,
            'license_plan' => $store->license_plan,
            'enabled_menu_items' => $store->enabled_menu_items ?? ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings'],
            'feature_flags' => $store->feature_flags ?? [],
            'version' => $store->version,
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $storeId = $request->header('X-Store-Id') ?? ($request->user() ? $request->user()->store_id : 1);
        $store = Store::find($storeId);
        if ($store) {
            $store->update($request->all());
        }

        return response()->json([
            'success' => true,
            'message' => 'Store profile updated successfully',
        ]);
    }
}
