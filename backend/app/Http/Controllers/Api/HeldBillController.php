<?php

namespace App\Http\Controllers\Api;

use App\Models\HeldBill;
use App\Models\SyncEvent;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HeldBillController
{
    private function resolveStoreId(Request $request): int
    {
        $candidate = $request->header('X-Store-Id') ?: $request->header('Store-Id');
        if (!$candidate) {
            $candidate = $request->input('store_id') ?: $request->query('store_id');
        }
        if (!$candidate && $request->user()) {
            $candidate = $request->user()->store_id;
        }

        if ($candidate !== null && $candidate !== '') {
            if (is_numeric($candidate)) {
                $store = Store::find((int)$candidate);
                if ($store) return $store->id;
            }
            $store = Store::where('code', $candidate)
                ->orWhere('id', $candidate)
                ->orWhere('name', $candidate)
                ->first();
            if ($store) return $store->id;
        }

        $first = Store::first();
        return $first ? $first->id : 1;
    }

    public function index(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $heldBills = HeldBill::where('store_id', $storeId)
            ->where('status', 'held')
            ->orderBy('held_at', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'held_bills' => $heldBills,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $validated = $request->validate([
            'id' => 'nullable|string',
            'held_by_counter_id' => 'nullable|string',
            'held_by_counter_name' => 'nullable|string',
            'held_by_user_name' => 'nullable|string',
            'customer_name' => 'nullable|string',
            'items_count' => 'required|integer',
            'grand_total' => 'required|numeric',
            'cart_payload' => 'required',
        ]);

        $id = $validated['id'] ?? ('hold_' . (int)(microtime(true) * 1000) . '_' . bin2hex(random_bytes(3)));
        $cartPayload = is_string($validated['cart_payload']) 
            ? json_decode($validated['cart_payload'], true) 
            : $validated['cart_payload'];

        $heldBill = HeldBill::updateOrCreate(
            ['id' => $id],
            [
                'store_id' => $storeId,
                'held_by_counter_id' => $validated['held_by_counter_id'] ?? 'C01',
                'held_by_counter_name' => $validated['held_by_counter_name'] ?? 'Main Counter',
                'held_by_user_name' => $validated['held_by_user_name'] ?? 'Cashier',
                'customer_name' => $validated['customer_name'] ?? 'Walk-in Customer',
                'items_count' => $validated['items_count'],
                'grand_total' => $validated['grand_total'],
                'held_at' => (int)(microtime(true) * 1000),
                'cart_payload' => $cartPayload,
                'status' => 'held',
            ]
        );

        // Broadcast to SSE stream for all counters
        SyncEvent::create([
            'store_id' => $storeId,
            'entity_type' => 'held_bill',
            'entity_id' => $heldBill->id,
            'action' => 'create',
            'client_data' => $heldBill->toArray(),
            'status' => 'resolved',
        ]);

        return response()->json([
            'success' => true,
            'held_bill' => $heldBill,
            'message' => 'Bill placed on hold and synced across counters.',
        ], 201);
    }

    public function claim(Request $request, string $id): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $counterId = $request->input('counter_id', 'C01');

        $heldBill = HeldBill::where('store_id', $storeId)->findOrFail($id);

        if ($heldBill->status !== 'held') {
            return response()->json([
                'success' => false,
                'message' => "This bill has already been {$heldBill->status} by counter {$heldBill->claimed_by_counter_id}.",
            ], 409);
        }

        $heldBill->update([
            'status' => 'claimed',
            'claimed_by_counter_id' => $counterId,
            'claimed_at' => (int)(microtime(true) * 1000),
        ]);

        // Broadcast claim event
        SyncEvent::create([
            'store_id' => $storeId,
            'entity_type' => 'held_bill',
            'entity_id' => $heldBill->id,
            'action' => 'claim',
            'client_data' => ['id' => $heldBill->id, 'claimed_by_counter_id' => $counterId],
            'status' => 'resolved',
        ]);

        return response()->json([
            'success' => true,
            'held_bill' => $heldBill,
            'message' => 'Held bill claimed successfully.',
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $heldBill = HeldBill::where('store_id', $storeId)->find($id);

        if ($heldBill) {
            $heldBill->update(['status' => 'cancelled']);

            SyncEvent::create([
                'store_id' => $storeId,
                'entity_type' => 'held_bill',
                'entity_id' => $id,
                'action' => 'delete',
                'client_data' => ['id' => $id],
                'status' => 'resolved',
            ]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Held bill removed.',
        ]);
    }
}
