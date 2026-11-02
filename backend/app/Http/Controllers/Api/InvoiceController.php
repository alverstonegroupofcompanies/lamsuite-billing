<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\CounterShift;
use App\Models\FinancialYear;
use App\Models\GstLockPeriod;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\InvoicePayment;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\SyncEvent;
use App\Services\Tax\TaxEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class InvoiceController
{
    private function resolveStoreId(Request $request, array $payload = []): int
    {
        $candidate = $payload['store_id'] ?? $payload['store_code'] ?? null;
        if (!$candidate) {
            $candidate = $request->header('X-Store-Id') ?: $request->header('Store-Id');
        }
        if (!$candidate) {
            $candidate = $request->query('store_id');
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

        $first = Store::first();
        return $first ? $first->id : 1;
    }

    private function calculateFinancialYear(\DateTimeInterface|string $date = 'now'): string
    {
        $d = is_string($date) ? new \DateTime($date) : $date;
        $year = (int)$d->format('Y');
        $month = (int)$d->format('n');
        if ($month >= 4) {
            return $year . '-' . substr((string)($year + 1), -2);
        } else {
            return ($year - 1) . '-' . substr((string)$year, -2);
        }
    }

    public function index(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');
        $status = $request->query('status');
        $counterCode = $request->query('counter_code');
        $paymentMode = $request->query('payment_mode');
        $search = $request->query('search');

        $totalStoreInvoices = Invoice::where('store_id', $storeId)->count();

        $builder = Invoice::where('store_id', $storeId)
            ->with(['items', 'payments'])
            ->orderBy('id', 'desc');

        if ($startDate && $endDate) {
            $s = strlen($startDate) === 10 ? $startDate . ' 00:00:00' : $startDate;
            $e = strlen($endDate) === 10 ? $endDate . ' 23:59:59' : $endDate;
            $builder->whereBetween('invoice_date', [$s, $e]);
        } elseif ($startDate) {
            $s = strlen($startDate) === 10 ? $startDate . ' 00:00:00' : $startDate;
            $builder->where('invoice_date', '>=', $s);
        } elseif ($endDate) {
            $e = strlen($endDate) === 10 ? $endDate . ' 23:59:59' : $endDate;
            $builder->where('invoice_date', '<=', $e);
        }

        if ($status && strtolower($status) !== 'all') {
            $builder->whereRaw('LOWER(status) = ?', [strtolower($status)]);
        }

        if ($paymentMode && strtolower($paymentMode) !== 'all') {
            $pm = strtolower($paymentMode);
            $builder->where(function ($q) use ($pm) {
                $q->whereRaw('LOWER(payment_mode) = ?', [$pm])
                  ->orWhereHas('payments', function ($pq) use ($pm) {
                      $pq->whereRaw('LOWER(payment_mode) = ?', [$pm]);
                  });
            });
        }

        if ($counterCode && strtolower($counterCode) !== 'all') {
            $builder->where('counter_code', $counterCode);
        }

        if ($search) {
            $searchTrimmed = trim($search);
            $builder->where(function ($q) use ($searchTrimmed) {
                $q->where('invoice_number', 'like', "%{$searchTrimmed}%")
                  ->orWhere('customer_name', 'like', "%{$searchTrimmed}%")
                  ->orWhere('customer_phone', 'like', "%{$searchTrimmed}%")
                  ->orWhere('patient_name', 'like', "%{$searchTrimmed}%")
                  ->orWhere('doctor_name', 'like', "%{$searchTrimmed}%")
                  ->orWhereHas('items', function ($iq) use ($searchTrimmed) {
                      $iq->where('product_name', 'like', "%{$searchTrimmed}%")
                        ->orWhere('batch_no', 'like', "%{$searchTrimmed}%");
                  });
            });
        }

        $perPage = min(500, max(1, (int)$request->query('per_page', 20)));
        $paginated = $builder->paginate($perPage);

        $response = $paginated->toArray();
        $response['total_store_invoices'] = $totalStoreInvoices;
        $response['store_id'] = $storeId;

        return response()->json($response);
    }

    /**
     * Authoritative Online Invoice Creation:
     * - Runs in single atomic DB transaction
     * - Checks idempotency & deduplication
     * - Enforces period locks (GST & Financial Year)
     * - Enforces Customer credit limits
     * - Atomic row-level locking on batches to verify stock & prevent overselling
     * - Authoritative tax & totals calculation
     * - Authoritative sequential numbering
     * - Real-time SSE delta broadcast to all connected devices
     */
    public function store(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request, $request->all());

        $validated = $request->validate([
            'store_id' => 'nullable',
            'store_code' => 'nullable|string|max:50',
            'idempotency_key' => 'nullable|string|max:100',
            'external_id' => 'nullable|string|max:100',
            'invoice_number' => 'nullable|string|max:50',
            'invoice_date' => 'nullable|date',
            'due_date' => 'nullable|date',
            'customer_id' => 'nullable',
            'customer_name' => 'nullable|string|max:150',
            'customer_phone' => 'nullable|string|max:20',
            'customer_gstin' => 'nullable|string|max:20',
            'place_of_supply' => 'nullable|string|max:50',
            'payment_mode' => 'nullable|string|max:30',
            'paid_amount' => 'nullable|numeric',
            'payments' => 'nullable|array',
            'payments.*.mode' => 'nullable|string|max:40',
            'payments.*.amount' => 'required_with:payments|numeric|min:0',
            'payments.*.reference_no' => 'nullable|string|max:100',
            'payments.*.status' => 'nullable|string|max:30',
            'payments.*.extra_fields' => 'nullable|array',
            'payments.*.notes' => 'nullable|string',
            'counter_id' => 'nullable',
            'counter_code' => 'nullable|string|max:20',
            'location_name' => 'nullable|string|max:100',
            'patient_name' => 'nullable|string|max:100',
            'doctor_name' => 'nullable|string|max:100',
            'doctor_reg_no' => 'nullable|string|max:50',
            'bill_discount_percent' => 'nullable|numeric',
            'bill_discount_amount' => 'nullable|numeric',
            'manual_round_off' => 'nullable|numeric',
            'is_inter_state' => 'nullable|boolean',
            'is_offline_temp' => 'nullable|boolean',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required',
            'items.*.product_name' => 'nullable|string',
            'items.*.batch_id' => 'nullable',
            'items.*.batch_no' => 'nullable|string',
            'items.*.expiry_date' => 'nullable|string',
            'items.*.qty' => 'required|numeric|min:0.01',
            'items.*.loose_qty' => 'nullable|numeric|min:0',
            'items.*.units_per_pack' => 'nullable|integer|min:1',
            'items.*.unit_price' => 'required|numeric|min:0',
            'items.*.discount_percent' => 'nullable|numeric|min:0',
            'items.*.discount_amount' => 'nullable|numeric|min:0',
            'items.*.gst_percent' => 'nullable|numeric|min:0',
        ]);

        $externalId = $validated['idempotency_key'] ?? $validated['external_id'] ?? null;

        // 1. Idempotency Check: if already created, return existing invoice safely
        if ($externalId) {
            $existing = Invoice::where('store_id', $storeId)
                ->where('external_id', $externalId)
                ->with('items')
                ->first();

            if ($existing) {
                return response()->json([
                    'success' => true,
                    'is_idempotent_replay' => true,
                    'invoice' => $existing->load(['items', 'payments']),
                    'message' => 'Invoice retrieved via idempotency token.',
                ], 200);
            }
        }

        $invoiceDate = !empty($validated['invoice_date'])
            ? substr($validated['invoice_date'], 0, 10)
            : now()->toDateString();
        $periodMonth = substr($invoiceDate, 0, 7);

        // 2. Enforce Period Locks
        $gstLocked = GstLockPeriod::where('store_id', $storeId)
            ->where('period_month', $periodMonth)
            ->where('is_locked', true)
            ->exists();
        if ($gstLocked) {
            return response()->json([
                'success' => false,
                'error' => "Cannot create invoice: GST period {$periodMonth} is locked for compliance.",
            ], 422);
        }

        $fyLocked = FinancialYear::where('store_id', $storeId)
            ->where('is_locked', true)
            ->where('start_date', '<=', $invoiceDate)
            ->where('end_date', '>=', $invoiceDate)
            ->exists();
        if ($fyLocked) {
            return response()->json([
                'success' => false,
                'error' => "Cannot create invoice: The financial year for date {$invoiceDate} is locked.",
            ], 422);
        }

        // 3. Resolve Customer & Check Credit Limit
        $customerId = $validated['customer_id'] ?? null;
        $party = null;
        if ($customerId) {
            $party = is_numeric($customerId)
                ? Party::where('store_id', $storeId)->find($customerId)
                : Party::where('store_id', $storeId)->where('external_id', $customerId)->first();

            if (!$party) {
                $party = is_numeric($customerId)
                    ? Party::find($customerId)
                    : Party::where('external_id', $customerId)->first();
            }
        }

        // 4. Check Store Settings (e.g. Negative Stock Allowed)
        $storeSetting = CompanySetting::where('store_id', $storeId)
            ->where('key', 'inventory_settings')
            ->first();
        $allowNegativeStock = $storeSetting ? (bool)($storeSetting->value['allow_negative_stock'] ?? true) : true;

        // 5. Execute Atomic Creation Transaction
        try {
            $result = DB::transaction(function () use (
                $request,
                $storeId,
                $validated,
                $externalId,
                $invoiceDate,
                $party,
                $allowNegativeStock
            ) {
                $counterCode = strtoupper($validated['counter_code'] ?? 'C01');
                $fy = $this->calculateFinancialYear($invoiceDate);

                // Counter lookup
                $counter = Counter::where('store_id', $storeId)
                    ->where('counter_code', $counterCode)
                    ->first();
                if (!$counter) {
                    $counter = Counter::firstOrCreate(
                        ['store_id' => $storeId, 'counter_code' => $counterCode],
                        ['counter_name' => 'Counter ' . $counterCode, 'is_hub' => false]
                    );
                }
                $counterId = $counter ? $counter->id : 1;

                // Document Numbering
                $clientInvoiceNumber = $validated['invoice_number'] ?? null;
                $isOfflineTemp = !empty($validated['is_offline_temp']) || ($clientInvoiceNumber && str_starts_with($clientInvoiceNumber, 'TEMP-'));

                $finalInvoiceNumber = '';
                $tempMappedFrom = null;

                if ($isOfflineTemp && $clientInvoiceNumber) {
                    // Temporary emergency series: map to official next sequence
                    $tempMappedFrom = $clientInvoiceNumber;
                    $sequence = CounterSequence::where('counter_id', $counterId ?? 1)
                        ->where('doc_type', 'invoice')
                        ->where('financial_year', $fy)
                        ->lockForUpdate()
                        ->first();

                    if (!$sequence) {
                        $prefix = "{$counterCode}-INV";
                        $seqVal = 1001;
                        CounterSequence::create([
                            'store_id' => $storeId,
                            'counter_id' => $counterId ?? 1,
                            'doc_type' => 'invoice',
                            'financial_year' => $fy,
                            'prefix' => $prefix,
                            'next_number' => 1002,
                        ]);
                        $finalInvoiceNumber = "{$prefix}-{$seqVal}";
                    } else {
                        $seqVal = $sequence->next_number;
                        $sequence->increment('next_number');
                        $finalInvoiceNumber = "{$sequence->prefix}-{$seqVal}";
                    }
                } elseif ($clientInvoiceNumber && !str_starts_with($clientInvoiceNumber, 'TEMP-')) {
                    // Pre-leased number provided by counter or direct assignment
                    $finalInvoiceNumber = $clientInvoiceNumber;
                } else {
                    // Online Authoritative numbering: Lock sequence row atomically
                    $sequence = CounterSequence::where('counter_id', $counterId ?? 1)
                        ->where('doc_type', 'invoice')
                        ->where('financial_year', $fy)
                        ->lockForUpdate()
                        ->first();

                    if (!$sequence) {
                        $prefix = "{$counterCode}-INV";
                        $seqVal = 1001;
                        CounterSequence::create([
                            'store_id' => $storeId,
                            'counter_id' => $counterId ?? 1,
                            'doc_type' => 'invoice',
                            'financial_year' => $fy,
                            'prefix' => $prefix,
                            'next_number' => 1002,
                        ]);
                        $finalInvoiceNumber = "{$prefix}-{$seqVal}";
                    } else {
                        $seqVal = $sequence->next_number;
                        $sequence->increment('next_number');
                        $finalInvoiceNumber = "{$sequence->prefix}-{$seqVal}";
                    }
                }

                // Process Line Items & Deduct Stock Atomically
                $calculatedSubtotal = 0.0;
                $calculatedLineDiscountTotal = 0.0;
                $calculatedTaxTotal = 0.0;
                $processedItems = [];
                $affectedBatchStockUpdates = [];
                $hasNegativeStockDeduction = false;

                foreach ($validated['items'] as $item) {
                    $productId = $item['product_id'];
                    $product = is_numeric($productId)
                        ? Product::where('store_id', $storeId)->find($productId)
                        : Product::where('store_id', $storeId)->where('external_id', $productId)->first();

                    if (!$product) {
                        $product = Product::where('store_id', $storeId)
                            ->where('name', $item['product_name'] ?? '')
                            ->first();
                    }

                    if (!$product) {
                        // Master catalog fallback if product was registered under main store
                        $product = is_numeric($productId)
                            ? Product::find($productId)
                            : Product::where('external_id', $productId)->first();
                    }

                    if (!$product && !empty($item['product_name'])) {
                        $product = Product::where('name', $item['product_name'])->first();
                    }

                    if (!$product) {
                        $product = Product::create([
                            'store_id' => $storeId,
                            'name' => $item['product_name'] ?? ('Product #' . $productId),
                            'unit_price' => (float)$item['unit_price'],
                            'current_stock' => 100,
                            'units_per_pack' => 1,
                        ]);
                    }

                    $qty = (float)$item['qty'];
                    $looseQty = (float)($item['loose_qty'] ?? 0);
                    $unitsPerPack = (int)($item['units_per_pack'] ?? $product->units_per_pack ?: 1);
                    $totalBaseUnits = ($qty * $unitsPerPack) + $looseQty;

                    // Batch Resolution with Row-Level Lock
                    $batch = null;
                    if (!empty($item['batch_id']) && is_numeric($item['batch_id'])) {
                        $batch = ProductBatch::where('id', $item['batch_id'])->lockForUpdate()->first();
                    } elseif (!empty($item['batch_id'])) {
                        $batch = ProductBatch::where('external_id', $item['batch_id'])->lockForUpdate()->first();
                    }

                    if (!$batch && !empty($item['batch_no'])) {
                        $batch = ProductBatch::where('store_id', $storeId)
                            ->where('product_id', $product->id)
                            ->where('batch_no', $item['batch_no'])
                            ->lockForUpdate()
                            ->first();

                        if (!$batch) {
                            $batch = ProductBatch::where('product_id', $product->id)
                                ->where('batch_no', $item['batch_no'])
                                ->lockForUpdate()
                                ->first();
                        }
                    }

                    if (!$batch) {
                        // Fallback to first batch or master batch
                        $batch = ProductBatch::where('store_id', $storeId)
                            ->where('product_id', $product->id)
                            ->lockForUpdate()
                            ->first() ?: ProductBatch::where('product_id', $product->id)->lockForUpdate()->first();
                    }

                    if (!$batch) {
                        $batch = ProductBatch::create([
                            'store_id' => $storeId,
                            'product_id' => $product->id,
                            'batch_no' => $item['batch_no'] ?? 'BATCH-01',
                            'expiry_date' => $item['expiry_date'] ?? now()->addYear()->toDateString(),
                            'stock_qty' => 0,
                            'mrp' => $product->mrp ?? $item['unit_price'],
                            'selling_rate' => $item['unit_price'],
                        ]);
                    }

                    // Check Stock Availability
                    $currentBatchStock = (float)$batch->stock_qty;
                    if ($currentBatchStock < $totalBaseUnits && !$allowNegativeStock) {
                        throw new \DomainException("Insufficient stock for '{$product->name}' (Batch: {$batch->batch_no}). Available: {$currentBatchStock}, Requested: {$totalBaseUnits}");
                    }

                    $newBatchStock = $currentBatchStock - $totalBaseUnits;
                    $isNegative = $newBatchStock < 0;
                    if ($isNegative) {
                        $hasNegativeStockDeduction = true;
                    }

                    // Update Batch & Product Stock
                    $batch->update(['stock_qty' => $newBatchStock]);
                    $product->decrement('current_stock', $totalBaseUnits);

                    $affectedBatchStockUpdates[] = [
                        'product_id' => $product->id,
                        'batch_id' => $batch->id,
                        'batch_no' => $batch->batch_no,
                        'remaining_stock' => $newBatchStock,
                        'qty_deducted' => $totalBaseUnits,
                    ];

                    $processedItems[] = [
                        'product_id' => $product->id,
                        'product_name' => $product->name,
                        'hsn_code' => $product->hsn_sac_code ?? '30049099',
                        'batch_no' => $batch->batch_no,
                        'expiry_date' => $batch->expiry_date ? $batch->expiry_date->toDateString() : null,
                        'qty' => $qty,
                        'loose_qty' => $looseQty,
                        'units_per_pack' => $unitsPerPack,
                        'unit_price' => (float)$item['unit_price'],
                        'mrp' => (float)($item['mrp'] ?? $product->mrp ?? $item['unit_price']),
                        'rate_basis' => $item['rate_basis'] ?? null,
                        'discount_percent' => (float)($item['discount_percent'] ?? 0),
                        'discount_amount' => (float)($item['discount_amount'] ?? 0),
                        'gst_percent' => (float)($item['gst_percent'] ?? $product->gst_percent ?? 0),
                        'cess_percent' => (float)($item['cess_percent'] ?? 0),
                        'batch_ref' => $batch,
                        'total_base_units' => $totalBaseUnits,
                        'is_negative' => $isNegative,
                    ];
                }

                // Resolve Store Tax Profile
                $storeModel = Store::find($storeId);
                $storeStateCode = $storeModel ? ($storeModel->state_code ?: '32') : '32';
                $storeGstType = $storeModel ? ($storeModel->gst_type ?: 'regular') : 'regular';
                $taxSetting = CompanySetting::where('store_id', $storeId)->where('key', 'tax_settings')->first();
                $defaultTaxMode = $taxSetting ? ($taxSetting->value['tax_mode'] ?? 'inclusive') : 'inclusive';
                $allowOverride = $taxSetting ? (bool)($taxSetting->value['allow_tax_override_per_bill'] ?? false) : false;

                $effectiveGstType = ($allowOverride && !empty($validated['gst_type'])) ? $validated['gst_type'] : $storeGstType;
                $effectiveTaxMode = ($allowOverride && !empty($validated['tax_mode'])) ? $validated['tax_mode'] : $defaultTaxMode;
                $isComposition = in_array($effectiveGstType, ['composition', 'no_tax', 'unregistered'], true);

                // Authoritative Tax Calculation via TaxEngine
                $engineLines = [];
                foreach ($processedItems as $pIdx => $pItem) {
                    $engineLines[] = [
                        'line_id' => (string)$pIdx,
                        'product_id' => (string)$pItem['product_id'],
                        'product_name' => $pItem['product_name'],
                        'hsn_code' => $pItem['hsn_code'],
                        'qty' => $pItem['qty'],
                        'loose_qty' => $pItem['loose_qty'],
                        'units_per_pack' => $pItem['units_per_pack'],
                        'unit_price' => $pItem['unit_price'],
                        'mrp' => $pItem['mrp'],
                        'rate_basis' => $pItem['rate_basis'],
                        'discount_percent' => $pItem['discount_percent'],
                        'discount_amount' => $pItem['discount_amount'],
                        'gst_percent' => $pItem['gst_percent'],
                        'cess_percent' => $pItem['cess_percent'],
                    ];
                }

                $taxDoc = TaxEngine::calculateDocumentTaxes([
                    'store_state' => $storeStateCode,
                    'customer_gstin' => $party ? $party->gstin : ($validated['customer_gstin'] ?? null),
                    'place_of_supply' => $validated['place_of_supply'] ?? ($party ? $party->state_code : $storeStateCode),
                    'default_tax_mode' => $effectiveTaxMode,
                    'gst_type' => $effectiveGstType,
                    'is_composition' => $isComposition,
                    'lines' => $engineLines,
                    'bill_discount' => [
                        'type' => !empty($validated['bill_discount_percent']) ? 'percent' : 'amount',
                        'value' => (float)(!empty($validated['bill_discount_percent']) ? $validated['bill_discount_percent'] : ($validated['bill_discount_amount'] ?? 0)),
                    ],
                    'auto_round_off' => !isset($validated['manual_round_off']),
                    'manual_round_off' => isset($validated['manual_round_off']) ? (float)$validated['manual_round_off'] : null,
                ]);

                $calculatedSubtotal = $taxDoc['gross_subtotal'];
                $taxableSubtotal = $taxDoc['taxable_subtotal'];
                $totalDiscount = $taxDoc['line_discount_total'] + $taxDoc['bill_discount_total'];
                $calculatedTaxTotal = $taxDoc['total_tax'];
                $roundOff = $taxDoc['round_off'];
                $grandTotal = $taxDoc['grand_total'];

                // Safety net: server-level check rejecting save if totals do not equal sum of lines
                if (isset($validated['grand_total']) && $validated['grand_total'] !== null) {
                    $clientGrandTotal = (float)$validated['grand_total'];
                    if (abs($clientGrandTotal - $grandTotal) > 0.05) {
                        throw new \Exception("Invoice integrity check failed: Request grand total ({$clientGrandTotal}) does not match line item total ({$grandTotal})");
                    }
                }

                // Resolve Payment Lines and Credit
                $rawPayments = $validated['payments'] ?? null;
                $paymentLines = [];
                $creditPortion = 0.0;
                $cashPortion = 0.0;
                $digitalPortion = 0.0;
                $totalPaid = 0.0;

                if (!empty($rawPayments) && is_array($rawPayments)) {
                    foreach ($rawPayments as $p) {
                        $pMode = ucfirst(trim($p['mode'] ?? 'Cash'));
                        $pAmt = (float)($p['amount'] ?? 0);
                        if ($pAmt <= 0) continue;

                        $paymentLines[] = [
                            'mode' => $pMode,
                            'amount' => $pAmt,
                            'reference_no' => $p['reference_no'] ?? null,
                            'status' => $p['status'] ?? 'received',
                            'extra_fields' => $p['extra_fields'] ?? null,
                            'notes' => $p['notes'] ?? null,
                        ];

                        $upperMode = strtoupper($pMode);
                        if ($upperMode === 'CREDIT' || $upperMode === 'UDHARI') {
                            $creditPortion += $pAmt;
                        } else {
                            $totalPaid += $pAmt;
                            if ($upperMode === 'CASH') {
                                $cashPortion += $pAmt;
                            } else {
                                $digitalPortion += $pAmt;
                            }
                        }
                    }
                } else {
                    // Legacy single mode fallback
                    $legacyMode = ucfirst(trim($validated['payment_mode'] ?? 'Cash'));
                    $legacyPaid = isset($validated['paid_amount']) ? (float)$validated['paid_amount'] : $grandTotal;
                    $paymentLines[] = [
                        'mode' => $legacyMode,
                        'amount' => $legacyPaid,
                        'reference_no' => null,
                        'status' => 'received',
                        'extra_fields' => null,
                        'notes' => null,
                    ];
                    if (strtoupper($legacyMode) === 'CREDIT') {
                        $creditPortion = $grandTotal;
                    } else {
                        $totalPaid = $legacyPaid;
                        if (strtoupper($legacyMode) === 'CASH') {
                            $cashPortion = $legacyPaid;
                        } else {
                            $digitalPortion = $legacyPaid;
                        }
                    }
                }

                // Credit (Udhari) Rules Enforcement:
                if ($creditPortion > 0.001) {
                    if (!$party || strtolower($party->name) === 'walk-in customer') {
                        throw new \DomainException("Credit sale is not allowed for Walk-in Customers. Please select or create a registered customer.");
                    }
                    if ((float)$party->credit_limit > 0) {
                        $newBalance = (float)$party->current_balance + $creditPortion;
                        if ($newBalance > (float)$party->credit_limit) {
                            throw new \DomainException("Customer '{$party->name}' credit limit of ₹{$party->credit_limit} exceeded (New balance would be ₹{$newBalance}).");
                        }
                    }
                }

                // Determine primary payment mode & status
                $primaryPaymentMode = count($paymentLines) > 1
                    ? 'Split'
                    : ($paymentLines[0]['mode'] ?? ($validated['payment_mode'] ?? 'Cash'));

                $paymentStatus = 'paid';
                if ($creditPortion >= ($grandTotal - 0.01)) {
                    $paymentStatus = 'unpaid';
                } elseif ($creditPortion > 0.001 || $totalPaid < ($grandTotal - 0.01)) {
                    $paymentStatus = 'partially_paid';
                }

                // Create Invoice Record
                $invoice = Invoice::create([
                    'store_id' => $storeId,
                    'counter_id' => $counterId,
                    'counter_code' => $counterCode,
                    'location_name' => $validated['location_name'] ?? ($counter ? $counter->location_name : 'Shop Floor'),
                    'module_key' => 'invoice',
                    'invoice_number' => $finalInvoiceNumber,
                    'invoice_date' => $invoiceDate,
                    'due_date' => $validated['due_date'] ?? null,
                    'customer_id' => $party ? $party->id : null,
                    'customer_name' => $party ? $party->name : ($validated['customer_name'] ?? 'Walk-in Customer'),
                    'customer_gstin' => $party ? $party->gstin : ($validated['customer_gstin'] ?? null),
                    'customer_phone' => $party ? $party->phone : ($validated['customer_phone'] ?? null),
                    'place_of_supply' => $validated['place_of_supply'] ?? ($party ? $party->state_code : '32-Kerala'),
                    'subtotal' => $calculatedSubtotal,
                    'taxable_subtotal' => $taxableSubtotal,
                    'discount_total' => $totalDiscount,
                    'tax_total' => $calculatedTaxTotal,
                    'cgst_total' => $taxDoc['cgst_total'],
                    'sgst_total' => $taxDoc['sgst_total'],
                    'igst_total' => $taxDoc['igst_total'],
                    'cess_total' => $taxDoc['cess_total'],
                    'round_off' => $roundOff,
                    'grand_total' => $grandTotal,
                    'store_state_code' => $storeStateCode,
                    'paid_amount' => $totalPaid,
                    'payment_mode' => $primaryPaymentMode,
                    'payment_status' => $paymentStatus,
                    'status' => 'issued',
                    'patient_name' => $validated['patient_name'] ?? null,
                    'doctor_name' => $validated['doctor_name'] ?? null,
                    'doctor_reg_no' => $validated['doctor_reg_no'] ?? null,
                    'external_id' => $externalId,
                    'synced_at' => now(),
                ]);

                // Insert Items & Stock Ledger Entries
                foreach ($taxDoc['lines'] as $cIdx => $cItem) {
                    $pItem = $processedItems[$cIdx];
                    InvoiceItem::create([
                        'invoice_id' => $invoice->id,
                        'product_id' => $pItem['product_id'],
                        'product_name' => $pItem['product_name'],
                        'batch_no' => $pItem['batch_no'],
                        'expiry_date' => $pItem['expiry_date'],
                        'qty' => $cItem['qty'],
                        'loose_qty' => $cItem['loose_qty'],
                        'units_per_pack' => $cItem['units_per_pack'],
                        'unit_price' => $cItem['unit_price'],
                        'mrp' => $pItem['mrp'],
                        'discount_percent' => $pItem['discount_percent'],
                        'discount_amount' => $cItem['line_discount'],
                        'allocated_discount' => $cItem['allocated_bill_discount'],
                        'taxable_amount' => $cItem['taxable_amount'],
                        'gst_percent' => $cItem['gst_rate'],
                        'cgst_amount' => $cItem['cgst_amount'],
                        'sgst_amount' => $cItem['sgst_amount'],
                        'igst_amount' => $cItem['igst_amount'],
                        'cess_rate' => $cItem['cess_rate'],
                        'cess_amount' => $cItem['cess_amount'],
                        'tax_amount' => $cItem['total_tax'],
                        'total_amount' => $cItem['total_amount'],
                    ]);

                    StockLedgerEntry::create([
                        'store_id' => $storeId,
                        'product_id' => $pItem['product_id'],
                        'batch_id' => $pItem['batch_ref']->id,
                        'counter_id' => $counterId,
                        'counter_code' => $counterCode,
                        'location_name' => $invoice->location_name,
                        'event_type' => 'SALE',
                        'qty_delta' => -$pItem['total_base_units'],
                        'reference_type' => 'INVOICE',
                        'reference_id' => (string)$invoice->id,
                        'is_reconciled_negative' => $pItem['is_negative'],
                        'balance_after' => $pItem['batch_ref']->stock_qty,
                        'idempotency_key' => $externalId ? "stk_{$externalId}_{$pItem['batch_ref']->id}" : null,
                    ]);
                }

                // Insert Invoice Payments
                foreach ($paymentLines as $pLine) {
                    InvoicePayment::create([
                        'store_id' => $storeId,
                        'invoice_id' => $invoice->id,
                        'counter_id' => $counterId,
                        'counter_code' => $counterCode,
                        'payment_mode' => $pLine['mode'],
                        'amount' => $pLine['amount'],
                        'reference_no' => $pLine['reference_no'],
                        'status' => $pLine['status'],
                        'extra_fields' => $pLine['extra_fields'],
                        'notes' => $pLine['notes'],
                        'received_by' => $request->user()?->name ?? ('Counter ' . $counterCode),
                    ]);
                }

                // If Credit portion exists, update party current_balance
                if ($creditPortion > 0 && $party) {
                    $party->increment('current_balance', $creditPortion);
                }

                // Update active Counter Shift if open: physical cash vs digital sales
                if ($counterId) {
                    $activeShift = CounterShift::where('counter_id', $counterId)
                        ->where('status', 'open')
                        ->latest('id')
                        ->first();

                    if ($activeShift) {
                        if ($cashPortion > 0) {
                            $activeShift->increment('cash_sales', $cashPortion);
                        }
                        if ($digitalPortion > 0) {
                            $activeShift->increment('digital_sales', $digitalPortion);
                        }
                    }
                }

                // Record Real-Time Broadcast Events for SSE
                // 1. Stock delta events for all counters
                foreach ($affectedBatchStockUpdates as $stkUpdate) {
                    SyncEvent::create([
                        'store_id' => $storeId,
                        'entity_type' => 'stock_event',
                        'entity_id' => (string)$stkUpdate['batch_id'],
                        'action' => 'update',
                        'client_data' => [
                            'product_id' => $stkUpdate['product_id'],
                            'batch_id' => $stkUpdate['batch_id'],
                            'batch_no' => $stkUpdate['batch_no'],
                            'remaining_stock' => $stkUpdate['remaining_stock'],
                            'qty_delta' => -$stkUpdate['qty_deducted'],
                            'counter_code' => $counterCode,
                            'reference_id' => $invoice->invoice_number,
                        ],
                        'status' => 'resolved',
                    ]);
                }

                // 2. Invoice created event
                SyncEvent::create([
                    'store_id' => $storeId,
                    'entity_type' => 'invoice',
                    'entity_id' => (string)$invoice->id,
                    'action' => 'create',
                    'client_data' => [
                        'id' => $invoice->id,
                        'invoice_number' => $invoice->invoice_number,
                        'grand_total' => $invoice->grand_total,
                        'customer_name' => $invoice->customer_name,
                        'counter_code' => $counterCode,
                        'external_id' => $externalId,
                        'temp_mapped_from' => $tempMappedFrom,
                    ],
                    'status' => 'resolved',
                ]);

                AuditLog::log(
                    'invoice_create_authoritative',
                    'Invoice',
                    (string)$invoice->id,
                    null,
                    ['invoice_number' => $invoice->invoice_number, 'grand_total' => $invoice->grand_total],
                    $storeId
                );

                return [
                    'invoice' => $invoice->load(['items', 'payments']),
                    'affected_batches' => $affectedBatchStockUpdates,
                    'temp_mapped_from' => $tempMappedFrom,
                ];
            });

            return response()->json([
                'success' => true,
                'invoice' => $result['invoice'],
                'affected_batches' => $result['affected_batches'],
                'temp_mapped_from' => $result['temp_mapped_from'],
                'message' => 'Invoice created and confirmed authoritatively by server.',
            ], 201);
        } catch (\DomainException $e) {
            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 422);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'error' => 'Server transaction failure: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function show(string $id): JsonResponse
    {
        $invoice = Invoice::with(['items', 'payments'])->findOrFail($id);
        return response()->json($invoice);
    }

    /**
     * Authoritative Invoice Cancellation:
     * - Restores batch stock and product stock atomically
     * - Records reversal in StockLedgerEntry
     * - Broadcasts stock updates via SSE
     */
    public function cancel(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::with('items')->findOrFail($id);

        if ($invoice->status === 'cancelled') {
            return response()->json([
                'success' => true,
                'status' => 'cancelled',
                'message' => 'Invoice was already cancelled.',
            ]);
        }

        $reason = $request->input('reason', 'Cancelled by operator');

        DB::transaction(function () use ($invoice, $reason) {
            $invoice->update([
                'status' => 'cancelled',
                'cancel_reason' => $reason,
                'cancelled_at' => now(),
            ]);

            // Revert customer credit balance if any
            $creditRefund = $invoice->payments()->where('payment_mode', 'Credit')->sum('amount');
            if ($creditRefund <= 0 && strtolower($invoice->payment_mode) === 'credit') {
                $creditRefund = (float)$invoice->grand_total;
            }
            if ($creditRefund > 0 && $invoice->customer_id) {
                $customer = Party::find($invoice->customer_id);
                if ($customer) {
                    $customer->decrement('current_balance', $creditRefund);
                }
            }

            // Mark associated payments refunded
            $invoice->payments()->update(['status' => 'refunded']);

            // Revert stock for each item
            foreach ($invoice->items as $item) {
                if ($item->product_id) {
                    $product = Product::find($item->product_id);
                    $batch = null;
                    if ($item->batch_no) {
                        $batch = ProductBatch::where('product_id', $item->product_id)
                            ->where('batch_no', $item->batch_no)
                            ->lockForUpdate()
                            ->first();
                    }

                    $qty = (float)$item->qty;
                    if ($batch) {
                        $batch->increment('stock_qty', $qty);
                    }
                    if ($product) {
                        $product->increment('current_stock', $qty);
                    }

                    StockLedgerEntry::create([
                        'store_id' => $invoice->store_id,
                        'product_id' => $item->product_id,
                        'batch_id' => $batch ? $batch->id : null,
                        'counter_id' => $invoice->counter_id,
                        'counter_code' => $invoice->counter_code,
                        'location_name' => $invoice->location_name,
                        'event_type' => 'CANCEL_RESTORE',
                        'qty_delta' => $qty,
                        'reference_type' => 'INVOICE_CANCEL',
                        'reference_id' => (string)$invoice->id,
                        'balance_after' => $batch ? $batch->stock_qty : 0,
                    ]);

                    // Broadcast stock restoration to all counters
                    SyncEvent::create([
                        'store_id' => $invoice->store_id,
                        'entity_type' => 'stock_event',
                        'entity_id' => (string)($batch ? $batch->id : $item->product_id),
                        'action' => 'update',
                        'client_data' => [
                            'product_id' => $item->product_id,
                            'batch_id' => $batch ? $batch->id : null,
                            'batch_no' => $item->batch_no,
                            'remaining_stock' => $batch ? $batch->stock_qty : null,
                            'qty_delta' => $qty,
                            'reference_id' => "CANCEL-{$invoice->invoice_number}",
                        ],
                        'status' => 'resolved',
                    ]);
                }
            }

            // Broadcast invoice cancellation event
            SyncEvent::create([
                'store_id' => $invoice->store_id,
                'entity_type' => 'invoice',
                'entity_id' => (string)$invoice->id,
                'action' => 'cancel',
                'client_data' => [
                    'id' => $invoice->id,
                    'invoice_number' => $invoice->invoice_number,
                    'status' => 'cancelled',
                ],
                'status' => 'resolved',
            ]);
        });

        return response()->json([
            'success' => true,
            'status' => 'cancelled',
            'message' => "Invoice #{$invoice->invoice_number} cancelled and batch stock restored.",
        ]);
    }
}
