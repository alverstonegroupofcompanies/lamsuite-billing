<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\Party;
use App\Models\Invoice;
use App\Models\Purchase;
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
        $storeId = $validated['store_id'] ?? 1;

        DB::beginTransaction();
        try {
            $insertedCount = 0;
            $updatedCount = 0;

            if ($entityType === 'items' || $entityType === 'products') {
                foreach ($rows as $row) {
                    $barcode = $row['barcode'] ?? null;
                    $existing = $barcode ? Product::where('barcode', $barcode)->first() : null;

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
                    Party::create([
                        'store_id' => $storeId,
                        'name' => $row['name'],
                        'type' => $partyType,
                        'phone' => $row['phone'] ?? null,
                        'gstin' => $row['gstin'] ?? null,
                        'address' => $row['address'] ?? null,
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
        $storeId = $request->query('store_id');
        $query = null;

        if ($type === 'items' || $type === 'products') {
            $query = Product::when($storeId, fn($q) => $q->where('store_id', $storeId));
        } elseif ($type === 'customers') {
            $query = Party::where('type', 'customer')->when($storeId, fn($q) => $q->where('store_id', $storeId));
        } elseif ($type === 'suppliers') {
            $query = Party::where('type', 'supplier')->when($storeId, fn($q) => $q->where('store_id', $storeId));
        } elseif ($type === 'invoices') {
            $query = Invoice::when($storeId, fn($q) => $q->where('store_id', $storeId));
        } elseif ($type === 'purchases') {
            $query = Purchase::when($storeId, fn($q) => $q->where('store_id', $storeId));
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
