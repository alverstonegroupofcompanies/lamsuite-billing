<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\CounterShift;
use App\Models\CustomerPayment;
use App\Models\Expense;
use App\Models\GstLockPeriod;
use App\Models\HeldBill;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\Store;
use App\Models\SupplierPayment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminTransactionController
{
    /**
     * Helper to strip clinical fields when store is not a pharmacy.
     */
    protected function sanitizeClinicalFields($record, bool $isPharmacy)
    {
        if ($isPharmacy) {
            return $record;
        }

        if (is_array($record)) {
            unset($record['patient_name'], $record['doctor_name'], $record['doctor_reg_no'], $record['prescription_no'], $record['prescription_date']);
            return $record;
        }

        if ($record instanceof Invoice) {
            $record->patient_name = null;
            $record->doctor_name = null;
            $record->doctor_reg_no = null;
            if ($record->relationLoaded('items')) {
                foreach ($record->items as $item) {
                    $item->makeHidden(['is_schedule_h', 'is_schedule_x', 'requires_prescription']);
                }
            }
        }

        return $record;
    }

    /**
     * List sales invoices.
     */
    public function invoices(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $store = $storeId ? Store::find($storeId) : null;
        $isPharmacy = !$store || $store->store_type === 'pharmacy';

        $query = Invoice::with(['items', 'customer:id,name,phone,gstin', 'payments'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($moduleKey = $request->query('module_key')) {
            $query->where('module_key', $moduleKey);
        } else {
            // By default list sales invoices (exclude returns and quotations)
            $query->where(function ($q) {
                $q->whereNull('module_key')
                  ->orWhereNotIn('module_key', ['credit_note', 'sales_return', 'quotation']);
            });
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search, $isPharmacy) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhere('customer_name', 'like', "%{$search}%");
                if ($isPharmacy) {
                    $q->orWhere('patient_name', 'like', "%{$search}%")
                      ->orWhere('doctor_name', 'like', "%{$search}%");
                }
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($startDate = $request->query('start_date')) {
            $query->whereDate('invoice_date', '>=', $startDate);
        }
        if ($endDate = $request->query('end_date')) {
            $query->whereDate('invoice_date', '<=', $endDate);
        }

        $query->orderBy('invoice_date', 'desc')->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            $data = $query->get();
            if (!$isPharmacy) {
                $data->transform(fn($inv) => $this->sanitizeClinicalFields($inv, false));
            }
            return response()->json(['data' => $data]);
        }

        $perPage = min((int) $request->query('per_page', 25), 500);
        $paginated = $query->paginate($perPage);
        if (!$isPharmacy) {
            $paginated->getCollection()->transform(fn($inv) => $this->sanitizeClinicalFields($inv, false));
        }

        return response()->json($paginated);
    }

    /**
     * Show single invoice with print data.
     */
    public function showInvoice(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::with(['items', 'customer', 'store', 'payments', 'cancelledByUser'])
            ->where('id', $id)
            ->orWhere('invoice_number', $id)
            ->firstOrFail();
        $store = $invoice->store ?: ($request->get('active_store_id') ? Store::find($request->get('active_store_id')) : null);
        $isPharmacy = !$store || $store->store_type === 'pharmacy';

        if (!$isPharmacy) {
            $invoice = $this->sanitizeClinicalFields($invoice, false);
        }

        return response()->json($invoice);
    }

    /**
     * Sales Returns & Credit Notes.
     */
    /**
     * Create a sales return (credit note). The original invoice is required so
     * the server can verify remaining returnable quantities in base units and
     * restock the exact batch that was sold.
     */
    public function storeSalesReturn(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id')
            ?: $request->header('X-Store-Id')
            ?: $request->user()?->store_id;
        $store = $storeId ? Store::find($storeId) : null;
        if (!$store) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_REQUIRED',
                'message' => 'An active store is required to record a sales return.',
            ], 422);
        }

        $validated = $request->validate([
            'original_invoice_id' => 'nullable',
            'original_invoice_number' => 'nullable|string|max:50',
            'customer_phone' => 'nullable|string|max:20',
            'refund_mode' => 'nullable|string|max:30',
            'refund_amount' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.product_id' => 'required',
            'items.*.product_name' => 'nullable|string|max:255',
            'items.*.batch_no' => 'nullable|string|max:50',
            'items.*.expiry_date' => 'nullable|string|max:30',
            'items.*.qty' => 'required|numeric|min:0',
            'items.*.loose_qty' => 'nullable|numeric|min:0',
            'items.*.units_per_pack' => 'nullable|integer|min:1',
            'items.*.rate' => 'nullable|numeric|min:0',
            'items.*.unit_price' => 'nullable|numeric|min:0',
            'items.*.gst_percent' => 'nullable|numeric|min:0',
            'items.*.reason' => 'nullable|string|max:255',
        ]);

        if (empty($validated['original_invoice_id']) && empty($validated['original_invoice_number'])) {
            return response()->json([
                'success' => false,
                'error' => 'ORIGINAL_INVOICE_REQUIRED',
                'message' => 'Select the original invoice before recording a return.',
            ], 422);
        }

        $original = null;
        if (!empty($validated['original_invoice_id'])) {
            $originalId = $validated['original_invoice_id'];
            $original = Invoice::where('store_id', $store->id)
                ->with('items')
                ->where(function ($q) use ($originalId) {
                    $q->where('id', $originalId)->orWhere('external_id', $originalId);
                })
                ->first();
        }
        if (!$original && !empty($validated['original_invoice_number'])) {
            $original = Invoice::where('store_id', $store->id)
                ->with('items')
                ->where('invoice_number', $validated['original_invoice_number'])
                ->first();
        }

        if (!$original) {
            return response()->json([
                'success' => false,
                'error' => 'ORIGINAL_INVOICE_NOT_FOUND',
                'message' => 'The original invoice could not be found in this store.',
            ], 404);
        }
        if ($original->status === 'cancelled' || in_array($original->module_key, ['credit_note', 'sales_return', 'quotation'], true)) {
            return response()->json([
                'success' => false,
                'error' => 'ORIGINAL_INVOICE_NOT_RETURNABLE',
                'message' => 'Returns can only be created against an issued sales invoice.',
            ], 422);
        }

        $alreadyReturned = $this->returnedBaseUnitsByLine($store->id, $original->invoice_number);
        $resolved = [];
        $taxLines = [];

        foreach ($validated['items'] as $index => $item) {
            $lineNumber = $index + 1;
            $productId = $item['product_id'];
            $product = Product::where('store_id', $store->id)
                ->where(function ($q) use ($productId) {
                    $q->where('id', $productId)->orWhere('external_id', $productId);
                })
                ->first();
            if (!$product && !empty($item['product_name'])) {
                $product = Product::where('store_id', $store->id)
                    ->where('name', $item['product_name'])
                    ->first();
            }
            if (!$product) {
                return response()->json([
                    'success' => false,
                    'error' => 'PRODUCT_NOT_FOUND',
                    'message' => "Line {$lineNumber}: product not found.",
                    'line' => $lineNumber,
                ], 422);
            }

            $qty = (float) $item['qty'];
            $looseQty = (float) ($item['loose_qty'] ?? 0);
            $unitsPerPack = max(1, (int) ($item['units_per_pack'] ?? 1));
            $baseUnits = ($qty * $unitsPerPack) + $looseQty;
            if ($baseUnits <= 0) {
                return response()->json([
                    'success' => false,
                    'error' => 'RETURN_QTY_REQUIRED',
                    'message' => "Line {$lineNumber}: enter a return quantity greater than zero.",
                    'line' => $lineNumber,
                ], 422);
            }

            $batchNo = $item['batch_no'] ?? null;
            $productItems = $original->items->filter(
                fn($oi) => (string) $oi->product_id === (string) $product->id
            );
            $originalItem = $productItems->first(
                fn($oi) => !empty($batchNo) && $oi->batch_no === $batchNo
            ) ?: $productItems->first();

            if (!$originalItem) {
                return response()->json([
                    'success' => false,
                    'error' => 'LINE_NOT_ON_INVOICE',
                    'message' => "Line {$lineNumber}: '{$product->name}' was not sold on this invoice.",
                    'line' => $lineNumber,
                ], 422);
            }

            $batchNo = $batchNo ?: $originalItem->batch_no;
            $lineKey = $product->id . '_' . ($batchNo ?? '');
            $soldBase = $this->baseUnits(
                $originalItem->qty,
                $originalItem->loose_qty,
                $originalItem->units_per_pack
            );
            $remaining = $soldBase - ($alreadyReturned[$lineKey] ?? 0);
            if ($baseUnits > $remaining) {
                return response()->json([
                    'success' => false,
                    'error' => 'RETURN_QTY_EXCEEDS',
                    'message' => "Line {$lineNumber}: cannot return {$baseUnits} units of {$product->name}. Only {$remaining} remain returnable.",
                    'line' => $lineNumber,
                    'remaining' => $remaining,
                ], 422);
            }

            $rate = (float) ($item['rate'] ?? $item['unit_price'] ?? $originalItem->unit_price ?? $product->sel_rate ?? 0);
            $gstPercent = (float) ($item['gst_percent'] ?? $originalItem->gst_percent ?? $product->gst_percent ?? 0);

            $resolved[] = [
                'product' => $product,
                'qty' => $qty,
                'loose_qty' => $looseQty,
                'units_per_pack' => $unitsPerPack,
                'base_units' => $baseUnits,
                'batch_no' => $batchNo,
                'expiry_date' => $item['expiry_date'] ?? $originalItem->expiry_date,
                'unit_price' => $rate,
                'gst_percent' => $gstPercent,
            ];

            $taxLines[] = [
                'line_id' => (string) $index,
                'product_id' => (string) $product->id,
                'product_name' => $product->name,
                'hsn_code' => $originalItem->hsn_code ?? $product->hsn_sac_code ?? '',
                'qty' => $qty,
                'loose_qty' => $looseQty,
                'units_per_pack' => $unitsPerPack,
                'unit_price' => $rate,
                'rate_basis' => 'sel_rate',
                'discount_percent' => 0,
                'discount_amount' => 0,
                'gst_percent' => $gstPercent,
                'cess_percent' => 0,
            ];
        }

        $taxSetting = \App\Models\CompanySetting::where('store_id', $store->id)
            ->where('key', 'tax_settings')
            ->first();
        $taxMode = $taxSetting ? ($taxSetting->value['tax_mode'] ?? 'inclusive') : 'inclusive';

        $tax = \App\Services\Tax\TaxEngine::calculate([
            'store_state' => $store->state_code ?: '32',
            'customer_gstin' => $original->customer_gstin,
            'place_of_supply' => $original->place_of_supply ?: '32-Kerala',
            'default_tax_mode' => $taxMode,
            'is_composition' => in_array($store->gst_type, ['composition', 'no_tax', 'unregistered'], true),
            'lines' => $taxLines,
            'auto_round_off' => true,
        ]);

        $result = DB::transaction(function () use ($store, $original, $validated, $resolved, $tax) {
            $invoice = Invoice::create([
                'store_id' => $store->id,
                'counter_id' => $original->counter_id,
                'user_id' => $original->user_id,
                'module_key' => 'credit_note',
                'invoice_number' => $this->nextCreditNoteNumber($store->id),
                'invoice_date' => Carbon::now($store->timezone ?: 'Asia/Kolkata')->toDateString(),
                'customer_id' => $original->customer_id,
                'customer_name' => $original->customer_name,
                'customer_phone' => $validated['customer_phone'] ?? $original->customer_phone,
                'customer_gstin' => $original->customer_gstin,
                'place_of_supply' => $original->place_of_supply,
                'subtotal' => $tax['taxable_subtotal'],
                'taxable_subtotal' => $tax['taxable_subtotal'],
                'discount_total' => $tax['line_discount_total'] + $tax['bill_discount_total'],
                'tax_total' => $tax['total_tax'],
                'cgst_total' => $tax['cgst_total'],
                'sgst_total' => $tax['sgst_total'],
                'igst_total' => $tax['igst_total'],
                'cess_total' => $tax['cess_total'],
                'round_off' => $tax['round_off'],
                'grand_total' => $tax['grand_total'],
                'paid_amount' => $validated['refund_amount'] ?? $tax['grand_total'],
                'payment_mode' => $validated['refund_mode'] ?? 'Cash',
                'status' => 'issued',
                'counter_code' => $original->counter_code,
                'store_state_code' => $store->state_code ?: '32',
                'original_invoice_id' => $original->id,
                'original_invoice_number' => $original->invoice_number,
            ]);

            foreach ($resolved as $index => $line) {
                $taxLine = $tax['lines'][$index];
                InvoiceItem::create([
                    'invoice_id' => $invoice->id,
                    'product_id' => $line['product']->id,
                    'product_name' => $line['product']->name,
                    'batch_no' => $line['batch_no'],
                    'expiry_date' => $line['expiry_date'],
                    'qty' => $line['qty'],
                    'loose_qty' => $line['loose_qty'],
                    'units_per_pack' => $line['units_per_pack'],
                    'unit_price' => $line['unit_price'],
                    'mrp' => $line['product']->mrp ?? $line['unit_price'],
                    'discount_percent' => 0,
                    'discount_amount' => 0,
                    'taxable_amount' => $taxLine['taxable_amount'],
                    'gst_percent' => $line['gst_percent'],
                    'cgst_amount' => $taxLine['cgst_amount'],
                    'sgst_amount' => $taxLine['sgst_amount'],
                    'igst_amount' => $taxLine['igst_amount'],
                    'cess_rate' => $taxLine['cess_rate'],
                    'cess_amount' => $taxLine['cess_amount'],
                    'tax_amount' => $taxLine['total_tax'],
                    'total_amount' => $taxLine['total_amount'],
                ]);

                $batch = ProductBatch::where('store_id', $store->id)
                    ->where('product_id', $line['product']->id)
                    ->where('batch_no', $line['batch_no'])
                    ->lockForUpdate()
                    ->first();
                if ($batch) {
                    $batch->increment('stock_qty', $line['base_units']);
                }
                $line['product']->increment('current_stock', $line['base_units']);
            }

            return $invoice->load('items');
        });

        return response()->json([
            'success' => true,
            'credit_note_number' => $result->invoice_number,
            'return_id' => $result->id,
            'refund_amount' => $result->grand_total,
            'invoice' => $result,
        ], 201);
    }

    private function baseUnits($qty, $looseQty, $unitsPerPack): float
    {
        $upp = max(1, (int) ($unitsPerPack ?: 1));
        return max(0, (float) $qty) * $upp + max(0, (float) $looseQty);
    }

    /** Base units already returned per `productId_batchNo` for an invoice. */
    private function returnedBaseUnitsByLine(int $storeId, string $invoiceNumber): array
    {
        $prior = Invoice::where('store_id', $storeId)
            ->whereIn('module_key', ['credit_note', 'sales_return'])
            ->where('original_invoice_number', $invoiceNumber)
            ->where('status', '!=', 'cancelled')
            ->with('items')
            ->get();

        $map = [];
        foreach ($prior as $doc) {
            foreach ($doc->items as $item) {
                $key = $item->product_id . '_' . ($item->batch_no ?? '');
                $map[$key] = ($map[$key] ?? 0)
                    + $this->baseUnits($item->qty, $item->loose_qty, $item->units_per_pack);
            }
        }
        return $map;
    }

    private function nextCreditNoteNumber(int $storeId): string
    {
        $last = Invoice::where('store_id', $storeId)
            ->where('module_key', 'credit_note')
            ->orderByDesc('id')
            ->first();
        $sequence = 1;
        if ($last && preg_match('/(\d+)$/', (string) $last->invoice_number, $matches)) {
            $sequence = (int) $matches[1] + 1;
        }
        return sprintf('CN-%d-%04d', $storeId, $sequence);
    }

    /**
     * List sales returns & credit notes.
     */
    public function returns(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $store = $storeId ? Store::find($storeId) : null;
        $isPharmacy = !$store || $store->store_type === 'pharmacy';

        $query = Invoice::with(['items', 'customer:id,name,phone,gstin', 'payments'])
            ->where(function ($q) {
                $q->whereIn('module_key', ['credit_note', 'sales_return'])
                  ->orWhere('grand_total', '<', 0);
            })
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhere('customer_name', 'like', "%{$search}%");
            });
        }

        if ($startDate = $request->query('start_date')) {
            $query->whereDate('invoice_date', '>=', $startDate);
        }
        if ($endDate = $request->query('end_date')) {
            $query->whereDate('invoice_date', '<=', $endDate);
        }

        $query->orderBy('invoice_date', 'desc')->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            $data = $query->get();
            if (!$isPharmacy) {
                $data->transform(fn($inv) => $this->sanitizeClinicalFields($inv, false));
            }
            return response()->json(['data' => $data]);
        }

        $perPage = min((int) $request->query('per_page', 25), 500);
        $paginated = $query->paginate($perPage);
        if (!$isPharmacy) {
            $paginated->getCollection()->transform(fn($inv) => $this->sanitizeClinicalFields($inv, false));
        }

        return response()->json($paginated);
    }

    /**
     * Quotations & Estimates.
     */
    public function quotations(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $store = $storeId ? Store::find($storeId) : null;
        $isPharmacy = !$store || $store->store_type === 'pharmacy';

        $query = Invoice::with(['items', 'customer:id,name,phone,gstin'])
            ->where('module_key', 'quotation')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhere('customer_name', 'like', "%{$search}%");
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($startDate = $request->query('start_date')) {
            $query->whereDate('invoice_date', '>=', $startDate);
        }
        if ($endDate = $request->query('end_date')) {
            $query->whereDate('invoice_date', '<=', $endDate);
        }

        $query->orderBy('invoice_date', 'desc')->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            $data = $query->get();
            if (!$isPharmacy) {
                $data->transform(fn($inv) => $this->sanitizeClinicalFields($inv, false));
            }
            return response()->json(['data' => $data]);
        }

        $perPage = min((int) $request->query('per_page', 25), 500);
        $paginated = $query->paginate($perPage);
        if (!$isPharmacy) {
            $paginated->getCollection()->transform(fn($inv) => $this->sanitizeClinicalFields($inv, false));
        }

        return response()->json($paginated);
    }

    /**
     * Cancel an invoice with stock restoration, ledger adjustment, and GST lock verification.
     */
    public function cancelInvoice(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::with('items')->findOrFail($id);

        if ($invoice->status === 'cancelled') {
            return response()->json(['message' => 'Invoice is already cancelled.'], 422);
        }

        $request->validate([
            'reason' => 'required|string|min:5',
        ]);

        // 1. Verify GST period lock
        $invoiceMonth = Carbon::parse($invoice->invoice_date)->format('Y-m');
        $isLocked = GstLockPeriod::where('store_id', $invoice->store_id)
            ->where('period_month', $invoiceMonth)
            ->where('is_locked', true)
            ->exists();

        if ($isLocked) {
            return response()->json([
                'message' => "GST statutory lock active for period {$invoiceMonth}. Invoices in locked periods cannot be cancelled.",
                'period_month' => $invoiceMonth,
            ], 422);
        }

        DB::beginTransaction();
        try {
            // 2. Restore stock for each invoice line item
            foreach ($invoice->items as $item) {
                if ($item->product_id) {
                    $prod = Product::find($item->product_id);
                    if ($prod) {
                        $prod->increment('current_stock', $item->qty);
                    }

                    if ($item->batch_no) {
                        ProductBatch::where('product_id', $item->product_id)
                            ->where('batch_no', $item->batch_no)
                            ->increment('stock_qty', $item->qty);
                    }
                }
            }

            // 3. Update customer ledger if customer is linked
            if ($invoice->customer_id) {
                $customer = Party::find($invoice->customer_id);
                if ($customer) {
                    $customer->decrement('current_balance', $invoice->grand_total);
                }
            }

            // 4. Update invoice status
            $oldStatus = $invoice->status;
            $invoice->update([
                'status' => 'cancelled',
                'cancel_reason' => $request->input('reason'),
                'cancelled_at' => now(),
                'cancelled_by' => $request->user() ? $request->user()->id : null,
                'version' => $invoice->version + 1,
            ]);

            // 5. Tamper-evident audit log entry
            AuditLog::log(
                'cancel_invoice',
                'Invoice',
                (string)$invoice->id,
                ['status' => $oldStatus],
                [
                    'status' => 'cancelled',
                    'reason' => $request->input('reason'),
                    'stock_restored' => true,
                    'customer_ledger_updated' => (bool)$invoice->customer_id,
                ],
                $invoice->store_id
            );

            DB::commit();

            return response()->json([
                'success' => true,
                'status' => 'cancelled',
                'message' => "Invoice {$invoice->invoice_number} cancelled. Stock restored, customer ledger adjusted, and audit entry generated.",
                'invoice' => $invoice,
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Failed to cancel invoice: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Controlled invoice update (only if GST period not locked).
     */
    public function updateInvoice(Request $request, string $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);

        if ($request->has('version') && (int)$request->input('version') !== (int)$invoice->version) {
            return response()->json([
                'message' => 'Conflict warning: This invoice was modified or synced concurrently.',
                'current_version' => $invoice->version,
            ], 409);
        }

        $invoiceMonth = Carbon::parse($invoice->invoice_date)->format('Y-m');
        $isLocked = GstLockPeriod::where('store_id', $invoice->store_id)
            ->where('period_month', $invoiceMonth)
            ->where('is_locked', true)
            ->exists();

        if ($isLocked) {
            return response()->json([
                'message' => "GST period {$invoiceMonth} is locked. Edits are strictly forbidden.",
            ], 422);
        }

        $validated = $request->validate([
            'patient_name' => 'nullable|string',
            'doctor_name' => 'nullable|string',
            'doctor_reg_no' => 'nullable|string',
            'payment_mode' => 'nullable|string',
        ]);

        $oldValues = $invoice->only(array_keys($validated));
        $validated['version'] = $invoice->version + 1;
        $invoice->update($validated);

        AuditLog::log('edit_invoice', 'Invoice', (string)$invoice->id, $oldValues, $validated, $invoice->store_id);

        return response()->json($invoice);
    }

    /**
     * Purchases list and details.
     */
    public function purchases(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = Purchase::with(['items', 'supplier'])
            ->where(function ($q) {
                $q->whereNull('module_key')
                  ->orWhere('module_key', 'purchase')
                  ->orWhereNotIn('module_key', ['debit_note', 'purchase_return', 'purchase_order', 'order']);
            })
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhere('supplier_name', 'like', "%{$search}%");
            });
        }

        $query->orderBy('invoice_date', 'desc')->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        $perPage = min((int) $request->query('per_page', 25), 500);
        return response()->json($query->paginate($perPage));
    }

    public function showPurchase(string $id): JsonResponse
    {
        $purchase = Purchase::with(['items', 'supplier', 'store'])->findOrFail($id);
        return response()->json($purchase);
    }

    /**
     * Purchase Returns & Debit Notes.
     */
    public function purchaseReturns(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = Purchase::with(['items', 'supplier'])
            ->whereIn('module_key', ['debit_note', 'purchase_return'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhere('supplier_name', 'like', "%{$search}%");
            });
        }

        $query->orderBy('invoice_date', 'desc')->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        $perPage = min((int) $request->query('per_page', 25), 500);
        return response()->json($query->paginate($perPage));
    }

    /**
     * Purchase Orders.
     */
    public function purchaseOrders(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = Purchase::with(['items', 'supplier'])
            ->whereIn('module_key', ['purchase_order', 'order'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhere('supplier_name', 'like', "%{$search}%");
            });
        }

        $query->orderBy('invoice_date', 'desc')->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        $perPage = min((int) $request->query('per_page', 25), 500);
        return response()->json($query->paginate($perPage));
    }

    /**
     * Held Bills list and details.
     */
    public function heldBills(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = HeldBill::query()
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('id', 'like', "%{$search}%")
                  ->orWhere('customer_name', 'like', "%{$search}%")
                  ->orWhere('held_by_counter_name', 'like', "%{$search}%")
                  ->orWhere('held_by_user_name', 'like', "%{$search}%");
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        $query->orderBy('held_at', 'desc')->orderBy('id', 'desc');

        $perPage = min((int) $request->query('per_page', 25), 500);
        return response()->json($query->paginate($perPage));
    }

    public function showHeldBill(string $id): JsonResponse
    {
        $bill = HeldBill::findOrFail($id);
        return response()->json($bill);
    }

    /**
     * Counter shifts & day close.
     */
    public function shifts(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = CounterShift::with([
            'counter:id,counter_code,device_name',
            'openedBy:id,name',
            'closedBy:id,name',
            'store:id,name',
        ])
        ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($counterId = $request->query('counter_id')) {
            $query->where('counter_id', $counterId);
        }

        $query->orderBy('opened_at', 'desc')->orderBy('id', 'desc');

        $perPage = min((int) $request->query('per_page', 25), 500);
        return response()->json($query->paginate($perPage));
    }

    /**
     * Stock adjustments, transfers, expenses, customer payments.
     */
    public function stockAdjustments(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = StockAdjustment::with(['product', 'user:id,name'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('id', 'desc');

        return response()->json($query->paginate(20));
    }

    public function stockTransfers(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = StockTransfer::with(['fromStore:id,name', 'toStore:id,name', 'items.product', 'creator:id,name'])
            ->when($storeId, fn($q) => $q->where(fn($sub) => $sub->where('from_store_id', $storeId)->orWhere('to_store_id', $storeId)))
            ->orderBy('id', 'desc');

        return response()->json($query->paginate(20));
    }

    public function expenses(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = Expense::with('creator:id,name')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('expense_date', 'desc');

        return response()->json($query->paginate(20));
    }

    public function customerPayments(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = CustomerPayment::with(['customer:id,name,phone', 'creator:id,name'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('payment_date', 'desc');

        return response()->json($query->paginate(20));
    }

    public function storeCustomerPayment(Request $request): JsonResponse
    {
        $storeId = $request->input('store_id') ?: $request->get('active_store_id');
        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'customer_id' => 'required|exists:parties,id',
            'amount' => 'required|numeric|min:0.01',
            'payment_mode' => 'required|string|max:50',
            'reference_no' => 'nullable|string|max:100',
            'notes' => 'nullable|string|max:500',
            'payment_date' => 'nullable|date',
        ]);

        $validated['payment_date'] = $validated['payment_date'] ?? now()->toDateString();
        $validated['created_by'] = $request->user() ? $request->user()->id : null;

        DB::beginTransaction();
        try {
            $payment = CustomerPayment::create($validated);
            $customer = Party::findOrFail($validated['customer_id']);
            $oldBalance = $customer->current_balance;
            $customer->decrement('current_balance', $validated['amount']);

            AuditLog::log(
                'record_customer_payment',
                'CustomerPayment',
                (string)$payment->id,
                ['current_balance' => $oldBalance],
                ['amount' => $validated['amount'], 'new_balance' => $customer->current_balance],
                $validated['store_id']
            );

            DB::commit();
            return response()->json([
                'success' => true,
                'payment' => $payment->load(['customer:id,name,phone', 'creator:id,name']),
                'new_balance' => $customer->current_balance,
            ], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Failed to record customer payment: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Supplier payments and receipts.
     */
    public function supplierPayments(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = SupplierPayment::with(['supplier:id,name,phone,gstin', 'creator:id,name'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($supplierId = $request->query('supplier_id')) {
            $query->where('supplier_id', $supplierId);
        }

        if ($startDate = $request->query('start_date')) {
            $query->whereDate('payment_date', '>=', $startDate);
        }
        if ($endDate = $request->query('end_date')) {
            $query->whereDate('payment_date', '<=', $endDate);
        }

        $query->orderBy('payment_date', 'desc')->orderBy('id', 'desc');

        return response()->json($query->paginate(25));
    }

    public function storeSupplierPayment(Request $request): JsonResponse
    {
        $storeId = $request->input('store_id') ?: $request->get('active_store_id');
        $validated = $request->validate([
            'store_id' => 'required|exists:stores,id',
            'supplier_id' => 'required|exists:parties,id',
            'amount' => 'required|numeric|min:0.01',
            'payment_mode' => 'required|string|max:50',
            'reference_no' => 'nullable|string|max:100',
            'notes' => 'nullable|string|max:500',
            'payment_date' => 'nullable|date',
        ]);

        $validated['payment_date'] = $validated['payment_date'] ?? now()->toDateString();
        $validated['created_by'] = $request->user() ? $request->user()->id : null;

        DB::beginTransaction();
        try {
            $payment = SupplierPayment::create($validated);
            $supplier = Party::findOrFail($validated['supplier_id']);
            $oldBalance = $supplier->current_balance;
            $supplier->decrement('current_balance', $validated['amount']);

            AuditLog::log(
                'record_supplier_payment',
                'SupplierPayment',
                (string)$payment->id,
                ['current_balance' => $oldBalance],
                ['amount' => $validated['amount'], 'new_balance' => $supplier->current_balance],
                $validated['store_id']
            );

            DB::commit();
            return response()->json([
                'success' => true,
                'payment' => $payment->load(['supplier:id,name,phone,gstin', 'creator:id,name']),
                'new_balance' => $supplier->current_balance,
            ], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Failed to record supplier payment: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Customer Ledger statement.
     */
    public function customerLedger(Request $request, string $id): JsonResponse
    {
        $customer = Party::findOrFail($id);

        $invoices = Invoice::where('customer_id', $customer->id)
            ->where('status', '!=', 'cancelled')
            ->select('id', 'invoice_number as doc_number', 'invoice_date as doc_date', 'module_key', 'grand_total', 'paid_amount', 'payment_mode')
            ->get();

        $payments = CustomerPayment::where('customer_id', $customer->id)
            ->select('id', 'reference_no as doc_number', 'payment_date as doc_date', 'amount', 'payment_mode', 'notes')
            ->get();

        $rows = [];
        foreach ($invoices as $inv) {
            $isReturn = in_array($inv->module_key, ['credit_note', 'sales_return']);
            $rows[] = [
                'type' => $isReturn ? 'Sales Return' : ($inv->module_key === 'quotation' ? 'Quotation' : 'Invoice'),
                'doc_number' => $inv->doc_number,
                'doc_date' => (string)$inv->doc_date,
                'debit' => $isReturn ? 0 : (float)$inv->grand_total,
                'credit' => $isReturn ? (float)$inv->grand_total : 0,
                'payment_mode' => $inv->payment_mode,
            ];
        }

        foreach ($payments as $pay) {
            $rows[] = [
                'type' => 'Payment Receipt',
                'doc_number' => $pay->doc_number ?: ('REC-' . $pay->id),
                'doc_date' => (string)$pay->doc_date,
                'debit' => 0,
                'credit' => (float)$pay->amount,
                'payment_mode' => $pay->payment_mode,
                'notes' => $pay->notes,
            ];
        }

        usort($rows, fn($a, $b) => strcmp($a['doc_date'], $b['doc_date']));

        $runningBalance = (float)$customer->opening_balance;
        foreach ($rows as &$r) {
            $runningBalance += ($r['debit'] - $r['credit']);
            $r['running_balance'] = round($runningBalance, 2);
        }

        return response()->json([
            'customer' => $customer,
            'opening_balance' => (float)$customer->opening_balance,
            'current_balance' => (float)$customer->current_balance,
            'transactions' => $rows,
        ]);
    }

    /**
     * Supplier Ledger statement.
     */
    public function supplierLedger(Request $request, string $id): JsonResponse
    {
        $supplier = Party::findOrFail($id);

        $purchases = Purchase::where('supplier_id', $supplier->id)
            ->where('status', '!=', 'cancelled')
            ->select('id', 'invoice_number as doc_number', 'invoice_date as doc_date', 'module_key', 'grand_total', 'paid_amount')
            ->get();

        $payments = SupplierPayment::where('supplier_id', $supplier->id)
            ->select('id', 'reference_no as doc_number', 'payment_date as doc_date', 'amount', 'payment_mode', 'notes')
            ->get();

        $rows = [];
        foreach ($purchases as $p) {
            $isReturn = in_array($p->module_key, ['debit_note', 'purchase_return']);
            $rows[] = [
                'type' => $isReturn ? 'Debit Note' : 'Purchase Inward',
                'doc_number' => $p->doc_number,
                'doc_date' => (string)$p->doc_date,
                'credit' => $isReturn ? 0 : (float)$p->grand_total,
                'debit' => $isReturn ? (float)$p->grand_total : 0,
            ];
        }

        foreach ($payments as $pay) {
            $rows[] = [
                'type' => 'Disbursement',
                'doc_number' => $pay->doc_number ?: ('PAY-' . $pay->id),
                'doc_date' => (string)$pay->doc_date,
                'credit' => 0,
                'debit' => (float)$pay->amount,
                'payment_mode' => $pay->payment_mode,
                'notes' => $pay->notes,
            ];
        }

        usort($rows, fn($a, $b) => strcmp($a['doc_date'], $b['doc_date']));

        $runningBalance = (float)$supplier->opening_balance;
        foreach ($rows as &$r) {
            $runningBalance += ($r['credit'] - $r['debit']);
            $r['running_balance'] = round($runningBalance, 2);
        }

        return response()->json([
            'supplier' => $supplier,
            'opening_balance' => (float)$supplier->opening_balance,
            'current_balance' => (float)$supplier->current_balance,
            'transactions' => $rows,
        ]);
    }
}
