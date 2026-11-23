<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\BusinessRuleException;
use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\FinancialYear;
use App\Models\GstLockPeriod;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\InvoicePayment;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Services\Sales\PharmacistGate;
use App\Services\Sales\SalespersonAttribution;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\SyncEvent;
use App\Services\Gst\PartyStateResolver;
use App\Support\RestrictedDrugResolver;
use App\Services\Alerts\OperationalAlertService;
use App\Services\Tax\MrpCeiling;
use App\Services\Tax\TaxEngine;
use App\Services\Compliance\ComplianceService;
use App\Services\Webhook\WebhookOutboxService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use App\Support\RequestTenant;

class InvoiceController
{
    /**
     * G1-SEC: the store comes from the authenticated counter or the person's
     * checked store scope (RequestTenant), never from the payload, a header the
     * middleware did not vouch for, or "the first store".
     */
    private function resolveStoreId(Request $request): int
    {
        return RequestTenant::requireStoreId($request);
    }

    /**
     * G1-SEC / SEC-05: the counter a bill belongs to. A counter's token names
     * itself; a person (owner/manager on a till route) must name a counter that
     * exists in their store. A payload can never invent or move to another one.
     */
    private function resolveBillingCounter(Request $request, int $storeId, ?string $counterCode): Counter
    {
        $tokenCounterId = RequestTenant::counterId($request);
        if ($tokenCounterId !== null) {
            $counter = Counter::where('store_id', $storeId)->find($tokenCounterId);
            if (!$counter) {
                throw ValidationException::withMessages(['counter' => 'This workstation is not on a counter of this store.']);
            }

            return $counter;
        }

        $code = strtoupper(trim((string) $counterCode));
        $counter = $code === '' ? null : Counter::where('store_id', $storeId)->where('counter_code', $code)->first();
        if (!$counter) {
            throw ValidationException::withMessages(['counter_code' => 'Name an existing counter of this store for this bill.']);
        }

        return $counter;
    }

