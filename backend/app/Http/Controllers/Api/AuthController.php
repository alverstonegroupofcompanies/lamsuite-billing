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
        $deviceUuid = $request->input('device_uuid', 'uuid_' . uniqid());
        $deviceName = $request->input('device_name', 'Counter Station');
        $storeId = $request->input('store_id', 'store_main');
        $isHub = (bool) $request->input('is_hub', false);

        $deviceId = 'dev_' . substr(md5($deviceUuid), 0, 8);
        $counterId = 'cntr_' . substr(md5($deviceUuid), 0, 6);

        return response()->json([
            'success' => true,
            'device_id' => $deviceId,
            'counter_id' => $counterId,
            'counter_name' => $deviceName,
            'store_id' => $storeId,
            'is_hub' => $isHub,
            'device_token' => 'jwt_dev_' . bin2hex(random_bytes(16)),
            'refresh_token' => 'ref_dev_' . bin2hex(random_bytes(16)),
            'license_plan' => 'Enterprise Retail & Pharmacy Chain',
            'license_status' => 'active',
            'license_expires_at' => '2027-12-31T23:59:59Z',
            'status' => 'activated',
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
