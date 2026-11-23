<?php

namespace App\Http\Controllers\Api;

use App\Models\CompanySetting;
use App\Models\AuditLog;
use App\Models\Party;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Services\Purchase\PurchaseChargeService;
use App\Services\Purchase\PurchasePostingService;
use App\Services\Tax\TaxEngine;
use App\Services\Webhook\WebhookOutboxService;
use App\Support\RequestTenant;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

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
        // The bill is written to the store the caller is authorised for, never to whichever
        // store id the body happens to carry (G1-SEC).
        $storeId = RequestTenant::requireStoreId($request);
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
            'place_of_supply' => 'nullable|string|max:20',
            'bill_discount_type' => 'nullable|in:percent,amount',
            'bill_discount' => 'nullable|numeric|min:0',
            'round_off' => 'nullable|numeric',
            'grand_total' => 'nullable|numeric',
            'is_interstate' => 'nullable|boolean',
            'is_rcm' => 'nullable|boolean',
            'itc_eligibility' => 'nullable|string',
            'charges' => 'nullable|array',
            'charges.*.external_id' => 'nullable|string|max:64',
            'charges.*.seq' => 'nullable|integer|min:1',
            'charges.*.head_code' => 'required|string|max:40',
            'charges.*.head_name' => 'nullable|string|max:100',
            'charges.*.note' => 'nullable|string|max:1000',
            'charges.*.amount' => 'required|numeric',
            'charges.*.gst_percent' => 'required|numeric|min:0|max:100',
            'charges.*.cess_percent' => 'nullable|numeric|min:0|max:100',
            'charges.*.treatment' => 'nullable|in:add_to_cost,expense',
            'charges.*.spread_method' => 'nullable|in:value,quantity,weight',
            'charges.*.itc_eligibility' => 'nullable|in:eligible,ineligible,blocked,partial',
            'charges.*.is_rcm' => 'nullable|boolean',
            'charges.*.paid_separately' => 'nullable|boolean',
            'charges.*.paid_to_label' => 'nullable|string|max:120',
            'charges.*.place_of_supply' => 'nullable|string|max:10',
            'charges.*.sac_code' => 'nullable|string|max:20',
            'lines' => 'required|array|min:1',
            'lines.*.product_id' => 'nullable',
            'lines.*.product_name' => 'required|string',
            'lines.*.hsn_code' => 'nullable|string|max:20',
            'lines.*.batch_no' => $batchRequired ? 'required|string' : 'nullable|string',
            'lines.*.mfg_date' => 'nullable|date',
            'lines.*.expiry_date' => $batchRequired ? 'required|string' : 'nullable|string',
            'lines.*.pack_qty' => 'nullable|numeric|min:0',
            'lines.*.gross_weight_kg' => 'nullable|numeric|min:0',
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

        $this->assertBelongsToStore((int) $storeId, $validated);

        $storeStateCode = $store ? ($store->state_code ?: '32') : '32';
        $chargeService = app(PurchaseChargeService::class);
        $posting = app(PurchasePostingService::class);

        // AUD-01: this route is opened by a claimed counter, so the bill and every shelf
        // movement it causes name that counter, as a bill pushed through the sync queue does.
        $counter = \App\Http\Middleware\AuthenticateCounterProfile::counterFor($request);
        if ($counter && (int) $counter->store_id !== (int) $storeId) {
            $counter = null;
        }

        $purchase = DB::transaction(function () use ($validated, $storeId, $storeStateCode, $chargeService, $posting, $request, $counter) {
            $engineLines = $chargeService->engineLines($validated['lines']);

            $freightCharges = round((float)($validated['freight_charges'] ?? 0), 2);

            // A charge is only as good as the head it belongs to, and a head belongs to exactly
            // one store (R12) — so this is checked before a single row of the bill is written.
            $documentPos = $validated['place_of_supply'] ?? null;
            $engineCharges = !empty($validated['charges'])
                ? $chargeService->resolveForStore((int)$storeId, $validated['charges'], $documentPos)
                // Legacy freight is a 0%-GST add-to-cost charge, so the engine — not this
                // controller — decides round-off and the per-line landed cost (PUR-017).
                : $chargeService->legacyFreight((int)$storeId, $freightCharges, $documentPos);

            $manualRoundOff = isset($validated['round_off'])
                ? round((float)$validated['round_off'], 2)
                : null;

            $calcResult = TaxEngine::calculateDocumentTaxes([
                'store_state' => $storeStateCode,
                'customer_gstin' => $validated['supplier_gstin'] ?? null,
                // 'XX' was never a state code. An inter-state bill is decided by the supplier
                // GSTIN first, then by the 2-digit place of supply sent with the bill.
                'place_of_supply' => $validated['place_of_supply'] ?? null,
                'default_tax_mode' => 'exclusive',
                'lines' => $engineLines,
                'bill_discount' => [
                    'type' => $validated['bill_discount_type'] ?? 'amount',
                    'value' => (float)($validated['bill_discount'] ?? 0),
                ],
                'charges' => $engineCharges,
                'separately_paid_in_payable' => $chargeService->separatelyPaidInPayable((int)$storeId),
                'auto_round_off' => $manualRoundOff === null,
                'manual_round_off' => $manualRoundOff,
            ]);

            $chargeService->assertStaysPayable($calcResult);

            $netBeforeRound = (float)$calcResult['net_before_round'];
            $roundOff = (float)$calcResult['round_off'];
            $grandTotal = (float)$calcResult['grand_total'];

            // One supplier cannot file the same bill number twice. Checked before any row is
            // written, so a duplicate leaves the store untouched (PUR-06).
            $posting->assertUniqueBill(
                (int) $storeId,
                'purchase',
                isset($validated['supplier_id']) ? (int) $validated['supplier_id'] : null,
                $validated['supplier_name'],
                $validated['invoice_number'],
            );

            $purchase = Purchase::create([
                'store_id' => $storeId,
                'supplier_id' => $validated['supplier_id'] ?? null,
                'supplier_name' => $validated['supplier_name'],
                'supplier_gstin' => $validated['supplier_gstin'] ?? null,
                'invoice_number' => $validated['invoice_number'],
                'supplier_invoice_no' => $validated['invoice_number'],
                'counter_id' => $counter?->id,
                'counter_code' => $counter?->counter_code,
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
                // PUR-009: remember whose state decided intra vs inter for this bill's charges.
                'place_of_supply' => $calcResult['place_of_supply'],
                'round_off' => $roundOff,
                'grand_total' => $grandTotal,
                'paid_amount' => 0,
                'status' => 'received',
            ]);

            $itemIdsByLine = [];
            foreach ($calcResult['lines'] as $idx => $cLine) {
                $rawLine = $validated['lines'][$idx];
                $item = PurchaseItem::create([
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
                    'gross_weight_kg' => $rawLine['gross_weight_kg'] ?? null,
                    'free_qty' => $cLine['free_qty'],
                    'free_loose_qty' => $rawLine['free_loose_qty'] ?? 0,
                    'units_per_pack' => $cLine['units_per_pack'],
                    // qty is billed PACKS everywhere else in the book; storing units here made the
                    // server stock five times the shelf for a five-a-pack line (PUR-05).
                    'qty' => $cLine['qty'],
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

                $itemIdsByLine[(string) ($cLine['line_id'] ?? $idx)] = $item->id;
            }

            // A bill entered on the server is the same debt as one pushed by a till: the shelf,
            // the stock ledger and the supplier's balance all move through the one posting path.
            // Stock comes first so the batch exists when the charge spread writes landed cost.
            $posting->postInward(
                $purchase,
                [],
                PurchaseItem::where('purchase_id', $purchase->id)->get(),
                0.0,
                null,
                $counter,
                $request->user()?->id
            );

            // Money that is not goods still has to be stored: charge rows, their paisa-exact
            // spread across these item lines, the landed cost, and any expense register entry.
            $chargeService->post($purchase, $engineCharges, $engineLines, $calcResult, $itemIdsByLine, $request->user()?->id);

            // The bill's identity in the book, for the unique index and the supplier ledger.
            $posting->stampBillKey($purchase);

            AuditLog::log(
                'purchase_posted',
                'Purchase',
                (string) $purchase->id,
                null,
                [
                    'status' => $purchase->status,
                    'grand_total' => (float) $purchase->grand_total,
                    'document_number' => $purchase->document_number,
                    'supplier_invoice_no' => $purchase->supplier_invoice_no,
                    'counter_code' => $purchase->counter_code,
                ],
                (int) $storeId,
                $request->user()?->id
            );

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
            'purchase' => $purchase->load(['items', 'charges.allocations']),
        ], 201);
    }

    /**
     * A bill posts stock onto its products and a payable onto its supplier, so both must be
     * this store's own. A foreign id is refused by name before anything is written, rather
     * than reaching the store-scope trigger as a 500 or crediting another branch's party.
     */
    private function assertBelongsToStore(int $storeId, array $validated): void
    {
        $errors = [];

        if (!empty($validated['supplier_id'])
            && !Party::where('store_id', $storeId)->whereKey((int) $validated['supplier_id'])->exists()) {
            $errors['supplier_id'] = ['This supplier does not belong to this store.'];
        }

        foreach ($validated['lines'] as $idx => $line) {
            $productId = $line['product_id'] ?? null;
            if ($productId === null || $productId === '') {
                continue;
            }

            if (!is_numeric($productId)
                || !Product::where('store_id', $storeId)->whereKey((int) $productId)->exists()) {
                $errors["lines.{$idx}.product_id"] = [
                    'Product "' . ($line['product_name'] ?? $productId) . '" does not belong to this store.',
                ];
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    public function show(string $id): JsonResponse
    {
        $purchase = Purchase::with(['items', 'charges.allocations'])->findOrFail($id);
        return response()->json(['data' => $purchase]);
    }
}