    /** G1-SEC: an invoice is only ever found inside the caller's store. */
    private function findStoreInvoice(Request $request, string $id, array $with = []): Invoice
    {
        $storeId = $this->resolveStoreId($request);

        return Invoice::with($with)
            ->where('store_id', $storeId)
            ->where(function ($q) use ($id) {
                $q->where('id', $id)->orWhere('invoice_number', $id);
            })
            ->firstOrFail();
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
            ->with(['items', 'payments', 'customer'])
            ->orderBy('id', 'desc');

        // invoice_date is TEXT and the till has written both a bare 'YYYY-MM-DD' and a full
        // timestamp into it, so the window is matched on the date part. A string range against
        // '... 00:00:00' silently drops every bare-date bill, which made "Today" come back empty.
        $from = $startDate ? substr($startDate, 0, 10) : null;
        $to = $endDate ? substr($endDate, 0, 10) : null;
        if ($from) {
            $builder->whereDate('invoice_date', '>=', $from);
        }
        if ($to) {
            $builder->whereDate('invoice_date', '<=', $to);
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

        $compliance = app(ComplianceService::class);
        $paginated->getCollection()->transform(fn (Invoice $invoice) => $compliance->decorate($invoice));

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
        $storeId = $this->resolveStoreId($request);
        $store = Store::find($storeId);
        if ($store && !$store->is_active) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_DISABLED',
                'message' => 'Store is currently disabled by Admin. Billing and transactions are prohibited.',
            ], 403);
        }

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
            'payments.*.tendered_amount' => 'nullable|numeric|min:0',
            'payments.*.change_amount' => 'nullable|numeric|min:0',
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
            'tax_mode' => 'nullable|in:inclusive,exclusive',
            'gst_type' => 'nullable|in:regular,composition,no_tax,unregistered',
            'is_inter_state' => 'nullable|boolean',
            'is_offline_temp' => 'nullable|boolean',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required',
            'items.*.product_name' => 'nullable|string',
            'items.*.batch_id' => 'nullable',
            'items.*.batch_no' => 'nullable|string',
            'items.*.expiry_date' => 'nullable|string',
            // Loose-only sales legitimately carry qty = 0; the total base-unit
            // check inside the transaction is the real invariant.
            'items.*.qty' => 'required|numeric|min:0',
            'items.*.loose_qty' => 'nullable|numeric|min:0',
            'items.*.free_qty' => 'nullable|numeric|min:0',
            'items.*.free_loose_qty' => 'nullable|numeric|min:0',
            'items.*.units_per_pack' => 'nullable|integer|min:1',
            'items.*.unit_price' => 'required|numeric|min:0',
            'items.*.discount_percent' => 'nullable|numeric|min:0',
            'items.*.discount_amount' => 'nullable|numeric|min:0',
            'items.*.gst_percent' => 'nullable|numeric|min:0',
            // Which documented rate the line was billed on (sel_rate, mrp, ptr,
            // pts, loose_rate…). The server stores it so an offline review can
            // tell a PTR sale from a retyped price.
            'items.*.rate_basis' => 'nullable|string|max:20',
            // Accepted so the master catalog keeps whatever the till printed, but
            // never the ceiling a line is measured against — that is the MRP on file.
            'items.*.mrp' => 'nullable|numeric|min:0',
            // APR-003..010: the grant that settles what the profile deferred.
            'approval_token' => 'nullable|string|max:128',
            'approval_reason' => 'nullable|string|max:1000',
            // GAP-01 / SPR-010: the person the bill credits. Resolved against
            // the store and the counter rather than validated as a bare id.
            'salesperson_id' => 'nullable',
            'salesperson_name' => 'nullable|string|max:191',
            // GAP-02 / PHR-004: who vouched for a restricted line. The PIN is
            // judged by the pharmacist's own hash, not by a rule applied here.
            'pharmacist_id' => 'nullable',
            'pharmacist_pin' => 'nullable|string|max:64',
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

        // Auto-match or auto-create customer if customer details are provided
        if (!$party) {
            $cleanPhone = !empty($validated['customer_phone']) ? trim($validated['customer_phone']) : null;
            $cleanName = !empty($validated['customer_name']) ? trim($validated['customer_name']) : null;
            $isWalkIn = empty($cleanName) || in_array(strtolower($cleanName), ['walk-in', 'walk-in customer', 'walk in']);

            if (!empty($cleanPhone)) {
                $party = Party::where('type', 'customer')
                    ->where(function ($q) use ($storeId) {
                        $q->where('store_id', $storeId)->orWhereNull('store_id');
                    })
                    ->where('phone', $cleanPhone)
                    ->first();
            }

            if (!$party && !$isWalkIn) {
                $party = Party::where('type', 'customer')
                    ->where(function ($q) use ($storeId) {
                        $q->where('store_id', $storeId)->orWhereNull('store_id');
                    })
                    ->where('name', $cleanName)
                    ->first();
            }

            // MST-02: a phone number is a deliberate identity; a bare typed name
            // is not. Create a master only when the caller supplied a real phone.
            $phoneDigits = $cleanPhone ? strlen(preg_replace('/\D/', '', $cleanPhone)) : 0;
            if (!$party && $phoneDigits >= 10) {
                $partyGstin = !empty($validated['customer_gstin']) ? strtoupper(trim($validated['customer_gstin'])) : null;
                $party = Party::create([
                    'store_id' => $storeId,
                    'type' => 'customer',
                    'name' => !$isWalkIn ? $cleanName : ("Customer " . substr(preg_replace('/\D/', '', $cleanPhone), -4)),
                    'phone' => $cleanPhone,
                    'gstin' => $partyGstin,
                    'state_code' => app(PartyStateResolver::class)->resolve(
                        $validated['state_code'] ?? null,
                        $partyGstin,
                        Store::find($storeId)
                    ),
                    'credit_limit' => 0,
                    'opening_balance' => 0,
                    'current_balance' => 0,
                    'is_active' => true,
                    'version' => 1,
                    'external_id' => $customerId ?: ('cust_' . time() . '_' . substr(md5(uniqid()), 0, 6)),
                ]);
            }
        }

        // If party already found but phone is missing in party record, save customer_phone to party
        if ($party && empty($party->phone) && !empty($validated['customer_phone'])) {
            $party->phone = trim($validated['customer_phone']);
            $party->save();
        }

        // 4. Check Store Settings (e.g. Negative Stock Allowed)
        $storeSetting = CompanySetting::where('store_id', $storeId)
            ->where('key', 'inventory_settings')
            ->first();
        $allowNegativeStock = $storeSetting ? (bool)($storeSetting->value['allow_negative_stock'] ?? true) : true;

        // PRF-003: the counter's profile is a ceiling over the store's own
        // switch, so a till whose profile forbids selling beyond stock cannot
        // do it even in a store that allows negative stock.
        $profile = \App\Http\Middleware\AuthenticateCounterProfile::profile($request);
        $sellBeyondStock = $profile === null
            || app(\App\Services\Counter\CounterProfilePolicy::class)->sellBeyondStockAllowed($profile);
        $allowNegativeStock = $allowNegativeStock && $sellBeyondStock;

        $billingCounter = $this->resolveBillingCounter($request, $storeId, $validated['counter_code'] ?? null);

        // GAP-01 / SPR-002, 006: who sold this bill, answered exactly the way
        // an offline upload answers it.
        $salesperson = SalespersonAttribution::resolve(
            $storeId,
            $billingCounter->id,
            $validated['salesperson_id'] ?? null,
            $validated['salesperson_name'] ?? null
        );

        // PRF-003/Q9: the profile's threshold answers arrived with the request.
        // A grant is redeemed inside the transaction that writes the bill, so a
        // failed save leaves it usable and a saved bill cannot replay it.
        $requiredApprovals = (array) $request->attributes->get('counter_approvals_required', []);
        $approvalToken = $validated['approval_token'] ?? null;

        // GAP-02 / PHR-004: a line the owner's schedule list marks restricted is
        // written only over a registered pharmacist's own PIN. The till's prompt
        // is a courtesy; this answer is the rule, and it is the same one the
        // offline upload is measured with.
        $restrictedItems = RestrictedDrugResolver::forLines((int) $storeId, (array) ($validated['items'] ?? []));
        $pharmacist = PharmacistGate::require(
            (int) $storeId,
            (int) $billingCounter->id,
            $restrictedItems,
            $validated['pharmacist_id'] ?? null,
            $validated['pharmacist_pin'] ?? null
        );

        // 5. Execute Atomic Creation Transaction
        try {
            $result = DB::transaction(function () use (
                $request,
                $billingCounter,
                $storeId,
                $validated,
                $externalId,
                $invoiceDate,
                $party,
                $allowNegativeStock,
                $sellBeyondStock,
                $salesperson,
                $requiredApprovals,
                $approvalToken,
                $pharmacist,
                $restrictedItems
            ) {
                // G1-SEC / SEC-05: resolved from the token before the transaction.
                $counter = $billingCounter;
                $counterCode = $counter->counter_code;
                $counterId = $counter->id;
                $fy = $this->calculateFinancialYear($invoiceDate);

                // Document Numbering — the counter issues the number at save,
                // so the number the cashier saw and the number in the book are
                // one and the same. A temporary marker never becomes a book
                // number; a number on this counter's own series that it has not
                // already given out is kept as the number it was shown under.
                $clientInvoiceNumber = $validated['invoice_number'] ?? null;
                $tempMappedFrom = null;

                if (!empty($validated['is_offline_temp']) || ($clientInvoiceNumber && str_starts_with($clientInvoiceNumber, 'TEMP-'))) {
                    $tempMappedFrom = $clientInvoiceNumber;
                    $clientInvoiceNumber = null;
                }

                $numbering = app(\App\Services\CounterSequenceService::class)
                    ->numberLiveDocument($counter, 'invoice', $clientInvoiceNumber, $fy);

                $finalInvoiceNumber = $numbering['number'];

                // Process Line Items & Deduct Stock Atomically
                $calculatedSubtotal = 0.0;
                $calculatedLineDiscountTotal = 0.0;
                $calculatedTaxTotal = 0.0;
                $processedItems = [];
                $affectedBatchStockUpdates = [];
                $hasNegativeStockDeduction = false;
                // TAX-02: the ceiling is the store's to switch off; it applies unless it says otherwise.
                $mrpCappingEnforced = MrpCeiling::enforcedFor(Store::find($storeId));

                foreach ($validated['items'] as $lineIndex => $item) {
                    $lineNumber = $lineIndex + 1;
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
                        // G1-SEC / SEC-04: a product of another store is a refused
                        // reference, never a "master catalog" fallback.
                        $foreign = is_numeric($productId)
                            ? Product::whereKey($productId)->where('store_id', '!=', $storeId)->exists()
                            : Product::where('external_id', $productId)->where('store_id', '!=', $storeId)->exists();
                        if ($foreign) {
                            throw new \DomainException("Line {$lineNumber}: '" . ($item['product_name'] ?? $productId) . "' is not a product of this store.");
                        }
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
                    $freeQty = (float)($item['free_qty'] ?? 0);
                    $freeLooseQty = (float)($item['free_loose_qty'] ?? 0);
                    $unitsPerPack = (int)($item['units_per_pack'] ?? $product->units_per_pack ?: 1);
                    $unitsPerPack = max(1, $unitsPerPack);
                    // Bonus units are not billed but still leave stock.
                    $totalBaseUnits = (($qty + $freeQty) * $unitsPerPack) + $looseQty + $freeLooseQty;

                    if ($totalBaseUnits <= 0) {
                        throw new BusinessRuleException(
                            'QUANTITY_REQUIRED',
                            "Enter a quantity for '{$product->name}'.",
                            'quantity_positive',
                            $lineNumber,
                            'qty',
                            'Use packs and/or loose units, for example 2+5.'
                        );
                    }
                    if ($unitsPerPack > 1 && $qty != floor($qty)) {
                        throw new BusinessRuleException(
                            'PACKS_MUST_BE_WHOLE',
                            "Packs must be a whole number for '{$product->name}'.",
                            'whole_packs',
                            $lineNumber,
                            'qty',
                            'Enter 2+5 for two packs and five loose units.'
                        );
                    }
                    if ($unitsPerPack > 1 && $freeQty != floor($freeQty)) {
                        throw new BusinessRuleException(
                            'PACKS_MUST_BE_WHOLE',
                            "Free packs must be a whole number for '{$product->name}'.",
                            'whole_packs',
                            $lineNumber,
                            'free_qty',
                            'Enter free packs as a whole number.'
                        );
                    }
                    if (($looseQty > 0 || $freeLooseQty > 0) && !($product->allow_loose_sale ?? true)) {
                        throw new BusinessRuleException(
                            'LOOSE_NOT_ALLOWED',
                            "Loose units are not enabled for '{$product->name}'.",
                            'loose_permission',
                            $lineNumber,
                            'loose_qty',
                            'Enter whole packs only.'
                        );
                    }

                    // Batch Resolution with Row-Level Lock
                    // G1-SEC / SEC-04: every batch lookup is held to this store and
                    // this line's product; a batch id from elsewhere is refused.
                    $batch = null;
                    if (!empty($item['batch_id'])) {
                        $byId = is_numeric($item['batch_id'])
                            ? ProductBatch::whereKey($item['batch_id'])
                            : ProductBatch::where('external_id', $item['batch_id']);
                        $batch = (clone $byId)
                            ->where('store_id', $storeId)
                            ->where('product_id', $product->id)
                            ->lockForUpdate()
                            ->first();
                        if (!$batch && $byId->exists()) {
                            throw new \DomainException("Line {$lineNumber}: batch " . ($item['batch_no'] ?? $item['batch_id']) . " does not belong to '{$product->name}' in this store.");
                        }
                    }

                    if (!$batch && !empty($item['batch_no'])) {
                        $batch = ProductBatch::where('store_id', $storeId)
                            ->where('product_id', $product->id)
                            ->where('batch_no', $item['batch_no'])
                            ->lockForUpdate()
                            ->first();
                    }

                    if (!$batch) {
                        // Fallback to this store's first batch of the product.
                        $batch = ProductBatch::where('store_id', $storeId)
                            ->where('product_id', $product->id)
                            ->lockForUpdate()
                            ->first();
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

                    // G11-TAX / TAX-02: nothing may be charged above the printed MRP. The
                    // masters set the ceiling — the batch's own, the product's when the
                    // batch carries none — so a rate typed over it is refused before any
                    // stock moves. A payload's `mrp` is never the limit.
                    $mrpCap = MrpCeiling::rateCap($product, $batch, $item, $unitsPerPack);
                    if ($mrpCappingEnforced && MrpCeiling::isBreach((float) $item['unit_price'], $mrpCap)) {
                        throw new BusinessRuleException(
                            'MRP_EXCEEDED',
                            "'{$product->name}' is billed at Rs {$item['unit_price']} against a ceiling of Rs " . number_format((float) $mrpCap, 2) . '.',
                            'mrp_ceiling',
                            $lineNumber,
                            'unit_price',
                            strtolower((string) ($item['rate_basis'] ?? '')) === 'loose_rate'
                                ? 'A loose rate cannot pass the pack MRP divided by the units in the pack.'
                                : 'Reduce the rate to the MRP, or correct the MRP on the batch.'
                        );
                    }

                    // Check Stock Availability
                    $currentBatchStock = (float)$batch->stock_qty;
                    if ($currentBatchStock < $totalBaseUnits && !$allowNegativeStock) {
                        throw new BusinessRuleException(
                            'INSUFFICIENT_STOCK',
                            "Insufficient stock for '{$product->name}' (Batch: {$batch->batch_no}).",
                            'stock_available',
                            $lineNumber,
                            'batch_id',
                            $sellBeyondStock
                                ? "Available: {$currentBatchStock}, requested: {$totalBaseUnits}. Reduce the quantity or pick another batch."
                                : "Available: {$currentBatchStock}, requested: {$totalBaseUnits}. This counter's profile does not allow selling beyond stock."
                        );
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
                        'free_qty' => $freeQty,
                        'free_loose_qty' => $freeLooseQty,
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
                $taxPolicy = app(\App\Services\Tax\StoreTaxPolicy::class)->forStore($storeId);
                $storeGstType = $taxPolicy['gst_type'];

                // The buyer, not the till's header, decides where the sale is supplied.
                $placeOfSupply = app(\App\Services\Tax\PlaceOfSupply::class)
                    ->forDocument($storeModel, $party, $party?->gstin ?? ($validated['customer_gstin'] ?? null));

                $effectiveGstType = ($taxPolicy['allow_override'] && !empty($validated['gst_type'])) ? $validated['gst_type'] : $storeGstType;
                $effectiveTaxMode = ($taxPolicy['allow_override'] && !empty($validated['tax_mode'])) ? $validated['tax_mode'] : $taxPolicy['tax_mode'];
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
                        'free_qty' => $pItem['free_qty'],
                        'free_loose_qty' => $pItem['free_loose_qty'],
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
                    'place_of_supply' => $placeOfSupply['code'],
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

                // Resolve Payment Lines and Credit. The settlement service owns
                // the tender/applied split, the change, the walk-in rule and the
                // store's reference policy — the invoice must not recompute it.
                $settlement = app(\App\Services\Payments\TenderSettlementService::class)->settle(
                    (float) $grandTotal,
                    $validated['payments'] ?? null,
                    $validated['paid_amount'] ?? null,
                    $validated['payment_mode'] ?? null,
                    $party,
                    (int) $storeId
                );

                $paymentLines = $settlement['lines'];
                $creditPortion = $settlement['credit'];
                $cashPortion = $settlement['cash'];
                $digitalPortion = $settlement['digital'];
                $giftCardPortion = $settlement['gift_card'];
                $totalPaid = $settlement['paid'];
                $primaryPaymentMode = $settlement['primary_mode'];
                $paymentStatus = $settlement['payment_status'];

                // Create Invoice Record
                $invoice = Invoice::create([
                    'store_id' => $storeId,
                    'counter_id' => $counterId,
                    'counter_code' => $counterCode,
                    'location_name' => $validated['location_name'] ?? ($counter ? $counter->location_name : 'Shop Floor'),
                    // SPR-010: the id is the person; the name is what they were
                    // called the day this bill was printed.
                    'salesperson_id' => $salesperson['salesperson_id'] ?? null,
                    'salesperson_name' => $salesperson['salesperson_name'] ?? null,
                    // PHR-005: the registration as it read at the moment the
                    // pharmacist vouched, not a live reference to their row.
                    'pharmacist_id' => $pharmacist['pharmacist_id'] ?? null,
                    'pharmacist_name' => $pharmacist['pharmacist_name'] ?? null,
                    'pharmacist_reg_no' => $pharmacist['pharmacist_reg_no'] ?? null,
                    'pharmacist_confirmed_at' => $pharmacist['pharmacist_confirmed_at'] ?? null,
                    'module_key' => 'invoice',
                    'invoice_number' => $finalInvoiceNumber,
                    'invoice_date' => $invoiceDate,
                    'due_date' => $validated['due_date'] ?? null,
                    'customer_id' => $party ? $party->id : null,
                    'customer_name' => $party ? $party->name : ($validated['customer_name'] ?? 'Walk-in Customer'),
                    'customer_gstin' => $party ? $party->gstin : ($validated['customer_gstin'] ?? null),
                    'customer_phone' => !empty($validated['customer_phone']) ? $validated['customer_phone'] : ($party ? $party->phone : null),
                    'place_of_supply' => $placeOfSupply['label'],
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

                // APR-003..010: settle what the profile deferred. A ceiling was
                // already refused by the gate; this redeems the grant for the
                // thresholds, exactly once, or rolls the bill back.
                app(\App\Services\Counter\ApprovalService::class)->settle(
                    $requiredApprovals,
                    $approvalToken,
                    (int) $storeId,
                    $counterId !== null ? (int) $counterId : null,
                    \App\Services\Counter\ApprovalService::DOCUMENT_INVOICE,
                    $externalId,
                    (int) $invoice->id
                );

                // PHR-004, Q1: the confirmation is written with the document it
                // released, so a save that never happened leaves no pharmacist
                // standing behind a bill.
                if ($pharmacist !== null) {
                    PharmacistGate::record(
                        (int) $storeId,
                        $counterId !== null ? (int) $counterId : null,
                        PharmacistGate::DOCUMENT_SALE,
                        (string) $invoice->id,
                        (string) $invoice->invoice_number,
                        $pharmacist,
                        $restrictedItems
                    );
                }

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
                        'free_qty' => $pItem['free_qty'],
                        'free_loose_qty' => $pItem['free_loose_qty'],
                        'units_per_pack' => $cItem['units_per_pack'],
                        'unit_price' => $cItem['unit_price'],
                        'mrp' => $pItem['mrp'],
                        'rate_basis' => $pItem['rate_basis'],
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

                // Redeem gift card tenders atomically with the sale
                if ($giftCardPortion > 0) {
                    $giftCardService = app(\App\Services\Payments\GiftCardService::class);
                    foreach ($paymentLines as $pLine) {
                        if (empty($pLine['is_gift_card'])) continue;
                        $code = $pLine['extra_fields']['gift_card_code'] ?? $pLine['reference_no'] ?? '';
                        $giftCardService->redeem(
                            $storeId,
                            (string) $code,
                            (float) $pLine['amount'],
                            $invoice->id,
                            'invoice',
                            (string) $invoice->id,
                            $request->user()?->id
                        );
                    }
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
                        'tendered_amount' => $pLine['tendered_amount'],
                        'change_amount' => $pLine['change_amount'],
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

                // AUD-02: a sale that leaves a shelf negative or gives away most of the
                // line's value is the owner's business whether or not the drawer is open.
                $alerts = app(OperationalAlertService::class);
                $alerts->negativeStockOnInvoice($invoice, $storeId);
                $alerts->largeDiscountOnInvoice($invoice, $storeId);

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
                    'invoice' => $invoice->load(['items', 'payments', 'customer']),
                    'affected_batches' => $affectedBatchStockUpdates,
                    'temp_mapped_from' => $tempMappedFrom,
                ];
            });

            $invoice = $result['invoice'];
            app(WebhookOutboxService::class)->enqueue(
                'invoice.created',
                [
                    'id' => $invoice->id,
                    'invoice_number' => $invoice->invoice_number,
                    'grand_total' => (float) $invoice->grand_total,
                    'customer_id' => $invoice->customer_id,
                    'customer_name' => $invoice->customer_name,
                    'payment_mode' => $invoice->payment_mode,
                    'counter_code' => $invoice->counter_code,
                    'invoice_date' => optional($invoice->created_at)->toIso8601String(),
                ],
                $storeId,
                'invoice',
                (string) $invoice->id
            );

            return response()->json([
                'success' => true,
                'invoice' => $result['invoice'],
                'affected_batches' => $result['affected_batches'],
                'temp_mapped_from' => $result['temp_mapped_from'],
                'message' => 'Invoice created and confirmed authoritatively by server.',
            ], 201);
        } catch (BusinessRuleException $e) {
            return $e->render();
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

    public function show(Request $request, string $id): JsonResponse
    {
        $invoice = $this->findStoreInvoice($request, $id, ['items', 'payments', 'customer']);
        app(ComplianceService::class)->decorate($invoice);

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
        $invoice = Invoice::with('items')
            ->where('store_id', $this->resolveStoreId($request))
            ->findOrFail($id);

        if ($invoice->status === 'cancelled') {
            return response()->json([
                'success' => true,
                'status' => 'cancelled',
                'message' => 'Invoice was already cancelled.',
            ]);
        }

        $validated = $request->validate([
            'reason' => 'nullable|string|max:1000',
            'approval_token' => 'nullable|string|max:191',
            'pharmacist_id' => 'nullable',
            'pharmacist_pin' => 'nullable|string|max:64',
        ]);

        $reason = $validated['reason'] ?? 'Cancelled by operator';

        // PHR-004: taking a restricted bill off the book takes the pharmacist's
        // registration with it. The bill keeps the stamp it was sold under —
        // only the confirmation of the void is written here.
        $restrictedItems = RestrictedDrugResolver::forInvoice($invoice);
        $pharmacist = PharmacistGate::require(
            (int) $invoice->store_id,
            $invoice->counter_id !== null ? (int) $invoice->counter_id : null,
            $restrictedItems,
            $validated['pharmacist_id'] ?? null,
            $validated['pharmacist_pin'] ?? null,
            'cancellation',
            $invoice
        );

        // G12: the day guard and the approver's grant are both enforced inside the
        // cancellation service so the offline sync path cannot bypass them.
        app(\App\Services\Sales\InvoiceCancellationService::class)->cancel(
            $invoice,
            $reason,
            $request->user()?->id,
            $validated['approval_token'] ?? null
        );

        if ($pharmacist !== null) {
            PharmacistGate::record(
                (int) $invoice->store_id,
                $invoice->counter_id !== null ? (int) $invoice->counter_id : null,
                PharmacistGate::DOCUMENT_CANCEL,
                (string) $invoice->id,
                (string) $invoice->invoice_number,
                $pharmacist,
                $restrictedItems,
                $reason
            );
        }

        return response()->json([
            'success' => true,
            'status' => 'cancelled',
            'message' => "Invoice #{$invoice->invoice_number} cancelled and batch stock restored.",
        ]);
    }
}
