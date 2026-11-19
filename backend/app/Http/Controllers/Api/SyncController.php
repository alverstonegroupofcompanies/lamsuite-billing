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
use App\Models\InvoicePayment;
use App\Models\MasterLookup;
use App\Models\SyncEvent;
use App\Models\Store;
use App\Models\AuditLog;
use App\Services\Payments\GiftCardService;
use App\Services\StockAdjustmentService;
use Illuminate\Validation\ValidationException;

class SyncController
{
    public function __construct(
        private StockAdjustmentService $stockAdjustments,
        private \App\Services\Stock\InterStoreTransferService $transfers
    ) {
    }

    /**
     * Resolve store_id from request headers, payload, or first store fallback.
     */
    private function resolveStoreId(Request $request, $itemData = []): int
    {
        // A paired device may only write to the store its token was issued for.
        $deviceStoreId = $request->attributes->get('device_store_id');
        if (!empty($deviceStoreId)) {
            return (int) $deviceStoreId;
        }

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
                if ($store) {
                    $this->assertUserMayWriteStore($request, $store->id);
                    return $store->id;
                }
            }
            $store = Store::where('code', $candidate)
                ->orWhere('id', $candidate)
                ->orWhere('name', $candidate)
                ->first();
            if ($store) {
                $this->assertUserMayWriteStore($request, $store->id);
                return $store->id;
            }
        }

        $firstStore = Store::first();
        return $firstStore ? $firstStore->id : 1;
    }

    /**
     * A user token may only sync into stores it belongs to (device tokens are
     * already pinned by their device_store_id attribute upstream).
     */
    private function assertUserMayWriteStore(Request $request, int $storeId): void
    {
        $user = $request->user();
        if ($user && !$user->canAccessStore($storeId)) {
            abort(403, 'You are not allowed to sync into this store.');
        }
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
                    case 'purchase_order':
                        $this->upsertSinglePurchaseOrder($request, $payload);
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
                    case 'expense':
                        $this->upsertSingleExpense($request, $payload);
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

        // Find existing invoice either by external_id OR (store_id + invoice_number) to prevent duplicates.
        // R5: never reach into another store's documents.
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
        } elseif (!empty($inv['invoice_number'])) {
            $invoice = Invoice::where('store_id', $storeId)
                ->where('invoice_number', $inv['invoice_number'])
                ->first();
        }

        // A status-only payload (an offline cancellation, a note update) carries neither lines
        // nor money. Running it through the document path would re-derive the totals and store
        // zeros against a bill that already has payments, so patch the described columns only
        // and let the shared cancellation service reverse the bill properly.
        if ($invoice && !$this->isInvoiceDocumentPayload($inv)) {
            return $this->patchInvoiceFromSync($request, $invoice, $inv);
        }

        // Resolve customer_id if party exists (scoped to this store)
        $customerId = $inv['customer_id'] ?? null;
        $matchedParty = null;
        if ($customerId) {
            $matchedParty = is_numeric($customerId)
                ? Party::where('store_id', $storeId)->where('id', (int) $customerId)->first()
                : Party::where('store_id', $storeId)->where('external_id', $customerId)->first();
            if ($matchedParty) {
                $customerId = $matchedParty->id;
            }
        }
        if (!$matchedParty && !empty($inv['customer_phone'])) {
            $matchedParty = Party::where('store_id', $storeId)->where('phone', $inv['customer_phone'])->first();
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

        $igstTotal = (float)($inv['igst_total'] ?? 0);
        $cessTotal = (float)($inv['cess_total'] ?? 0);
        $bookedFromHeader = $grandTotal;

        // A synced bill's lines are what the counter screen charged and what the GST returns are
        // built from, so when they travel with the payload the document is re-priced here instead
        // of trusting a header a revision can leave stale (or re-based into the wrong tax mode).
        $engineDoc = $this->recalculateInvoiceFromLines($inv, $storeId, $matchedParty);
        $syncNote = null;
        $engineLines = null;

        if ($engineDoc !== null) {
            // One paisa per line of legitimate CGST/SGST split drift, plus the usual paisa margin.
            $tolerance = 0.05 + 0.01 * count($engineDoc['lines']);

            $payloadLineSum = 0.0;
            foreach ($inv['items'] as $item) {
                $payloadLineSum += (float) ($item['total_amount'] ?? 0);
            }

            $headerAgrees = abs($engineDoc['grand_total'] - $grandTotal) <= $tolerance;
            $linesAgree = abs($engineDoc['grand_total'] - round($payloadLineSum, 2)) <= $tolerance;

            if ($headerAgrees || $linesAgree) {
                $grandTotal = $engineDoc['grand_total'];
                $taxableSubtotal = $engineDoc['taxable_subtotal'];
                $taxTotal = $engineDoc['total_tax'];
                $cgstTotal = $engineDoc['cgst_total'];
                $sgstTotal = $engineDoc['sgst_total'];
                $igstTotal = $engineDoc['igst_total'];
                $cessTotal = $engineDoc['cess_total'];
                $roundOff = $engineDoc['round_off'];
                $engineLines = $engineDoc['lines'];

                if (!$headerAgrees) {
                    $syncNote = sprintf(
                        'Header Rs %.2f contradicted its own lines (Rs %.2f); booked from the lines.',
                        $bookedFromHeader,
                        $grandTotal
                    );
                }
            } else {
                $syncNote = sprintf(
                    'Lines re-price to Rs %.2f but the till booked Rs %.2f; collected money left untouched.',
                    $engineDoc['grand_total'],
                    $grandTotal
                );
            }
        }

        // Money the counter actually took outranks what a revision claims. A payload that ships
        // no tender lines cannot prove it collected anything, so keep the stored tenders and let
        // paid_amount follow them.
        $payloadHasTenders = $this->payloadTenderLines($inv) !== [];
        $paidAmount = (float) ($inv['paid_amount'] ?? $grandTotal);
        if ($invoice && !$payloadHasTenders) {
            $collected = $invoice->payments()
                ->whereNotIn('status', ['refunded', 'cancelled', 'bounced'])
                ->get()
                ->reject(fn ($payment) => in_array(
                    strtoupper(trim((string) $payment->payment_mode)),
                    ['CREDIT', 'UDHARI'],
                    true
                ))
                ->sum('amount');
            if ($invoice->payments()->exists()) {
                $paidAmount = round((float) $collected, 2);
            }
        }

        // The till keeps its own counter identifiers (device-scoped strings), so resolve the
        // server counter row from the code and never blank out what an earlier sync stored.
        $counterId = null;
        if (!empty($inv['counter_id']) && is_numeric($inv['counter_id'])) {
            $counterId = (int) $inv['counter_id'];
        } elseif (!empty($inv['counter_code'])) {
            $counterId = \App\Models\Counter::where('store_id', $storeId)
                ->where('counter_code', $inv['counter_code'])
                ->value('id');
        }
        if (!$counterId) {
            $counterId = $invoice?->counter_id;
        }

        $invoiceData = [
            'store_id' => $storeId,
            'counter_id' => $counterId,
            'counter_code' => $inv['counter_code'] ?? ($invoice?->counter_code),
            'location_name' => $inv['location_name'] ?? ($invoice?->location_name),
            // A payload that has no module_key but does carry its own return number is a credit
            // note pushed by an older till; storing it as a plain bill books a refund as a sale.
            'module_key' => $inv['module_key'] ?? ($this->syncedDocumentStockDirection($inv) > 0 ? 'credit_note' : 'invoice'),
            'invoice_number' => $inv['invoice_number'] ?? ('INV-' . time()),
            'invoice_date' => $invoiceDate,
            'due_date' => !empty($inv['due_date']) ? substr($inv['due_date'], 0, 10) : null,
            'customer_id' => $customerId,
            'customer_name' => $inv['customer_name'] ?? 'Walk-in Customer',
            'customer_phone' => $inv['customer_phone'] ?? ($matchedParty ? $matchedParty->phone : null),
            'customer_gstin' => $inv['customer_gstin'] ?? null,
            'place_of_supply' => $inv['place_of_supply'] ?? null,
            'subtotal' => $engineDoc ? $engineDoc['gross_subtotal'] : ($inv['subtotal'] ?? $taxableSubtotal),
            'taxable_subtotal' => $taxableSubtotal,
            'discount_total' => $inv['discount_total'] ?? 0,
            'tax_total' => $taxTotal,
            'cgst_total' => $cgstTotal,
            'sgst_total' => $sgstTotal,
            'igst_total' => $igstTotal,
            'cess_total' => $cessTotal,
            'store_state_code' => $inv['store_state_code'] ?? '32',
            'original_invoice_id' => $inv['original_invoice_id'] ?? null,
            'original_invoice_number' => $inv['original_invoice_number'] ?? null,
            'round_off' => $roundOff,
            'grand_total' => $grandTotal,
            'paid_amount' => $paidAmount,
            'payment_mode' => $inv['payment_mode'] ?? 'Cash',
            'status' => $inv['status'] ?? 'issued',
            'cancel_reason' => $inv['cancel_reason'] ?? null,
            'patient_name' => $inv['patient_name'] ?? null,
            'doctor_name' => $inv['doctor_name'] ?? null,
            'doctor_reg_no' => $inv['doctor_reg_no'] ?? null,
            'synced_at' => now(),
        ];

        // Remembered before the header is rewritten: a revise that changes the payable has to
        // replace the stored tenders, while a plain re-sync of the same bill must stay a no-op.
        $previousGrandTotal = $invoice ? (float) $invoice->grand_total : null;

        // The line rows stored here are the units this document already took out of stock, so
        // they are captured before the revision replaces them.
        $previousItems = $invoice ? InvoiceItem::where('invoice_id', $invoice->id)->get() : collect();

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
        if (!empty($inv['items']) && is_array($inv['items'])) {            // Delete previous synced items to maintain idempotent consistency
            InvoiceItem::where('invoice_id', $invoice->id)->delete();

            foreach ($inv['items'] as $idx => $item) {
                $productId = $item['product_id'] ?? null;
                if ($productId && !is_numeric($productId)) {
                    $prod = Product::where('store_id', $storeId)
                        ->where(function ($q) use ($productId, $item) {
                            $q->where('external_id', $productId)
                              ->orWhere('name', $item['product_name'] ?? '');
                        })
                        ->first();
                    $productId = $prod ? $prod->id : null;
                } elseif ($productId) {
                    $prod = Product::where('store_id', $storeId)->where('id', (int) $productId)->first();
                    $productId = $prod ? $prod->id : null;
                }

                // When the document was re-priced from its lines, the line figures that produced
                // the header are stored, so header and lines can never disagree on the server.
                $calc = $engineLines[$idx] ?? null;

                InvoiceItem::create([
                    'invoice_id' => $invoice->id,
                    'product_id' => $productId,
                    'product_name' => $item['product_name'] ?? 'Item',
                    'batch_no' => $item['batch_no'] ?? null,
                    'expiry_date' => !empty($item['expiry_date']) ? substr($item['expiry_date'], 0, 10) : null,
                    'qty' => $item['qty'] ?? 1,
                    'loose_qty' => $item['loose_qty'] ?? 0,
                    'free_qty' => $item['free_qty'] ?? 0,
                    'free_loose_qty' => $item['free_loose_qty'] ?? 0,
                    'units_per_pack' => $item['units_per_pack'] ?? 1,
                    'unit_price' => $item['unit_price'] ?? ($item['rate'] ?? 0),
                    'mrp' => $item['mrp'] ?? null,
                    'stock_action' => $item['stock_action'] ?? null,
                    'discount_percent' => $item['discount_percent'] ?? 0,
                    'discount_amount' => $item['discount_amount'] ?? 0,
                    'allocated_discount' => $calc ? $calc['allocated_bill_discount'] : ($item['allocated_discount'] ?? 0),
                    'taxable_amount' => $calc ? $calc['taxable_amount'] : ($item['taxable_amount'] ?? 0),
                    'gst_percent' => $calc ? $calc['gst_rate'] : ($item['gst_percent'] ?? 0),
                    'cgst_amount' => $calc ? $calc['cgst_amount'] : ($item['cgst_amount'] ?? 0),
                    'sgst_amount' => $calc ? $calc['sgst_amount'] : ($item['sgst_amount'] ?? 0),
                    'igst_amount' => $calc ? $calc['igst_amount'] : ($item['igst_amount'] ?? 0),
                    'cess_rate' => $calc ? $calc['cess_rate'] : ($item['cess_rate'] ?? 0),
                    'cess_amount' => $calc ? $calc['cess_amount'] : ($item['cess_amount'] ?? 0),
                    'tax_amount' => $calc ? $calc['total_tax'] : ($item['tax_amount'] ?? ($item['total_tax'] ?? 0)),
                    'total_amount' => $calc ? $calc['total_amount'] : ($item['total_amount'] ?? ($item['grand_total'] ?? 0)),
                ]);
            }
        }

        // Ingest tender lines so offline references reconcile and gift cards redeem. Only a
        // rupee-meaningful change in the payable counts as a revision, so paisa-level split
        // drift between the till and this engine can never revoke a collected tender.
        $this->syncInvoicePayments(
            $invoice,
            $inv,
            $matchedParty,
            $previousGrandTotal !== null && abs($previousGrandTotal - $grandTotal) > 0.05
        );

        // A synced document also changes what is on the shelf. A bill created while the line was
        // down has to leave the same stock behind as the same bill billed online, and a credit
        // note has to bring it back; the units already stored against this document are given
        // first, so re-sending the same bill nets to nothing.
        $direction = $this->syncedDocumentStockDirection($inv);
        if ($direction !== null && !empty($inv['items']) && is_array($inv['items'])) {
            $this->applyRevisedLineStock(
                $invoice,
                $previousItems,
                InvoiceItem::where('invoice_id', $invoice->id)->get(),
                $direction
            );
        }

        $eventDetails = [
            'invoice_number' => $invoice->invoice_number,
            'grand_total' => $invoice->grand_total,
            'customer_name' => $invoice->customer_name,
            'external_id' => $externalId,
        ];
        if ($syncNote !== null) {
            $eventDetails['recalculation'] = $syncNote;
        }

        // Record in sync_events for Admin Sync Center visibility
        $this->recordSyncEvent($request, 'invoice', (string)$invoice->id, 'create', $eventDetails);

        return $invoice;
    }

    /**
     * Move the stock a synced document changed. The lines being replaced are given back to the
     * batches that gave them out and the revised lines are taken out, netted per batch before
     * anything is written, so a bill synced twice with the same lines moves nothing and leaves no
     * ledger noise.
     *
     * $direction is the side the document's own lines sit on: a bill takes units off the shelf
     * (-1) and a credit note puts them back (+1), so the same netting serves both.
     */
    private function applyRevisedLineStock(Invoice $invoice, $before, $after, float $direction = -1.0): void
    {
        $moves = [];

        $inwardEvent = $direction > 0 ? 'SALES_RETURN' : 'INVOICE_EDIT_REVERSAL';
        $outwardEvent = $direction > 0 ? 'SALES_RETURN_REVERSAL' : 'SALE';

        $tally = function ($items, float $sign) use (&$moves, $invoice, $direction): void {
            foreach ($items as $item) {
                if (!$item->product_id) {
                    continue;
                }
                if ($direction > 0 && !$item->restocksShelf()) {
                    continue;
                }

                $unitsPerPack = max(1, (float) ($item->units_per_pack ?: 1));
                $units = ((float) $item->qty + (float) $item->free_qty) * $unitsPerPack
                    + (float) $item->loose_qty + (float) $item->free_loose_qty;
                if (abs($units) < 0.0001) {
                    continue;
                }

                $batch = $item->batch_no
                    ? ProductBatch::where('store_id', $invoice->store_id)
                        ->where('product_id', $item->product_id)
                        ->where('batch_no', $item->batch_no)
                        ->lockForUpdate()
                        ->first()
                    : null;

                $key = $item->product_id . '|' . ($batch ? $batch->id : (string) $item->batch_no);
                if (!isset($moves[$key])) {
                    $moves[$key] = ['product_id' => (int) $item->product_id, 'batch' => $batch, 'qty' => 0.0];
                }
                $moves[$key]['qty'] += $sign * $units;
            }
        };

        DB::transaction(function () use ($tally, $before, $after, $invoice, &$moves, $direction, $inwardEvent, $outwardEvent) {
            $tally($before, -$direction);
            $tally($after, $direction);

            foreach ($moves as $move) {
                $qty = round($move['qty'], 4);
                if (abs($qty) < 0.0001) {
                    continue;
                }

                $batch = $move['batch'];
                if ($batch) {
                    $batch->increment('stock_qty', $qty);
                }
                $product = Product::find($move['product_id']);
                if ($product) {
                    $product->increment('current_stock', $qty);
                }

                \App\Models\StockLedgerEntry::create([
                    'store_id' => $invoice->store_id,
                    'product_id' => $move['product_id'],
                    'batch_id' => $batch ? $batch->id : null,
                    'counter_id' => $invoice->counter_id,
                    'counter_code' => $invoice->counter_code,
                    'location_name' => $invoice->location_name,
                    'event_type' => $qty > 0 ? $inwardEvent : $outwardEvent,
                    'qty_delta' => $qty,
                    'reference_type' => 'INVOICE',
                    'reference_id' => (string) $invoice->id,
                    'balance_after' => $batch ? (float) $batch->stock_qty : 0,
                    'staff_user_id' => $invoice->user_id,
                ]);

                SyncEvent::create([
                    'store_id' => $invoice->store_id,
                    'entity_type' => 'stock_event',
                    'entity_id' => (string) ($batch ? $batch->id : $move['product_id']),
                    'action' => 'update',
                    'client_data' => [
                        'product_id' => $move['product_id'],
                        'batch_id' => $batch ? $batch->id : null,
                        'batch_no' => $batch ? $batch->batch_no : null,
                        'remaining_stock' => $batch ? (float) $batch->stock_qty : null,
                        'qty_delta' => $qty,
                        'reference_id' => "REVISE-{$invoice->invoice_number}",
                    ],
                    'status' => 'resolved',
                ]);
            }
        });
    }

    /**
     * Which side of the shelf a synced document sits on: -1 takes units out, +1 puts them back,
     * and null leaves stock alone. A bill and a credit note arrive through the same queue entry,
     * so the document has to say what it is — the till marks credit notes by module_key, and a
     * return queued before that field existed still carries its own return number and must not be
     * booked as a second sale. Anything the register has not identified is left untouched rather
     * than guessed at, because a wrong guess moves real stock.
     */
    private function syncedDocumentStockDirection(array $inv): ?float
    {
        $module = strtolower((string) ($inv['module_key'] ?? ''));

        if (in_array($module, ['credit_note', 'sales_return', 'debit_note'], true)) {
            return 1.0;
        }

        if (in_array($module, ['invoice', 'bill', 'sale', ''], true)) {
            return !empty($inv['return_number']) ? 1.0 : -1.0;
        }

        return null;
    }

    /**
     * Does this payload describe a whole bill (lines and/or money), or only a status change?
     */
    private function isInvoiceDocumentPayload(array $inv): bool
    {
        if (!empty($inv['items'])) {
            return true;
        }

        foreach (['grand_total', 'taxable_subtotal', 'subtotal', 'tax_total'] as $key) {
            if (isset($inv[$key]) && (float) $inv[$key] != 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * Tender lines exactly as the till describes them, or an empty list when the payload carries
     * none. A revision without tender lines has not collected anything new, so it may not rewrite
     * money the counter already took.
     */
    private function payloadTenderLines(array $inv): array
    {
        $raw = $inv['payments'] ?? null;
        if (is_string($raw)) {
            $raw = json_decode($raw, true) ?: [];
        }
        if (!is_array($raw)) {
            return [];
        }

        $lines = [];
        foreach ($raw as $p) {
            if (is_array($p) && round((float) ($p['amount'] ?? 0), 2) > 0) {
                $lines[] = $p;
            }
        }

        return $lines;
    }

    /**
     * Re-price a synced bill from its own line records with the authoritative tax engine.
     * Returns null when the payload has no priceable lines, leaving the till's figures alone.
     */
    private function recalculateInvoiceFromLines(array $inv, int $storeId, ?Party $party): ?array
    {
        $items = $inv['items'] ?? null;
        if (!is_array($items) || $items === []) {
            return null;
        }

        $lines = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                return null; // index alignment with the engine output is required
            }

            $gstPercent = (float) ($item['gst_percent'] ?? 0);
            if ($gstPercent <= 0) {
                $gstPercent = $this->resolveLineGstRate($item, $storeId);
            }

            $lines[] = [
                'product_name' => $item['product_name'] ?? null,
                'hsn_code' => $item['hsn_code'] ?? null,
                'qty' => (float) ($item['qty'] ?? 0),
                'loose_qty' => (float) ($item['loose_qty'] ?? 0),
                'free_qty' => (float) ($item['free_qty'] ?? 0),
                'free_loose_qty' => (float) ($item['free_loose_qty'] ?? 0),
                'units_per_pack' => max(1, (float) ($item['units_per_pack'] ?? 1)),
                'unit_price' => (float) ($item['unit_price'] ?? ($item['rate'] ?? 0)),
                'mrp' => $item['mrp'] ?? null,
                'rate_basis' => $item['rate_basis'] ?? 'sel_rate',
                'discount_percent' => (float) ($item['discount_percent'] ?? 0),
                'discount_amount' => (float) ($item['discount_amount'] ?? 0),
                'gst_percent' => $gstPercent,
                'cess_percent' => (float) ($item['cess_percent'] ?? ($item['cess_rate'] ?? 0)),
            ];
        }

        $priceable = false;
        foreach ($lines as $line) {
            if ($line['unit_price'] > 0 && $line['qty'] + $line['loose_qty'] > 0) {
                $priceable = true;
                break;
            }
        }
        if (!$priceable) {
            return null;
        }

        $store = Store::find($storeId);
        $policy = app(\App\Services\Tax\StoreTaxPolicy::class)->forStore($storeId);
        $canOverride = (bool) $policy['allow_override'];

        $taxMode = $canOverride
            && in_array($inv['tax_mode'] ?? null, \App\Services\Tax\StoreTaxPolicy::TAX_MODES, true)
            ? $inv['tax_mode'] : $policy['tax_mode'];
        $gstType = $canOverride
            && in_array($inv['gst_type'] ?? null, \App\Services\Tax\StoreTaxPolicy::GST_TYPES, true)
            ? $inv['gst_type'] : $policy['gst_type'];

        return \App\Services\Tax\TaxEngine::calculateDocumentTaxes([
            'store_state' => $store?->state_code ?: '32',
            'customer_gstin' => $inv['customer_gstin'] ?? ($party?->gstin),
            'place_of_supply' => $inv['place_of_supply'] ?? null,
            'default_tax_mode' => $taxMode,
            'gst_type' => $gstType,
            'is_composition' => in_array($gstType, ['composition', 'no_tax', 'unregistered'], true),
            'lines' => $lines,
            'bill_discount' => [
                'type' => !empty($inv['bill_discount_percent']) ? 'percent' : 'amount',
                'value' => (float) (!empty($inv['bill_discount_percent'])
                    ? $inv['bill_discount_percent']
                    : ($inv['bill_discount_amount'] ?? 0)),
            ],
            'auto_round_off' => !isset($inv['manual_round_off']),
            'manual_round_off' => isset($inv['manual_round_off']) ? (float) $inv['manual_round_off'] : null,
        ]);
    }

    /**
     * GST rate for a line whose payload left it out: the product master is the only source.
     */
    private function resolveLineGstRate(array $item, int $storeId): float
    {
        $productId = $item['product_id'] ?? null;

        $product = is_numeric($productId)
            ? Product::where('store_id', $storeId)->where('id', (int) $productId)->first()
            : ($productId
                ? Product::where('store_id', $storeId)->where(fn ($q) => $q->where('external_id', $productId)->orWhere('name', $item['product_name'] ?? ''))->first()
                : Product::where('store_id', $storeId)->where('name', $item['product_name'] ?? '')->first());

        return $product ? (float) $product->gst_percent : 0.0;
    }

    /**
     * Apply a status/metadata-only sync payload without touching booked money, lines or tenders.
     */
    private function patchInvoiceFromSync(Request $request, Invoice $invoice, array $inv): Invoice
    {
        $patchable = [
            'customer_name', 'customer_phone', 'customer_gstin', 'payment_mode', 'payment_status',
            'patient_name', 'doctor_name', 'doctor_reg_no', 'due_date', 'place_of_supply',
        ];

        $patch = [];
        foreach ($patchable as $key) {
            if (array_key_exists($key, $inv)) {
                $patch[$key] = $inv[$key];
            }
        }

        if (strcasecmp((string) ($inv['status'] ?? ''), 'cancelled') === 0 && $invoice->status !== 'cancelled') {
            app(\App\Services\Sales\InvoiceCancellationService::class)->cancel(
                $invoice,
                trim((string) ($inv['cancel_reason'] ?? '')) ?: 'Cancelled on offline counter',
                $request->user()?->id
            );
        } elseif (array_key_exists('status', $inv)) {
            $patch['status'] = $inv['status'];
            if (array_key_exists('cancel_reason', $inv)) {
                $patch['cancel_reason'] = $inv['cancel_reason'];
            }
        }

        if ($patch) {
            $invoice->update($patch);
        }

        $this->recordSyncEvent($request, 'invoice', (string) $invoice->id, 'update', [
            'invoice_number' => $invoice->invoice_number,
            'status' => $invoice->status,
            'grand_total' => $invoice->grand_total,
            'external_id' => $invoice->external_id,
            'patched' => array_keys($patch),
        ]);

        return $invoice->fresh();
    }

    /**
     * Recreate invoice payment lines for offline-synced bills, redeem gift card
     * tenders, and carry the credit portion into the customer ledger.
     *
     * $isRevision is only true when a stored bill is re-posted with a materially different
     * payable; the old tenders are then reversed and replaced, but only if the payload actually
     * ships the tenders that replace them.
     */
    private function syncInvoicePayments(Invoice $invoice, array $inv, ?Party $matchedParty, bool $isRevision = false): void
    {
        $tenders = $this->payloadTenderLines($inv);

        if ($invoice->payments()->exists()) {
            // Reversing without a replacement would delete cash the counter really collected,
            // so a tender-less revision leaves the stored money exactly as it stands.
            if (!$isRevision || $tenders === []) {
                return;
            }
            $this->reverseStoredPayments($invoice, $matchedParty);
        }

        $lines = [];
        foreach ($tenders as $p) {
            if (!is_array($p)) continue;
            $amount = round((float) ($p['amount'] ?? 0), 2);
            if ($amount <= 0) continue;

            $extra = $p['extra_fields'] ?? null;
            if (is_string($extra)) {
                $extra = json_decode($extra, true) ?: null;
            }

            $lines[] = [
                'mode' => trim((string) ($p['mode'] ?? $p['payment_mode'] ?? 'Cash')) ?: 'Cash',
                'amount' => $amount,
                'reference_no' => $p['reference_no'] ?? ($p['reference'] ?? null),
                'status' => $p['status'] ?? 'received',
                'extra_fields' => is_array($extra) ? $extra : null,
                'notes' => $p['notes'] ?? null,
            ];
        }

        if ($lines === [] && round((float) ($inv['paid_amount'] ?? 0), 2) > 0) {
            $lines[] = [
                'mode' => trim((string) ($inv['payment_mode'] ?? 'Cash')) ?: 'Cash',
                'amount' => round((float) $inv['paid_amount'], 2),
                'reference_no' => null,
                'status' => 'received',
                'extra_fields' => null,
                'notes' => 'Derived from invoice paid amount',
            ];
        }

        if (empty($lines)) {
            return;
        }

        $creditPortion = 0.0;
        foreach ($lines as $line) {
            if (in_array(strtoupper($line['mode']), ['CREDIT', 'UDHARI'], true)) {
                $creditPortion += $line['amount'];
            }
        }

        if ($creditPortion > 0) {
            if (!$matchedParty || stripos($matchedParty->name, 'Walk-in') !== false) {
                throw new \InvalidArgumentException('Credit sale requires a registered customer account (Walk-in credit is not permitted).');
            }
        }

        DB::transaction(function () use ($invoice, $lines, $creditPortion, $matchedParty) {
            foreach ($lines as $line) {
                InvoicePayment::create([
                    'store_id' => $invoice->store_id,
                    'invoice_id' => $invoice->id,
                    'counter_code' => $invoice->counter_code,
                    'payment_mode' => $line['mode'],
                    'amount' => $line['amount'],
                    'reference_no' => $line['reference_no'],
                    'status' => $line['status'],
                    'extra_fields' => $line['extra_fields'],
                    'notes' => $line['notes'],
                    'received_by' => $invoice->counter_code ? 'Counter ' . $invoice->counter_code : null,
                ]);
            }

            $giftCardService = app(GiftCardService::class);
            foreach ($lines as $line) {
                if (!$this->isGiftCardMode($line['mode'])) continue;
                $code = $line['extra_fields']['gift_card_code'] ?? $line['reference_no'] ?? '';
                $giftCardService->redeem(
                    (int) $invoice->store_id,
                    (string) $code,
                    $line['amount'],
                    $invoice->id,
                    'invoice',
                    (string) $invoice->id
                );
            }

            if ($creditPortion > 0 && $matchedParty) {
                $matchedParty->increment('current_balance', $creditPortion);
            }
        });
    }

    /**
     * Undo the tenders a bill was originally paid with, before a revision replaces them:
     * gift card balances go back, credit portions leave the customer ledger again.
     */
    private function reverseStoredPayments(Invoice $invoice, ?Party $matchedParty): void
    {
        $previous = $invoice->payments()->get();
        $giftCardService = app(GiftCardService::class);

        DB::transaction(function () use ($previous, $giftCardService, $invoice, $matchedParty) {
            foreach ($previous as $payment) {
                $amount = (float) $payment->amount;
                if ($amount <= 0) {
                    continue;
                }

                if ($this->isGiftCardMode((string) $payment->payment_mode)) {
                    $extra = is_array($payment->extra_fields) ? $payment->extra_fields : [];
                    $code = (string) ($extra['gift_card_code'] ?? ($payment->reference_no ?? ''));
                    if ($code !== '') {
                        $giftCardService->refund($invoice->store_id, $code, $amount, $invoice->id, null);
                    }
                }

                if (in_array(strtoupper(trim((string) $payment->payment_mode)), ['CREDIT', 'UDHARI'], true) && $matchedParty) {
                    $matchedParty->decrement('current_balance', $amount);
                }

                // 'refunded' is the status every collector already excludes (day close and the
                // report queries), so a superseded tender drops out of cash totals with it.
                $payment->update([
                    'status' => 'refunded',
                    'notes' => trim(((string) $payment->notes) . ' | Superseded by revised bill'),
                ]);
            }
        });
    }

    private function isGiftCardMode(string $mode): bool
    {
        return in_array(strtoupper(trim($mode)), [
            'GIFT CARD', 'GIFT VOUCHER', 'GIFT_VOUCHER', 'GIFT_CARD', 'GIFTCARD', 'GIFT VOUCHERS',
        ], true);
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

        // R5: rows are keyed by (store_id, external_id) — a till can never touch
        // another store's row. A rejected push (e.g. per-store barcode clash)
        // becomes a sync-centre conflict instead of a hijack or a crash.
        try {
            $product = Product::updateOrCreate(
                ['store_id' => $storeId, 'external_id' => $externalId],
                [
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
        } catch (\Illuminate\Database\QueryException $e) {
            // Per-store barcode uniqueness or a trigger guard rejected the row.
            $this->recordSyncConflict($request, 'product', (string) $externalId, $p, 'Store-scope constraint rejected the push: ' . $e->getMessage());
            return null;
        }

        // If batch data is included
        if (!empty($p['batches']) && is_array($p['batches'])) {
            foreach ($p['batches'] as $b) {
                $batchExtId = $b['external_id'] ?? $b['id'] ?? null;
                try {
                    ProductBatch::updateOrCreate(
                        ['store_id' => $storeId, 'external_id' => $batchExtId],
                        [
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
                } catch (\Illuminate\Database\QueryException $e) {
                    $this->recordSyncConflict($request, 'product_batch', (string) $batchExtId, $b, 'Store-scope constraint rejected the batch push: ' . $e->getMessage());
                }
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
            ['store_id' => $storeId, 'external_id' => $externalId],
            [
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

        $rawDate = $pur['invoice_date'] ?? $pur['purchase_date'] ?? $pur['return_date'] ?? null;
        $invoiceDate = !empty($rawDate)
            ? (strlen($rawDate) === 10 ? $rawDate : substr($rawDate, 0, 10))
            : now()->toDateString();

        // A debit note is a purchase document that takes stock out instead of bringing it in, so it
        // shares this ingest path — but it must never match the inward bill it is returning against.
        $isReturn = $this->purchaseDocumentIsReturn($pur);

        // A till names a purchase bill by the supplier's own bill number and keeps its running
        // number beside it. Whichever the payload carries is the key this store's book is matched
        // on — matching globally, or on a number the till never sent, lets one store's inward
        // overwrite another's and turns every re-sync into a fresh duplicate.
        $invoiceNumber = $isReturn
            ? ($this->firstFilled($pur, ['return_number', 'invoice_number']) ?? ('PR-' . $storeId . '-' . time()))
            : ($this->firstFilled($pur, ['invoice_number', 'supplier_invoice_no', 'purchase_number']) ?? ('PUR-' . $storeId . '-' . time()));

        $status = $pur['status'] ?? ($isReturn ? 'completed' : 'received');

        // Returns keep their own row even when a number collides with an inward bill, because the
        // two documents move stock in opposite directions.
        $purchase = $isReturn
            ? Purchase::firstOrNew(['store_id' => $storeId, 'invoice_number' => $invoiceNumber, 'module_key' => 'purchase_return'])
            : Purchase::firstOrNew(['store_id' => $storeId, 'invoice_number' => $invoiceNumber]);
        $heldItems = $purchase->exists
            ? PurchaseItem::where('purchase_id', $purchase->id)->get()
            : collect();
        $wasCancelled = strtolower((string) $purchase->status) === 'cancelled';

        $purchase->fill([
            'store_id' => $storeId,
            'supplier_id' => $this->matchPurchaseSupplier($pur, $storeId),
            'supplier_name' => $pur['supplier_name'] ?? 'Supplier',
            'supplier_gstin' => $pur['supplier_gstin'] ?? null,
            'invoice_date' => $invoiceDate,
            'module_key' => $pur['module_key'] ?? ($isReturn ? 'purchase_return' : 'purchase'),
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
            'status' => $status,
            'cancel_reason' => $pur['cancel_reason'] ?? ($pur['cancellation_reason'] ?? null),
            'notes' => $isReturn
                ? $this->purchaseReturnNotes($pur)
                : (($pur['notes'] ?? null) !== null ? $pur['notes'] : $purchase->notes),
        ]);
        $purchase->save();

        $payloadItems = $isReturn
            ? $this->normalizeReturnLines($pur)
            : ((isset($pur['items']) && is_array($pur['items'])) ? $pur['items'] : []);

        if ($payloadItems) {
            PurchaseItem::where('purchase_id', $purchase->id)->delete();
            foreach ($payloadItems as $item) {
                $packQty = $this->firstFilledNumber($item, ['pack_qty', 'qty']) ?? 1;

                PurchaseItem::create([
                    'purchase_id' => $purchase->id,
                    'product_id' => $this->matchPurchaseProduct($item, $storeId),
                    'product_name' => $item['product_name'] ?? 'Item',
                    'batch_no' => ($item['batch_no'] ?? null) ?: null,
                    'expiry_date' => !empty($item['expiry_date']) ? substr($item['expiry_date'], 0, 10) : null,
                    'mfg_date' => !empty($item['mfg_date']) ? substr($item['mfg_date'], 0, 10) : null,
                    'hsn_code' => $item['hsn_code'] ?? null,
                    'selling_rate' => $item['selling_rate'] ?? null,
                    'pack_qty' => $packQty,
                    'loose_qty' => $item['loose_qty'] ?? 0,
                    'free_qty' => $item['free_qty'] ?? 0,
                    'free_loose_qty' => $item['free_loose_qty'] ?? 0,
                    'units_per_pack' => $item['units_per_pack'] ?? 1,
                    'qty' => $packQty,
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

        // A cancellation is pushed as a header with no lines, so the quantities the server already
        // holds are the ones that have to go back; an edit pushes the whole new set, so only the
        // difference moves. Re-sending a bill that is already cancelled nets to nothing.
        $cancelled = strtolower((string) $status) === 'cancelled';
        $afterItems = $cancelled
            ? ($wasCancelled ? $heldItems : collect())
            : ($payloadItems ? PurchaseItem::where('purchase_id', $purchase->id)->get() : $heldItems);

        $this->applyPurchaseLineStock($purchase, $heldItems, $afterItems, $isReturn ? -1.0 : 1.0);

        $this->recordSyncEvent($request, 'purchase', (string)$purchase->id, 'create', [
            'invoice_number' => $purchase->invoice_number,
            'supplier' => $purchase->supplier_name,
            'grand_total' => $purchase->grand_total,
            'status' => $purchase->status,
        ]);

        return $purchase;
    }

    /**
     * A debit note arrives shaped like the inward bill it returns against: its own return number,
     * a reference to the original and a `lines` array of returned units. Anything matching that is
     * ingested as a return so it can never be merged into the bill it partially undoes.
     */
    private function purchaseDocumentIsReturn(array $pur): bool
    {
        $module = strtolower(trim((string) ($pur['module_key'] ?? '')));
        if (in_array($module, ['purchase_return', 'debit_note'], true)) {
            return true;
        }

        return isset($pur['original_purchase_number'])
            || isset($pur['original_purchase_id'])
            || (isset($pur['return_number']) && isset($pur['lines']));
    }

    /**
     * Return lines count what the supplier gets back, in units, priced at the unit rate paid for
     * them. Purchase lines are counted in packs, so returns are normalised onto the same footing
     * before storage: one unit per pack keeps the base-unit arithmetic identical for both.
     */
    private function normalizeReturnLines(array $ret): array
    {
        $source = (isset($ret['lines']) && is_array($ret['lines'])) ? $ret['lines'] : [];

        $normalised = [];
        foreach ($source as $line) {
            if (!is_array($line)) {
                continue;
            }

            $units = $this->firstFilledNumber($line, ['return_qty', 'total_units', 'qty']) ?? 0;
            $rate = $this->firstFilledNumber($line, ['purchase_rate', 'unit_price', 'effective_unit_cost']) ?? 0;

            // The till's debit note line carries the CGST/SGST split but not a combined tax figure,
            // and a line with no tax_amount is useless to every GST report that reads it.
            $splits = (float) ($line['cgst_amount'] ?? 0) + (float) ($line['sgst_amount'] ?? 0)
                + (float) ($line['igst_amount'] ?? 0) + (float) ($line['cess_amount'] ?? 0);
            $tax = $splits > 0
                ? $splits
                : ($this->firstFilledNumber($line, ['tax_amount', 'total_tax']) ?? 0.0);

            $normalised[] = [
                'product_id' => $line['product_id'] ?? null,
                'product_name' => $line['product_name'] ?? 'Item',
                'batch_no' => $line['batch_no'] ?? null,
                'expiry_date' => $line['expiry_date'] ?? null,
                'hsn_code' => $line['hsn_code'] ?? null,
                'pack_qty' => $units,
                'units_per_pack' => 1,
                'purchase_rate' => $rate,
                'effective_unit_cost' => $rate,
                'taxable_amount' => $line['taxable_amount'] ?? round($units * $rate, 2),
                'gst_percent' => $line['gst_percent'] ?? 0,
                'cgst_amount' => $line['cgst_amount'] ?? 0,
                'sgst_amount' => $line['sgst_amount'] ?? 0,
                'igst_amount' => $line['igst_amount'] ?? 0,
                'cess_amount' => $line['cess_amount'] ?? 0,
                'tax_amount' => round($tax, 2),
                'total_amount' => $line['total_amount'] ?? 0,
            ];
        }

        return $normalised;
    }

    /**
     * Nothing on the purchases table names the inward bill a debit note belongs to, and a return
     * that cannot name its original is useless in a GST audit, so the link rides in the notes.
     */
    private function purchaseReturnNotes(array $ret): string
    {
        $notes = trim((string) ($ret['notes'] ?? ''));
        $original = $this->firstFilled($ret, ['original_purchase_number', 'supplier_invoice_no']);

        if ($original === null) {
            return $notes;
        }

        return $notes === '' ? "Return against {$original}" : "{$notes} (return against {$original})";
    }

    /**
     * The first key of this payload that carries a non-empty string.
     */
    private function firstFilled(array $data, array $keys): ?string
    {
        foreach ($keys as $key) {
            if (isset($data[$key]) && is_string($data[$key]) && trim($data[$key]) !== '') {
                return trim($data[$key]);
            }
            if (isset($data[$key]) && is_numeric($data[$key])) {
                return (string) $data[$key];
            }
        }

        return null;
    }

    /**
     * The first key of this payload that carries a usable quantity.
     */
    private function firstFilledNumber(array $data, array $keys): ?float
    {
        foreach ($keys as $key) {
            if (isset($data[$key]) && is_numeric($data[$key])) {
                return (float) $data[$key];
            }
        }

        return null;
    }

    /**
     * A purchase line arrives with the product the till was looking at, which the server knows by
     * its own id. Left unresolved the line stores no product at all, so the inward report cannot
     * group it and the batch it should have created has nothing to belong to.
     */
    private function matchPurchaseProduct(array $item, int $storeId): ?int
    {
        $productId = $item['product_id'] ?? null;

        if (is_numeric($productId)) {
            $local = Product::where('store_id', $storeId)->where('id', (int) $productId)->first();
            if ($local) {
                return $local->id;
            }
        } elseif ($productId) {
            $local = Product::where('store_id', $storeId)->where('external_id', $productId)->first();
            if ($local) {
                return $local->id;
            }
        }

        $name = $item['product_name'] ?? null;
        if (!$name) {
            return null;
        }

        return Product::where('store_id', $storeId)->where('name', $name)->value('id');
    }

    /**
     * Same for the supplier: a purchase without its party is a name on a page, not a ledger.
     */
    private function matchPurchaseSupplier(array $pur, int $storeId): ?int
    {
        $supplierId = $pur['supplier_id'] ?? null;

        if (is_numeric($supplierId)) {
            $local = Party::where('store_id', $storeId)->where('id', (int) $supplierId)->first();
            if ($local) {
                return $local->id;
            }
        } elseif ($supplierId) {
            $local = Party::where('store_id', $storeId)->where('external_id', $supplierId)->first();
            if ($local) {
                return $local->id;
            }
        }

        if (!empty($pur['supplier_gstin'])) {
            $byGstin = Party::where('store_id', $storeId)->where('gstin', $pur['supplier_gstin'])->first();
            if ($byGstin) {
                return $byGstin->id;
            }
        }

        if (!empty($pur['supplier_name'])) {
            return Party::where('store_id', $storeId)->where('name', $pur['supplier_name'])->value('id');
        }

        return null;
    }

    /**
     * Move the stock a purchase document changes. Inward is the only way stock arrives, so a synced
     * purchase that credits nothing leaves the server permanently short — every later sale then
     * reports a batch as negative even though the register counted correctly. A debit note is the
     * same arithmetic turned round ($direction = -1). The lines being replaced give their units
     * back and the lines being kept take theirs, netted per batch before anything is written, so
     * the same bill synced twice moves nothing and a cancel restores exactly what it had changed.
     */
    private function applyPurchaseLineStock(Purchase $purchase, $before, $after, float $direction = 1.0): void
    {
        $moves = [];

        $tally = function ($items, float $sign) use (&$moves, $purchase): void {
            foreach ($items as $item) {
                if (!$item->product_id) {
                    continue;
                }

                $unitsPerPack = max(1, (float) ($item->units_per_pack ?: 1));
                $units = ((float) $item->qty + (float) $item->free_qty) * $unitsPerPack
                    + (float) $item->loose_qty + (float) $item->free_loose_qty;
                if (abs($units) < 0.0001) {
                    continue;
                }

                $batch = $item->batch_no
                    ? ProductBatch::where('store_id', $purchase->store_id)
                        ->where('product_id', $item->product_id)
                        ->where('batch_no', $item->batch_no)
                        ->lockForUpdate()
                        ->first()
                    : null;

                $key = $item->product_id . '|' . ($batch ? $batch->id : (string) $item->batch_no);
                if (!isset($moves[$key])) {
                    $moves[$key] = ['product_id' => (int) $item->product_id, 'batch' => $batch, 'line' => $item, 'qty' => 0.0];
                }
                $moves[$key]['qty'] += $sign * $units;
            }
        };

        DB::transaction(function () use ($tally, $before, $after, $purchase, $direction, &$moves) {
            $tally($before, -$direction);
            $tally($after, $direction);

            foreach ($moves as $move) {
                $qty = round($move['qty'], 4);
                if (abs($qty) < 0.0001) {
                    continue;
                }

                $batch = $move['batch'];
                if (!$batch && $qty > 0) {
                    $line = $move['line'];
                    $batch = ProductBatch::create([
                        'store_id' => $purchase->store_id,
                        'product_id' => $move['product_id'],
                        'batch_no' => (string) ($line->batch_no ?: 'BAT-01'),
                        'mfg_date' => $line->mfg_date ? $line->mfg_date->format('Y-m-d') : null,
                        'expiry_date' => $line->expiry_date
                            ? $line->expiry_date->format('Y-m-d')
                            : now()->addYear()->toDateString(),
                        'stock_qty' => 0,
                        'mrp' => $line->mrp ?? 0,
                        'purchase_rate' => $line->purchase_rate ?? 0,
                        'selling_rate' => $line->selling_rate ?? 0,
                    ]);
                }

                if ($batch) {
                    $batch->increment('stock_qty', $qty);
                }
                $product = Product::find($move['product_id']);
                if ($product) {
                    $product->increment('current_stock', $qty);
                }

                $cancelled = strtolower((string) $purchase->status) === 'cancelled';
                $returning = $direction < 0;
                $prefix = $returning ? 'PURCHASE_RETURN' : 'PURCHASE';

                \App\Models\StockLedgerEntry::create([
                    'store_id' => $purchase->store_id,
                    'product_id' => $move['product_id'],
                    'batch_id' => $batch ? $batch->id : null,
                    'event_type' => $qty > 0
                        ? ($returning ? ($cancelled ? 'PURCHASE_RETURN_CANCEL' : 'PURCHASE_RETURN_EDIT_REVERSAL') : 'PURCHASE_RECEIPT')
                        : ($returning ? 'PURCHASE_RETURN' : ($cancelled ? 'PURCHASE_CANCEL' : 'PURCHASE_EDIT_REVERSAL')),
                    'qty_delta' => $qty,
                    'reference_type' => $prefix,
                    'reference_id' => (string) $purchase->id,
                    'balance_after' => $batch ? (float) $batch->stock_qty : 0,
                ]);

                SyncEvent::create([
                    'store_id' => $purchase->store_id,
                    'entity_type' => 'stock_event',
                    'entity_id' => (string) ($batch ? $batch->id : $move['product_id']),
                    'action' => 'update',
                    'client_data' => [
                        'product_id' => $move['product_id'],
                        'batch_id' => $batch ? $batch->id : null,
                        'batch_no' => $batch ? $batch->batch_no : null,
                        'remaining_stock' => $batch ? (float) $batch->stock_qty : null,
                        'qty_delta' => $qty,
                        'reference_id' => "{$prefix}-{$purchase->invoice_number}",
                    ],
                    'status' => 'resolved',
                ]);
            }
        });
    }

    /**
     * Upsert a purchase order / purchase requisition pushed from the desktop.
     * The desktop PO payload differs from a received purchase: it uses
     * po_number/po_date and ordered_qty instead of invoice_number/qty.
     */
    private function upsertSinglePurchaseOrder(Request $request, array $po): Purchase
    {
        $storeId = $this->resolveStoreId($request, $po);
        $poNumber = $po['po_number'] ?? $po['invoice_number'] ?? null;
        if (!$poNumber) {
            throw new \InvalidArgumentException('Purchase order is missing po_number');
        }

        $rawDate = $po['po_date'] ?? $po['invoice_date'] ?? null;
        $poDate = !empty($rawDate)
            ? (strlen($rawDate) === 10 ? $rawDate : substr($rawDate, 0, 10))
            : now()->toDateString();

        $moduleKey = in_array($po['module_key'] ?? 'po', ['pr', 'order', 'requisition'], true)
            ? 'order'
            : 'purchase_order';

        $supplierId = $po['supplier_id'] ?? null;
        if ($supplierId && !is_numeric($supplierId)) {
            $supplierId = Party::where('store_id', $storeId)->where('external_id', $supplierId)->value('id');
        }

        $total = (float) ($po['grand_total'] ?? $po['total_amount'] ?? 0);

        $purchase = Purchase::firstOrNew([
            'store_id' => $storeId,
            'invoice_number' => $poNumber,
        ]);

        $purchase->fill([
            'supplier_id' => $supplierId ?: null,
            'supplier_name' => $po['supplier_name'] ?? 'Supplier',
            'invoice_date' => $poDate,
            'expected_delivery_date' => !empty($po['expected_delivery_date']) ? substr($po['expected_delivery_date'], 0, 10) : null,
            'module_key' => $moduleKey,
            'subtotal' => $po['subtotal'] ?? $total,
            'tax_total' => $po['tax_total'] ?? 0,
            'grand_total' => $total,
            'paid_amount' => 0,
            'status' => $po['status'] ?? 'pending',
            'notes' => $po['notes'] ?? null,
        ]);
        $purchase->version = ($purchase->version ?? 0) + 1;
        $purchase->save();

        if (!empty($po['items']) && is_array($po['items'])) {
            PurchaseItem::where('purchase_id', $purchase->id)->delete();

            foreach ($po['items'] as $item) {
                $productId = $item['product_id'] ?? null;
                if ($productId && !is_numeric($productId)) {
                    $productId = Product::where('store_id', $storeId)
                        ->where(fn ($q) => $q->where('external_id', $productId)->orWhere('name', $item['product_name'] ?? ''))
                        ->value('id');
                } elseif ($productId) {
                    $productId = Product::where('store_id', $storeId)->where('id', (int) $productId)->value('id');
                }

                $qty = (float) ($item['ordered_qty'] ?? $item['qty'] ?? 1);
                $rate = (float) ($item['purchase_rate'] ?? $item['unit_price'] ?? 0);
                $gstPercent = (float) ($item['gst_percent'] ?? 0);
                $taxable = $item['taxable_amount'] ?? round($qty * $rate, 2);
                $tax = $item['tax_amount'] ?? round($taxable * $gstPercent / 100, 2);

                PurchaseItem::create([
                    'purchase_id' => $purchase->id,
                    'product_id' => $productId ?: null,
                    'product_name' => $item['product_name'] ?? 'Item',
                    'hsn_code' => $item['hsn_code'] ?? null,
                    'batch_no' => $item['batch_no'] ?? '',
                    'expiry_date' => !empty($item['expiry_date']) ? substr($item['expiry_date'], 0, 10) : null,
                    'qty' => $qty,
                    'received_qty' => $item['received_qty'] ?? 0,
                    'purchase_rate' => $rate,
                    'mrp' => $item['mrp'] ?? 0,
                    'gst_percent' => $gstPercent,
                    'taxable_amount' => $taxable,
                    'tax_amount' => $tax,
                    'total_amount' => $item['total_amount'] ?? round($taxable + $tax, 2),
                ]);
            }
        }

        $this->recordSyncEvent($request, 'purchase_order', (string) $purchase->id, 'create', [
            'po_number' => $purchase->invoice_number,
            'supplier' => $purchase->supplier_name,
            'grand_total' => $purchase->grand_total,
            'status' => $purchase->status,
        ]);

        return $purchase;
    }

    /**
     * A stock event names the product and batch the till was standing at, which may be the
     * server's own id, the id the till holds for it, or the printed batch number. Matching on
     * whichever row carries that value — with no bound to the store the event came from — lets one
     * store's adjustment move another store's shelf, so every lookup here is bounded by the store
     * that pushed it.
     */
    private function matchStockEventProduct(array $event, int $storeId): ?int
    {
        $ref = $event['product_id'] ?? null;
        if ($ref === null || $ref === '') {
            return null;
        }

        if (is_numeric($ref)) {
            return Product::where('store_id', $storeId)->where('id', (int) $ref)->value('id');
        }

        return Product::where('store_id', $storeId)->where('external_id', $ref)->value('id')
            ?? Product::where('store_id', $storeId)->where('id', $ref)->value('id');
    }

    private function matchStockEventBatch(array $event, int $storeId, ?int $productId): ?int
    {
        foreach (['batch_id', 'batch_no'] as $key) {
            $ref = $event[$key] ?? null;
            if ($ref === null || $ref === '') {
                continue;
            }

            if (is_numeric($ref)) {
                $id = ProductBatch::where('store_id', $storeId)->where('id', (int) $ref)->value('id');
            } else {
                $batch = ProductBatch::where('store_id', $storeId)->where('external_id', $ref)->first()
                    ?: ($productId
                        ? ProductBatch::where('store_id', $storeId)
                            ->where('product_id', $productId)
                            ->where('batch_no', $ref)
                            ->first()
                        : null);
                $id = $batch ? $batch->id : null;
            }

            if ($id) {
                return $id;
            }
        }

        return null;
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

        $productId = $this->matchStockEventProduct($event, $storeId);
        $batchId = $this->matchStockEventBatch($event, $storeId, $productId);

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

        // R4: the destination store must be named by the payload — never defaulted.
        $toStoreId = $transfer['destination_store_id'] ?? $transfer['to_store_id'] ?? null;
        if (empty($toStoreId) || !is_numeric($toStoreId) || (int) $toStoreId === (int) $storeId) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'destination_store_id' => 'A stock transfer needs a destination store different from the sending store.',
            ]);
        }

        $transferNumber = $transfer['transfer_no'] ?? $transfer['transfer_number'] ?? ('TRF-' . time());
        $existing = StockTransfer::where('transfer_number', $transferNumber)->first();
        $wasNew = $existing === null;
        $previousStatus = $existing?->status;

        $stkTransfer = StockTransfer::updateOrCreate(
            ['transfer_number' => $transferNumber],
            [
                'from_store_id' => $storeId,
                'to_store_id' => (int) $toStoreId,
                'status' => $transfer['status'] ?? 'dispatched',
                'notes' => $transfer['notes'] ?? null,
                'created_by' => $request->user()?->id ?? $existing?->created_by,
            ]
        );

        // A received/cancelled transfer is closed — a late re-push must not
        // rewrite its lines or re-apply stock effects.
        if (!in_array($stkTransfer->status, ['received', 'cancelled'], true)) {
            if (!empty($transfer['lines']) && is_array($transfer['lines'])) {
                StockTransferItem::where('stock_transfer_id', $stkTransfer->id)->delete();
                foreach ($transfer['lines'] as $line) {
                    $productId = $line['product_id'] ?? null;
                    if ($productId && !is_numeric($productId)) {
                        // R5: match the sending store's product only.
                        $p = Product::where('store_id', $storeId)->where('external_id', $productId)->first();
                        $productId = $p ? $p->id : null;
                    } elseif ($productId) {
                        $p = Product::where('store_id', $storeId)->where('id', (int) $productId)->first();
                        $productId = $p ? $p->id : null;
                    }
                    if ($productId) {
                        StockTransferItem::create([
                            'stock_transfer_id' => $stkTransfer->id,
                            'store_id' => $storeId,
                            'product_id' => $productId,
                            'batch_no' => $line['batch_no'] ?? 'BAT-01',
                            'qty' => $line['transfer_total_qty'] ?? ($line['qty'] ?? 1),
                        ]);
                    }
                }
            }

            if ($stkTransfer->status === 'dispatched' && ($wasNew || $previousStatus !== 'dispatched')) {
                $this->transfers->applyDispatchEffects($stkTransfer->refresh(), $request->user());
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
            $p = Party::where('store_id', $storeId)->where('external_id', $customerId)->first();
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
     * Idempotent expense ingestion from offline terminals (keyed by expense_number).
     */
    private function upsertSingleExpense(Request $request, array $expense): void
    {
        $storeId = $this->resolveStoreId($request, $expense);
        $head = trim((string) ($expense['expense_head'] ?? ''));
        $amount = round((float) ($expense['amount'] ?? 0), 2);

        if ($head === '') {
            throw new \InvalidArgumentException('expense_head is required.');
        }

        if ($amount <= 0) {
            throw new \InvalidArgumentException('Expense amount must be greater than zero.');
        }

        $attributes = [
            'expense_head' => $head,
            'amount' => $amount,
            'payment_mode' => $expense['payment_mode'] ?? 'Cash',
            'reference_no' => $expense['reference_no'] ?? null,
            'notes' => $expense['notes'] ?? null,
            'expense_date' => !empty($expense['expense_date'])
                ? substr((string) $expense['expense_date'], 0, 10)
                : now()->toDateString(),
        ];

        $expenseNumber = trim((string) ($expense['expense_number'] ?? ''));

        if ($expenseNumber !== '') {
            Expense::updateOrCreate(
                ['store_id' => $storeId, 'expense_number' => $expenseNumber],
                $attributes
            );
        } else {
            Expense::firstOrCreate(
                [
                    'store_id' => $storeId,
                    'expense_head' => $head,
                    'amount' => $amount,
                    'expense_date' => $attributes['expense_date'],
                    'reference_no' => $attributes['reference_no'],
                ],
                $attributes
            );
        }

        $this->recordSyncEvent($request, 'expense', $expense['id'] ?? uniqid(), 'create', $expense);
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
    /**
     * Route a rejected push into the sync centre instead of mutating another store's row.
     */
    private function recordSyncConflict(Request $request, string $entityType, string $entityId, array $clientData, string $reason): void
    {
        try {
            SyncEvent::create([
                'store_id' => $this->resolveStoreId($request, $clientData),
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'action' => 'update',
                'client_version' => 1,
                'server_version' => 1,
                'client_data' => $clientData,
                'server_data' => null,
                'status' => 'conflict',
                'conflict_reason' => $reason,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            report($e);
        }
    }

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

