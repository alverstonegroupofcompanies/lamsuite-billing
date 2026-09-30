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
        $deviceUuid = $request->input('device_uuid');
        $deviceName = $request->input('device_name', 'Counter Station');

        return response()->json([
            'success' => true,
            'device_id' => 'dev_' . substr(md5($deviceUuid), 0, 8),
            'status' => 'activated',
            'registered_at' => now()->toIso8601String(),
        ]);
    }
}
