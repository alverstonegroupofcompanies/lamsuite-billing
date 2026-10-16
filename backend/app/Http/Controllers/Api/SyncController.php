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
use App\Models\SyncEvent;
use App\Models\Store;

class SyncController
{
    /**
     * Resolve store_id from request headers, payload, or first store fallback.
     */
    private function resolveStoreId(Request $request, $itemData = []): int
    {
        if (!empty($itemData['store_id'])) {
            if (is_numeric($itemData['store_id'])) {
                return (int)$itemData['store_id'];
            }
            $store = Store::where('code', $itemData['store_id'])->first();
            if ($store) return $store->id;
        }

        $headerStore = $request->header('X-Store-Id') ?: $request->header('Store-Id');
        if ($headerStore) {
            if (is_numeric($headerStore)) return (int)$headerStore;
            $store = Store::where('code', $headerStore)->first();
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
        $invoicesData = $request->input('invoices', []);
        $ingested = 0;
        $failed = 0;

        foreach ($invoicesData as $inv) {
            try {
                $this->upsertSingleInvoice($request, $inv);
                $ingested++;
            } catch (\Throwable $e) {
                $failed++;
            }
        }

        return response()->json([
            'success' => $failed === 0,
            'ingested_count' => $ingested,
            'failed_count' => $failed,
        ]);
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
        if ($customerId && !is_numeric($customerId)) {
            $matchedParty = Party::where('external_id', $customerId)
                ->orWhere('phone', $inv['customer_phone'] ?? '')
                ->first();
            $customerId = $matchedParty ? $matchedParty->id : null;
        }

        $invoiceDate = !empty($inv['invoice_date'])
            ? (strlen($inv['invoice_date']) === 10 ? $inv['invoice_date'] : substr($inv['invoice_date'], 0, 10))
            : now()->toDateString();

        $invoiceData = [
            'store_id' => $storeId,
            'module_key' => $inv['module_key'] ?? 'invoice',
            'invoice_number' => $inv['invoice_number'] ?? ('INV-' . time()),
            'invoice_date' => $invoiceDate,
            'due_date' => !empty($inv['due_date']) ? substr($inv['due_date'], 0, 10) : null,
            'customer_id' => $customerId,
            'customer_name' => $inv['customer_name'] ?? 'Walk-in Customer',
            'customer_gstin' => $inv['customer_gstin'] ?? null,
            'place_of_supply' => $inv['place_of_supply'] ?? null,
            'subtotal' => $inv['subtotal'] ?? 0,
            'discount_total' => $inv['discount_total'] ?? 0,
            'tax_total' => $inv['tax_total'] ?? 0,
            'round_off' => $inv['round_off'] ?? 0,
            'grand_total' => $inv['grand_total'] ?? 0,
            'paid_amount' => $inv['paid_amount'] ?? ($inv['grand_total'] ?? 0),
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
                    'unit_price' => $item['unit_price'] ?? ($item['rate'] ?? 0),
                    'discount_percent' => $item['discount_percent'] ?? 0,
                    'discount_amount' => $item['discount_amount'] ?? 0,
                    'gst_percent' => $item['gst_percent'] ?? 0,
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
            $this->upsertSingleProduct($request, $p);
            $ingested++;
        }

        return response()->json([
            'success' => true,
            'ingested_count' => $ingested,
        ]);
    }

    private function upsertSingleProduct(Request $request, array $p): Product
    {
        $storeId = $this->resolveStoreId($request, $p);
        $externalId = $p['external_id'] ?? $p['id'] ?? null;

        $product = Product::updateOrCreate(
            ['external_id' => $externalId],
            [
                'store_id' => $storeId,
                'barcode' => $p['barcode'] ?? null,
                'name' => $p['name'] ?? 'Untitled Product',
                'print_name' => $p['print_name'] ?? ($p['name'] ?? null),
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

        $invoiceDate = !empty($pur['invoice_date'])
            ? (strlen($pur['invoice_date']) === 10 ? $pur['invoice_date'] : substr($pur['invoice_date'], 0, 10))
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
                    'batch_no' => $item['batch_no'] ?? 'BAT-01',
                    'expiry_date' => !empty($item['expiry_date']) ? substr($item['expiry_date'], 0, 10) : now()->addYear()->toDateString(),
                    'qty' => $item['qty'] ?? 1,
                    'purchase_rate' => $item['purchase_rate'] ?? ($item['unit_price'] ?? 0),
                    'mrp' => $item['mrp'] ?? 0,
                    'gst_percent' => $item['gst_percent'] ?? 0,
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

        $productId = $event['product_id'] ?? null;
        if ($productId && !is_numeric($productId)) {
            $p = Product::where('external_id', $productId)->first();
            $productId = $p ? $p->id : null;
        }

        if ($productId) {
            StockAdjustment::create([
                'store_id' => $storeId,
                'product_id' => $productId,
                'batch_no' => $event['batch_id'] ?? ($event['batch_no'] ?? null),
                'adjustment_type' => ($event['qty_delta'] ?? 0) >= 0 ? 'increase' : 'decrease',
                'qty' => abs($event['qty_delta'] ?? 0),
                'reason' => $event['notes'] ?? ($event['event_type'] ?? 'Workstation Stock Event'),
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
     * Idempotent push of stock transactions from desktop client.
     */
    public function pushStockEvents(Request $request): JsonResponse
    {
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
        SyncEvent::create([
            'store_id' => $storeId,
            'device_id' => 1,
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

    /**
     * Pull master deltas updated since watermark timestamp.
     */
    public function pullDeltas(Request $request): JsonResponse
    {
        $watermark = $request->input('since_watermark', 0);
        $sinceDate = date('Y-m-d H:i:s', $watermark / 1000);

        $products = Product::where('updated_at', '>=', $sinceDate)->get();
        $batches = ProductBatch::where('updated_at', '>=', $sinceDate)->get();
        $parties = Party::where('updated_at', '>=', $sinceDate)->get();

        return response()->json([
            'watermark' => (int) (microtime(true) * 1000),
            'products' => $products,
            'batches' => $batches,
            'parties' => $parties,
        ]);
    }
}
