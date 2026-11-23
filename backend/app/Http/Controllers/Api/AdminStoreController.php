<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\InvoicePayment;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\CustomerPayment;
use App\Models\Expense;
use App\Models\HeldBill;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\SupplierPayment;
use App\Models\SyncEvent;
use App\Models\Store;
use App\Support\GstStateCodes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AdminStoreController
{
    /** Uppercase letters and digits in hyphen-separated groups (SET-01); 20 characters at most. */
    private const STORE_CODE_PATTERN = '/^[A-Z0-9]+(-[A-Z0-9]+)*$/';

    /**
     * List stores (server-side paginated, searchable, sortable, exportable).
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = Store::query();

        // Tenant scope: regular users only see allowed stores
        if (!$user->isSuperAdmin()) {
            $allowed = $user->allowed_store_ids ?? [];
            if ($user->store_id) {
                $allowed[] = $user->store_id;
            }
            $query->whereIn('id', array_unique($allowed));
        }

        // Search
        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('code', 'like', "%{$search}%")
                  ->orWhere('gstin', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }

        // Filter by status
        if ($request->has('is_active') && $request->query('is_active') !== '') {
            $query->where('is_active', filter_var($request->query('is_active'), FILTER_VALIDATE_BOOLEAN));
        }

        // Sorting
        $sortBy = $request->query('sort_by', 'id');
        $sortDir = $request->query('sort_dir', 'desc');
        $query->orderBy($sortBy, $sortDir);

        if ($request->query('export') === 'true') {
            return response()->json(['data' => $query->get()]);
        }

        $perPage = min(100, (int)$request->query('per_page', 15));
        return response()->json($query->paginate($perPage));
    }

    /**
     * Create new store.
     */
    public function store(Request $request): JsonResponse
    {
        $this->normalizeStoreCode($request);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'code' => ['required', 'string', 'max:20', 'regex:' . self::STORE_CODE_PATTERN, 'unique:stores,code'],
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'address' => 'nullable|string',
            'state_code' => ['required', 'string', Rule::in(GstStateCodes::all())],
            'gstin' => 'nullable|string|max:20',
            'drug_license_numbers' => 'nullable|array',
            'fssai_no' => 'nullable|string|max:50',
            'timezone' => 'nullable|string|max:64',
            'tax_mode' => 'nullable|in:inclusive,exclusive',
            'store_type' => 'nullable|string|in:pharmacy,cosmetics,kirana_general,clothing,electronics,stationery,wholesale,restaurant,other',
            'gst_type' => 'nullable|string|in:regular,composition,no_tax',
            'invoice_prefix' => 'nullable|string|max:20',
            'license_plan' => 'nullable|string',
            'license_expires_at' => 'nullable|date',
            'enabled_menu_items' => 'nullable|array',
            'feature_flags' => 'nullable|array',
        ]);

        $this->assertGstinMatchesState($validated['gstin'] ?? null, $validated['state_code']);

        $defaultMenus = ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings'];
        $validated['enabled_menu_items'] = $validated['enabled_menu_items'] ?? $defaultMenus;
        $validated['is_active'] = true;
        $validated['version'] = 1;

        $store = Store::create($validated);
        app(\App\Services\Masters\UnitDefaultsService::class)->seedDefaultsForStore($store->id);
        app(\App\Services\Masters\ChargeHeadDefaultsService::class)->seedDefaultsForStore($store->id);

        // CNT-013: a new store is not issued a key. Codes are minted per counter.
        AuditLog::log('create_store', 'Store', (string)$store->id, null, $store->toArray(), $store->id);

        return response()->json($store, 201);
    }

    /**
     * Get store details.
     */
    public function show(string $id): JsonResponse
    {
        $store = Store::withCount(['users', 'devices', 'products', 'invoices'])->findOrFail($id);
        return response()->json($store);
    }

    /**
     * Update store with optimistic locking.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $store = Store::findOrFail($id);

        // Optimistic locking check
        if ($request->has('version') && (int)$request->input('version') !== (int)$store->version) {
            return response()->json([
                'message' => 'Conflict detected: this store was updated by another session or offline sync. Please refresh.',
                'current_version' => $store->version,
                'client_version' => $request->input('version'),
            ], 409);
        }

        $this->normalizeStoreCode($request, $store->code);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'code' => ['sometimes', 'required', 'string', 'max:20', 'regex:' . self::STORE_CODE_PATTERN, Rule::unique('stores', 'code')->ignore($store->id)],
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'address' => 'nullable|string',
            'state_code' => ['sometimes', 'required', 'string', Rule::in(GstStateCodes::all())],
            'gstin' => 'nullable|string|max:20',
            'drug_license_numbers' => 'nullable|array',
            'fssai_no' => 'nullable|string|max:50',
            'timezone' => 'nullable|string|max:64',
            'tax_mode' => 'nullable|in:inclusive,exclusive',
            'store_type' => 'nullable|string|in:pharmacy,cosmetics,kirana_general,clothing,electronics,stationery,wholesale,restaurant,other',
            'gst_type' => 'nullable|string|in:regular,composition,no_tax',
            'invoice_prefix' => 'nullable|string|max:20',
            'license_plan' => 'nullable|string',
            'license_expires_at' => 'nullable|date',
            'enabled_menu_items' => 'nullable|array',
            'feature_flags' => 'nullable|array',
        ]);

        $this->assertGstinMatchesState(
            array_key_exists('gstin', $validated) ? $validated['gstin'] : $store->gstin,
            array_key_exists('state_code', $validated) ? $validated['state_code'] : $store->state_code,
        );

        $oldValues = $store->toArray();
        $validated['version'] = $store->version + 1;

        $store->update($validated);

        AuditLog::log('update_store', 'Store', (string)$store->id, $oldValues, $store->toArray(), $store->id);

        return response()->json($store);
    }

    /**
     * Enable or disable a store (triggers "store disabled" in desktop app).
     */
    public function toggleStatus(Request $request, string $id): JsonResponse
    {
        $store = Store::findOrFail($id);
        $request->validate(['reason' => 'required|string']);

        $newStatus = !$store->is_active;
        $store->update([
            'is_active' => $newStatus,
            'version' => $store->version + 1,
        ]);

        AuditLog::log(
            $newStatus ? 'enable_store' : 'disable_store',
            'Store',
            (string)$store->id,
            ['is_active' => !$newStatus],
            ['is_active' => $newStatus, 'reason' => $request->input('reason')],
            $store->id
        );

        // Record real-time SyncEvent for desktop terminals and counters
        SyncEvent::create([
            'store_id' => $store->id,
            'entity_type' => 'store_status',
            'entity_id' => (string)$store->id,
            'action' => $newStatus ? 'enabled' : 'disabled',
            'client_data' => [
                'store_id' => $store->id,
                'is_active' => $newStatus,
                'store_version' => $store->version,
                'reason' => $request->input('reason'),
                'updated_at' => now()->toIso8601String(),
            ],
        ]);

        return response()->json([
            'success' => true,
            'store_id' => $store->id,
            'is_active' => $store->is_active,
            'message' => $newStatus ? 'Store enabled successfully.' : 'Store disabled. Connected POS desktop apps will show "Store disabled" upon sync.',
        ]);
    }

    /**
     * Remote store data reset (destructive action).
     * Requires exact confirmation phrase and mandatory reason.
     */
    public function resetStore(Request $request, string $id): JsonResponse
    {
        $store = Store::findOrFail($id);

        $expectedPhrase = 'RESET STORE ' . strtoupper($store->name);

        $request->validate([
            'confirmation_phrase' => 'required|string',
            'reason' => 'required|string|min:5',
        ]);

        if (trim($request->input('confirmation_phrase')) !== $expectedPhrase) {
            return response()->json([
                'message' => "Confirmation phrase mismatch. You must type exactly: '{$expectedPhrase}'",
            ], 422);
        }

        $options = $request->input('options', [
            'reset_invoices' => true,
            'reset_stock' => true,
            'reset_products' => false,
            'reset_purchases' => true,
            'reset_customers' => true,
            'reset_expenses' => true,
            'reset_held_bills' => true,
        ]);

        $resetInvoices = !empty($options['reset_invoices']);
        $resetStock = !empty($options['reset_stock']);
        $resetProducts = !empty($options['reset_products']);
        $resetPurchases = !empty($options['reset_purchases']);
        $resetCustomers = !empty($options['reset_customers']);
        $resetExpenses = !empty($options['reset_expenses']);
        $resetHeldBills = !empty($options['reset_held_bills']);

        DB::beginTransaction();
        try {
            $wipedCounts = [];

            // 1. Reset Invoices & Billing Data
            if ($resetInvoices) {
                $invoiceIds = Invoice::where('store_id', $store->id)->pluck('id');
                InvoiceItem::whereIn('invoice_id', $invoiceIds)->delete();
                InvoicePayment::where('store_id', $store->id)->delete();
                Invoice::where('store_id', $store->id)->delete();
                $wipedCounts['invoices_wiped'] = count($invoiceIds);
            }

            // 2. Reset Purchases & Supplier Invoices
            if ($resetPurchases) {
                $purchaseIds = Purchase::where('store_id', $store->id)->pluck('id');
                PurchaseItem::whereIn('purchase_id', $purchaseIds)->delete();
                Purchase::where('store_id', $store->id)->delete();
                $wipedCounts['purchases_wiped'] = count($purchaseIds);
            }

            // 3. Reset Stock & Inventory Ledgers
            if ($resetStock) {
                $transferIds = StockTransfer::where('source_store_id', $store->id)->orWhere('destination_store_id', $store->id)->pluck('id');
                StockTransferItem::whereIn('stock_transfer_id', $transferIds)->delete();
                StockTransfer::whereIn('id', $transferIds)->delete();

                $adjustmentsCount = StockAdjustment::where('store_id', $store->id)->delete();
                $ledgerCount = StockLedgerEntry::where('store_id', $store->id)->delete();

                // Reset batch quantities to zero for this store (wiping negative oversold deficits)
                ProductBatch::where('store_id', $store->id)->update(['stock_qty' => 0]);
                // If single-store or shared batches, also reset
                if (Store::count() === 1) {
                    ProductBatch::query()->update(['stock_qty' => 0]);
                    Product::query()->update(['current_stock' => 0]);
                } else {
                    Product::where('store_id', $store->id)->update(['current_stock' => 0]);
                }
                $wipedCounts['stock_reset'] = true;
                $wipedCounts['adjustments_wiped'] = $adjustmentsCount;
            }

            // 3b. Reset / Wipe Product & Batch Catalog
            if ($resetProducts) {
                $batchesCount = ProductBatch::where('store_id', $store->id)->delete();
                $prodsCount = Product::where('store_id', $store->id)->delete();
                $wipedCounts['products_wiped'] = $prodsCount;
                $wipedCounts['batches_wiped'] = $batchesCount;
            }

            // 4. Reset Parties (customers, suppliers, doctors, patients), balances & payments
            if ($resetCustomers) {
                $paymentsCount = CustomerPayment::where('store_id', $store->id)->delete();
                SupplierPayment::where('store_id', $store->id)->delete();
                $partiesCount = Party::where('store_id', $store->id)->delete();
                $wipedCounts['customer_payments_wiped'] = $paymentsCount;
                $wipedCounts['parties_wiped'] = $partiesCount;
            }

            // 5. Reset Operational Expenses
            if ($resetExpenses) {
                $expensesCount = Expense::where('store_id', $store->id)->delete();
                $wipedCounts['expenses_wiped'] = $expensesCount;
            }

            // 6. Reset Parked / Held Bills
            if ($resetHeldBills) {
                $heldCount = HeldBill::where('store_id', $store->id)->delete();
                $wipedCounts['held_bills_wiped'] = $heldCount;
            }

            // Increment store version
            $store->increment('version');

            AuditLog::log(
                'remote_store_reset',
                'Store',
                (string)$store->id,
                $wipedCounts,
                [
                    'reason' => $request->input('reason'),
                    'phrase' => $expectedPhrase,
                    'options' => $options,
                ],
                $store->id
            );

            // Record remote store reset SyncEvent so connected desktop apps clear local data
            SyncEvent::create([
                'store_id' => $store->id,
                'entity_type' => 'store_reset',
                'entity_id' => (string)$store->id,
                'action' => 'remote_reset',
                'client_data' => [
                    'store_id' => $store->id,
                    'store_version' => $store->version,
                    'reason' => $request->input('reason'),
                    'options' => $options,
                    'reset_stock' => $resetStock,
                    'reset_invoices' => $resetInvoices,
                    'reset_purchases' => $resetPurchases,
                    'reset_customers' => $resetCustomers,
                    'reset_expenses' => $resetExpenses,
                    'reset_held_bills' => $resetHeldBills,
                    'reset_at' => now()->toIso8601String(),
                ],
            ]);

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => "Store '{$store->name}' selected data has been successfully reset.",
                'wiped_modules' => $wipedCounts,
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            return response()->json(['message' => 'Failed to reset store: ' . $e->getMessage()], 500);
        }
    }

    /**
     * SET-01: trims and uppercases the store code before validation. On an
     * update, a code sent back unchanged is dropped, so a store saved under an
     * older, looser rule can still be edited; only a new code must meet the rule.
     */
    private function normalizeStoreCode(Request $request, ?string $currentCode = null): void
    {
        if (!$request->has('code') || !is_string($request->input('code'))) {
            return;
        }

        $raw = trim($request->input('code'));

        if ($currentCode !== null && $raw === $currentCode) {
            $request->offsetUnset('code');
            return;
        }

        $request->merge(['code' => strtoupper($raw)]);
    }

    /**
     * A store's state decides CGST+SGST vs IGST, so it must be a real GST code
     * and must agree with the GSTIN's own prefix.
     */
    private function assertGstinMatchesState(?string $gstin, ?string $stateCode): void
    {
        $gstin = $gstin === null ? null : trim($gstin);
        if ($gstin === '') {
            $gstin = null;
        }

        if ($gstin !== null && !GstStateCodes::isValidGstin($gstin)) {
            throw ValidationException::withMessages([
                'gstin' => 'Enter a valid 15-character GSTIN or leave it blank.',
            ]);
        }

        $stateCode = GstStateCodes::normalize($stateCode);
        if ($stateCode !== null && !GstStateCodes::isValid($stateCode)) {
            throw ValidationException::withMessages([
                'state_code' => 'Choose a valid GST state code (01-38 or 97).',
            ]);
        }

        if ($gstin !== null && $stateCode !== null) {
            $prefix = GstStateCodes::fromGstin($gstin);
            if ($prefix !== null && $prefix !== $stateCode) {
                throw ValidationException::withMessages([
                    'state_code' => "State code {$stateCode} does not match the GSTIN's state ({$prefix}).",
                ]);
            }
        }
    }
}
