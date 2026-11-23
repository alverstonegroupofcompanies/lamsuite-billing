<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use App\Models\Party;
use App\Models\Store;
use App\Services\Gst\PartyStateResolver;
use App\Support\GstStateCodes;
use App\Support\RequestTenant;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class CustomerController
{
    public function index(Request $request): JsonResponse
    {
        $search = $request->query('search', $request->query('query', ''));
        $limit = (int) $request->query('limit', 25);
        $storeId = RequestTenant::storeId($request);

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
            'state_code' => ['nullable', 'string', Rule::in(GstStateCodes::all())],
            'credit_limit' => 'nullable|numeric|min:0',
            'opening_balance' => 'nullable|numeric',
        ]);

        $storeId = RequestTenant::requireStoreId($request);
        $this->assertGstinMatchesState($validated['gstin'] ?? null, $validated['state_code'] ?? null);

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
            'state_code' => app(PartyStateResolver::class)->resolve(
                $validated['state_code'] ?? null,
                $validated['gstin'] ?? null,
                Store::find($storeId)
            ),
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
            'state_code' => ['nullable', 'string', Rule::in(GstStateCodes::all())],
            'credit_limit' => 'nullable|numeric|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        if (isset($validated['gstin'])) {
            $validated['gstin'] = strtoupper($validated['gstin']);
        }

        $gstin = array_key_exists('gstin', $validated) ? $validated['gstin'] : $customer->gstin;
        $this->assertGstinMatchesState(
            $gstin,
            array_key_exists('state_code', $validated) ? $validated['state_code'] : $customer->state_code
        );

        if (!array_key_exists('state_code', $validated) || $validated['state_code'] === null) {
            if (GstStateCodes::isValidGstin($gstin)) {
                $validated['state_code'] = GstStateCodes::fromGstin($gstin);
            } else {
                unset($validated['state_code']);
            }
        }

        $customer->update($validated);
        return response()->json($customer);
    }

    private function assertGstinMatchesState(?string $gstin, ?string $stateCode): void
    {
        $gstin = $gstin === null ? null : trim($gstin);
        if ($gstin === '') {
            $gstin = null;
        }

        if ($gstin !== null && !GstStateCodes::isValidGstin($gstin)) {
            throw ValidationException::withMessages([
                'gstin' => 'Enter a valid 15-character GSTIN or leave it blank.',
            ]);
        }

        $stateCode = GstStateCodes::normalize($stateCode);
        if ($stateCode !== null && !GstStateCodes::isValid($stateCode)) {
            throw ValidationException::withMessages([
                'state_code' => 'Choose a valid GST state code (01-38 or 97).',
            ]);
        }

        if ($gstin !== null && $stateCode !== null && GstStateCodes::fromGstin($gstin) !== $stateCode) {
            throw ValidationException::withMessages([
                'state_code' => "State code {$stateCode} does not match the GSTIN's state.",
            ]);
        }
    }
}
