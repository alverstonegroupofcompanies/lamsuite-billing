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
        $invoice = Invoice::with(['items', 'customer', 'store', 'payments', 'cancelledByUser'])->findOrFail($id);
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
