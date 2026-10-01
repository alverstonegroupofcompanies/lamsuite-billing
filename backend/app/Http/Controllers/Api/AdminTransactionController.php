<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\GstLockPeriod;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\Expense;
use App\Models\CustomerPayment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminTransactionController
{
    /**
     * List sales invoices.
     */
    public function invoices(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = Invoice::with(['items', 'customer:id,name,phone,gstin'])
            ->when($storeId, fn($q) => $q->where('store_id', $storeId));

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhere('customer_name', 'like', "%{$search}%")
                  ->orWhere('patient_name', 'like', "%{$search}%")
                  ->orWhere('doctor_name', 'like', "%{$search}%");
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($moduleKey = $request->query('module_key')) {
            $query->where('module_key', $moduleKey);
        }

        if ($startDate = $request->query('start_date')) {
            $query->whereDate('invoice_date', '>=', $startDate);
        }
        if ($endDate = $request->query('end_date')) {
            $query->whereDate('invoice_date', '<=', $endDate);
        }

        $query->orderBy('invoice_date', 'desc')->orderBy('id', 'desc');

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        return response()->json($query->paginate(20));
    }

    /**
     * Show single invoice with print data.
     */
    public function showInvoice(string $id): JsonResponse
    {
        $invoice = Invoice::with(['items', 'customer', 'store', 'cancelledByUser'])->findOrFail($id);
        return response()->json($invoice);
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
                    // Reduce balance by invoice grand_total
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

        return response()->json($query->paginate(20));
    }

    public function showPurchase(string $id): JsonResponse
    {
        $purchase = Purchase::with(['items', 'supplier', 'store'])->findOrFail($id);
        return response()->json($purchase);
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
}
