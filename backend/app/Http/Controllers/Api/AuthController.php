<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class AuthController
{
    public function login(Request $request): JsonResponse
    {
        $email = $request->input('email');
        $password = $request->input('password');

        if (empty($email) || empty($password)) {
            return response()->json(['message' => 'Invalid credentials'], 422);
        }

        // Demo/Admin token issuance
        return response()->json([
            'token' => 'demo_token_' . md5($email . time()),
            'user' => [
                'id' => 1,
                'name' => 'Store Admin',
                'email' => $email,
                'role' => 'admin',
            ],
            'store' => [
                'id' => 1,
                'name' => 'LamStone Pharmacy & Retail',
                'code' => 'STORE-01',
            ],
        ]);
    }

    public function registerDevice(Request $request): JsonResponse
    {
        $activationKey = $request->input('activation_key');
        $deviceUuid = $request->input('device_uuid', 'uuid_' . uniqid());
        $deviceName = $request->input('device_name', 'Counter Station');
        $storeId = $request->input('store_id');
        $isHub = (bool) $request->input('is_hub', false);

        // If activation_key is supplied, validate directly against database
        $store = null;
        if (!empty($activationKey)) {
            $store = \App\Models\Store::where('activation_key', trim($activationKey))->first();
            if (!$store) {
                // Also check if key matches store code
                $store = \App\Models\Store::where('code', strtoupper(trim($activationKey)))->first();
            }
        } elseif (!empty($storeId)) {
            $store = \App\Models\Store::find($storeId) ?? \App\Models\Store::where('code', $storeId)->first();
        }

        if (!$store) {
            $store = \App\Models\Store::first();
        }

        $deviceId = 'dev_' . substr(md5($deviceUuid), 0, 8);
        $counterId = 'cntr_' . substr(md5($deviceUuid), 0, 6);

        // Check if this store already has an admin or manager staff user
        $hasAdminStaff = false;
        if ($store) {
            $hasAdminStaff = \App\Models\User::where('store_id', $store->id)
                ->whereIn('role', ['admin', 'store_owner', 'super_admin', 'manager'])
                ->exists();
        }

        return response()->json([
            'success' => true,
            'device_id' => $deviceId,
            'counter_id' => $counterId,
            'counter_name' => $deviceName,
            'store_id' => $store ? (string)$store->id : 'store_main',
            'store_name' => $store ? $store->name : 'LamStone Pharmacy & Retail',
            'store_code' => $store ? $store->code : 'MAIN',
            'is_hub' => $isHub,
            'device_token' => 'jwt_dev_' . bin2hex(random_bytes(16)),
            'refresh_token' => 'ref_dev_' . bin2hex(random_bytes(16)),
            'license_plan' => $store->license_plan ?? 'Enterprise Retail & Pharmacy Chain',
            'license_status' => $store->is_active ? 'active' : 'revoked',
            'license_expires_at' => $store->license_expires_at ? $store->license_expires_at->toDateString() : '2027-12-31',
            'status' => 'activated',
            'admin_staff_present' => $hasAdminStaff,
            'registered_at' => now()->toIso8601String(),
        ]);
    }

    public function branches(): JsonResponse
    {
        return response()->json([
            'data' => [
                [
                    'id' => 'store_main',
                    'name' => 'LamStone Pharmacy & Clinic (Main Store)',
                    'code' => 'MAIN',
                    'city' => 'Palakkad',
                    'state_code' => '32',
                    'gstin' => '32AAAAA0000A1Z5',
                    'is_main' => true,
                    'is_active' => true,
                ],
                [
                    'id' => 'store_north',
                    'name' => 'LamStone North Palakkad Branch',
                    'code' => 'NORTH',
                    'city' => 'Palakkad',
                    'state_code' => '32',
                    'gstin' => '32AAAAA0000A1Z5',
                    'is_main' => false,
                    'is_active' => true,
                ],
                [
                    'id' => 'store_coimbatore',
                    'name' => 'LamStone Coimbatore Medicare & Retail',
                    'code' => 'CBE_BR',
                    'city' => 'Coimbatore',
                    'state_code' => '33',
                    'gstin' => '33AAAAA0000A1Z4',
                    'is_main' => false,
                    'is_active' => true,
                ],
            ],
        ]);
    }

    public function checkLicense(Request $request): JsonResponse
    {
        return response()->json([
            'valid' => true,
            'status' => 'active',
            'license_plan' => 'Enterprise Retail & Pharmacy Chain',
            'license_expires_at' => '2027-12-31T23:59:59Z',
            'features' => ['pos', 'purchases', 'stock', 'reports', 'multi_counter', 'lan_sync'],
        ]);
    }
}
