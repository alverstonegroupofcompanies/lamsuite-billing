<?php

namespace App\Http\Controllers\Api;

use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Product;
use App\Models\ProductBatch;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class PurchaseController
{
    public function index(Request $request): JsonResponse
    {
        $storeId = $request->query('store_id', $request->header('X-Store-Id', 1));
        $query = Purchase::with('items')->where('store_id', $storeId);

        if ($request->has('supplier_id')) {
            $query->where('supplier_id', $request->query('supplier_id'));
        }

        if ($request->has('status')) {
            $query->where('status', $request->query('status'));
        }

        $purchases = $query->orderBy('invoice_date', 'desc')->paginate(50);
        return response()->json($purchases);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'nullable|integer',
            'supplier_id' => 'nullable|integer',
            'supplier_name' => 'required|string|max:255',
            'supplier_gstin' => 'nullable|string|max:20',
            'invoice_number' => 'required|string|max:50',
            'invoice_date' => 'required|date',
            'subtotal' => 'required|numeric',
            'tax_total' => 'required|numeric',
            'grand_total' => 'required|numeric',
            'lines' => 'required|array|min:1',
            'lines.*.product_id' => 'nullable|integer',
            'lines.*.product_name' => 'required|string',
            'lines.*.batch_no' => 'required|string',
            'lines.*.expiry_date' => 'required|string',
            'lines.*.qty' => 'required|numeric|min:0.01',
            'lines.*.purchase_rate' => 'required|numeric|min:0',
            'lines.*.mrp' => 'nullable|numeric',
            'lines.*.gst_percent' => 'required|numeric',
            'lines.*.total_amount' => 'required|numeric',
        ]);

        $storeId = $validated['store_id'] ?? $request->header('X-Store-Id', 1);

        $purchase = DB::transaction(function () use ($validated, $storeId) {
            $purchase = Purchase::create([
                'store_id' => $storeId,
                'supplier_id' => $validated['supplier_id'] ?? null,
                'supplier_name' => $validated['supplier_name'],
                'supplier_gstin' => $validated['supplier_gstin'] ?? null,
                'invoice_number' => $validated['invoice_number'],
                'invoice_date' => $validated['invoice_date'],
                'subtotal' => $validated['subtotal'],
                'tax_total' => $validated['tax_total'],
                'round_off' => $validated['round_off'] ?? 0,
                'grand_total' => $validated['grand_total'],
                'paid_amount' => 0,
                'status' => 'received',
            ]);

            foreach ($validated['lines'] as $line) {
                PurchaseItem::create([
                    'purchase_id' => $purchase->id,
                    'product_id' => $line['product_id'] ?? null,
                    'product_name' => $line['product_name'],
                    'batch_no' => $line['batch_no'],
                    'expiry_date' => $line['expiry_date'],
                    'qty' => $line['qty'],
                    'purchase_rate' => $line['purchase_rate'],
                    'mrp' => $line['mrp'] ?? 0,
                    'gst_percent' => $line['gst_percent'],
                    'tax_amount' => ($line['total_amount'] - ($line['qty'] * $line['purchase_rate'])),
                    'total_amount' => $line['total_amount'],
                ]);
            }

            return $purchase;
        });

        return response()->json([
            'success' => true,
            'purchase' => $purchase->load('items'),
        ], 201);
    }

    public function show(string $id): JsonResponse
    {
        $purchase = Purchase::with('items')->findOrFail($id);
        return response()->json(['data' => $purchase]);
    }
}
