<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Party;

class CustomerController
{
    public function index(Request $request): JsonResponse
    {
        $search = $request->query('search', $request->query('query', ''));
        $limit = (int) $request->query('limit', 25);
        $storeId = $request->user()?->store_id;

        $builder = Party::where('type', 'customer')->where('is_active', true);

        if ($storeId) {
            $builder->where(function ($q) use ($storeId) {
                $q->where('store_id', $storeId)->orWhereNull('store_id');
            });
        }

        if (!empty($search)) {
            $builder->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%")
                  ->orWhere('gstin', 'like', "%{$search}%")
                  ->orWhere('reg_no', 'like', "%{$search}%");
            });
        }

        $customers = $builder->orderBy('name', 'asc')->paginate($limit);
        return response()->json($customers);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'gstin' => 'nullable|string|max:15',
            'address' => 'nullable|string|max:500',
            'email' => 'nullable|email|max:255',
            'state_code' => 'nullable|string|max:10',
            'credit_limit' => 'nullable|numeric|min:0',
            'opening_balance' => 'nullable|numeric',
        ]);

        $storeId = $request->user()?->store_id;

        // Check duplicate phone if phone is provided
        if (!empty($validated['phone'])) {
            $existing = Party::where('type', 'customer')
                ->where('phone', $validated['phone'])
                ->when($storeId, fn($q) => $q->where('store_id', $storeId))
                ->first();

            if ($existing) {
                return response()->json([
                    'message' => 'Customer with this phone number already exists',
                    'customer' => $existing,
                ], 200);
            }
        }

        $customer = Party::create([
            'store_id' => $storeId,
            'type' => 'customer',
            'name' => $validated['name'],
            'phone' => $validated['phone'] ?? null,
            'gstin' => isset($validated['gstin']) ? strtoupper($validated['gstin']) : null,
            'address' => $validated['address'] ?? null,
            'email' => $validated['email'] ?? null,
            'state_code' => $validated['state_code'] ?? '32',
            'credit_limit' => $validated['credit_limit'] ?? 0,
            'opening_balance' => $validated['opening_balance'] ?? 0,
            'current_balance' => $validated['opening_balance'] ?? 0,
            'reg_no' => 'CUST-' . strtoupper(substr(uniqid(), -6)),
            'is_active' => true,
            'version' => 1,
            'external_id' => 'cust_' . time() . '_' . substr(bin2hex(random_bytes(4)), 0, 8),
        ]);

        return response()->json($customer, 201);
    }

    public function show(string $id): JsonResponse
    {
        $customer = Party::where('type', 'customer')->with('invoices')->findOrFail($id);
        return response()->json($customer);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $customer = Party::where('type', 'customer')->findOrFail($id);
        
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'gstin' => 'nullable|string|max:15',
            'address' => 'nullable|string|max:500',
            'email' => 'nullable|email|max:255',
            'state_code' => 'nullable|string|max:10',
            'credit_limit' => 'nullable|numeric|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        if (isset($validated['gstin'])) {
            $validated['gstin'] = strtoupper($validated['gstin']);
        }

        $customer->update($validated);
        return response()->json($customer);
    }
}
