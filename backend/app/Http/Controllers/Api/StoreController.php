<?php

namespace App\Http\Controllers\Api;

use App\Models\Store;
use App\Support\GstStateCodes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class StoreController
{
    public function show(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);

        if (!$store) {
            return response()->json([
                'success' => false,
                'message' => 'A store context is required (X-Store-Id header or a paired counter).',
            ], 404);
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
            'drug_license_numbers' => $store->drug_license_numbers ?? [],
            'fssai_no' => $store->fssai_no,
            'tax_mode' => $store->tax_mode ?? 'inclusive',
            'store_type' => $store->store_type ?? 'pharmacy',
            'gst_type' => $store->gst_type ?? 'regular',
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
        $store = $this->resolveStore($request);

        if (!$store) {
            return response()->json([
                'success' => false,
                'message' => 'A store context is required (X-Store-Id header or a paired counter).',
            ], 404);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'address' => 'nullable|string',
            'state_code' => ['sometimes', 'required', 'string', Rule::in(GstStateCodes::all())],
            'gstin' => 'nullable|string|max:20',
            'drug_license_numbers' => 'nullable|array',
            'fssai_no' => 'nullable|string|max:50',
            'timezone' => 'nullable|string|max:64',
            'tax_mode' => 'nullable|in:inclusive,exclusive',
            'store_type' => 'nullable|string|in:pharmacy,cosmetics,kirana_general,clothing,electronics,stationery,wholesale,restaurant,other',
            'gst_type' => 'nullable|string|in:regular,composition,no_tax',
            'invoice_prefix' => 'nullable|string|max:20',
            'enabled_menu_items' => 'nullable|array',
            'feature_flags' => 'nullable|array',
        ]);

        $gstin = array_key_exists('gstin', $validated) ? $validated['gstin'] : $store->gstin;
        $gstin = $gstin === null ? null : trim($gstin);
        if ($gstin === '') {
            $gstin = null;
        }
        $stateCode = GstStateCodes::normalize($validated['state_code'] ?? $store->state_code);

        if ($gstin !== null && !GstStateCodes::isValidGstin($gstin)) {
            throw ValidationException::withMessages([
                'gstin' => 'Enter a valid 15-character GSTIN or leave it blank.',
            ]);
        }
        if ($gstin !== null && $stateCode !== null && GstStateCodes::fromGstin($gstin) !== $stateCode) {
            throw ValidationException::withMessages([
                'state_code' => "State code {$stateCode} does not match the GSTIN's state.",
            ]);
        }

        $store->update($validated);

        return response()->json([
            'success' => true,
            'message' => 'Store profile updated successfully',
        ]);
    }

    /**
     * The counter's own store outranks everything else: a paired till is the
     * tenant principal, so no header or token can make it read or rewrite a
     * different branch. A person keeps the store their account belongs to.
     */
    private function resolveStore(Request $request): ?Store
    {
        $deviceStoreId = $request->attributes->get('device_store_id');
        if (!empty($deviceStoreId)) {
            return Store::find((int) $deviceStoreId);
        }

        $candidate = $request->header('X-Store-Id')
            ?: $request->header('Store-Id')
            ?: $request->input('store_id')
            ?: ($request->user()?->store_id);

        if ($candidate === null || $candidate === '' || strtolower((string) $candidate) === 'all') {
            return null;
        }

        return Store::find((int) $candidate);
    }
}
