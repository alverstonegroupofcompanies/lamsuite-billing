<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class StoreController
{
    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'id' => 1,
            'name' => 'LamStone Pharmacy & Retail',
            'code' => 'STORE-01',
            'phone' => '9876543210',
            'email' => 'store@lamstone.in',
            'address' => 'Main Road, Palakkad, Kerala',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5',
            'drug_license_numbers' => ['20B-123456', '21B-123457'],
            'fssai_no' => '10020041000123',
            'tax_mode' => 'inclusive',
            'invoice_prefix' => 'INV',
            'enabled_menu_items' => ['pos', 'purchases', 'stock', 'reports', 'masters', 'settings'],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => 'Store profile updated successfully',
        ]);
    }
}
