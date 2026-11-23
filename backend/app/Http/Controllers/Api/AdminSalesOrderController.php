<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\DeliveryChallan;
use App\Models\DeliveryChallanItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\SalesOrder;
use App\Models\SalesOrderItem;
use App\Models\Store;
use App\Services\Sales\SalesOrderTaxService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminSalesOrderController
{
    private const ORDER_STATUSES = ['draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled'];
    private const CHALLAN_STATUSES = ['dispatched', 'delivered', 'cancelled'];

    public function __construct(private readonly SalesOrderTaxService $taxService)
    {
    }

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

    private function presentOrder(SalesOrder $order, bool $withItems = true): array
    {
        $payload = [
            'id' => $order->id,
            'store_id' => $order->store_id,
            'order_number' => $order->order_number,
            'order_date' => $order->order_date?->toDateString(),
            'expected_delivery_date' => $order->expected_delivery_date?->toDateString(),
            'customer_id' => $order->customer_id,
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_gstin' => $order->customer_gstin,
            'place_of_supply' => $order->place_of_supply,
            'status' => $order->status,
            'subtotal' => (float) $order->subtotal,
            'discount_total' => (float) $order->discount_total,
            'tax_total' => (float) $order->tax_total,
            'round_off' => (float) $order->round_off,
            'grand_total' => (float) $order->grand_total,
            'notes' => $order->notes,
            'cancel_reason' => $order->cancel_reason,
            'created_at' => $order->created_at?->toIso8601String(),
            'updated_at' => $order->updated_at?->toIso8601String(),
            'items_count' => $order->items_count ?? $order->items()->count(),
            'challans_count' => $order->challans_count ?? $order->challans()->count(),
        ];

        if ($withItems) {
            $payload['items'] = $order->items()->orderBy('id')->get()->map(fn (SalesOrderItem $item) => [
                'id' => $item->id,
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'hsn_code' => $item->hsn_code,
                'qty' => (float) $item->qty,
                'loose_qty' => (float) $item->loose_qty,
                'units_per_pack' => (int) $item->units_per_pack,
                'unit_price' => (float) $item->unit_price,
                'discount_percent' => (float) $item->discount_percent,
                'discount_amount' => (float) $item->discount_amount,
                'gst_percent' => (float) $item->gst_percent,
                'taxable_amount' => (float) $item->taxable_amount,
                'tax_amount' => (float) $item->tax_amount,
                'total_amount' => (float) $item->total_amount,
                'ordered_base_units' => $item->orderedBaseUnits(),
                'fulfilled_base_units' => (float) $item->fulfilled_base_units,
                'remaining_base_units' => max(0, $item->orderedBaseUnits() - (float) $item->fulfilled_base_units),
            ])->values()->all();
        }

        return $payload;
    }

    private function presentChallan(DeliveryChallan $challan, bool $withItems = true): array
    {
        $payload = [
            'id' => $challan->id,
            'store_id' => $challan->store_id,
            'challan_number' => $challan->challan_number,
            'challan_date' => $challan->challan_date?->toDateString(),
            'sales_order_id' => $challan->sales_order_id,
            'invoice_id' => $challan->invoice_id,
            'customer_id' => $challan->customer_id,
            'customer_name' => $challan->customer_name,
            'customer_phone' => $challan->customer_phone,
            'customer_gstin' => $challan->customer_gstin,
            'place_of_supply' => $challan->place_of_supply,
            'status' => $challan->status,
            'transporter_name' => $challan->transporter_name,
            'vehicle_no' => $challan->vehicle_no,
            'notes' => $challan->notes,
            'subtotal' => (float) $challan->subtotal,
            'tax_total' => (float) $challan->tax_total,
            'grand_total' => (float) $challan->grand_total,
            'created_at' => $challan->created_at?->toIso8601String(),
            'updated_at' => $challan->updated_at?->toIso8601String(),
            'items_count' => $challan->items_count ?? $challan->items()->count(),
        ];

        if ($withItems) {
            $payload['items'] = $challan->items()->orderBy('id')->get()->map(fn (DeliveryChallanItem $item) => [
                'id' => $item->id,
                'sales_order_item_id' => $item->sales_order_item_id,
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'hsn_code' => $item->hsn_code,
                'batch_no' => $item->batch_no,
                'expiry_date' => $item->expiry_date?->toDateString(),
                'qty' => (float) $item->qty,
                'loose_qty' => (float) $item->loose_qty,
                'units_per_pack' => (int) $item->units_per_pack,
                'unit_price' => (float) $item->unit_price,
                'discount_percent' => (float) $item->discount_percent,
                'gst_percent' => (float) $item->gst_percent,
                'taxable_amount' => (float) $item->taxable_amount,
                'tax_amount' => (float) $item->tax_amount,
                'total_amount' => (float) $item->total_amount,
            ])->values()->all();
        }

        return $payload;
    }

    private function recalcOrderStatus(SalesOrder $order): void
    {
        if (in_array($order->status, ['cancelled', 'draft'], true)) {
            return;
        }

        $items = $order->items()->get();
        $totalOrdered = 0.0;
        $totalFulfilled = 0.0;
        foreach ($items as $item) {
            $totalOrdered += $item->orderedBaseUnits();
            $totalFulfilled += (float) $item->fulfilled_base_units;
        }

        $status = 'confirmed';
        if ($totalFulfilled > 0 && $totalFulfilled + 0.0001 >= $totalOrdered) {
            $status = 'fulfilled';
        } elseif ($totalFulfilled > 0) {
            $status = 'partially_fulfilled';
        }

        if ($status !== $order->status) {
            $order->update(['status' => $status]);
        }
    }

    public function index(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $query = SalesOrder::where('store_id', $store->id)->withCount(['items', 'challans']);

        if ($status = $request->query('status')) {
            if ($status !== 'all') {
                $query->where('status', $status);
            }
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('order_number', 'like', "%{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%")
                    ->orWhere('customer_phone', 'like', "%{$search}%");
            });
        }
        if ($from = $request->query('from')) {
            $query->where('order_date', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->where('order_date', '<=', $to);
        }

        $perPage = min(200, max(1, (int) $request->query('per_page', 50)));
        $orders = $query->orderByDesc('order_date')->orderByDesc('id')->paginate($perPage);

        return response()->json([
            'success' => true,
            'orders' => collect($orders->items())->map(fn (SalesOrder $o) => $this->presentOrder($o, false))->values(),
            'meta' => [
                'current_page' => $orders->currentPage(),
                'last_page' => $orders->lastPage(),
                'total' => $orders->total(),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'order_date' => 'nullable|date',
            'expected_delivery_date' => 'nullable|date',
            'customer_id' => 'nullable|integer|exists:parties,id',
            'customer_name' => 'nullable|string|max:255',
            'customer_phone' => 'nullable|string|max:30',
            'customer_gstin' => 'nullable|string|max:20',
            'place_of_supply' => 'nullable|string|max:60',
            'notes' => 'nullable|string|max:1000',
            'items' => 'required|array|min:1|max:500',
            'items.*.product_id' => 'nullable|integer|exists:products,id',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.hsn_code' => 'nullable|string|max:20',
            'items.*.qty' => 'required|numeric|min:0|max:1000000',
            'items.*.loose_qty' => 'nullable|numeric|min:0|max:1000000',
            'items.*.units_per_pack' => 'nullable|integer|min:1|max:100000',
            'items.*.unit_price' => 'required|numeric|min:0|max:10000000',
            'items.*.discount_percent' => 'nullable|numeric|min:0|max:100',
            'items.*.discount_amount' => 'nullable|numeric|min:0|max:10000000',
            'items.*.gst_percent' => 'nullable|numeric|min:0|max:100',
        ]);

        $customer = null;
        if (!empty($validated['customer_id'])) {
            $customer = Party::where('store_id', $store->id)->find($validated['customer_id']);
            if (!$customer) {
                return response()->json(['success' => false, 'message' => 'Customer not found in this store.'], 422);
            }
        }

        $productIds = collect($validated['items'])->pluck('product_id')->filter()->map(fn ($v) => (int) $v)->unique();
        $products = Product::where('store_id', $store->id)->whereIn('id', $productIds)->get()->keyBy('id');
        if ($products->count() !== $productIds->count()) {
            return response()->json(['success' => false, 'message' => 'One or more products do not belong to this store.'], 422);
        }

        $items = [];
        foreach ($validated['items'] as $raw) {
            $product = !empty($raw['product_id']) ? $products->get((int) $raw['product_id']) : null;
            $name = trim((string) ($raw['product_name'] ?? '')) ?: $product?->name;
            if (!$name) {
                return response()->json(['success' => false, 'message' => 'Each order line needs a product or a product name.'], 422);
            }
            $items[] = [
                'product_id' => $product?->id,
                'product_name' => $name,
                'hsn_code' => $raw['hsn_code'] ?? $product?->hsn_sac_code,
                'qty' => (float) $raw['qty'],
                'loose_qty' => (float) ($raw['loose_qty'] ?? 0),
                'units_per_pack' => max(1, (int) ($raw['units_per_pack'] ?? ($product?->units_per_pack ?? 1))),
                'unit_price' => (float) $raw['unit_price'],
                'discount_percent' => (float) ($raw['discount_percent'] ?? 0),
                'discount_amount' => (float) ($raw['discount_amount'] ?? 0),
                'gst_percent' => (float) ($raw['gst_percent'] ?? ($product?->gst_percent ?? 0)),
            ];
        }

        $meta = [
            'customer_gstin' => $validated['customer_gstin'] ?? $customer?->gstin,
            'place_of_supply' => $validated['place_of_supply'] ?? $customer?->state_code ?? $store->state_code ?? '32',
        ];
        [$taxDoc] = $this->taxService->calculateDocument($store, $items, $meta);

        $order = DB::transaction(function () use ($store, $validated, $items, $meta, $taxDoc, $customer, $request) {
            $order = SalesOrder::create([
                'store_id' => $store->id,
                'order_number' => $this->taxService->nextSequence('sales_orders', 'order_number', $store->id, 'SO'),
                'order_date' => $validated['order_date'] ?? Carbon::today()->toDateString(),
                'expected_delivery_date' => $validated['expected_delivery_date'] ?? null,
                'customer_id' => $customer?->id,
                'customer_name' => $validated['customer_name'] ?? $customer?->name,
                'customer_phone' => $validated['customer_phone'] ?? $customer?->phone,
                'customer_gstin' => $meta['customer_gstin'],
                'place_of_supply' => $meta['place_of_supply'],
                'status' => 'draft',
                'subtotal' => $taxDoc['gross_subtotal'],
                'discount_total' => $taxDoc['line_discount_total'] + $taxDoc['bill_discount_total'],
                'tax_total' => $taxDoc['total_tax'],
                'round_off' => $taxDoc['round_off'],
                'grand_total' => $taxDoc['grand_total'],
                'notes' => $validated['notes'] ?? null,
                'created_by' => $request->user()?->id,
            ]);

            foreach ($taxDoc['lines'] as $idx => $line) {
                $input = $items[$idx];
                SalesOrderItem::create([
                    'sales_order_id' => $order->id,
                    'product_id' => $input['product_id'],
                    'product_name' => $input['product_name'],
                    'hsn_code' => $input['hsn_code'],
                    'qty' => $line['qty'],
                    'loose_qty' => $line['loose_qty'],
                    'units_per_pack' => $line['units_per_pack'],
                    'unit_price' => $line['unit_price'],
                    'discount_percent' => $input['discount_percent'],
                    'discount_amount' => $line['line_discount'] ?? $input['discount_amount'],
                    'gst_percent' => $line['gst_rate'],
                    'taxable_amount' => $line['taxable_amount'],
                    'tax_amount' => $line['total_tax'],
                    'total_amount' => $line['total_amount'],
                ]);
            }

            AuditLog::log('create_sales_order', 'SalesOrder', (string) $order->id, null, [
                'order_number' => $order->order_number,
                'grand_total' => (float) $order->grand_total,
            ], $store->id);

            return $order;
        });

        return response()->json(['success' => true, 'order' => $this->presentOrder($order->refresh())], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $order = SalesOrder::where('store_id', $store?->id)->findOrFail($id);

        return response()->json([
            'success' => true,
            'order' => $this->presentOrder($order),
            'challans' => $order->challans()->orderByDesc('id')->get()->map(fn (DeliveryChallan $c) => $this->presentChallan($c, false))->values(),
        ]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $order = SalesOrder::where('store_id', $store?->id)->findOrFail($id);

        if ($order->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Only draft orders can be edited.'], 422);
        }

        $validated = $request->validate([
            'order_date' => 'sometimes|date',
            'expected_delivery_date' => 'nullable|date',
            'customer_id' => 'nullable|integer|exists:parties,id',
            'customer_name' => 'nullable|string|max:255',
            'customer_phone' => 'nullable|string|max:30',
            'customer_gstin' => 'nullable|string|max:20',
            'place_of_supply' => 'nullable|string|max:60',
            'notes' => 'nullable|string|max:1000',
            'items' => 'sometimes|array|min:1|max:500',
            'items.*.product_id' => 'nullable|integer|exists:products,id',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.hsn_code' => 'nullable|string|max:20',
            'items.*.qty' => 'required_with:items|numeric|min:0|max:1000000',
            'items.*.loose_qty' => 'nullable|numeric|min:0|max:1000000',
            'items.*.units_per_pack' => 'nullable|integer|min:1|max:100000',
            'items.*.unit_price' => 'required_with:items|numeric|min:0|max:10000000',
            'items.*.discount_percent' => 'nullable|numeric|min:0|max:100',
            'items.*.discount_amount' => 'nullable|numeric|min:0|max:10000000',
            'items.*.gst_percent' => 'nullable|numeric|min:0|max:100',
        ]);

        DB::transaction(function () use ($request, $order, $validated, $store) {
            $before = $order->only(['order_date', 'grand_total', 'customer_name']);

            $order->update(collect($validated)->only([
                'order_date',
                'expected_delivery_date',
                'customer_name',
                'customer_phone',
                'customer_gstin',
                'place_of_supply',
                'notes',
            ])->all());

            if (!empty($validated['customer_id'])) {
                $customer = Party::where('store_id', $store->id)->find($validated['customer_id']);
                if ($customer) {
                    $order->customer_id = $customer->id;
                    $order->customer_name = $order->customer_name ?: $customer->name;
                    $order->customer_gstin = $order->customer_gstin ?: $customer->gstin;
                    $order->save();
                }
            }

            if (!empty($validated['items'])) {
                $productIds = collect($validated['items'])->pluck('product_id')->filter()->map(fn ($v) => (int) $v)->unique();
                $products = Product::where('store_id', $store->id)->whereIn('id', $productIds)->get()->keyBy('id');
                if ($products->count() !== $productIds->count()) {
                    abort(response()->json(['success' => false, 'message' => 'One or more products do not belong to this store.'], 422));
                }

                $items = [];
                foreach ($validated['items'] as $raw) {
                    $product = !empty($raw['product_id']) ? $products->get((int) $raw['product_id']) : null;
                    $name = trim((string) ($raw['product_name'] ?? '')) ?: $product?->name;
                    if (!$name) {
                        abort(response()->json(['success' => false, 'message' => 'Each order line needs a product or a product name.'], 422));
                    }
                    $items[] = [
                        'product_id' => $product?->id,
                        'product_name' => $name,
                        'hsn_code' => $raw['hsn_code'] ?? $product?->hsn_sac_code,
                        'qty' => (float) $raw['qty'],
                        'loose_qty' => (float) ($raw['loose_qty'] ?? 0),
                        'units_per_pack' => max(1, (int) ($raw['units_per_pack'] ?? ($product?->units_per_pack ?? 1))),
                        'unit_price' => (float) $raw['unit_price'],
                        'discount_percent' => (float) ($raw['discount_percent'] ?? 0),
                        'discount_amount' => (float) ($raw['discount_amount'] ?? 0),
                        'gst_percent' => (float) ($raw['gst_percent'] ?? ($product?->gst_percent ?? 0)),
                    ];
                }

                [$taxDoc] = $this->taxService->calculateDocument($store, $items, [
                    'customer_gstin' => $order->customer_gstin,
                    'place_of_supply' => $order->place_of_supply,
                ]);

                $order->items()->delete();
                foreach ($taxDoc['lines'] as $idx => $line) {
                    $input = $items[$idx];
                    SalesOrderItem::create([
                        'sales_order_id' => $order->id,
                        'product_id' => $input['product_id'],
                        'product_name' => $input['product_name'],
                        'hsn_code' => $input['hsn_code'],
                        'qty' => $line['qty'],
                        'loose_qty' => $line['loose_qty'],
                        'units_per_pack' => $line['units_per_pack'],
                        'unit_price' => $line['unit_price'],
                        'discount_percent' => $input['discount_percent'],
                        'discount_amount' => $line['line_discount'] ?? $input['discount_amount'],
                        'gst_percent' => $line['gst_rate'],
                        'taxable_amount' => $line['taxable_amount'],
                        'tax_amount' => $line['total_tax'],
                        'total_amount' => $line['total_amount'],
                    ]);
                }

                $order->forceFill([
                    'subtotal' => $taxDoc['gross_subtotal'],
                    'discount_total' => $taxDoc['line_discount_total'] + $taxDoc['bill_discount_total'],
                    'tax_total' => $taxDoc['total_tax'],
                    'round_off' => $taxDoc['round_off'],
                    'grand_total' => $taxDoc['grand_total'],
                ])->save();
            }

            AuditLog::log('update_sales_order', 'SalesOrder', (string) $order->id, $before, [
                'order_date' => $order->order_date?->toDateString(),
                'grand_total' => (float) $order->grand_total,
            ], $store->id);
        });

        return response()->json(['success' => true, 'order' => $this->presentOrder($order->refresh())]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $order = SalesOrder::where('store_id', $store?->id)->findOrFail($id);

        if ($order->status !== 'draft') {
            return response()->json(['success' => false, 'message' => 'Only draft orders can be deleted. Cancel confirmed orders instead.'], 422);
        }

        AuditLog::log('delete_sales_order', 'SalesOrder', (string) $order->id, $order->only(['order_number']), null, $order->store_id);
        $order->delete();

        return response()->json(['success' => true, 'message' => 'Sales order deleted.']);
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $order = SalesOrder::where('store_id', $store?->id)->findOrFail($id);

        $validated = $request->validate([
            'status' => 'required|in:' . implode(',', self::ORDER_STATUSES),
            'reason' => 'nullable|string|max:500',
        ]);

        $target = $validated['status'];
        $allowed = [
            'draft' => ['confirmed', 'cancelled'],
            'confirmed' => ['cancelled'],
            'partially_fulfilled' => ['cancelled'],
        ];
        $current = $order->status;
        if (!in_array($target, $allowed[$current] ?? [], true)) {
            return response()->json(['success' => false, 'message' => "Cannot move order from '{$current}' to '{$target}'."], 422);
        }
        if ($target === 'cancelled') {
            if ($order->challans()->where('status', '!=', 'cancelled')->exists()) {
                return response()->json(['success' => false, 'message' => 'Cancel the delivery challans before cancelling this order.'], 422);
            }
            if (empty(trim((string) ($validated['reason'] ?? '')))) {
                return response()->json(['success' => false, 'message' => 'A cancellation reason is required.'], 422);
            }
        }

        $before = ['status' => $current];
        $order->update([
            'status' => $target,
            'cancel_reason' => $target === 'cancelled' ? $validated['reason'] : null,
        ]);
        AuditLog::log('sales_order_status', 'SalesOrder', (string) $order->id, $before, [
            'status' => $target,
            'reason' => $validated['reason'] ?? null,
        ], $order->store_id);

        return response()->json(['success' => true, 'order' => $this->presentOrder($order->refresh())]);
    }

    /** Create a (partial) delivery challan against a confirmed order. */
    public function storeChallan(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $order = SalesOrder::where('store_id', $store?->id)->with('items')->findOrFail($id);

        if (!in_array($order->status, ['confirmed', 'partially_fulfilled'], true)) {
            return response()->json(['success' => false, 'message' => 'Only confirmed or partially fulfilled orders can be dispatched.'], 422);
        }

        $validated = $request->validate([
            'challan_date' => 'nullable|date',
            'transporter_name' => 'nullable|string|max:255',
            'vehicle_no' => 'nullable|string|max:30',
            'notes' => 'nullable|string|max:1000',
            'items' => 'required|array|min:1|max:500',
            'items.*.sales_order_item_id' => 'required|integer',
            'items.*.qty' => 'required|numeric|min:0|max:1000000',
            'items.*.loose_qty' => 'nullable|numeric|min:0|max:1000000',
            'items.*.batch_no' => 'nullable|string|max:40',
            'items.*.expiry_date' => 'nullable|date',
        ]);

        $orderItems = $order->items->keyBy('id');
        $challanLines = [];
        foreach ($validated['items'] as $raw) {
            $orderItem = $orderItems->get((int) $raw['sales_order_item_id']);
            if (!$orderItem) {
                return response()->json(['success' => false, 'message' => 'Delivery item does not belong to this order.'], 422);
            }
            $upp = max(1, (int) $orderItem->units_per_pack);
            $dispatchBase = ((float) $raw['qty'] * $upp) + (float) ($raw['loose_qty'] ?? 0);
            $remaining = max(0, $orderItem->orderedBaseUnits() - (float) $orderItem->fulfilled_base_units);
            if ($dispatchBase <= 0) {
                continue;
            }
            if ($dispatchBase > $remaining + 0.0001) {
                return response()->json(['success' => false, 'message' => "Dispatch quantity for {$orderItem->product_name} exceeds the remaining ordered quantity."], 422);
            }
            $challanLines[] = [
                'order_item' => $orderItem,
                'qty' => (float) $raw['qty'],
                'loose_qty' => (float) ($raw['loose_qty'] ?? 0),
                'batch_no' => $raw['batch_no'] ?? null,
                'expiry_date' => $raw['expiry_date'] ?? null,
                'dispatch_base_units' => $dispatchBase,
            ];
        }

        if (empty($challanLines)) {
            return response()->json(['success' => false, 'message' => 'Enter a dispatch quantity for at least one line.'], 422);
        }

        $challanInputs = [];
        foreach ($challanLines as $line) {
            /** @var SalesOrderItem $orderItem */
            $orderItem = $line['order_item'];
            $challanInputs[] = [
                'product_id' => $orderItem->product_id,
                'product_name' => $orderItem->product_name,
                'hsn_code' => $orderItem->hsn_code,
                'qty' => $line['qty'],
                'loose_qty' => $line['loose_qty'],
                'units_per_pack' => max(1, (int) $orderItem->units_per_pack),
                'unit_price' => (float) $orderItem->unit_price,
                'discount_percent' => (float) $orderItem->discount_percent,
                'discount_amount' => 0,
                'gst_percent' => (float) $orderItem->gst_percent,
            ];
        }
        [$taxDoc] = $this->taxService->calculateDocument($store, $challanInputs, [
            'customer_gstin' => $order->customer_gstin,
            'place_of_supply' => $order->place_of_supply,
        ]);

        $challan = DB::transaction(function () use ($order, $validated, $challanLines, $taxDoc, $store, $request) {
            $challan = DeliveryChallan::create([
                'store_id' => $store->id,
                'challan_number' => $this->taxService->nextSequence('delivery_challans', 'challan_number', $store->id, 'DC'),
                'challan_date' => $validated['challan_date'] ?? Carbon::today()->toDateString(),
                'sales_order_id' => $order->id,
                'customer_id' => $order->customer_id,
                'customer_name' => $order->customer_name,
                'customer_phone' => $order->customer_phone,
                'customer_gstin' => $order->customer_gstin,
                'place_of_supply' => $order->place_of_supply,
                'status' => 'dispatched',
                'transporter_name' => $validated['transporter_name'] ?? null,
                'vehicle_no' => $validated['vehicle_no'] ?? null,
                'notes' => $validated['notes'] ?? null,
                'created_by' => $request->user()?->id,
            ]);

            foreach ($taxDoc['lines'] as $idx => $line) {
                /** @var SalesOrderItem $orderItem */
                $orderItem = $challanLines[$idx]['order_item'];

                DeliveryChallanItem::create([
                    'delivery_challan_id' => $challan->id,
                    'sales_order_item_id' => $orderItem->id,
                    'product_id' => $orderItem->product_id,
                    'product_name' => $orderItem->product_name,
                    'hsn_code' => $orderItem->hsn_code,
                    'batch_no' => $challanLines[$idx]['batch_no'],
                    'expiry_date' => $challanLines[$idx]['expiry_date'],
                    'qty' => $line['qty'],
                    'loose_qty' => $line['loose_qty'],
                    'units_per_pack' => $line['units_per_pack'],
                    'unit_price' => $line['unit_price'],
                    'discount_percent' => (float) $orderItem->discount_percent,
                    'gst_percent' => $line['gst_rate'],
                    'taxable_amount' => $line['taxable_amount'],
                    'tax_amount' => $line['total_tax'],
                    'total_amount' => $line['total_amount'],
                ]);

                $orderItem->fulfilled_base_units = (float) $orderItem->fulfilled_base_units + $challanLines[$idx]['dispatch_base_units'];
                $orderItem->save();
            }

            $challan->forceFill([
                'subtotal' => $taxDoc['taxable_subtotal'],
                'tax_total' => $taxDoc['total_tax'],
                'grand_total' => $taxDoc['grand_total'],
            ])->save();

            $this->recalcOrderStatus($order);

            AuditLog::log('create_delivery_challan', 'DeliveryChallan', (string) $challan->id, null, [
                'challan_number' => $challan->challan_number,
                'sales_order_id' => $order->id,
                'grand_total' => (float) $challan->grand_total,
            ], $store->id);

            return $challan;
        });

        return response()->json([
            'success' => true,
            'challan' => $this->presentChallan($challan->refresh()),
            'order' => $this->presentOrder($order->refresh()),
        ], 201);
    }

    public function challans(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $query = DeliveryChallan::where('store_id', $store->id)->withCount('items');

        if ($status = $request->query('status')) {
            if ($status !== 'all') {
                $query->where('status', $status);
            }
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('challan_number', 'like', "%{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%")
                    ->orWhere('vehicle_no', 'like', "%{$search}%");
            });
        }
        if ($orderId = $request->query('sales_order_id')) {
            $query->where('sales_order_id', (int) $orderId);
        }

        $perPage = min(200, max(1, (int) $request->query('per_page', 50)));
        $challans = $query->orderByDesc('challan_date')->orderByDesc('id')->paginate($perPage);

        return response()->json([
            'success' => true,
            'challans' => collect($challans->items())->map(fn (DeliveryChallan $c) => $this->presentChallan($c, false))->values(),
            'meta' => [
                'current_page' => $challans->currentPage(),
                'last_page' => $challans->lastPage(),
                'total' => $challans->total(),
            ],
        ]);
    }

    public function showChallan(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $challan = DeliveryChallan::where('store_id', $store?->id)->findOrFail($id);

        return response()->json([
            'success' => true,
            'challan' => $this->presentChallan($challan),
            'order' => $challan->salesOrder ? $this->presentOrder($challan->salesOrder->refresh(), false) : null,
        ]);
    }

    public function updateChallanStatus(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $challan = DeliveryChallan::where('store_id', $store?->id)->findOrFail($id);

        $validated = $request->validate([
            'status' => 'required|in:' . implode(',', self::CHALLAN_STATUSES),
            'reason' => 'nullable|string|max:500',
        ]);

        $target = $validated['status'];
        $allowed = [
            'dispatched' => ['delivered', 'cancelled'],
            'delivered' => [],
            'cancelled' => [],
        ];
        if (!in_array($target, $allowed[$challan->status] ?? [], true)) {
            return response()->json(['success' => false, 'message' => "Cannot move challan from '{$challan->status}' to '{$target}'."], 422);
        }
        if ($target === 'cancelled' && $challan->invoice_id) {
            return response()->json(['success' => false, 'message' => 'This challan is linked to an invoice and cannot be cancelled.'], 422);
        }

        DB::transaction(function () use ($challan, $target, $store) {
            $previousStatus = $challan->status;
            if ($target === 'cancelled' && $challan->sales_order_id) {
                foreach ($challan->items()->get() as $item) {
                    if (!$item->sales_order_item_id) continue;
                    $orderItem = SalesOrderItem::find($item->sales_order_item_id);
                    if (!$orderItem) continue;
                    $upp = max(1, (int) $orderItem->units_per_pack);
                    $dispatchBase = ((float) $item->qty * $upp) + (float) $item->loose_qty;
                    $orderItem->fulfilled_base_units = max(0, (float) $orderItem->fulfilled_base_units - $dispatchBase);
                    $orderItem->save();
                }
            }

            $challan->update(['status' => $target]);
            if ($challan->sales_order_id) {
                $order = SalesOrder::find($challan->sales_order_id);
                if ($order) {
                    $this->recalcOrderStatus($order);
                }
            }

            AuditLog::log('delivery_challan_status', 'DeliveryChallan', (string) $challan->id, ['status' => $previousStatus], [
                'status' => $target,
            ], $store->id);
        });

        return response()->json(['success' => true, 'challan' => $this->presentChallan($challan->refresh())]);
    }
}
