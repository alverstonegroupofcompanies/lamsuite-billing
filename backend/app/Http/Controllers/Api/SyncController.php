<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Party;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\Expense;
use App\Models\CustomerPayment;
use App\Models\MasterLookup;
use App\Models\SyncEvent;
use App\Models\Store;
use App\Models\AuditLog;
use App\Services\StockAdjustmentService;
use Illuminate\Validation\ValidationException;

class SyncController
{
    public function __construct(private StockAdjustmentService $stockAdjustments)
    {
    }

    /**
     * Resolve store_id from request headers, payload, or first store fallback.
     */
    private function resolveStoreId(Request $request, $itemData = []): int
    {
        $candidate = is_array($itemData) ? ($itemData['store_id'] ?? $itemData['store_code'] ?? null) : null;
        if (!$candidate) {
            $candidate = $request->header('X-Store-Id') ?: $request->header('Store-Id');
        }
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

        $firstStore = Store::first();
        return $firstStore ? $firstStore->id : 1;
    }

    /**
     * Universal batch push endpoint supporting all entity types.
     */
    public function pushBatch(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $store = Store::find($storeId);
        if ($store && !$store->is_active) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_DISABLED',
                'message' => 'Store is disabled by administration. Synchronization rejected.',
            ], 403);
        }

        $items = $request->input('items', []);
        $results = [
            'total' => count($items),
            'processed' => 0,
            'failed' => 0,
            'errors' => [],
        ];

        foreach ($items as $item) {
            $entityType = $item['entity_type'] ?? '';
            $action = $item['action'] ?? 'create';
            $payload = $item['payload'] ?? [];
            if (is_string($payload)) {
                $payload = json_decode($payload, true) ?: [];
            }

            try {
                switch ($entityType) {
                    case 'invoice':
                        $this->upsertSingleInvoice($request, $payload);
                        break;
                    case 'product':
                        $this->upsertSingleProduct($request, $payload);
                        break;
                    case 'customer':
                    case 'party':
                        $this->upsertSingleParty($request, $payload);
                        break;
                    case 'purchase':
                        $this->upsertSinglePurchase($request, $payload);
                        break;
                    case 'stock_event':
                    case 'stock_adjustment':
                        $this->upsertSingleStockEvent($request, $payload);
                        break;
                    case 'transfer':
                    case 'stock_transfer':
                        $this->upsertSingleTransfer($request, $payload);
                        break;
                    case 'payment':
                        $this->upsertSinglePayment($request, $payload);
                        break;
                    case 'staff':
                    case 'staff_user':
                        $this->upsertSingleStaffUser($request, $payload);
                        break;
                    case 'settings':
                    case 'setting':
                        $this->upsertSingleSettings($request, $payload);
                        break;
                    case 'lookup':
                    case 'master_lookup':
                    case 'unit':
                    case 'group':
                    case 'brand':
                    case 'manufacturer':
                    case 'discount_schema':
                    case 'tax_rate':
                    case 'expense_head':
                    case 'bank':
                        $this->upsertSingleLookup($request, $payload, $entityType);
                        break;
                    default:
                        // Record as generic sync event
                        $this->recordSyncEvent($request, $entityType, $item['entity_id'] ?? uniqid(), $action, $payload);
                        break;
                }
                $results['processed']++;
            } catch (\Throwable $e) {
                $results['failed']++;
                $results['errors'][] = [
                    'id' => $item['id'] ?? null,
                    'entity_type' => $entityType,
                    'error' => $e->getMessage(),
                ];
            }
        }

        return response()->json([
            'success' => $results['failed'] === 0,
            'results' => $results,
        ]);
    }

    /**
     * Idempotent push of offline invoices from desktop client.
     */
    public function pushInvoices(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $store = Store::find($storeId);
        if ($store && !$store->is_active) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_DISABLED',
                'message' => 'Store is disabled by administration. Invoices push rejected.',
            ], 403);
        }

        $invoicesData = $request->input('invoices', []);
        $ingested = 0;
        $failed = 0;
        $errors = [];

        foreach ($invoicesData as $inv) {
            try {
                $this->upsertSingleInvoice($request, $inv);
                $ingested++;
            } catch (\Throwable $e) {
                $failed++;
                $errors[] = [
                    'invoice_number' => $inv['invoice_number'] ?? null,
                    'external_id' => $inv['external_id'] ?? null,
                    'error' => $e->getMessage(),
                ];
            }
        }

        $statusCode = ($failed > 0 && $ingested === 0) ? 422 : 200;

        return response()->json([
            'success' => $failed === 0,
            'ingested_count' => $ingested,
            'failed_count' => $failed,
            'errors' => $errors,
        ], $statusCode);
    }

    private function upsertSingleInvoice(Request $request, array $inv): Invoice
    {
        $externalId = $inv['external_id'] ?? $inv['id'] ?? $inv['idempotency_key'] ?? null;
        if (!$externalId && !empty($inv['invoice_number'])) {
            $externalId = 'inv_' . $inv['invoice_number'];
        }
        if (!$externalId) {
            throw new \InvalidArgumentException('Missing invoice identification');
        }

        $storeId = $this->resolveStoreId($request, $inv);
        $store = Store::find($storeId);

        // Find existing invoice either by external_id OR (store_id + invoice_number) to prevent duplicates
        $invoice = null;
        if ($externalId) {
            $invoice = Invoice::where('store_id', $storeId)
                ->where(function ($q) use ($externalId, $inv) {
                    $q->where('external_id', $externalId);
                    if (!empty($inv['invoice_number'])) {
                        $q->orWhere('invoice_number', $inv['invoice_number']);
                    }
                })
                ->first();

            if (!$invoice) {
                // Also check by external_id across stores if storeId wasn't matched exactly
                $invoice = Invoice::where('external_id', $externalId)->first();
            }
        } elseif (!empty($inv['invoice_number'])) {
            $invoice = Invoice::where('store_id', $storeId)
                ->where('invoice_number', $inv['invoice_number'])
                ->first();
        }

        // Resolve customer_id if party exists
        $customerId = $inv['customer_id'] ?? null;
        $matchedParty = null;
        if ($customerId) {
            $matchedParty = is_numeric($customerId)
                ? Party::find($customerId)
                : Party::where('external_id', $customerId)->first();
            if ($matchedParty) {
                $customerId = $matchedParty->id;
            }
        }
        if (!$matchedParty && !empty($inv['customer_phone'])) {
            $matchedParty = Party::where('phone', $inv['customer_phone'])->first();
            if ($matchedParty) {
                $customerId = $matchedParty->id;
            }
        }
        if ($matchedParty && empty($matchedParty->phone) && !empty($inv['customer_phone'])) {
            $matchedParty->phone = $inv['customer_phone'];
            $matchedParty->save();
        }

        // DEF-02 Fix: Enforce credit debt safety - credit sales strictly require a registered customer account
        if (strcasecmp($inv['payment_mode'] ?? 'Cash', 'Credit') === 0) {
            if (empty($customerId) || !$matchedParty || stripos($matchedParty->name, 'Walk-in') !== false) {
                throw new \InvalidArgumentException("Credit sale requires a registered customer account (Walk-in credit is not permitted).");
            }
        }

        $invoiceDate = !empty($inv['invoice_date'])
            ? (strlen($inv['invoice_date']) === 10 ? $inv['invoice_date'] : substr($inv['invoice_date'], 0, 10))
            : now()->toDateString();

        // DEF-01 Fix: Enforce tax & taxable integrity so grand_total == taxable_subtotal + tax_total + round_off
        $grandTotal = (float)($inv['grand_total'] ?? 0);
        $taxableSubtotal = isset($inv['taxable_subtotal']) ? (float)$inv['taxable_subtotal'] : null;
        $taxTotal = isset($inv['tax_total']) ? (float)$inv['tax_total'] : null;
        $roundOff = (float)($inv['round_off'] ?? 0);

        if (($taxableSubtotal === null || $taxableSubtotal == 0) && $grandTotal > 0) {
            $gstType = $store->gst_type ?? 'regular';
            $taxMode = $store->tax_mode ?? 'inclusive';

            if (in_array($gstType, ['composition', 'no_tax', 'unregistered'], true)) {
                $taxableSubtotal = $grandTotal;
                $taxTotal = 0.0;
                $cgstTotal = 0.0;
                $sgstTotal = 0.0;
                $roundOff = 0.0;
            } else {
                // Defaulting to 12% GST
                $gstRate = 0.12;

                if ($taxMode === 'exclusive' && !empty($inv['subtotal']) && (float)$inv['subtotal'] > 0 && (float)$inv['subtotal'] < $grandTotal) {
                    $taxableSubtotal = round((float)$inv['subtotal'], 2);
                    $taxTotal = round($taxableSubtotal * $gstRate, 2);
                    $roundOff = round($grandTotal - ($taxableSubtotal + $taxTotal), 2);
                } else {
                    // Standard inclusive derivation ensuring grand_total == taxable_subtotal + tax_total + round_off
                    $taxableSubtotal = round($grandTotal / (1 + $gstRate), 2);
                    $taxTotal = round($grandTotal - $taxableSubtotal, 2);
                    $roundOff = round($grandTotal - ($taxableSubtotal + $taxTotal), 2);
                }

                $cgstTotal = round($taxTotal / 2, 2);
                $sgstTotal = round($taxTotal - $cgstTotal, 2);
            }
        } else {
            $taxableSubtotal = $taxableSubtotal ?? ($inv['subtotal'] ?? $grandTotal);
            $taxTotal = $taxTotal ?? 0;
            $cgstTotal = (float)($inv['cgst_total'] ?? ($taxTotal / 2));
            $sgstTotal = (float)($inv['sgst_total'] ?? ($taxTotal - $cgstTotal));
            if ($roundOff == 0 && abs($grandTotal - ($taxableSubtotal + $taxTotal)) <= 0.5) {
                $roundOff = round($grandTotal - ($taxableSubtotal + $taxTotal), 2);
            }
        }

        $invoiceData = [
            'store_id' => $storeId,
            'counter_id' => !empty($inv['counter_id']) && is_numeric($inv['counter_id']) ? (int)$inv['counter_id'] : null,
            'counter_code' => $inv['counter_code'] ?? null,
            'location_name' => $inv['location_name'] ?? null,
            'module_key' => $inv['module_key'] ?? 'invoice',
            'invoice_number' => $inv['invoice_number'] ?? ('INV-' . time()),
            'invoice_date' => $invoiceDate,
            'due_date' => !empty($inv['due_date']) ? substr($inv['due_date'], 0, 10) : null,
            'customer_id' => $customerId,
            'customer_name' => $inv['customer_name'] ?? 'Walk-in Customer',
            'customer_phone' => $inv['customer_phone'] ?? ($matchedParty ? $matchedParty->phone : null),
            'customer_gstin' => $inv['customer_gstin'] ?? null,
            'place_of_supply' => $inv['place_of_supply'] ?? null,
            'subtotal' => $inv['subtotal'] ?? $taxableSubtotal,
            'taxable_subtotal' => $taxableSubtotal,
            'discount_total' => $inv['discount_total'] ?? 0,
            'tax_total' => $taxTotal,
            'cgst_total' => $cgstTotal,
            'sgst_total' => $sgstTotal,
            'igst_total' => $inv['igst_total'] ?? 0,
            'cess_total' => $inv['cess_total'] ?? 0,
            'store_state_code' => $inv['store_state_code'] ?? '32',
            'original_invoice_id' => $inv['original_invoice_id'] ?? null,
            'original_invoice_number' => $inv['original_invoice_number'] ?? null,
            'round_off' => $roundOff,
            'grand_total' => $grandTotal,
            'paid_amount' => $inv['paid_amount'] ?? $grandTotal,
            'payment_mode' => $inv['payment_mode'] ?? 'Cash',
            'status' => $inv['status'] ?? 'issued',
            'cancel_reason' => $inv['cancel_reason'] ?? null,
            'patient_name' => $inv['patient_name'] ?? null,
            'doctor_name' => $inv['doctor_name'] ?? null,
            'doctor_reg_no' => $inv['doctor_reg_no'] ?? null,
            'synced_at' => now(),
        ];

        if ($invoice) {
            // Keep original external_id unless empty
            if (empty($invoice->external_id) && $externalId) {
                $invoiceData['external_id'] = $externalId;
            }
            $invoice->update($invoiceData);
        } else {
            $invoiceData['external_id'] = $externalId;
            $invoice = Invoice::create($invoiceData);
        }

        // Upsert invoice line items if present
        if (!empty($inv['items']) && is_array($inv['items'])) {
            // Delete previous synced items to maintain idempotent consistency
            InvoiceItem::where('invoice_id', $invoice->id)->delete();

            foreach ($inv['items'] as $item) {
                $productId = $item['product_id'] ?? null;
                if ($productId && !is_numeric($productId)) {
                    $prod = Product::where('external_id', $productId)
                        ->orWhere('name', $item['product_name'] ?? '')
                        ->first();
                    $productId = $prod ? $prod->id : null;
                }

                InvoiceItem::create([
                    'invoice_id' => $invoice->id,
                    'product_id' => $productId,
                    'product_name' => $item['product_name'] ?? 'Item',
                    'batch_no' => $item['batch_no'] ?? null,
                    'expiry_date' => !empty($item['expiry_date']) ? substr($item['expiry_date'], 0, 10) : null,
                    'qty' => $item['qty'] ?? 1,
                    'loose_qty' => $item['loose_qty'] ?? 0,
                    'units_per_pack' => $item['units_per_pack'] ?? 1,
                    'unit_price' => $item['unit_price'] ?? ($item['rate'] ?? 0),
                    'mrp' => $item['mrp'] ?? null,
                    'discount_percent' => $item['discount_percent'] ?? 0,
                    'discount_amount' => $item['discount_amount'] ?? 0,
                    'allocated_discount' => $item['allocated_discount'] ?? 0,
                    'taxable_amount' => $item['taxable_amount'] ?? 0,
                    'gst_percent' => $item['gst_percent'] ?? 0,
                    'cgst_amount' => $item['cgst_amount'] ?? 0,
                    'sgst_amount' => $item['sgst_amount'] ?? 0,
                    'igst_amount' => $item['igst_amount'] ?? 0,
                    'cess_rate' => $item['cess_rate'] ?? 0,
                    'cess_amount' => $item['cess_amount'] ?? 0,
                    'tax_amount' => $item['tax_amount'] ?? ($item['total_tax'] ?? 0),
                    'total_amount' => $item['total_amount'] ?? ($item['grand_total'] ?? 0),
                ]);
            }
        }

        // Record in sync_events for Admin Sync Center visibility
        $this->recordSyncEvent($request, 'invoice', (string)$invoice->id, 'create', [
            'invoice_number' => $invoice->invoice_number,
            'grand_total' => $invoice->grand_total,
            'customer_name' => $invoice->customer_name,
            'external_id' => $externalId,
        ]);

        return $invoice;
    }

    /**
     * Upsert product and its batches from desktop workstation.
     */
    public function pushProducts(Request $request): JsonResponse
    {
        $products = $request->input('products', []);
        $ingested = 0;

        foreach ($products as $p) {
            if ($this->upsertSingleProduct($request, $p) !== null) {
                $ingested++;
            }
        }

        return response()->json([
            'success' => true,
            'ingested_count' => $ingested,
        ]);
    }

    private function upsertSingleProduct(Request $request, array $p): ?Product
    {
        $storeId = $this->resolveStoreId($request, $p);
        $externalId = $p['external_id'] ?? $p['id'] ?? null;
        $name = trim((string) ($p['name'] ?? ''));

        // Never create placeholder catalog rows or upsert onto an ambiguous null external_id.
        if ($externalId === null || $externalId === '' || $name === '') {
            return null;
        }

        $product = Product::updateOrCreate(
            ['external_id' => $externalId],
            [
                'store_id' => $storeId,
                'barcode' => $p['barcode'] ?? null,
                'name' => $name,
                'print_name' => $p['print_name'] ?? $name,
                'generic_name' => $p['generic_name'] ?? null,
                'hsn_sac_code' => $p['hsn_sac_code'] ?? null,
                'category_id' => $p['category_id'] ?? 'General',
                'brand_id' => $p['brand_id'] ?? null,
                'unit_id' => $p['unit_id'] ?? null,
                'mrp' => $p['mrp'] ?? 0,
                'sel_rate' => $p['sel_rate'] ?? 0,
                'ptr' => $p['ptr'] ?? 0,
                'pts' => $p['pts'] ?? 0,
                'gst_percent' => $p['gst_percent'] ?? 0,
                'units_per_pack' => $p['units_per_pack'] ?? 1,
                'rack_location' => $p['rack_location'] ?? null,
                'shelf_location' => $p['shelf_location'] ?? null,
                'reorder_level' => $p['reorder_level'] ?? 10,
                'current_stock' => $p['current_stock'] ?? 0,
                'is_active' => $p['is_active'] ?? true,
                'version' => $p['version'] ?? 1,
            ]
        );

        // If batch data is included
        if (!empty($p['batches']) && is_array($p['batches'])) {
            foreach ($p['batches'] as $b) {
                $batchExtId = $b['external_id'] ?? $b['id'] ?? null;
                ProductBatch::updateOrCreate(
                    ['external_id' => $batchExtId],
                    [
                        'store_id' => $storeId,
                        'product_id' => $product->id,
                        'batch_no' => $b['batch_no'] ?? 'BAT-01',
                        'mfg_date' => !empty($b['mfg_date']) ? substr($b['mfg_date'], 0, 10) : null,
                        'expiry_date' => !empty($b['expiry_date']) ? substr($b['expiry_date'], 0, 10) : now()->addYear()->toDateString(),
                        'stock_qty' => $b['stock_qty'] ?? 0,
                        'mrp' => $b['mrp'] ?? $product->mrp,
                        'purchase_rate' => $b['purchase_rate'] ?? $product->ptr,
                        'selling_rate' => $b['selling_rate'] ?? $product->sel_rate,
                        'rack_location' => $b['rack_location'] ?? null,
                        'shelf_location' => $b['shelf_location'] ?? null,
                    ]
                );
            }
        }

        $this->recordSyncEvent($request, 'product', (string)$product->id, 'update', [
            'name' => $product->name,
            'sel_rate' => $product->sel_rate,
            'current_stock' => $product->current_stock,
        ]);

        return $product;
    }

    /**
     * Upsert parties (customers, suppliers, doctors, patients).
     */
    public function pushParties(Request $request): JsonResponse
    {
        $parties = $request->input('parties', []);
        $ingested = 0;

        foreach ($parties as $party) {
            $this->upsertSingleParty($request, $party);
            $ingested++;
        }

        return response()->json([
            'success' => true,
            'ingested_count' => $ingested,
        ]);
    }

    private function upsertSingleParty(Request $request, array $party): Party
    {
        $storeId = $this->resolveStoreId($request, $party);
        $externalId = $party['external_id'] ?? $party['id'] ?? null;

        $p = Party::updateOrCreate(
            ['external_id' => $externalId],
            [
                'store_id' => $storeId,
                'type' => $party['type'] ?? 'customer',
                'name' => $party['name'] ?? 'Unnamed Party',
                'phone' => $party['phone'] ?? null,
                'email' => $party['email'] ?? null,
                'gstin' => $party['gstin'] ?? null,
                'pan' => $party['pan'] ?? null,
                'address' => $party['address'] ?? null,
                'state_code' => $party['state_code'] ?? '32',
                'credit_limit' => $party['credit_limit'] ?? 0,
                'opening_balance' => $party['opening_balance'] ?? 0,
                'current_balance' => $party['outstanding_balance'] ?? ($party['current_balance'] ?? 0),
                'reg_no' => $party['reg_no'] ?? ($party['medical_reg_no'] ?? null),
                'is_active' => $party['is_active'] ?? true,
                'version' => $party['version'] ?? 1,
            ]
        );

        $this->recordSyncEvent($request, $p->type, (string)$p->id, 'create', [
            'name' => $p->name,
            'phone' => $p->phone,
            'balance' => $p->current_balance,
        ]);

        return $p;
    }

    private function upsertSingleLookup(Request $request, array $lookup, string $entityType = 'unit'): MasterLookup
    {
        $storeId = $this->resolveStoreId($request, $lookup);
        $type = $lookup['type'] ?? ($entityType !== 'lookup' && $entityType !== 'master_lookup' ? $entityType : 'unit');
        $code = $lookup['code'] ?? ($lookup['symbol'] ?? null);
        $name = trim((string)($lookup['name'] ?? 'Unnamed'));

        $record = MasterLookup::updateOrCreate(
            [
                'store_id' => $storeId,
                'type' => $type,
                'name' => $name,
            ],
            [
                'code' => $code,
                'description' => $lookup['description'] ?? null,
                'config' => $lookup['config'] ?? (isset($lookup['precision']) ? ['precision' => $lookup['precision']] : null),
                'is_active' => isset($lookup['is_active']) ? (bool)$lookup['is_active'] : true,
            ]
        );

        $this->recordSyncEvent($request, 'lookup', (string)$record->id, 'update', [
            'type' => $record->type,
            'name' => $record->name,
        ]);

        return $record;
    }

    /**
     * Upsert purchases and purchase line items.
     */
    public function pushPurchases(Request $request): JsonResponse
    {
        $purchases = $request->input('purchases', []);
        $ingested = 0;

        foreach ($purchases as $pur) {
            $this->upsertSinglePurchase($request, $pur);
            $ingested++;
        }

        return response()->json([
            'success' => true,
            'ingested_count' => $ingested,
        ]);
    }

    private function upsertSinglePurchase(Request $request, array $pur): Purchase
    {
        $storeId = $this->resolveStoreId($request, $pur);
        $externalId = $pur['external_id'] ?? $pur['id'] ?? null;

        $rawDate = $pur['invoice_date'] ?? $pur['purchase_date'] ?? null;
        $invoiceDate = !empty($rawDate)
            ? (strlen($rawDate) === 10 ? $rawDate : substr($rawDate, 0, 10))
            : now()->toDateString();

        $purchase = Purchase::updateOrCreate(
            ['invoice_number' => $pur['invoice_number'] ?? $pur['supplier_invoice_no'] ?? ('PUR-' . time())],
            [
                'store_id' => $storeId,
                'supplier_name' => $pur['supplier_name'] ?? 'Supplier',
                'supplier_gstin' => $pur['supplier_gstin'] ?? null,
                'invoice_date' => $invoiceDate,
                'module_key' => $pur['module_key'] ?? 'purchase',
                'subtotal' => $pur['subtotal'] ?? 0,
                'tax_total' => $pur['tax_total'] ?? 0,
                'cgst_total' => $pur['cgst_total'] ?? 0,
                'sgst_total' => $pur['sgst_total'] ?? 0,
                'igst_total' => $pur['igst_total'] ?? 0,
                'cess_total' => $pur['cess_total'] ?? 0,
                'is_interstate' => (bool)($pur['is_interstate'] ?? false),
                'is_rcm' => (bool)($pur['is_rcm'] ?? false),
                'itc_eligibility' => $pur['itc_eligibility'] ?? 'eligible',
                'freight_charges' => $pur['freight_charges'] ?? 0,
                'bill_discount_type' => $pur['bill_discount_type'] ?? 'amount',
                'bill_discount' => $pur['bill_discount'] ?? 0,
                'round_off' => $pur['round_off'] ?? 0,
                'grand_total' => $pur['grand_total'] ?? 0,
                'paid_amount' => $pur['paid_amount'] ?? 0,
                'status' => $pur['status'] ?? 'received',
                'cancel_reason' => $pur['cancel_reason'] ?? null,
            ]
        );

        if (!empty($pur['items']) && is_array($pur['items'])) {
            PurchaseItem::where('purchase_id', $purchase->id)->delete();
            foreach ($pur['items'] as $item) {
                PurchaseItem::create([
                    'purchase_id' => $purchase->id,
                    'product_name' => $item['product_name'] ?? 'Item',
                    'batch_no' => ($item['batch_no'] ?? null) ?: null,
                    'expiry_date' => !empty($item['expiry_date']) ? substr($item['expiry_date'], 0, 10) : null,
                    'mfg_date' => !empty($item['mfg_date']) ? substr($item['mfg_date'], 0, 10) : null,
                    'hsn_code' => $item['hsn_code'] ?? null,
                    'selling_rate' => $item['selling_rate'] ?? null,
                    'pack_qty' => $item['pack_qty'] ?? ($item['qty'] ?? 1),
                    'loose_qty' => $item['loose_qty'] ?? 0,
                    'free_qty' => $item['free_qty'] ?? 0,
                    'free_loose_qty' => $item['free_loose_qty'] ?? 0,
                    'units_per_pack' => $item['units_per_pack'] ?? 1,
                    'qty' => $item['qty'] ?? 1,
                    'purchase_rate' => $item['purchase_rate'] ?? ($item['unit_price'] ?? 0),
                    'ptr' => $item['ptr'] ?? ($item['purchase_rate'] ?? ($item['unit_price'] ?? 0)),
                    'pts' => $item['pts'] ?? null,
                    'ptss' => $item['ptss'] ?? null,
                    'discount_type' => $item['discount_type'] ?? 'percent',
                    'discount_percent' => $item['discount_percent'] ?? 0,
                    'discount_amount' => $item['discount_amount'] ?? 0,
                    'effective_unit_cost' => $item['effective_unit_cost'] ?? 0,
                    'taxable_amount' => $item['taxable_amount'] ?? 0,
                    'mrp' => $item['mrp'] ?? 0,
                    'gst_percent' => $item['gst_percent'] ?? 0,
                    'cgst_amount' => $item['cgst_amount'] ?? 0,
                    'sgst_amount' => $item['sgst_amount'] ?? 0,
                    'igst_amount' => $item['igst_amount'] ?? 0,
                    'cess_amount' => $item['cess_amount'] ?? 0,
                    'tax_amount' => $item['tax_amount'] ?? 0,
                    'total_amount' => $item['total_amount'] ?? 0,
                ]);
            }
        }

        $this->recordSyncEvent($request, 'purchase', (string)$purchase->id, 'create', [
            'invoice_number' => $purchase->invoice_number,
            'supplier' => $purchase->supplier_name,
            'grand_total' => $purchase->grand_total,
        ]);

        return $purchase;
    }

    /**
     * Upsert stock adjustment.
     */
    private function upsertSingleStockEvent(Request $request, array $event): void
    {
        $storeId = $this->resolveStoreId($request, $event);

        // A multi-line adjustment document is synced as one event with the same
        // document_id the desktop stored locally, so retries remain idempotent.
        if (isset($event['lines']) && is_array($event['lines']) && count($event['lines']) > 0) {
            try {
                $result = $this->stockAdjustments->post($storeId, $request->user(), [
                    'document_id' => $event['document_id'] ?? ($event['reference_id'] ?? ($event['id'] ?? null)),
                    'mode' => $event['mode'] ?? 'adjustment',
                    'reason' => $event['reason'] ?? ($event['notes'] ?? null),
                    'notes' => $event['notes'] ?? null,
                    'document_date' => $event['document_date'] ?? ($event['created_date'] ?? null),
                    'lines' => $event['lines'],
                ]);
            } catch (ValidationException $e) {
                throw new \RuntimeException(implode(' ', $e->validator->errors()->all()));
            }

            $this->recordSyncEvent($request, 'stock_adjustment', $result['document']->document_id, 'create', [
                'document_id' => $result['document']->document_id,
                'status' => $result['document']->status,
                'lines' => $result['document']->lines_count,
            ]);

            return;
        }

        $productId = $event['product_id'] ?? null;
        if ($productId && !is_numeric($productId)) {
            $p = Product::where('external_id', $productId)->first();
            $productId = $p ? $p->id : null;
        }

        $batchId = $event['batch_id'] ?? null;
        if ($batchId && !is_numeric($batchId)) {
            $b = ProductBatch::where('batch_no', $batchId)->first();
            $batchId = $b ? $b->id : null;
        }

        $qtyDelta = (float)($event['qty_delta'] ?? 0);
        $idempotencyKey = $event['idempotency_key'] ?? ($event['id'] ?? null);

        // Deduplicate using idempotency key if present
        $existingEntry = null;
        if ($idempotencyKey) {
            $existingEntry = \App\Models\StockLedgerEntry::where('idempotency_key', $idempotencyKey)->first();
        }

        if (!$existingEntry && $productId) {
            // Find batch current balance
            $currentStock = 0;
            if ($batchId) {
                $batch = ProductBatch::find($batchId);
                $currentStock = $batch ? (float)$batch->stock_qty : 0;
            }

            $newBalance = $currentStock + $qtyDelta;
            $isNegative = $newBalance < 0;

            // Check store company setting for allow_negative_stock
            $companySetting = \App\Models\CompanySetting::where('store_id', $storeId)->first();
            $allowNegative = $companySetting ? ($companySetting->allow_negative_stock ?? true) : true;

            \App\Models\StockLedgerEntry::create([
                'store_id' => $storeId,
                'product_id' => $productId,
                'batch_id' => $batchId,
                'counter_id' => !empty($event['counter_id']) && is_numeric($event['counter_id']) ? (int)$event['counter_id'] : null,
                'counter_code' => $event['counter_code'] ?? null,
                'location_name' => $event['location_name'] ?? null,
                'event_type' => $event['event_type'] ?? ($qtyDelta < 0 ? 'SALE' : 'PURCHASE'),
                'qty_delta' => $qtyDelta,
                'reference_type' => $event['reference_type'] ?? 'counter_pos',
                'reference_id' => $event['reference_id'] ?? null,
                'is_reconciled_negative' => $isNegative,
                'balance_after' => $newBalance,
                'idempotency_key' => $idempotencyKey,
                'staff_user_id' => $request->user()?->id,
            ]);

            // Update product batch stock quantity
            if ($batchId && isset($batch) && $batch) {
                $batch->update(['stock_qty' => $newBalance]);
            }

            // Also keep standard StockAdjustment record for legacy views
            StockAdjustment::create([
                'store_id' => $storeId,
                'product_id' => $productId,
                'batch_no' => $event['batch_no'] ?? ($batch->batch_no ?? 'UNKNOWN'),
                'adjustment_type' => $qtyDelta >= 0 ? 'increase' : 'decrease',
                'qty' => abs($qtyDelta),
                'reason' => ($event['notes'] ?? ($event['event_type'] ?? 'Counter Stock Delta')) . ($isNegative ? ' [RECONCILED NEGATIVE]' : ''),
                'user_id' => 1,
            ]);
        }

        $this->recordSyncEvent($request, 'stock_adjustment', $event['id'] ?? uniqid(), 'create', $event);
    }

    /**
     * Upsert stock transfers.
     */
    public function pushTransfers(Request $request): JsonResponse
    {
        $transfers = $request->input('transfers', []);
        $ingested = 0;
        foreach ($transfers as $t) {
            $this->upsertSingleTransfer($request, $t);
            $ingested++;
        }
        return response()->json(['success' => true, 'ingested_count' => $ingested]);
    }

    private function upsertSingleTransfer(Request $request, array $transfer): StockTransfer
    {
        $storeId = $this->resolveStoreId($request, $transfer);
        $stkTransfer = StockTransfer::updateOrCreate(
            ['transfer_number' => $transfer['transfer_no'] ?? $transfer['transfer_number'] ?? ('TRF-' . time())],
            [
                'from_store_id' => $storeId,
                'to_store_id' => !empty($transfer['destination_store_id']) && is_numeric($transfer['destination_store_id']) ? (int)$transfer['destination_store_id'] : 2,
                'status' => $transfer['status'] ?? 'dispatched',
                'notes' => $transfer['notes'] ?? null,
                'created_by' => 1,
            ]
        );

        if (!empty($transfer['lines']) && is_array($transfer['lines'])) {
            StockTransferItem::where('stock_transfer_id', $stkTransfer->id)->delete();
            foreach ($transfer['lines'] as $line) {
                $productId = $line['product_id'] ?? null;
                if ($productId && !is_numeric($productId)) {
                    $p = Product::where('external_id', $productId)->first();
                    $productId = $p ? $p->id : null;
                }
                if ($productId) {
                    StockTransferItem::create([
                        'stock_transfer_id' => $stkTransfer->id,
                        'product_id' => $productId,
                        'batch_no' => $line['batch_no'] ?? 'BAT-01',
                        'qty' => $line['transfer_total_qty'] ?? ($line['qty'] ?? 1),
                    ]);
                }
            }
        }

        $this->recordSyncEvent($request, 'stock_transfer', (string)$stkTransfer->id, 'create', [
            'transfer_number' => $stkTransfer->transfer_number,
            'status' => $stkTransfer->status,
        ]);

        return $stkTransfer;
    }

    /**
     * Upsert customer or supplier payments.
     */
    private function upsertSinglePayment(Request $request, array $payment): void
    {
        $storeId = $this->resolveStoreId($request, $payment);
        $customerId = $payment['customer_id'] ?? ($payment['party_id'] ?? null);

        if ($customerId && !is_numeric($customerId)) {
            $p = Party::where('external_id', $customerId)->first();
            $customerId = $p ? $p->id : null;
        }

        if ($customerId) {
            CustomerPayment::create([
                'store_id' => $storeId,
                'customer_id' => $customerId,
                'amount' => $payment['amount'] ?? 0,
                'payment_mode' => $payment['payment_mode'] ?? 'Cash',
                'reference_no' => $payment['reference_no'] ?? null,
                'notes' => $payment['notes'] ?? null,
                'payment_date' => !empty($payment['payment_date']) ? substr($payment['payment_date'], 0, 10) : now()->toDateString(),
                'created_by' => 1,
            ]);
        }

        $this->recordSyncEvent($request, 'payment', $payment['id'] ?? uniqid(), 'create', $payment);
    }

    /**
     * Upsert staff users synced from billing terminals.
     */
    /**
     * Ingest security audit events recorded while the workstation was offline.
     * Client event ids make retries idempotent.
     */
    public function pushSecurityAudit(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'nullable',
            'device_uuid' => 'nullable|string|max:100',
            'events' => 'required|array|max:200',
            'events.*.id' => 'nullable|string|max:100',
            'events.*.event_type' => 'required|string|max:100',
            'events.*.user_id' => 'nullable',
            'events.*.user_name' => 'nullable|string|max:150',
            'events.*.counter_id' => 'nullable|string|max:100',
            'events.*.details' => 'nullable|string|max:2000',
            'events.*.ip_address' => 'nullable|string|max:64',
            'events.*.created_at' => 'nullable|integer',
        ]);

        $storeId = $this->resolveStoreId($request, $validated);
        $ingested = 0;

        foreach ($validated['events'] as $event) {
            $clientEventId = $event['id'] ?? null;
            $action = (string)$event['event_type'];

            if ($clientEventId && AuditLog::where('entity_type', 'SecurityEvent')
                ->where('entity_id', $clientEventId)
                ->where('action', $action)
                ->exists()) {
                continue;
            }

            AuditLog::log(
                $action,
                'SecurityEvent',
                $clientEventId,
                null,
                [
                    'source' => 'offline',
                    'client_event_id' => $clientEventId,
                    'user_name' => $event['user_name'] ?? null,
                    'counter_id' => $event['counter_id'] ?? null,
                    'details' => $event['details'] ?? null,
                    'client_created_at' => isset($event['created_at'])
                        ? date(DATE_ATOM, (int)($event['created_at'] / 1000))
                        : null,
                    'device_uuid' => $validated['device_uuid'] ?? null,
                ],
                $storeId,
                is_numeric($event['user_id'] ?? null) ? (int)$event['user_id'] : null
            );
            $ingested++;
        }

        return response()->json(['success' => true, 'ingested_count' => $ingested]);
    }

    public function pushStaff(Request $request): JsonResponse
    {
        $staffList = $request->input('staff', $request->input('items', []));
        $ingested = 0;
        foreach ($staffList as $staff) {
            $this->upsertSingleStaffUser($request, $staff);
            $ingested++;
        }
        return response()->json(['success' => true, 'ingested_count' => $ingested]);
    }

    private function upsertSingleStaffUser(Request $request, array $staff): void
    {
        $storeId = $this->resolveStoreId($request, $staff);
        $username = trim($staff['username'] ?? '');
        $name = trim($staff['full_name'] ?? ($staff['name'] ?? 'Staff Operator'));
        if (empty($username)) {
            return;
        }

        // Standardize email identifier for user model
        $email = !empty($staff['email']) ? $staff['email'] : ($username . '@store' . $storeId . '.lamstone.local');

        // Map desktop roles to backend roles
        $desktopRole = strtolower($staff['role'] ?? 'cashier');
        $backendRole = 'manager';
        if (in_array($desktopRole, ['admin', 'store_owner', 'super_admin'])) {
            $backendRole = 'store_owner';
        } elseif ($desktopRole === 'manager') {
            $backendRole = 'manager';
        } elseif (in_array($desktopRole, ['cashier', 'operator'])) {
            $backendRole = 'manager'; // Allow POS operator access with manager base role
        }

        $user = \App\Models\User::where('email', $email)
            ->orWhere(function ($q) use ($storeId, $username) {
                $q->where('store_id', $storeId)
                  ->where('email', 'like', $username . '@%');
            })
            ->first();

        // Ensure username does not collide with other stores
        $uniqueUsername = $username;
        $existingOtherUser = \App\Models\User::where('username', $uniqueUsername)
            ->when($user, function ($q) use ($user) {
                $q->where('id', '!=', $user->id);
            })
            ->first();
        if ($existingOtherUser) {
            $uniqueUsername = 's' . $storeId . '_' . $username;
        }

        $pinHash = null;
        if (!empty($staff['pin'])) {
            $pinHash = \Illuminate\Support\Facades\Hash::make($staff['pin']);
        } elseif (!empty($staff['pin_code'])) {
            $pinHash = \Illuminate\Support\Facades\Hash::make($staff['pin_code']);
        }

        if ($user) {
            $updateData = [
                'store_id' => $storeId,
                'name' => $name,
                'username' => $uniqueUsername,
                'role' => $user->role ?: $backendRole,
                'is_biometric_enabled' => !empty($staff['biometric_registered']),
            ];
            if (!empty($staff['password'])) {
                $updateData['password'] = \Illuminate\Support\Facades\Hash::make($staff['password']);
            }
            if ($pinHash) {
                $updateData['pin_hash'] = $pinHash;
            }
            $user->update($updateData);
        } else {
            // Never create an account with a predictable password. When the
            // desktop does not supply one, generate a random secret and force a
            // credential reset before the account can be used for login.
            $hasSuppliedPassword = !empty($staff['password']);
            \App\Models\User::create([
                'store_id' => $storeId,
                'name' => $name,
                'username' => $uniqueUsername,
                'email' => $email,
                'password' => \Illuminate\Support\Facades\Hash::make(
                    $hasSuppliedPassword ? $staff['password'] : \Illuminate\Support\Str::random(32)
                ),
                'must_change_password' => !$hasSuppliedPassword,
                'pin_hash' => $pinHash,
                'role' => $backendRole,
                'is_biometric_enabled' => !empty($staff['biometric_registered']),
                'idle_timeout_minutes' => 15,
                'max_failed_logins' => 5,
            ]);
        }

        $this->recordSyncEvent($request, 'staff_user', $staff['id'] ?? uniqid(), 'upsert', [
            'store_id' => $storeId,
            'username' => $username,
            'full_name' => $name,
            'role' => $desktopRole,
        ]);
    }

    /**
     * Idempotent push of stock transactions from desktop client.
     */
    public function pushStockEvents(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $store = Store::find($storeId);
        if ($store && !$store->is_active) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_DISABLED',
                'message' => 'Store is disabled by administration. Stock events push rejected.',
            ], 403);
        }

        $events = $request->input('events', []);
        $ingested = 0;

        foreach ($events as $event) {
            $this->upsertSingleStockEvent($request, $event);
            $ingested++;
        }

        return response()->json([
            'success' => true,
            'ingested_count' => $ingested,
        ]);
    }

    /**
     * Record sync event into sync_events table for Admin Sync Center visibility.
     */
    private function recordSyncEvent(Request $request, string $entityType, string $entityId, string $action, array $payload): void
    {
        $storeId = $this->resolveStoreId($request, $payload);
        $deviceId = null;
        if (!empty($payload['device_id']) && is_numeric($payload['device_id'])) {
            $deviceId = \App\Models\Device::find($payload['device_id'])?->id;
        }

        SyncEvent::create([
            'store_id' => $storeId,
            'device_id' => $deviceId,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'action' => $action,
            'client_version' => 1,
            'server_version' => 1,
            'client_data' => $payload,
            'server_data' => null,
            'status' => 'resolved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function upsertSingleSettings(Request $request, array $payload): void
    {
        $storeId = $this->resolveStoreId($request, $payload);
        $store = Store::find($storeId) ?? Store::first();
        if (!$store) return;

        $updateReq = new Request();
        $updateReq->replace($payload);
        $updateReq->attributes->set('active_store_id', $store->id);
        (new AdminSettingController())->update($updateReq);
    }

    /**
     * Pull master deltas updated since watermark timestamp.
     */
    public function pullDeltas(Request $request): JsonResponse
    {
        $watermark = $request->input('since_watermark', 0);
        $sinceDate = date('Y-m-d H:i:s', $watermark / 1000);

        // Require an explicit store context. Falling back to the first store
        // would hand one tenant's masters to a device that never identified
        // itself, which is how another store's catalog could reseed it.
        $explicitStore = $request->header('X-Store-Id')
            ?: $request->header('Store-Id')
            ?: $request->query('store_id')
            ?: $request->input('store_id')
            ?: $request->user()?->store_id;
        if ($explicitStore === null || $explicitStore === '') {
            return response()->json([
                'watermark' => (int) (microtime(true) * 1000),
                'store_id' => null,
                'is_active' => true,
                'store_version' => 1,
                'last_reset_at' => null,
                'last_reset_options' => null,
                'sync_events' => [],
                'products' => [],
                'batches' => [],
                'parties' => [],
                'lookups' => [],
                'settings' => null,
                'error' => 'STORE_CONTEXT_REQUIRED',
            ]);
        }

        $storeId = $this->resolveStoreId($request);

        $products = Product::where('store_id', $storeId)->where('updated_at', '>=', $sinceDate)->get();
        $batches = ProductBatch::where('store_id', $storeId)->where('updated_at', '>=', $sinceDate)->get();
        $parties = Party::where('store_id', $storeId)->where('updated_at', '>=', $sinceDate)->get();
        $lookups = MasterLookup::where(function ($query) use ($storeId) {
            $query->whereNull('store_id')->orWhere('store_id', $storeId);
        })->where('updated_at', '>=', $sinceDate)->get();

        $store = Store::find($storeId) ?? Store::first();
        $settings = $store ? (new AdminSettingController())->getSettingsPayload($store) : null;

        // Fetch any store_status or store_reset sync events for this store
        $storeEvents = SyncEvent::where('store_id', $store?->id)
            ->whereIn('entity_type', ['store_reset', 'store_status'])
            ->orderBy('id', 'desc')
            ->take(5)
            ->get();

        $lastReset = \App\Models\AuditLog::where('store_id', $store?->id)
            ->where('action', 'remote_store_reset')
            ->latest('id')
            ->first();
        $lastResetAt = $lastReset ? $lastReset->created_at->toIso8601String() : null;

        return response()->json([
            'watermark' => (int) (microtime(true) * 1000),
            'store_id' => $store?->id,
            'is_active' => $store ? (bool)$store->is_active : true,
            'store_version' => $store ? (int)$store->version : 1,
            'last_reset_at' => $lastResetAt,
            'last_reset_options' => $lastReset ? ($lastReset->new_values['options'] ?? null) : null,
            'sync_events' => $storeEvents,
            'products' => $products,
            'batches' => $batches,
            'parties' => $parties,
            'lookups' => $lookups,
            'settings' => $settings,
        ]);
    }

    /**
     * Near Real-Time Server-Sent Events (SSE) stream for instant delta propagation.
     */
    public function streamSSE(Request $request)
    {
        $storeId = $this->resolveStoreId($request);
        $counterCode = $request->query('counter_code', 'unknown');

        // Update counter's last seen status
        \App\Models\Counter::where('store_id', $storeId)
            ->where('counter_code', $counterCode)
            ->update(['last_seen_at' => now(), 'ip_address' => $request->ip()]);

        return response()->stream(function () use ($storeId, $counterCode) {
            $latestEventId = (int)\App\Models\SyncEvent::where('store_id', $storeId)->max('id');

            // Send initial connected packet
            echo "event: connected\n";
            echo 'data: ' . json_encode([
                'status' => 'connected',
                'counter' => $counterCode,
                'server_time' => (int)(microtime(true) * 1000),
                'latest_event_id' => $latestEventId,
            ]) . "\n\n";
            ob_flush();
            flush();

            // Stream any recent events
            $events = \App\Models\SyncEvent::where('store_id', $storeId)
                ->where('id', '>', max(0, $latestEventId - 5))
                ->orderBy('id', 'asc')
                ->get();

            foreach ($events as $event) {
                echo "event: sync_event\n";
                echo 'data: ' . json_encode($event) . "\n\n";
                ob_flush();
                flush();
            }

            // Keep-alive ping
            echo "event: ping\n";
            echo 'data: ' . json_encode(['timestamp' => (int)(microtime(true) * 1000)]) . "\n\n";
            ob_flush();
            flush();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'Connection' => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * Acquire or renew a lock on an invoice before modifying/cancelling it.
     */
    public function lockInvoice(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $counterId = $request->input('counter_id');
        $counterCode = $request->input('counter_code', 'C01');

        // Check if currently locked by a DIFFERENT counter and not expired
        if ($invoice->locked_by_counter_id && $invoice->locked_by_counter_id != $counterId && $invoice->locked_until && $invoice->locked_until->isFuture()) {
            return response()->json([
                'success' => false,
                'locked' => true,
                'message' => "Invoice is currently being edited on another counter (Counter ID: {$invoice->locked_by_counter_id}). Locked until " . $invoice->locked_until->toIso8601String(),
                'locked_until' => $invoice->locked_until,
            ], 423); // 423 Locked
        }

        // Acquire lock for 5 minutes
        $lockedUntil = now()->addMinutes(5);
        $invoice->update([
            'locked_by_counter_id' => $counterId,
            'locked_until' => $lockedUntil,
        ]);

        return response()->json([
            'success' => true,
            'message' => "Invoice lock acquired by counter {$counterCode}.",
            'locked_until' => $lockedUntil,
        ]);
    }

    /**
     * Release lock on an invoice.
     */
    public function unlockInvoice(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $invoice->update([
            'locked_by_counter_id' => null,
            'locked_until' => null,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Invoice lock released.',
        ]);
    }

    /**
     * Negative stock reconciliation report across counters.
     */
    public function getNegativeStockReport(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);

        $negativeBatches = ProductBatch::where('stock_qty', '<', 0)
            ->with(['product'])
            ->get();

        $negativeEntries = \App\Models\StockLedgerEntry::where('store_id', $storeId)
            ->where('is_reconciled_negative', true)
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'negative_batches_count' => $negativeBatches->count(),
            'negative_batches' => $negativeBatches,
            'audit_entries' => $negativeEntries,
        ]);
    }
}

