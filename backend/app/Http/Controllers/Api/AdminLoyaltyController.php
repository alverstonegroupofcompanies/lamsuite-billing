<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\Invoice;
use App\Models\LoyaltyLedger;
use App\Models\LoyaltyProgram;
use App\Models\Party;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminLoyaltyController
{
    private function resolveStore(Request $request): ?Store
    {
        // A paired counter may only act against the store its token was issued
        // for, and nothing that names no store is pointed at whichever tenant
        // happens to be first.
        $deviceStoreId = $request->attributes->get('device_store_id');
        if (!empty($deviceStoreId)) {
            return Store::find((int) $deviceStoreId);
        }

        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? ($request->user() ? $request->user()->store_id : null);

        if ($candidate !== null && $candidate !== '' && $candidate !== 'all') {
            return Store::find((int) $candidate);
        }

        return null;
    }

    private function programFor(Store $store): LoyaltyProgram
    {
        return LoyaltyProgram::firstOrCreate(
            ['store_id' => $store->id],
            [
                'is_active' => false,
                'earn_points_per_100' => 1,
                'redeem_value_per_point' => 0.25,
                'min_redeem_points' => 100,
            ]
        );
    }

    private function presentProgram(LoyaltyProgram $program): array
    {
        return [
            'id' => $program->id,
            'store_id' => $program->store_id,
            'is_active' => (bool) $program->is_active,
            'earn_points_per_100' => (float) $program->earn_points_per_100,
            'redeem_value_per_point' => (float) $program->redeem_value_per_point,
            'min_redeem_points' => (int) $program->min_redeem_points,
            'expiry_days' => $program->expiry_days,
        ];
    }

    private function presentCoupon(Coupon $coupon): array
    {
        return [
            'id' => $coupon->id,
            'store_id' => $coupon->store_id,
            'code' => $coupon->code,
            'description' => $coupon->description,
            'discount_type' => $coupon->discount_type,
            'value' => (float) $coupon->value,
            'min_bill_amount' => (float) $coupon->min_bill_amount,
            'max_discount' => $coupon->max_discount !== null ? (float) $coupon->max_discount : null,
            'valid_from' => $coupon->valid_from?->toDateString(),
            'valid_to' => $coupon->valid_to?->toDateString(),
            'usage_limit' => $coupon->usage_limit,
            'used_count' => (int) $coupon->used_count,
            'is_active' => (bool) $coupon->is_active,
            'is_valid_now' => $coupon->isCurrentlyValid(),
            'created_at' => $coupon->created_at?->toIso8601String(),
        ];
    }

    private function balanceFor(int $storeId, int $customerId): float
    {
        return (float) LoyaltyLedger::where('store_id', $storeId)
            ->where('customer_id', $customerId)
            ->sum('points_delta');
    }

    private function resolveInvoice(Store $store, $invoiceId): ?Invoice
    {
        if ($invoiceId === null || $invoiceId === '') {
            return null;
        }
        $query = Invoice::where('store_id', $store->id);
        if (is_numeric($invoiceId)) {
            $found = (clone $query)->where('id', (int) $invoiceId)->first();
            if ($found) {
                return $found;
            }
        }

        return $query->where('external_id', (string) $invoiceId)->first();
    }

    public function program(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $program = $this->programFor($store);
        $pointsOutstanding = (float) LoyaltyLedger::where('store_id', $store->id)->sum('points_delta');

        return response()->json([
            'success' => true,
            'program' => $this->presentProgram($program),
            'stats' => [
                'members' => LoyaltyLedger::where('store_id', $store->id)->distinct('customer_id')->count('customer_id'),
                'points_outstanding' => round($pointsOutstanding, 2),
                'redemptions_value' => (float) CouponRedemption::where('store_id', $store->id)->sum('discount_amount'),
            ],
        ]);
    }

    public function updateProgram(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'is_active' => 'sometimes|boolean',
            'earn_points_per_100' => 'sometimes|numeric|min:0|max:1000',
            'redeem_value_per_point' => 'sometimes|numeric|min:0|max:1000',
            'min_redeem_points' => 'sometimes|integer|min:0|max:1000000',
            'expiry_days' => 'nullable|integer|min:1|max:3650',
        ]);

        $program = $this->programFor($store);
        $before = $this->presentProgram($program);
        $program->update($validated);

        AuditLog::log('update_loyalty_program', 'LoyaltyProgram', (string) $program->id, $before, $this->presentProgram($program), $store->id);

        return response()->json(['success' => true, 'program' => $this->presentProgram($program->refresh())]);
    }

    public function coupons(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $query = Coupon::where('store_id', $store->id);
        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('code', 'like', "%{$search}%")->orWhere('description', 'like', "%{$search}%");
            });
        }
        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $query->where('is_active', filter_var($request->query('is_active'), FILTER_VALIDATE_BOOLEAN));
        }

        return response()->json([
            'success' => true,
            'coupons' => $query->orderByDesc('id')->get()->map(fn (Coupon $c) => $this->presentCoupon($c))->values(),
        ]);
    }

    public function storeCoupon(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'code' => 'required|string|max:40',
            'description' => 'nullable|string|max:255',
            'discount_type' => 'required|in:percent,amount',
            'value' => 'required|numeric|min:0.01|max:10000000',
            'min_bill_amount' => 'nullable|numeric|min:0|max:10000000',
            'max_discount' => 'nullable|numeric|min:0|max:10000000',
            'valid_from' => 'nullable|date',
            'valid_to' => 'nullable|date|after_or_equal:valid_from',
            'usage_limit' => 'nullable|integer|min:1|max:1000000',
            'is_active' => 'nullable|boolean',
        ]);

        if ($validated['discount_type'] === 'percent' && (float) $validated['value'] > 100) {
            return response()->json(['success' => false, 'message' => 'Percentage discount cannot exceed 100%.'], 422);
        }

        $code = strtoupper(trim($validated['code']));
        if (Coupon::where('store_id', $store->id)->where('code', $code)->exists()) {
            return response()->json(['success' => false, 'message' => 'A coupon with this code already exists.'], 422);
        }

        $coupon = Coupon::create([
            'store_id' => $store->id,
            'code' => $code,
            'description' => $validated['description'] ?? null,
            'discount_type' => $validated['discount_type'],
            'value' => $validated['value'],
            'min_bill_amount' => $validated['min_bill_amount'] ?? 0,
            'max_discount' => $validated['max_discount'] ?? null,
            'valid_from' => $validated['valid_from'] ?? null,
            'valid_to' => $validated['valid_to'] ?? null,
            'usage_limit' => $validated['usage_limit'] ?? null,
            'is_active' => $validated['is_active'] ?? true,
            'created_by' => $request->user()?->id,
        ]);

        AuditLog::log('create_coupon', 'Coupon', (string) $coupon->id, null, $coupon->only(['code', 'discount_type', 'value']), $store->id);

        return response()->json(['success' => true, 'coupon' => $this->presentCoupon($coupon)], 201);
    }

    public function updateCoupon(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $coupon = Coupon::where('store_id', $store?->id)->findOrFail($id);

        $validated = $request->validate([
            'code' => 'sometimes|required|string|max:40',
            'description' => 'nullable|string|max:255',
            'discount_type' => 'sometimes|required|in:percent,amount',
            'value' => 'sometimes|required|numeric|min:0.01|max:10000000',
            'min_bill_amount' => 'nullable|numeric|min:0|max:10000000',
            'max_discount' => 'nullable|numeric|min:0|max:10000000',
            'valid_from' => 'nullable|date',
            'valid_to' => 'nullable|date|after_or_equal:valid_from',
            'usage_limit' => 'nullable|integer|min:1|max:1000000',
            'is_active' => 'sometimes|boolean',
        ]);

        if (isset($validated['code'])) {
            $validated['code'] = strtoupper(trim($validated['code']));
            $dup = Coupon::where('store_id', $coupon->store_id)
                ->where('code', $validated['code'])
                ->where('id', '!=', $coupon->id)
                ->exists();
            if ($dup) {
                return response()->json(['success' => false, 'message' => 'A coupon with this code already exists.'], 422);
            }
        }
        $type = $validated['discount_type'] ?? $coupon->discount_type;
        $value = $validated['value'] ?? (float) $coupon->value;
        if ($type === 'percent' && (float) $value > 100) {
            return response()->json(['success' => false, 'message' => 'Percentage discount cannot exceed 100%.'], 422);
        }

        $before = $this->presentCoupon($coupon);
        $coupon->update($validated);
        AuditLog::log('update_coupon', 'Coupon', (string) $coupon->id, $before, $this->presentCoupon($coupon->refresh()), $coupon->store_id);

        return response()->json(['success' => true, 'coupon' => $this->presentCoupon($coupon->refresh())]);
    }

    public function destroyCoupon(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $coupon = Coupon::where('store_id', $store?->id)->findOrFail($id);

        AuditLog::log('delete_coupon', 'Coupon', (string) $coupon->id, $coupon->only(['code']), null, $coupon->store_id);
        $coupon->delete();

        return response()->json(['success' => true, 'message' => 'Coupon deleted.']);
    }

    public function ledger(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $query = LoyaltyLedger::where('store_id', $store->id)->with('customer:id,name,phone');
        if ($customerId = $request->query('customer_id')) {
            $query->where('customer_id', (int) $customerId);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $query->whereHas('customer', function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")->orWhere('phone', 'like', "%{$search}%");
            });
        }

        $perPage = min(500, max(1, (int) $request->query('per_page', 100)));
        $rows = $query->orderByDesc('id')->paginate($perPage);

        return response()->json([
            'success' => true,
            'entries' => collect($rows->items())->map(fn (LoyaltyLedger $entry) => [
                'id' => $entry->id,
                'customer_id' => $entry->customer_id,
                'customer_name' => $entry->customer?->name,
                'customer_phone' => $entry->customer?->phone,
                'invoice_id' => $entry->invoice_id,
                'type' => $entry->type,
                'points_delta' => (float) $entry->points_delta,
                'balance_after' => (float) $entry->balance_after,
                'note' => $entry->note,
                'created_at' => $entry->created_at?->toIso8601String(),
            ])->values(),
            'meta' => [
                'current_page' => $rows->currentPage(),
                'last_page' => $rows->lastPage(),
                'total' => $rows->total(),
            ],
        ]);
    }

    public function adjustPoints(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'customer_id' => 'required|integer',
            'points_delta' => 'required|numeric|min:-1000000|max:1000000|not_in:0',
            'note' => 'nullable|string|max:255',
        ]);

        $customer = Party::where('store_id', $store->id)->find($validated['customer_id']);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Customer not found in this store.'], 422);
        }

        $balance = $this->balanceFor($store->id, $customer->id);
        $newBalance = $balance + (float) $validated['points_delta'];
        if ($newBalance < 0) {
            return response()->json([
                'success' => false,
                'message' => "Adjustment would take the balance below zero (current: {$balance}).",
            ], 422);
        }

        $entry = LoyaltyLedger::create([
            'store_id' => $store->id,
            'customer_id' => $customer->id,
            'invoice_id' => null,
            'type' => 'adjust',
            'points_delta' => $validated['points_delta'],
            'balance_after' => $newBalance,
            'note' => $validated['note'] ?? null,
            'created_by' => $request->user()?->id,
        ]);

        AuditLog::log('adjust_loyalty_points', 'LoyaltyLedger', (string) $entry->id, ['balance' => $balance], [
            'points_delta' => (float) $validated['points_delta'],
            'balance_after' => $newBalance,
            'customer_id' => $customer->id,
        ], $store->id);

        return response()->json([
            'success' => true,
            'balance' => $newBalance,
            'entry' => $entry,
        ]);
    }

    public function balance(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }
        $customerId = (int) $request->query('customer_id');
        if (!$customerId) {
            return response()->json(['success' => true, 'balance' => 0, 'program' => $this->presentProgram($this->programFor($store))]);
        }

        return response()->json([
            'success' => true,
            'balance' => $this->balanceFor($store->id, $customerId),
            'program' => $this->presentProgram($this->programFor($store)),
        ]);
    }

    public function validateCoupon(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'code' => 'required|string|max:40',
            'bill_amount' => 'required|numeric|min:0|max:100000000',
            'customer_id' => 'nullable|integer',
        ]);

        $code = strtoupper(trim($validated['code']));
        $coupon = Coupon::where('store_id', $store->id)->where('code', $code)->first();
        if (!$coupon) {
            return response()->json(['success' => false, 'message' => 'Coupon not found.'], 404);
        }
        if (!$coupon->isCurrentlyValid()) {
            return response()->json(['success' => false, 'message' => 'This coupon is inactive or expired.'], 422);
        }
        if ((float) $validated['bill_amount'] < (float) $coupon->min_bill_amount) {
            return response()->json([
                'success' => false,
                'message' => 'Minimum bill amount for this coupon is ₹' . number_format((float) $coupon->min_bill_amount, 2),
            ], 422);
        }

        return response()->json([
            'success' => true,
            'coupon' => $this->presentCoupon($coupon),
            'discount_amount' => $coupon->discountFor((float) $validated['bill_amount']),
        ]);
    }

    public function redeemCoupon(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'code' => 'required|string|max:40',
            'invoice_id' => 'required|string|max:120',
            'bill_amount' => 'required|numeric|min:0|max:100000000',
            'customer_id' => 'nullable|integer',
        ]);

        $invoice = $this->resolveInvoice($store, $validated['invoice_id']);
        if (!$invoice) {
            return response()->json(['success' => false, 'message' => 'Invoice not found for coupon redemption.'], 404);
        }

        $code = strtoupper(trim($validated['code']));
        $coupon = Coupon::where('store_id', $store->id)->where('code', $code)->first();
        if (!$coupon) {
            return response()->json(['success' => false, 'message' => 'Coupon not found.'], 404);
        }

        $existing = CouponRedemption::where('coupon_id', $coupon->id)->where('invoice_id', $invoice->id)->first();
        if ($existing) {
            return response()->json([
                'success' => true,
                'already_redeemed' => true,
                'discount_amount' => (float) $existing->discount_amount,
            ]);
        }

        if (!$coupon->isCurrentlyValid()) {
            return response()->json(['success' => false, 'message' => 'This coupon is inactive or expired.'], 422);
        }
        if ((float) $validated['bill_amount'] < (float) $coupon->min_bill_amount) {
            return response()->json(['success' => false, 'message' => 'Bill does not meet the coupon minimum amount.'], 422);
        }

        $discount = $coupon->discountFor((float) $validated['bill_amount']);

        DB::transaction(function () use ($coupon, $store, $invoice, $validated, $code, $discount) {
            CouponRedemption::create([
                'coupon_id' => $coupon->id,
                'store_id' => $store->id,
                'invoice_id' => $invoice->id,
                'customer_id' => $validated['customer_id'] ?? $invoice->customer_id,
                'code' => $code,
                'bill_amount' => $validated['bill_amount'],
                'discount_amount' => $discount,
            ]);
            $coupon->increment('used_count');
        });

        return response()->json([
            'success' => true,
            'discount_amount' => $discount,
        ], 201);
    }

    public function earnPoints(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'invoice_id' => 'required|string|max:120',
            'customer_id' => 'nullable|integer',
            'bill_amount' => 'required|numeric|min:0|max:100000000',
        ]);

        $program = $this->programFor($store);
        if (!$program->is_active) {
            return response()->json(['success' => true, 'points_earned' => 0, 'balance' => 0, 'program_active' => false]);
        }

        $invoice = $this->resolveInvoice($store, $validated['invoice_id']);
        $customerId = (int) ($validated['customer_id'] ?? $invoice?->customer_id ?? 0);
        if (!$customerId) {
            return response()->json(['success' => true, 'points_earned' => 0, 'balance' => 0, 'program_active' => true]);
        }
        if (!Party::where('store_id', $store->id)->where('id', $customerId)->exists()) {
            return response()->json(['success' => false, 'message' => 'Customer not found in this store.'], 422);
        }

        if ($invoice) {
            $existing = LoyaltyLedger::where('invoice_id', $invoice->id)->where('type', 'earn')->first();
            if ($existing) {
                return response()->json([
                    'success' => true,
                    'points_earned' => (float) $existing->points_delta,
                    'balance' => (float) $existing->balance_after,
                    'already_credited' => true,
                ]);
            }
        }

        $rate = (float) $program->earn_points_per_100;
        $points = round(((float) $validated['bill_amount'] / 100) * $rate, 2);
        if ($points <= 0) {
            return response()->json(['success' => true, 'points_earned' => 0, 'balance' => $this->balanceFor($store->id, $customerId)]);
        }

        $balance = $this->balanceFor($store->id, $customerId) + $points;
        LoyaltyLedger::create([
            'store_id' => $store->id,
            'customer_id' => $customerId,
            'invoice_id' => $invoice?->id,
            'type' => 'earn',
            'points_delta' => $points,
            'balance_after' => $balance,
            'note' => $invoice ? "Earned on invoice #{$invoice->invoice_number}" : 'Points earned',
            'created_by' => $request->user()?->id,
        ]);

        return response()->json([
            'success' => true,
            'points_earned' => $points,
            'balance' => $balance,
        ], 201);
    }

    public function redeemPoints(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'customer_id' => 'required|integer',
            'points' => 'required|numeric|min:1|max:1000000',
            'invoice_id' => 'nullable|string|max:120',
            'bill_amount' => 'nullable|numeric|min:0|max:100000000',
        ]);

        $program = $this->programFor($store);
        if (!$program->is_active) {
            return response()->json(['success' => false, 'message' => 'The loyalty program is not active for this store.'], 422);
        }

        $points = (float) $validated['points'];
        if ($points < (int) $program->min_redeem_points) {
            return response()->json([
                'success' => false,
                'message' => "Minimum redeemable points is {$program->min_redeem_points}.",
            ], 422);
        }

        $customer = Party::where('store_id', $store->id)->find($validated['customer_id']);
        if (!$customer) {
            return response()->json(['success' => false, 'message' => 'Customer not found in this store.'], 422);
        }

        $balance = $this->balanceFor($store->id, $customer->id);
        if ($points > $balance) {
            return response()->json(['success' => false, 'message' => "Insufficient points (balance: {$balance})."], 422);
        }

        $discount = round($points * (float) $program->redeem_value_per_point, 2);
        if (!empty($validated['bill_amount'])) {
            $discount = min($discount, (float) $validated['bill_amount']);
        }

        $invoice = $this->resolveInvoice($store, $validated['invoice_id'] ?? null);
        $newBalance = $balance - $points;
        LoyaltyLedger::create([
            'store_id' => $store->id,
            'customer_id' => $customer->id,
            'invoice_id' => $invoice?->id,
            'type' => 'redeem',
            'points_delta' => -$points,
            'balance_after' => $newBalance,
            'note' => $invoice ? "Redeemed on invoice #{$invoice->invoice_number}" : 'Points redeemed',
            'created_by' => $request->user()?->id,
        ]);

        return response()->json([
            'success' => true,
            'discount_amount' => $discount,
            'points_redeemed' => $points,
            'balance' => $newBalance,
        ], 201);
    }
}
