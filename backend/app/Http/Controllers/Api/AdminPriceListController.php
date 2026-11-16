<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Party;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminPriceListController
{
    private function resolveStore(Request $request): ?Store
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? ($request->user() ? $request->user()->store_id : null);

        if ($candidate !== null && $candidate !== '' && $candidate !== 'all') {
            return Store::find((int) $candidate);
        }

        return Store::query()->orderBy('id')->first();
    }

    private function present(PriceList $list, bool $withItems = false): array
    {
        $payload = [
            'id' => $list->id,
            'store_id' => $list->store_id,
            'name' => $list->name,
            'description' => $list->description,
            'is_active' => (bool) $list->is_active,
            'valid_from' => $list->valid_from?->toDateString(),
            'valid_to' => $list->valid_to?->toDateString(),
            'priority' => (int) $list->priority,
            'items_count' => $list->items_count ?? $list->items()->count(),
            'assigned_customers' => $list->assigned_customers ?? Party::where('price_list_id', $list->id)->count(),
            'created_at' => $list->created_at?->toIso8601String(),
            'updated_at' => $list->updated_at?->toIso8601String(),
        ];

        if ($withItems) {
            $payload['items'] = $list->items()
                ->with('product:id,name,hsn_code,gst_percent,mrp,sel_rate,current_stock,is_active')
                ->orderBy('id')
                ->get()
                ->map(fn (PriceListItem $item) => [
                    'id' => $item->id,
                    'product_id' => $item->product_id,
                    'product_name' => $item->product?->name,
                    'hsn_code' => $item->product?->hsn_code,
                    'gst_percent' => $item->product ? (float) $item->product->gst_percent : null,
                    'mrp' => $item->product ? (float) $item->product->mrp : null,
                    'base_rate' => $item->product ? (float) $item->product->sel_rate : null,
                    'rate' => (float) $item->rate,
                    'discount_percent' => (float) $item->discount_percent,
                    'min_qty' => (int) $item->min_qty,
                ])
                ->values();
        }

        return $payload;
    }

    public function index(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $lists = PriceList::where('store_id', $store->id)
            ->withCount('items')
            ->when($request->query('search'), fn ($q, $search) => $q->where('name', 'like', '%' . $search . '%'))
            ->orderByDesc('priority')
            ->orderBy('name')
            ->get();

        $assigned = Party::where('store_id', $store->id)
            ->whereNotNull('price_list_id')
            ->selectRaw('price_list_id, COUNT(*) as total')
            ->groupBy('price_list_id')
            ->pluck('total', 'price_list_id');

        return response()->json([
            'success' => true,
            'store_id' => $store->id,
            'lists' => $lists->map(function (PriceList $list) use ($assigned) {
                $list->setAttribute('assigned_customers', (int) ($assigned[$list->id] ?? 0));
                return $this->present($list);
            })->values(),
            'products_count' => Product::where('store_id', $store->id)->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:80',
            'description' => 'nullable|string|max:500',
            'is_active' => 'nullable|boolean',
            'valid_from' => 'nullable|date',
            'valid_to' => 'nullable|date|after_or_equal:valid_from',
            'priority' => 'nullable|integer|min:0|max:1000',
        ]);

        $exists = PriceList::where('store_id', $store->id)->where('name', $validated['name'])->exists();
        if ($exists) {
            return response()->json(['success' => false, 'message' => 'A price list with this name already exists.'], 422);
        }

        $list = PriceList::create([
            'store_id' => $store->id,
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'is_active' => $validated['is_active'] ?? true,
            'valid_from' => $validated['valid_from'] ?? null,
            'valid_to' => $validated['valid_to'] ?? null,
            'priority' => $validated['priority'] ?? 0,
            'created_by' => $request->user()?->id,
        ]);

        AuditLog::log('create_price_list', 'PriceList', (string) $list->id, null, $list->only(['name', 'is_active']), $store->id);

        return response()->json(['success' => true, 'list' => $this->present($list, true)], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $list = PriceList::where('store_id', $store?->id)->findOrFail($id);

        return response()->json([
            'success' => true,
            'list' => $this->present($list, true),
            'customers' => Party::where('price_list_id', $list->id)
                ->orderBy('name')
                ->get(['id', 'name', 'phone', 'gstin', 'price_list_id']),
        ]);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $list = PriceList::where('store_id', $store?->id)->findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:80',
            'description' => 'nullable|string|max:500',
            'is_active' => 'sometimes|boolean',
            'valid_from' => 'nullable|date',
            'valid_to' => 'nullable|date|after_or_equal:valid_from',
            'priority' => 'sometimes|integer|min:0|max:1000',
        ]);

        if (isset($validated['name']) && $validated['name'] !== $list->name) {
            $exists = PriceList::where('store_id', $list->store_id)
                ->where('name', $validated['name'])
                ->where('id', '!=', $list->id)
                ->exists();
            if ($exists) {
                return response()->json(['success' => false, 'message' => 'A price list with this name already exists.'], 422);
            }
        }

        $before = $list->only(['name', 'is_active', 'valid_from', 'valid_to', 'priority']);
        $list->update($validated);
        AuditLog::log('update_price_list', 'PriceList', (string) $list->id, $before, $list->only(['name', 'is_active', 'valid_from', 'valid_to', 'priority']), $list->store_id);

        return response()->json(['success' => true, 'list' => $this->present($list->refresh(), true)]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $list = PriceList::where('store_id', $store?->id)->findOrFail($id);

        Party::where('price_list_id', $list->id)->update(['price_list_id' => null]);
        AuditLog::log('delete_price_list', 'PriceList', (string) $list->id, $list->only(['name']), null, $list->store_id);
        $list->delete();

        return response()->json(['success' => true, 'message' => 'Price list deleted.']);
    }

    public function saveItems(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $list = PriceList::where('store_id', $store?->id)->findOrFail($id);

        $validated = $request->validate([
            'items' => 'present|array|max:5000',
            'items.*.product_id' => 'required|integer|exists:products,id',
            'items.*.rate' => 'required|numeric|min:0|max:1000000',
            'items.*.discount_percent' => 'nullable|numeric|min:0|max:100',
            'items.*.min_qty' => 'nullable|integer|min:1|max:100000',
        ]);

        $productIds = collect($validated['items'])->pluck('product_id')->map(fn ($v) => (int) $v)->unique();
        $storeProductIds = Product::where('store_id', $list->store_id)
            ->whereIn('id', $productIds)
            ->pluck('id')
            ->map(fn ($v) => (int) $v)
            ->all();

        $invalid = $productIds->diff($storeProductIds)->values();
        if ($invalid->isNotEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'Some products do not belong to this store.',
                'invalid_product_ids' => $invalid,
            ], 422);
        }

        DB::transaction(function () use ($list, $validated) {
            $keep = [];
            foreach ($validated['items'] as $row) {
                $item = PriceListItem::updateOrCreate(
                    ['price_list_id' => $list->id, 'product_id' => (int) $row['product_id']],
                    [
                        'rate' => round((float) $row['rate'], 2),
                        'discount_percent' => round((float) ($row['discount_percent'] ?? 0), 2),
                        'min_qty' => max(1, (int) ($row['min_qty'] ?? 1)),
                    ]
                );
                $keep[] = $item->id;
            }
            PriceListItem::where('price_list_id', $list->id)->whereNotIn('id', $keep)->delete();
        });

        AuditLog::log('update_price_list_items', 'PriceList', (string) $list->id, null, ['items' => count($validated['items'])], $list->store_id);

        return response()->json([
            'success' => true,
            'message' => 'Pricing updated.',
            'list' => $this->present($list->refresh(), true),
        ]);
    }

    public function assign(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $list = PriceList::where('store_id', $store?->id)->findOrFail($id);

        $validated = $request->validate([
            'customer_ids' => 'required|array|max:5000',
            'customer_ids.*' => 'integer|exists:parties,id',
        ]);

        $ids = collect($validated['customer_ids'])->map(fn ($v) => (int) $v)->unique()->values();
        if ($ids->isEmpty()) {
            Party::where('store_id', $list->store_id)->where('price_list_id', $list->id)->update(['price_list_id' => null]);
        } else {
            $validIds = Party::where('store_id', $list->store_id)->whereIn('id', $ids)->pluck('id')->all();
            Party::whereIn('id', $validIds)->update(['price_list_id' => $list->id]);
            Party::where('store_id', $list->store_id)
                ->where('price_list_id', $list->id)
                ->whereNotIn('id', $validIds)
                ->update(['price_list_id' => null]);
        }

        AuditLog::log('assign_price_list', 'PriceList', (string) $list->id, null, ['customers' => $ids->count()], $list->store_id);

        return response()->json([
            'success' => true,
            'message' => 'Customer assignments updated.',
            'assigned_customers' => Party::where('price_list_id', $list->id)->count(),
        ]);
    }

    public function customers(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $customers = Party::where('store_id', $store->id)
            ->where('type', 'customer')
            ->when($request->query('search'), function ($q, $search) {
                $q->where(function ($sub) use ($search) {
                    $sub->where('name', 'like', '%' . $search . '%')
                        ->orWhere('phone', 'like', '%' . $search . '%')
                        ->orWhere('gstin', 'like', '%' . $search . '%');
                });
            })
            ->orderBy('name')
            ->limit(min(500, max(1, (int) $request->query('limit', 200))))
            ->get(['id', 'name', 'phone', 'gstin', 'price_list_id']);

        return response()->json(['success' => true, 'customers' => $customers]);
    }

    public function products(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $products = Product::where('store_id', $store->id)
            ->when($request->query('search'), function ($q, $search) {
                $q->where(function ($sub) use ($search) {
                    $sub->where('name', 'like', '%' . $search . '%')
                        ->orWhere('barcode', 'like', '%' . $search . '%')
                        ->orWhere('hsn_code', 'like', '%' . $search . '%');
                });
            })
            ->orderBy('name')
            ->limit(min(500, max(1, (int) $request->query('limit', 200))))
            ->get(['id', 'name', 'barcode', 'hsn_code', 'gst_percent', 'mrp', 'sel_rate', 'current_stock', 'is_active']);

        return response()->json(['success' => true, 'products' => $products]);
    }

    /**
     * Device-facing rate resolution used by the POS terminal.
     * Returns the customer's assigned list when active & in validity, otherwise null.
     */
    public function resolve(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $customerId = $request->query('customer_id');
        $customer = $customerId ? Party::where('store_id', $store->id)->find($customerId) : null;
        $listId = $customer?->price_list_id;

        if (!$listId) {
            return response()->json(['success' => true, 'list' => null, 'items' => []]);
        }

        $list = PriceList::where('store_id', $store->id)->find($listId);
        if (!$list || !$this->isCurrentlyValid($list)) {
            return response()->json(['success' => true, 'list' => null, 'items' => []]);
        }

        $items = PriceListItem::where('price_list_id', $list->id)
            ->get(['product_id', 'rate', 'discount_percent', 'min_qty'])
            ->map(fn (PriceListItem $item) => [
                'product_id' => (int) $item->product_id,
                'rate' => (float) $item->rate,
                'discount_percent' => (float) $item->discount_percent,
                'min_qty' => (int) $item->min_qty,
            ])
            ->values();

        return response()->json([
            'success' => true,
            'list' => [
                'id' => $list->id,
                'name' => $list->name,
                'priority' => (int) $list->priority,
                'valid_from' => $list->valid_from?->toDateString(),
                'valid_to' => $list->valid_to?->toDateString(),
            ],
            'items' => $items,
        ]);
    }

    private function isCurrentlyValid(PriceList $list): bool
    {
        if (!$list->is_active) {
            return false;
        }
        $today = Carbon::today();
        if ($list->valid_from && $today->lt($list->valid_from)) {
            return false;
        }
        if ($list->valid_to && $today->gt($list->valid_to)) {
            return false;
        }

        return true;
    }
}
