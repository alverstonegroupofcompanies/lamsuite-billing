<?php

namespace App\Http\Controllers\Api;

use App\Models\CompanySetting;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Services\Tax\TaxEngine;
use App\Services\Webhook\WebhookOutboxService;
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

        if ($request->has('status') && strtolower($request->query('status')) !== 'all') {
            $query->where('status', $request->query('status'));
        }

        $purchases = $query->orderBy('invoice_date', 'desc')->paginate(50);
        return response()->json($purchases);
    }

    public function store(Request $request): JsonResponse
    {
        $storeId = $request->input('store_id') ?? $request->header('X-Store-Id', 1);
        $store = Store::find($storeId);
        $batchRequiredSetting = CompanySetting::where('store_id', $storeId)
            ->where('key', 'batch_required')
            ->first()?->value;
        $batchRequired = $batchRequiredSetting !== null
            ? (bool)$batchRequiredSetting
            : (($store->store_type ?? 'pharmacy') === 'pharmacy');

        $validated = $request->validate([
            'store_id' => 'nullable|integer',
            'supplier_id' => 'nullable|integer',
            'supplier_name' => 'required|string|max:255',
            'supplier_gstin' => 'nullable|string|max:20',
            'invoice_number' => 'required|string|max:50',
            'invoice_date' => 'required|date',
            'subtotal' => 'nullable|numeric',
            'tax_total' => 'nullable|numeric',
            'freight_charges' => 'nullable|numeric|min:0',
            'bill_discount_type' => 'nullable|in:percent,amount',
            'bill_discount' => 'nullable|numeric|min:0',
            'round_off' => 'nullable|numeric',
            'grand_total' => 'nullable|numeric',
            'is_interstate' => 'nullable|boolean',
            'is_rcm' => 'nullable|boolean',
            'itc_eligibility' => 'nullable|string',
            'lines' => 'required|array|min:1',
            'lines.*.product_id' => 'nullable',
            'lines.*.product_name' => 'required|string',
            'lines.*.hsn_code' => 'nullable|string|max:20',
            'lines.*.batch_no' => $batchRequired ? 'required|string' : 'nullable|string',
            'lines.*.mfg_date' => 'nullable|date',
            'lines.*.expiry_date' => $batchRequired ? 'required|string' : 'nullable|string',
            'lines.*.pack_qty' => 'nullable|numeric|min:0',
            'lines.*.loose_qty' => 'nullable|numeric|min:0',
            'lines.*.free_qty' => 'nullable|numeric|min:0',
            'lines.*.free_loose_qty' => 'nullable|numeric|min:0',
            'lines.*.units_per_pack' => 'nullable|integer|min:1',
            'lines.*.qty' => 'nullable|numeric|min:0',
            'lines.*.purchase_rate' => 'required|numeric|min:0',
            'lines.*.ptr' => 'nullable|numeric|min:0',
            'lines.*.pts' => 'nullable|numeric|min:0',
            'lines.*.ptss' => 'nullable|numeric|min:0',
            'lines.*.discount_type' => 'nullable|in:percent,amount',
            'lines.*.discount_percent' => 'nullable|numeric|min:0',
            'lines.*.discount_amount' => 'nullable|numeric|min:0',
            'lines.*.mrp' => 'nullable|numeric',
            'lines.*.selling_rate' => 'nullable|numeric|min:0',
            'lines.*.gst_percent' => 'required|numeric',
            'lines.*.cess_percent' => 'nullable|numeric',
            'lines.*.total_amount' => 'nullable|numeric',
        ]);

        $storeStateCode = $store ? ($store->state_code ?: '32') : '32';

        $purchase = DB::transaction(function () use ($validated, $storeId, $storeStateCode) {
            $engineLines = [];
            foreach ($validated['lines'] as $idx => $line) {
                $packQty = (float)($line['pack_qty'] ?? $line['qty'] ?? 1);
                $looseQty = (float)($line['loose_qty'] ?? 0);
                $freeQty = (float)($line['free_qty'] ?? 0);
                $freeLooseQty = (float)($line['free_loose_qty'] ?? 0);
                $upp = (int)($line['units_per_pack'] ?? 1);
                $discountType = $line['discount_type'] ?? 'percent';

                $engineLines[] = [
                    'line_id' => (string)$idx,
                    'product_id' => (string)($line['product_id'] ?? ''),
                    'product_name' => $line['product_name'],
                    'hsn_code' => $line['hsn_code'] ?? null,
                    'qty' => $packQty,
                    'loose_qty' => $looseQty,
                    'free_qty' => $freeQty,
                    'free_loose_qty' => $freeLooseQty,
                    'units_per_pack' => $upp,
                    'unit_price' => (float)$line['purchase_rate'],
                    'mrp' => (float)($line['mrp'] ?? 0),
                    'rate_basis' => 'ptr', // Purchase rate is statutory tax-exclusive
                    'discount_percent' => $discountType === 'percent' ? (float)($line['discount_percent'] ?? 0) : 0,
                    'discount_amount' => $discountType === 'amount' ? (float)($line['discount_amount'] ?? 0) : 0,
                    'gst_percent' => (float)($line['gst_percent'] ?? 0),
                    'cess_percent' => (float)($line['cess_percent'] ?? 0),
                    'is_tax_inclusive' => false,
                ];
            }

            $calcResult = TaxEngine::calculateDocumentTaxes([
                'store_state' => $storeStateCode,
                'customer_gstin' => $validated['supplier_gstin'] ?? null,
                'place_of_supply' => !empty($validated['is_interstate']) ? 'XX' : $storeStateCode,
                'default_tax_mode' => 'exclusive',
                'lines' => $engineLines,
                'bill_discount' => [
                    'type' => $validated['bill_discount_type'] ?? 'amount',
                    'value' => (float)($validated['bill_discount'] ?? 0),
                ],
                'auto_round_off' => false,
            ]);

            $freightCharges = round((float)($validated['freight_charges'] ?? 0), 2);
            $netBeforeRound = round((float)$calcResult['net_before_round'] + $freightCharges, 2);
            $roundOff = isset($validated['round_off'])
                ? round((float)$validated['round_off'], 2)
                : round(round($netBeforeRound) - $netBeforeRound, 2);
            $grandTotal = max(0, round($netBeforeRound + $roundOff, 2));

            $purchase = Purchase::create([
                'store_id' => $storeId,
                'supplier_id' => $validated['supplier_id'] ?? null,
                'supplier_name' => $validated['supplier_name'],
                'supplier_gstin' => $validated['supplier_gstin'] ?? null,
                'invoice_number' => $validated['invoice_number'],
                'invoice_date' => $validated['invoice_date'],
                'subtotal' => $calcResult['gross_subtotal'],
                'tax_total' => $calcResult['total_tax'],
                'cgst_total' => $calcResult['cgst_total'],
                'sgst_total' => $calcResult['sgst_total'],
                'igst_total' => $calcResult['igst_total'],
                'cess_total' => $calcResult['cess_total'],
                'is_interstate' => $calcResult['is_inter_state'],
                'is_rcm' => (bool)($validated['is_rcm'] ?? false),
                'itc_eligibility' => $validated['itc_eligibility'] ?? 'eligible',
                'freight_charges' => $freightCharges,
                'bill_discount_type' => $validated['bill_discount_type'] ?? 'amount',
                // Persist the operator-entered value (percent or amount) so edit screens can round-trip it.
                'bill_discount' => (float)($validated['bill_discount'] ?? 0),
                'round_off' => $roundOff,
                'grand_total' => $grandTotal,
                'paid_amount' => 0,
                'status' => 'received',
            ]);

            foreach ($calcResult['lines'] as $idx => $cLine) {
                $rawLine = $validated['lines'][$idx];
                PurchaseItem::create([
                    'purchase_id' => $purchase->id,
                    'product_id' => $rawLine['product_id'] ?? null,
                    'product_name' => $rawLine['product_name'],
                    'batch_no' => $rawLine['batch_no'] ?? null,
                    'expiry_date' => $rawLine['expiry_date'] ?? null,
                    'mfg_date' => $rawLine['mfg_date'] ?? null,
                    'hsn_code' => $rawLine['hsn_code'] ?? null,
                    'selling_rate' => $rawLine['selling_rate'] ?? null,
                    'pack_qty' => $cLine['qty'],
                    'loose_qty' => $cLine['loose_qty'],
                    'free_qty' => $cLine['free_qty'],
                    'free_loose_qty' => $rawLine['free_loose_qty'] ?? 0,
                    'units_per_pack' => $cLine['units_per_pack'],
                    'qty' => $cLine['billed_units'],
                    'purchase_rate' => $cLine['unit_price'],
                    'ptr' => $rawLine['ptr'] ?? $cLine['unit_price'],
                    'pts' => $rawLine['pts'] ?? null,
                    'ptss' => $rawLine['ptss'] ?? null,
                    'discount_type' => $rawLine['discount_type'] ?? 'percent',
                    'discount_percent' => ($rawLine['discount_type'] ?? 'percent') === 'percent' ? ($rawLine['discount_percent'] ?? 0) : 0,
                    'discount_amount' => $cLine['line_discount'],
                    'effective_unit_cost' => $cLine['effective_unit_cost'] ?? 0,
                    'taxable_amount' => $cLine['taxable_amount'],
                    'mrp' => $rawLine['mrp'] ?? 0,
                    'gst_percent' => $cLine['gst_rate'],
                    'cgst_amount' => $cLine['cgst_amount'],
                    'sgst_amount' => $cLine['sgst_amount'],
                    'igst_amount' => $cLine['igst_amount'],
                    'cess_amount' => $cLine['cess_amount'],
                    'tax_amount' => $cLine['total_tax'],
                    'total_amount' => $cLine['total_amount'],
                ]);
            }

            return $purchase;
        });

        app(WebhookOutboxService::class)->enqueue(
            'purchase.created',
            [
                'id' => $purchase->id,
                'invoice_number' => $purchase->invoice_number,
                'supplier_id' => $purchase->supplier_id,
                'supplier_name' => $purchase->supplier_name,
                'grand_total' => (float) $purchase->grand_total,
                'invoice_date' => optional($purchase->invoice_date)->toDateString(),
            ],
            (int) $storeId,
            'purchase',
            (string) $purchase->id
        );

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
