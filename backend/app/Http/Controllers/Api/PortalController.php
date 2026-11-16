<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\LoyaltyLedger;
use App\Models\Party;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\PortalAccessToken;
use App\Models\SalesOrder;
use App\Models\SalesOrderItem;
use App\Models\Store;
use App\Services\Sales\SalesOrderTaxService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class PortalController
{
    public function __construct(private readonly SalesOrderTaxService $taxService)
    {
    }

    private function party(Request $request): Party
    {
        return $request->attributes->get('portal_party');
    }

    private function store(Request $request): Store
    {
        return $request->attributes->get('portal_store');
    }

    private function activePriceList(Party $party): ?PriceList
    {
        if (!$party->price_list_id) {
            return null;
        }

        $list = PriceList::find($party->price_list_id);
        if (!$list || !$list->is_active) {
            return null;
        }

        $today = Carbon::today();
        if ($list->valid_from && $today->lt($list->valid_from)) {
            return null;
        }
        if ($list->valid_to && $today->gt($list->valid_to)) {
            return null;
        }

        return $list;
    }

    private function invoiceBalance(Invoice $invoice): float
    {
        $sign = $invoice->module_key === 'credit_note' ? -1 : 1;

        return round($sign * ((float) $invoice->grand_total - (float) $invoice->paid_amount), 2);
    }

    public function me(Request $request): JsonResponse
    {
        $party = $this->party($request);
        $store = $this->store($request);

        $invoices = Invoice::where('store_id', $store->id)
            ->where('customer_id', $party->id)
            ->whereIn('module_key', ['invoice', 'credit_note'])
            ->where('status', '!=', 'cancelled')
            ->get();

        $outstanding = $invoices->sum(fn (Invoice $invoice) => $this->invoiceBalance($invoice));

        $openOrders = SalesOrder::where('store_id', $store->id)
            ->where('customer_id', $party->id)
            ->whereIn('status', ['draft', 'confirmed', 'partially_fulfilled'])
            ->count();

        $loyaltyPoints = (float) (LoyaltyLedger::where('store_id', $store->id)
            ->where('customer_id', $party->id)
            ->orderByDesc('id')
            ->value('balance_after') ?? 0);

        return response()->json([
            'success' => true,
            'party' => [
                'id' => $party->id,
                'name' => $party->name,
                'phone' => $party->phone,
                'email' => $party->email,
                'gstin' => $party->gstin,
                'state_code' => $party->state_code,
                'address' => $party->address,
                'credit_limit' => (float) $party->credit_limit,
            ],
            'store' => [
                'id' => $store->id,
                'name' => $store->name,
                'gstin' => $store->gstin,
                'phone' => $store->phone,
                'address' => $store->address,
            ],
            'summary' => [
                'outstanding_balance' => round($outstanding, 2),
                'open_orders' => $openOrders,
                'loyalty_points' => $loyaltyPoints,
                'invoice_count' => $invoices->count(),
            ],
        ]);
    }

    public function invoices(Request $request): JsonResponse
    {
        $party = $this->party($request);
        $store = $this->store($request);
        $perPage = min(100, max(1, (int) $request->query('per_page', 20)));

        $query = Invoice::withCount('items')
            ->where('store_id', $store->id)
            ->where('customer_id', $party->id)
            ->whereIn('module_key', ['invoice', 'credit_note'])
            ->where('status', '!=', 'cancelled')
            ->when($request->query('from'), fn ($q, $from) => $q->where('invoice_date', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('invoice_date', '<=', $to))
            ->orderByDesc('invoice_date')
            ->orderByDesc('id');

        $paginator = $query->paginate($perPage);

        return response()->json([
            'success' => true,
            'data' => collect($paginator->items())->map(fn (Invoice $invoice) => [
                'id' => $invoice->id,
                'invoice_number' => $invoice->invoice_number,
                'invoice_date' => $invoice->invoice_date?->toDateString(),
                'due_date' => $invoice->due_date?->toDateString(),
                'document' => $invoice->module_key === 'credit_note' ? 'Credit Note' : 'Invoice',
                'grand_total' => (float) $invoice->grand_total,
                'paid_amount' => (float) $invoice->paid_amount,
                'balance' => $this->invoiceBalance($invoice),
                'status' => $invoice->status,
                'payment_status' => $invoice->payment_status,
                'items_count' => $invoice->items_count,
            ])->values(),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    public function showInvoice(Request $request, string $id): JsonResponse
    {
        $party = $this->party($request);
        $store = $this->store($request);

        $invoice = Invoice::with(['items', 'store:id,name,gstin,address,phone'])
            ->where('store_id', $store->id)
            ->where('customer_id', $party->id)
            ->whereIn('module_key', ['invoice', 'credit_note'])
            ->find($id);

        if (!$invoice) {
            return response()->json(['success' => false, 'message' => 'Invoice not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'invoice' => [
                'id' => $invoice->id,
                'invoice_number' => $invoice->invoice_number,
                'invoice_date' => $invoice->invoice_date?->toDateString(),
                'due_date' => $invoice->due_date?->toDateString(),
                'document' => $invoice->module_key === 'credit_note' ? 'Credit Note' : 'Invoice',
                'customer_name' => $invoice->customer_name,
                'customer_gstin' => $invoice->customer_gstin,
                'place_of_supply' => $invoice->place_of_supply,
                'subtotal' => (float) $invoice->subtotal,
                'discount_total' => (float) $invoice->discount_total,
                'taxable_subtotal' => (float) $invoice->taxable_subtotal,
                'cgst_total' => (float) $invoice->cgst_total,
                'sgst_total' => (float) $invoice->sgst_total,
                'igst_total' => (float) $invoice->igst_total,
                'cess_total' => (float) $invoice->cess_total,
                'tax_total' => (float) $invoice->tax_total,
                'round_off' => (float) $invoice->round_off,
                'grand_total' => (float) $invoice->grand_total,
                'paid_amount' => (float) $invoice->paid_amount,
                'balance' => $this->invoiceBalance($invoice),
                'payment_mode' => $invoice->payment_mode,
                'payment_status' => $invoice->payment_status,
                'status' => $invoice->status,
                'store' => $invoice->store?->only(['name', 'gstin', 'address', 'phone']),
                'items' => $invoice->items->map(fn ($item) => [
                    'id' => $item->id,
                    'product_name' => $item->product_name,
                    'batch_no' => $item->batch_no,
                    'qty' => (float) $item->qty,
                    'loose_qty' => (float) $item->loose_qty,
                    'units_per_pack' => (int) $item->units_per_pack,
                    'unit_price' => (float) $item->unit_price,
                    'discount_amount' => (float) $item->discount_amount + (float) $item->allocated_discount,
                    'taxable_amount' => (float) $item->taxable_amount,
                    'gst_percent' => (float) $item->gst_percent,
                    'tax_amount' => (float) $item->tax_amount,
                    'total_amount' => (float) $item->total_amount,
                ])->values(),
            ],
        ]);
    }

    public function statement(Request $request): JsonResponse
    {
        $party = $this->party($request);
        $store = $this->store($request);
        $from = (string) $request->query('from', Carbon::today()->startOfMonth()->toDateString());
        $to = (string) $request->query('to', Carbon::today()->toDateString());

        $base = Invoice::where('store_id', $store->id)
            ->where('customer_id', $party->id)
            ->whereIn('module_key', ['invoice', 'credit_note'])
            ->where('status', '!=', 'cancelled');

        $opening = (float) $party->opening_balance + (clone $base)
            ->where('invoice_date', '<', $from)
            ->get()
            ->sum(fn (Invoice $invoice) => $this->invoiceBalance($invoice));

        $documents = (clone $base)
            ->whereBetween('invoice_date', [$from, $to])
            ->orderBy('invoice_date')
            ->orderBy('id')
            ->get();

        $running = $opening;
        $rows = $documents->map(function (Invoice $invoice) use (&$running) {
            $delta = $this->invoiceBalance($invoice);
            $running += $delta;

            return [
                'date' => $invoice->invoice_date?->toDateString(),
                'document' => $invoice->module_key === 'credit_note' ? 'Credit Note' : 'Invoice',
                'number' => $invoice->invoice_number,
                'due_date' => $invoice->due_date?->toDateString(),
                'total' => (float) $invoice->grand_total,
                'paid' => (float) $invoice->paid_amount,
                'balance_delta' => $delta,
                'running_balance' => round($running, 2),
            ];
        })->values();

        return response()->json([
            'success' => true,
            'period' => ['from' => $from, 'to' => $to],
            'opening_balance' => round($opening, 2),
            'closing_balance' => round($running, 2),
            'rows' => $rows,
        ]);
    }

    public function catalog(Request $request): JsonResponse
    {
        $party = $this->party($request);
        $store = $this->store($request);
        $search = trim((string) $request->query('search'));

        $products = Product::where('store_id', $store->id)
            ->where('is_active', true)
            ->when($search !== '', function ($q) use ($search) {
                $q->where(function ($sub) use ($search) {
                    $sub->where('name', 'like', "%{$search}%")
                        ->orWhere('barcode', 'like', "%{$search}%")
                        ->orWhere('hsn_sac_code', 'like', "%{$search}%");
                });
            })
            ->orderBy('name')
            ->limit(100)
            ->get();

        $priceList = $this->activePriceList($party);
        $priceItems = $priceList
            ? PriceListItem::where('price_list_id', $priceList->id)->get()->keyBy('product_id')
            : collect();

        return response()->json([
            'success' => true,
            'price_list' => $priceList?->only(['id', 'name']),
            'products' => $products->map(function (Product $product) use ($priceItems) {
                $override = $priceItems->get($product->id);

                return [
                    'id' => $product->id,
                    'name' => $product->name,
                    'barcode' => $product->barcode,
                    'hsn_code' => $product->hsn_sac_code,
                    'gst_percent' => (float) $product->gst_percent,
                    'units_per_pack' => max(1, (int) $product->units_per_pack),
                    'mrp' => (float) $product->mrp,
                    'sel_rate' => (float) $product->sel_rate,
                    'rate' => (float) ($override->rate ?? $product->sel_rate),
                    'discount_percent' => (float) ($override->discount_percent ?? 0),
                    'min_qty' => (int) ($override->min_qty ?? 0),
                    'current_stock' => (float) $product->current_stock,
                ];
            })->values(),
        ]);
    }

    public function orders(Request $request): JsonResponse
    {
        $party = $this->party($request);
        $store = $this->store($request);

        $orders = SalesOrder::withCount('items')
            ->where('store_id', $store->id)
            ->where('customer_id', $party->id)
            ->orderByDesc('order_date')
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        return response()->json([
            'success' => true,
            'orders' => $orders->map(fn (SalesOrder $order) => [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'order_date' => $order->order_date?->toDateString(),
                'expected_delivery_date' => $order->expected_delivery_date?->toDateString(),
                'status' => $order->status,
                'grand_total' => (float) $order->grand_total,
                'items_count' => $order->items_count,
                'notes' => $order->notes,
            ])->values(),
        ]);
    }

    public function createOrder(Request $request): JsonResponse
    {
        $party = $this->party($request);
        $store = $this->store($request);

        $validated = $request->validate([
            'items' => 'required|array|min:1|max:100',
            'items.*.product_id' => 'required|integer',
            'items.*.qty' => 'required|numeric|min:0|max:100000',
            'items.*.loose_qty' => 'nullable|numeric|min:0|max:100000',
            'notes' => 'nullable|string|max:1000',
            'expected_delivery_date' => 'nullable|date|after_or_equal:today',
        ]);

        $productIds = collect($validated['items'])->pluck('product_id')->map(fn ($id) => (int) $id)->unique();
        $products = Product::where('store_id', $store->id)
            ->whereIn('id', $productIds)
            ->where('is_active', true)
            ->get()
            ->keyBy('id');

        if ($products->count() !== $productIds->count()) {
            return response()->json(['success' => false, 'message' => 'One or more products are unavailable.'], 422);
        }

        $priceList = $this->activePriceList($party);
        $priceItems = $priceList
            ? PriceListItem::where('price_list_id', $priceList->id)->get()->keyBy('product_id')
            : collect();

        $items = [];
        foreach ($validated['items'] as $raw) {
            $product = $products->get((int) $raw['product_id']);
            $qty = (float) $raw['qty'];
            $loose = (float) ($raw['loose_qty'] ?? 0);
            if ($qty <= 0 && $loose <= 0) {
                return response()->json(['success' => false, 'message' => "Quantity is required for {$product->name}."], 422);
            }

            $override = $priceItems->get($product->id);
            $useOverride = $override && $qty >= max(0, (int) $override->min_qty);
            $rate = $useOverride ? (float) $override->rate : (float) $product->sel_rate;

            $items[] = [
                'product_id' => $product->id,
                'product_name' => $product->name,
                'hsn_code' => $product->hsn_sac_code,
                'qty' => $qty,
                'loose_qty' => $loose,
                'units_per_pack' => max(1, (int) $product->units_per_pack),
                'unit_price' => $rate,
                'discount_percent' => $useOverride ? (float) $override->discount_percent : 0,
                'discount_amount' => 0,
                'gst_percent' => (float) $product->gst_percent,
            ];
        }

        $meta = [
            'customer_gstin' => $party->gstin,
            'place_of_supply' => $party->state_code ?? $store->state_code ?? '32',
        ];
        [$taxDoc] = $this->taxService->calculateDocument($store, $items, $meta);

        $order = DB::transaction(function () use ($store, $party, $validated, $items, $meta, $taxDoc) {
            $order = SalesOrder::create([
                'store_id' => $store->id,
                'order_number' => $this->taxService->nextSequence('sales_orders', 'order_number', $store->id, 'SO'),
                'order_date' => Carbon::today()->toDateString(),
                'expected_delivery_date' => $validated['expected_delivery_date'] ?? null,
                'customer_id' => $party->id,
                'customer_name' => $party->name,
                'customer_phone' => $party->phone,
                'customer_gstin' => $meta['customer_gstin'],
                'place_of_supply' => $meta['place_of_supply'],
                'status' => 'draft',
                'subtotal' => $taxDoc['gross_subtotal'],
                'discount_total' => $taxDoc['line_discount_total'] + $taxDoc['bill_discount_total'],
                'tax_total' => $taxDoc['total_tax'],
                'round_off' => $taxDoc['round_off'],
                'grand_total' => $taxDoc['grand_total'],
                'notes' => $validated['notes'] ?? null,
                'created_by' => null,
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
                    'discount_amount' => $line['line_discount'] ?? 0,
                    'gst_percent' => $line['gst_rate'],
                    'taxable_amount' => $line['taxable_amount'],
                    'tax_amount' => $line['total_tax'],
                    'total_amount' => $line['total_amount'],
                ]);
            }

            return $order;
        });

        return response()->json([
            'success' => true,
            'order' => [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'order_date' => $order->order_date?->toDateString(),
                'status' => $order->status,
                'subtotal' => (float) $order->subtotal,
                'tax_total' => (float) $order->tax_total,
                'grand_total' => (float) $order->grand_total,
                'items_count' => count($items),
            ],
        ], 201);
    }

    public function logout(Request $request): JsonResponse
    {
        $token = $request->attributes->get('portal_token');
        if ($token instanceof PortalAccessToken) {
            $token->forceFill(['revoked_at' => now()])->save();
        }

        return response()->json(['success' => true]);
    }
}
