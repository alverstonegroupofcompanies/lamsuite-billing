<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\Party;
use App\Models\Invoice;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Services\Gst\PartyStateResolver;
use App\Services\Reports\PurchaseRegisterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DataExchangeController
{
    /**
     * Preview and dry-run validate import rows.
     */
    public function preview(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'entity_type' => 'required|string',
            'rows' => 'required|array',
            'action_policy' => 'nullable|string',
        ]);

        $rows = $validated['rows'];
        $entityType = $validated['entity_type'];
        $validRows = [];
        $errors = [];

        foreach ($rows as $index => $row) {
            $rowNum = $index + 1;
            if ($entityType === 'items' || $entityType === 'products') {
                if (empty($row['name'])) {
                    $errors[] = "Row #{$rowNum}: Name is required.";
                    continue;
                }
                if (empty($row['barcode'])) {
                    $errors[] = "Row #{$rowNum}: Barcode is required.";
                    continue;
                }
                $validRows[] = $row;
            } elseif ($entityType === 'customers' || $entityType === 'suppliers') {
                if (empty($row['name'])) {
                    $errors[] = "Row #{$rowNum}: Party name is required.";
                    continue;
                }
                $validRows[] = $row;
            } else {
                $validRows[] = $row;
            }
        }

        return response()->json([
            'success' => true,
            'entity_type' => $entityType,
            'total_rows' => count($rows),
            'valid_count' => count($validRows),
            'error_count' => count($errors),
            'errors' => $errors,
            'sample_preview' => array_slice($validRows, 0, 5),
        ]);
    }

    /**
     * Commit batch import in a transaction.
     */
    public function commit(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'entity_type' => 'required|string',
            'store_id' => 'nullable|integer',
            'rows' => 'required|array',
            'action_policy' => 'nullable|string',
        ]);

        $rows = $validated['rows'];
        $entityType = $validated['entity_type'];
        $storeId = (int) ($validated['store_id']
            ?? $request->attributes->get('active_store_id')
            ?? 0);
        if ($storeId <= 0) {
            abort(422, 'A specific store context is required for this change (All Stores scope is read-only).');
        }

        DB::beginTransaction();
        try {
            $insertedCount = 0;
            $updatedCount = 0;

            if ($entityType === 'items' || $entityType === 'products') {
                foreach ($rows as $row) {
                    $barcode = $row['barcode'] ?? null;
                    // P-STORE-SCOPE: barcode identity is per store — an import
                    // into one store must never update another store's product.
                    $existing = $barcode
                        ? Product::where('store_id', $storeId)->where('barcode', $barcode)->first()
                        : null;

                    if ($existing) {
                        $existing->update([
                            'name' => $row['name'] ?? $existing->name,
                            'mrp' => (float)($row['mrp'] ?? $existing->mrp),
                            'sel_rate' => (float)($row['sel_rate'] ?? $existing->sel_rate),
                            'current_stock' => (float)($row['current_stock'] ?? $existing->current_stock),
                        ]);
                        $updatedCount++;
                    } else {
                        Product::create([
                            'store_id' => $storeId,
                            'name' => $row['name'],
                            'barcode' => $barcode ?? 'BC-' . uniqid(),
                            'hsn_sac_code' => $row['hsn_sac_code'] ?? '30049099',
                            'mrp' => (float)($row['mrp'] ?? 0),
                            'sel_rate' => (float)($row['sel_rate'] ?? 0),
                            'ptr' => (float)($row['ptr'] ?? 0),
                            'gst_percent' => (float)($row['gst_percent'] ?? 12),
                            'current_stock' => (float)($row['current_stock'] ?? 0),
                            'is_active' => true,
                            'version' => 1,
                        ]);
                        $insertedCount++;
                    }
                }
            } elseif ($entityType === 'customers' || $entityType === 'suppliers') {
                $partyType = $entityType === 'customers' ? 'customer' : 'supplier';
                foreach ($rows as $row) {
                    $gstin = $row['gstin'] ?? null;
                    Party::create([
                        'store_id' => $storeId,
                        'name' => $row['name'],
                        'type' => $partyType,
                        'phone' => $row['phone'] ?? null,
                        'gstin' => $gstin,
                        'address' => $row['address'] ?? null,
                        'state_code' => app(PartyStateResolver::class)->resolve(
                            $row['state_code'] ?? null,
                            $gstin,
                            Store::find($storeId)
                        ),
                        'is_active' => true,
                        'version' => 1,
                    ]);
                    $insertedCount++;
                }
            }

            AuditLog::log('import_batch', ucfirst($entityType), 'bulk', null, [
                'inserted' => $insertedCount,
                'updated' => $updatedCount,
            ], $storeId);

            DB::commit();

            return response()->json([
                'success' => true,
                'entity_type' => $entityType,
                'inserted_count' => $insertedCount,
                'updated_count' => $updatedCount,
                'batch_id' => 'batch_' . time(),
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Import transaction failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Download or retrieve template fields.
     */
    public function template(string $type): JsonResponse
    {
        $templates = [
            'items' => [
                'fields' => ['barcode', 'name', 'print_name', 'generic_name', 'hsn_sac_code', 'gst_percent', 'mrp', 'sel_rate', 'ptr', 'units_per_pack', 'rack_location', 'category_name', 'brand_name', 'unit_name'],
                'sample' => [
                    'barcode' => '8901030012345',
                    'name' => 'Paracetamol 500mg Strip of 10',
                    'hsn_sac_code' => '30049099',
                    'gst_percent' => 12,
                    'mrp' => 35.0,
                    'sel_rate' => 32.0,
                    'ptr' => 22.5,
                ],
            ],
            'customers' => [
                'fields' => ['name', 'phone', 'gstin', 'address', 'place_of_supply', 'credit_limit', 'outstanding_balance'],
                'sample' => [
                    'name' => 'Rahul Sharma',
                    'phone' => '9876543210',
                    'gstin' => '32AAAAA0000A1Z5',
                    'place_of_supply' => 'Kerala',
                ],
            ],
            'suppliers' => [
                'fields' => ['name', 'gstin', 'phone', 'address', 'state_code', 'credit_period_days', 'opening_balance'],
                'sample' => [
                    'name' => 'Apex Pharma Distributors',
                    'gstin' => '32ABCDE9999Z1Z4',
                    'phone' => '9847000111',
                    'credit_period_days' => 30,
                ],
            ],
            // CR-C: a purchase row may carry its charges beside the bill, one head per row, and
            // a legacy `freight` column imports as the Freight head (PUR-017).
            'purchases' => [
                'fields' => [
                    'supplier_name', 'supplier_gstin', 'invoice_number', 'invoice_date',
                    'taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'cess_amount',
                    'total_amount', 'round_off', 'payment_status', 'freight',
                    'charge_head', 'charge_amount', 'charge_gst_percent', 'charge_treatment',
                    'charge_spread_method', 'charge_itc_eligibility', 'charge_is_rcm',
                    'charge_paid_separately', 'charge_paid_to', 'charge_note',
                ],
                'sample' => [
                    'supplier_name' => 'Apex Pharma Distributors',
                    'invoice_number' => 'PUR-1001',
                    'invoice_date' => '15-11-2026',
                    'taxable_amount' => 10000,
                    'cgst_amount' => 600,
                    'sgst_amount' => 600,
                    'total_amount' => 11554,
                    'charge_head' => 'FREIGHT',
                    'charge_amount' => 200,
                    'charge_gst_percent' => 18,
                    'charge_treatment' => 'add_to_cost',
                    'charge_spread_method' => 'value',
                    'charge_itc_eligibility' => 'eligible',
                ],
            ],
            'purchase_charges' => [
                'fields' => [
                    'purchase_reference', 'charge_head', 'amount', 'gst_percent', 'treatment',
                    'spread_method', 'itc_eligibility', 'is_rcm', 'paid_separately', 'paid_to',
                    'note',
                ],
                'sample' => [
                    'purchase_reference' => 'PUR-1001',
                    'charge_head' => 'PACKING',
                    'amount' => 100,
                    'gst_percent' => 18,
                    'treatment' => 'expense',
                    'spread_method' => 'value',
                    'itc_eligibility' => 'eligible',
                ],
            ],
        ];

        if (!isset($templates[$type])) {
            return response()->json(['message' => "Template not found for type: {$type}"], 404);
        }

        return response()->json(['success' => true, 'type' => $type, 'template' => $templates[$type]]);
    }

    /**
     * Export entity records.
     */
    public function export(Request $request, string $type): JsonResponse
    {
        $storeId = (int) ($request->query('store_id')
            ?? $request->attributes->get('active_store_id')
            ?? 0);
        if ($storeId <= 0) {
            abort(422, 'A specific store context is required for export (All Stores scope has no single store catalog).');
        }

        $query = null;

        if ($type === 'items' || $type === 'products') {
            $query = Product::where('store_id', $storeId);
        } elseif ($type === 'customers') {
            $query = Party::where('type', 'customer')->where('store_id', $storeId);
        } elseif ($type === 'suppliers') {
            $query = Party::where('type', 'supplier')->where('store_id', $storeId);
        } elseif ($type === 'invoices') {
            $query = Invoice::where('store_id', $storeId);
        } elseif ($type === 'purchases') {
            // REP-007: every bill leaves with its charges beside it, and each item line with the
            // rate it was billed at next to the landed rate the charges moved it to (PUR-011).
            $register = new PurchaseRegisterService();

            $rows = Purchase::with(['items', 'charges'])
                ->where('store_id', $storeId)
                ->orderBy('invoice_date')
                ->orderBy('id')
                ->get()
                ->map(function (Purchase $purchase) use ($register): array {
                    $line = $purchase->toArray();
                    $line['charges'] = $register->chargeRows($purchase);
                    $line['items'] = $purchase->items->map(fn (PurchaseItem $item): array => array_merge(
                        $item->toArray(),
                        [
                            'billed_cost' => round((float) $item->purchase_rate, 4),
                            'landed_cost' => round((float) ($item->landed_unit_cost
                                ?? $item->effective_unit_cost
                                ?? $item->purchase_rate), 4),
                        ]
                    ))->values();

                    return $line;
                })
                ->values()
                ->all();

            return response()->json(['success' => true, 'type' => $type, 'data' => $rows]);
        } elseif ($type === 'purchase_charges') {
            $rows = PurchaseCharge::with('purchase:id,invoice_number,supplier_name,invoice_date')
                ->where('store_id', $storeId)
                ->orderBy('purchase_id')
                ->orderBy('seq')
                ->get();

            return response()->json([
                'success' => true,
                'type' => $type,
                'data' => $rows
                    ->map(fn (PurchaseCharge $charge): array => array_merge(
                        $charge->toArray(),
                        ['purchase_reference' => (string) ($charge->purchase?->invoice_number ?? '')]
                    ))
                    ->values(),
            ]);
        } else {
            return response()->json(['message' => "Unsupported export entity: {$type}"], 404);
        }

        return response()->json(['success' => true, 'type' => $type, 'data' => $query->get()]);
    }

    /**
     * Recent import history from audit logs.
     */
    public function history(Request $request): JsonResponse
    {
        $logs = AuditLog::where('action', 'import_batch')
            ->orderBy('id', 'desc')
            ->limit(50)
            ->get();

        return response()->json(['success' => true, 'history' => $logs]);
    }
}
