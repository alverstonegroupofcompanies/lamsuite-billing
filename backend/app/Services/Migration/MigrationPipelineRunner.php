<?php

namespace App\Services\Migration;

use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\CustomerPayment;
use App\Models\Expense;
use App\Models\FinancialYear;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\MasterLookup;
use App\Models\MigrationIdMap;
use App\Models\MigrationRun;
use App\Models\MigrationUnresolvedItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Throwable;

class MigrationPipelineRunner
{
    private array $idMapCache = [];

    /**
     * Executes the complete migration pipeline in dependency order.
     * Can run in dry-run mode (transaction rollback) or live mode.
     */
    public function execute(MigrationRun $run, array $sourceData, bool $dryRun = false): array
    {
        $storeId = $run->store_id;
        $runUuid = $run->run_uuid;
        $stats = [
            'store' => 0,
            'lookups' => 0,
            'parties' => 0,
            'users' => 0,
            'products' => 0,
            'batches' => 0,
            'invoices' => 0,
            'purchases' => 0,
            'stock_adjustments' => 0,
            'transfers' => 0,
            'expenses' => 0,
            'payments' => 0,
            'held_bills' => 0,
            'unresolved' => 0,
            'errors' => [],
        ];

        // Preload existing ID maps for idempotency
        $existingMaps = MigrationIdMap::where('store_id', $storeId)->get();
        foreach ($existingMaps as $m) {
            $this->idMapCache[$m->entity_type . ':' . $m->old_id] = $m->new_id;
        }

        DB::beginTransaction();
        try {
            // 1. Store Profile & Company Settings
            $stats['store'] = $this->migrateStoreProfile($storeId, $runUuid, $sourceData);

            // 2. Masters / Lookups
            $stats['lookups'] = $this->migrateLookups($storeId, $runUuid, $sourceData);

            // 3. Parties (Customers, Suppliers, Doctors, Patients)
            $stats['parties'] = $this->migrateParties($storeId, $runUuid, $sourceData);

            // 4. Users & Staff
            $stats['users'] = $this->migrateUsers($storeId, $runUuid, $sourceData);

            // 5. Products Catalog
            $stats['products'] = $this->migrateProducts($storeId, $runUuid, $sourceData);

            // 6. Product Batches & Stock
            $stats['batches'] = $this->migrateBatches($storeId, $runUuid, $sourceData);

            // 7. Sales Invoices
            $stats['invoices'] = $this->migrateInvoices($storeId, $runUuid, $sourceData);

            // 8. Purchases & Debit Notes
            $stats['purchases'] = $this->migratePurchases($storeId, $runUuid, $sourceData);

            // 9. Stock Adjustments & Reconciliations
            $stats['stock_adjustments'] = $this->migrateStockAdjustments($storeId, $runUuid, $sourceData);

            // 10. Stock Transfers
            $stats['transfers'] = $this->migrateStockTransfers($storeId, $runUuid, $sourceData);

            // 11. Expenses
            $stats['expenses'] = $this->migrateExpenses($storeId, $runUuid, $sourceData);

            // 12. Customer Payments & Loan Repayments
            $stats['payments'] = $this->migrateCustomerPayments($storeId, $runUuid, $sourceData);

            // 13. Recovered Held Bills & Drafts
            $stats['held_bills'] = $this->migrateHeldBills($storeId, $runUuid, $sourceData);

            if ($dryRun) {
                DB::rollBack();
                $run->update([
                    'status' => 'completed',
                    'is_dry_run' => true,
                    'progress_stats' => $stats,
                ]);
            } else {
                DB::commit();
                $run->update([
                    'status' => 'completed',
                    'progress_stats' => $stats,
                ]);
            }

            return $stats;
        } catch (Throwable $e) {
            DB::rollBack();
            $run->update([
                'status' => 'failed',
                'error_message' => $e->getMessage() . "\n" . $e->getTraceAsString(),
            ]);
            throw $e;
        }
    }

    private function mapId(int $storeId, string $runUuid, string $entityType, string|int $oldId, string|int $newId, ?string $oldUuid = null): void
    {
        $oldIdStr = (string)$oldId;
        $newIdStr = (string)$newId;
        $key = $entityType . ':' . $oldIdStr;
        $this->idMapCache[$key] = $newIdStr;

        MigrationIdMap::updateOrCreate(
            [
                'store_id' => $storeId,
                'entity_type' => $entityType,
                'old_id' => $oldIdStr,
            ],
            [
                'migration_run_uuid' => $runUuid,
                'new_id' => $newIdStr,
                'old_uuid' => $oldUuid,
            ]
        );
    }

    private function getMappedId(string $entityType, string|int $oldId): ?string
    {
        return $this->idMapCache[$entityType . ':' . (string)$oldId] ?? null;
    }

    private function recordUnresolved(int $storeId, string $runUuid, string $entityType, ?string $oldId, string $reason, array $payload): void
    {
        MigrationUnresolvedItem::create([
            'store_id' => $storeId,
            'migration_run_uuid' => $runUuid,
            'entity_type' => $entityType,
            'old_id' => $oldId,
            'reason' => $reason,
            'raw_payload' => $payload,
        ]);
    }

    // --- Entity Specific Migration Methods ---

    protected function migrateStoreProfile(int $storeId, string $runUuid, array $sourceData): int
    {
        $storeData = $sourceData['store_profile'] ?? $sourceData['stores'][0] ?? null;
        if (!$storeData) return 0;

        $store = Store::find($storeId);
        if (!$store) return 0;

        $store->update([
            'phone' => $storeData['phone'] ?? $store->phone,
            'email' => $storeData['email'] ?? $store->email,
            'address' => $storeData['address'] ?? $store->address,
            'state_code' => $storeData['state_code'] ?? $store->state_code,
            'gstin' => $storeData['gstin'] ?? $store->gstin,
            'fssai_no' => $storeData['fssai_no'] ?? $store->fssai_no,
            'tax_mode' => $storeData['tax_mode'] ?? $store->tax_mode,
            'invoice_prefix' => $storeData['invoice_prefix'] ?? $store->invoice_prefix,
            'drug_license_numbers' => $storeData['drug_license_numbers'] ?? $store->drug_license_numbers,
            'enabled_menu_items' => $storeData['enabled_menu_items'] ?? $store->enabled_menu_items,
        ]);

        // Migrate company settings
        $settings = $sourceData['company_settings'] ?? $sourceData['store_settings'] ?? [];
        foreach ($settings as $setting) {
            $key = $setting['key'] ?? $setting['setting_key'] ?? null;
            if ($key) {
                CompanySetting::updateOrCreate(
                    ['store_id' => $storeId, 'key' => $key],
                    ['value' => $setting['value'] ?? null]
                );
            }
        }

        return 1;
    }

    protected function migrateLookups(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $lookupTypes = [
            'groups' => 'group',
            'brands' => 'brand',
            'units' => 'unit',
            'banks' => 'bank',
            'locations' => 'location',
            'departments' => 'department',
            'designations' => 'designation',
            'discount_schemas' => 'discount_schema',
            'expense_categories' => 'expense_head',
        ];

        foreach ($lookupTypes as $sourceKey => $targetType) {
            $items = $sourceData[$sourceKey] ?? [];
            foreach ($items as $item) {
                $oldId = $item['id'] ?? $item['code'] ?? null;
                $name = trim((string)($item['name'] ?? $item['title'] ?? ''));
                if (!$name || !$oldId) continue;

                $existingId = $this->getMappedId($targetType, $oldId);
                $lookup = $existingId ? MasterLookup::find($existingId) : null;

                if (!$lookup) {
                    $lookup = MasterLookup::create([
                        'store_id' => $storeId,
                        'type' => $targetType,
                        'code' => $item['code'] ?? null,
                        'name' => $name,
                        'description' => $item['description'] ?? null,
                        'config' => [
                            'units_per_pack' => $item['units_per_pack'] ?? null,
                            'rate' => $item['rate'] ?? null,
                            'discount_percent' => $item['discount_percent'] ?? null,
                        ],
                        'is_active' => (bool)($item['is_active'] ?? true),
                    ]);
                } else {
                    $lookup->update([
                        'name' => $name,
                        'description' => $item['description'] ?? $lookup->description,
                        'is_active' => (bool)($item['is_active'] ?? true),
                    ]);
                }

                $this->mapId($storeId, $runUuid, $targetType, $oldId, $lookup->id);
                $count++;
            }
        }

        return $count;
    }

    protected function migrateParties(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $partyMaps = [
            'customers' => 'customer',
            'suppliers' => 'supplier',
            'doctors' => 'doctor',
            'patients' => 'patient',
        ];

        foreach ($partyMaps as $sourceKey => $partyType) {
            $items = $sourceData[$sourceKey] ?? [];
            foreach ($items as $item) {
                $oldId = $item['id'] ?? null;
                $name = trim((string)($item['name'] ?? ''));
                if (!$name || !$oldId) continue;

                $existingId = $this->getMappedId($partyType, $oldId);
                $party = $existingId ? Party::find($existingId) : null;

                $data = [
                    'store_id' => $storeId,
                    'type' => $partyType,
                    'name' => $name,
                    'phone' => $item['phone'] ?? $item['mobile'] ?? null,
                    'email' => $item['email'] ?? null,
                    'gstin' => $item['gstin'] ?? null,
                    'pan' => $item['pan'] ?? null,
                    'address' => $item['address'] ?? null,
                    'state_code' => $item['state_code'] ?? '32',
                    'credit_limit' => (float)($item['credit_limit'] ?? 0),
                    'opening_balance' => (float)($item['opening_balance'] ?? 0),
                    'current_balance' => (float)($item['current_balance'] ?? $item['balance'] ?? 0),
                    'reg_no' => $item['reg_no'] ?? $item['doctor_reg_no'] ?? $item['mrn'] ?? null,
                    'is_active' => (bool)($item['is_active'] ?? true),
                    'external_id' => (string)($item['external_id'] ?? $oldId),
                ];

                if (!$party) {
                    $party = Party::create($data);
                } else {
                    $party->update($data);
                }

                $this->mapId($storeId, $runUuid, $partyType, $oldId, $party->id, $item['external_id'] ?? null);
                $count++;
            }
        }

        return $count;
    }

    protected function migrateUsers(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $users = $sourceData['users'] ?? $sourceData['billing_app_users'] ?? [];

        foreach ($users as $u) {
            $oldId = $u['id'] ?? null;
            $email = trim((string)($u['email'] ?? ''));
            if (!$email || !$oldId) continue;

            $role = match ($u['role'] ?? 'manager') {
                'store_admin', 'admin', 'owner' => 'store_owner',
                'accountant' => 'accountant',
                'super_admin' => 'super_admin',
                default => 'manager',
            };

            // Password hash preservation: if bcrypt or argon hash, reuse; else dummy secure hash
            $passwordHash = $u['password'] ?? '';
            if (!str_starts_with($passwordHash, '$2y$') && !str_starts_with($passwordHash, '$argon2')) {
                $passwordHash = Hash::make(Str::random(32));
            }

            $user = User::firstOrNew(['email' => $email]);
            $user->store_id = $storeId;
            $user->name = $u['name'] ?? 'Staff';
            $user->role = $role;
            $user->permissions = $u['permissions'] ?? null;
            $user->setRawAttributes(array_merge($user->getAttributes(), ['password' => $passwordHash]));
            $user->save();

            $this->mapId($storeId, $runUuid, 'user', $oldId, $user->id);
            $count++;
        }

        return $count;
    }

    protected function migrateProducts(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $products = $sourceData['products'] ?? [];

        foreach ($products as $p) {
            $oldId = $p['id'] ?? null;
            $name = trim((string)($p['name'] ?? ''));
            if (!$name || !$oldId) continue;

            $existingId = $this->getMappedId('product', $oldId);
            $product = $existingId ? Product::find($existingId) : null;

            $categoryId = isset($p['category_id']) ? $this->getMappedId('group', $p['category_id']) : null;
            $brandId = isset($p['brand_id']) ? $this->getMappedId('brand', $p['brand_id']) : null;
            $unitId = isset($p['unit_id']) ? $this->getMappedId('unit', $p['unit_id']) : null;

            $data = [
                'store_id' => $storeId,
                'barcode' => $p['barcode'] ?? null,
                'name' => $name,
                'print_name' => $p['print_name'] ?? $name,
                'generic_name' => $p['generic_name'] ?? null,
                'hsn_sac_code' => $p['hsn_sac_code'] ?? $p['hsn_code'] ?? null,
                'category_id' => $categoryId,
                'brand_id' => $brandId,
                'unit_id' => $unitId,
                'mrp' => (float)($p['mrp'] ?? 0),
                'sel_rate' => (float)($p['sel_rate'] ?? $p['selling_price'] ?? 0),
                'ptr' => (float)($p['ptr'] ?? 0),
                'pts' => (float)($p['pts'] ?? 0),
                'gst_percent' => (float)($p['gst_percent'] ?? 0),
                'units_per_pack' => (int)($p['units_per_pack'] ?? 1),
                'rack_location' => $p['rack_location'] ?? null,
                'shelf_location' => $p['shelf_location'] ?? null,
                'reorder_level' => (float)($p['reorder_level'] ?? 10),
                'current_stock' => (float)($p['current_stock'] ?? 0),
                'is_active' => (bool)($p['is_active'] ?? true),
                'external_id' => (string)($p['external_id'] ?? $oldId),
            ];

            if (!$product) {
                $product = Product::create($data);
            } else {
                $product->update($data);
            }

            $this->mapId($storeId, $runUuid, 'product', $oldId, $product->id, $p['external_id'] ?? null);
            $count++;
        }

        return $count;
    }

    protected function migrateBatches(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $batches = $sourceData['product_batches'] ?? [];

        // Check if batches are embedded in products
        if (empty($batches) && !empty($sourceData['products'])) {
            foreach ($sourceData['products'] as $p) {
                if (!empty($p['batches']) && is_array($p['batches'])) {
                    foreach ($p['batches'] as $b) {
                        $b['product_id'] = $p['id'];
                        $batches[] = $b;
                    }
                }
            }
        }

        foreach ($batches as $b) {
            $oldId = $b['id'] ?? null;
            $oldProductId = $b['product_id'] ?? null;
            $batchNo = trim((string)($b['batch_no'] ?? 'DEFAULT'));

            $newProductId = $oldProductId ? $this->getMappedId('product', $oldProductId) : null;
            if (!$newProductId) {
                $this->recordUnresolved($storeId, $runUuid, 'batch', (string)$oldId, "Parent product ID {$oldProductId} not found", $b);
                continue;
            }

            $stockQty = (float)($b['stock_qty'] ?? $b['quantity'] ?? 0);
            $expiryDate = !empty($b['expiry_date']) ? date('Y-m-d', strtotime($b['expiry_date'])) : date('Y-m-d', strtotime('+2 years'));

            $existingId = $oldId ? $this->getMappedId('batch', $oldId) : null;
            $batch = $existingId ? ProductBatch::find($existingId) : null;

            $data = [
                'store_id' => $storeId,
                'product_id' => (int)$newProductId,
                'batch_no' => $batchNo,
                'mfg_date' => !empty($b['mfg_date']) ? date('Y-m-d', strtotime($b['mfg_date'])) : null,
                'expiry_date' => $expiryDate,
                'stock_qty' => $stockQty,
                'mrp' => (float)($b['mrp'] ?? 0),
                'purchase_rate' => (float)($b['purchase_rate'] ?? $b['cost_price'] ?? 0),
                'selling_rate' => (float)($b['selling_rate'] ?? $b['selling_price'] ?? 0),
                'rack_location' => $b['rack_location'] ?? null,
                'shelf_location' => $b['shelf_location'] ?? null,
                'external_id' => (string)($b['external_id'] ?? $oldId),
            ];

            if (!$batch) {
                $batch = ProductBatch::create($data);
            } else {
                $batch->update($data);
            }

            if ($oldId) {
                $this->mapId($storeId, $runUuid, 'batch', $oldId, $batch->id, $b['external_id'] ?? null);
            }

            // Flag negative opening stock via stock_adjustments for ledger trace
            if ($stockQty < 0) {
                StockAdjustment::create([
                    'store_id' => $storeId,
                    'product_id' => (int)$newProductId,
                    'batch_no' => $batchNo,
                    'adjustment_type' => 'decrease',
                    'qty' => abs($stockQty),
                    'reason' => 'MIGRATION_NEGATIVE_OPENING_RECONCILED: Batch opened with negative balance',
                ]);
            }

            $count++;
        }

        // Recompute current_stock on products from batches
        Product::where('store_id', $storeId)->each(function ($p) {
            $totalStock = ProductBatch::where('product_id', $p->id)->sum('stock_qty');
            if ($totalStock > 0) {
                $p->update(['current_stock' => $totalStock]);
            }
        });

        return $count;
    }

    protected function migrateInvoices(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $invoices = $sourceData['invoices'] ?? [];

        foreach ($invoices as $inv) {
            $oldId = $inv['id'] ?? null;
            $invoiceNumber = trim((string)($inv['invoice_number'] ?? $inv['bill_number'] ?? ''));
            if (!$invoiceNumber || !$oldId) continue;

            $oldCustId = $inv['customer_id'] ?? null;
            $newCustId = $oldCustId ? $this->getMappedId('customer', $oldCustId) : null;

            $existingId = $this->getMappedId('invoice', $oldId);
            $invoice = $existingId ? Invoice::find($existingId) : null;

            $invoiceDate = !empty($inv['invoice_date']) ? date('Y-m-d', strtotime($inv['invoice_date'])) : date('Y-m-d');
            $status = match (strtolower((string)($inv['status'] ?? 'issued'))) {
                'cancelled', 'canceled' => 'cancelled',
                'draft' => 'draft',
                default => 'issued',
            };

            $data = [
                'store_id' => $storeId,
                'customer_id' => $newCustId ? (int)$newCustId : null,
                'invoice_number' => $invoiceNumber,
                'invoice_date' => $invoiceDate,
                'customer_name' => $inv['customer_name'] ?? ($inv['customer']['name'] ?? 'Walk-in Customer'),
                'customer_phone' => $inv['customer_phone'] ?? ($inv['customer']['phone'] ?? null),
                'customer_gstin' => $inv['customer_gstin'] ?? ($inv['customer']['gstin'] ?? null),
                'place_of_supply' => $inv['place_of_supply'] ?? '32',
                'subtotal' => (float)($inv['subtotal'] ?? 0),
                'discount_total' => (float)($inv['discount_total'] ?? $inv['discount_amount'] ?? 0),
                'tax_total' => (float)($inv['tax_total'] ?? $inv['tax_amount'] ?? 0),
                'round_off' => (float)($inv['round_off'] ?? 0),
                'grand_total' => (float)($inv['grand_total'] ?? $inv['total'] ?? 0),
                'paid_amount' => (float)($inv['paid_amount'] ?? $inv['grand_total'] ?? 0),
                'payment_mode' => $inv['payment_mode'] ?? 'Cash',
                'status' => $status,
                'cancel_reason' => $inv['cancel_reason'] ?? null,
                'cancelled_at' => !empty($inv['cancelled_at']) ? date('Y-m-d H:i:s', strtotime($inv['cancelled_at'])) : null,
                'patient_name' => $inv['patient_name'] ?? null,
                'doctor_name' => $inv['doctor_name'] ?? null,
                'doctor_reg_no' => $inv['doctor_reg_no'] ?? null,
                'external_id' => (string)($inv['external_id'] ?? $oldId),
            ];

            if (!$invoice) {
                $invoice = Invoice::create($data);
            } else {
                $invoice->update($data);
            }

            $this->mapId($storeId, $runUuid, 'invoice', $oldId, $invoice->id, $inv['external_id'] ?? null);

            // Invoice items
            $items = $inv['items'] ?? [];
            if (!empty($items)) {
                InvoiceItem::where('invoice_id', $invoice->id)->delete();
                foreach ($items as $item) {
                    $oldPId = $item['product_id'] ?? null;
                    $newPId = $oldPId ? $this->getMappedId('product', $oldPId) : null;

                    InvoiceItem::create([
                        'invoice_id' => $invoice->id,
                        'product_id' => $newPId ? (int)$newPId : null,
                        'product_name' => $item['product_name'] ?? $item['name'] ?? 'Item',
                        'batch_no' => $item['batch_no'] ?? null,
                        'expiry_date' => !empty($item['expiry_date']) ? date('Y-m-d', strtotime($item['expiry_date'])) : null,
                        'qty' => (float)($item['qty'] ?? 1),
                        'unit_price' => (float)($item['unit_price'] ?? $item['rate'] ?? 0),
                        'discount_percent' => (float)($item['discount_percent'] ?? 0),
                        'discount_amount' => (float)($item['discount_amount'] ?? 0),
                        'gst_percent' => (float)($item['gst_percent'] ?? 0),
                        'tax_amount' => (float)($item['tax_amount'] ?? 0),
                        'total_amount' => (float)($item['total_amount'] ?? 0),
                    ]);
                }
            }

            $count++;
        }

        return $count;
    }

    protected function migratePurchases(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $purchases = $sourceData['purchases'] ?? $sourceData['purchase_documents'] ?? [];

        foreach ($purchases as $p) {
            $oldId = $p['id'] ?? null;
            $invoiceNumber = trim((string)($p['invoice_number'] ?? $p['bill_number'] ?? ''));
            if (!$invoiceNumber || !$oldId) continue;

            $oldSuppId = $p['supplier_id'] ?? null;
            $newSuppId = $oldSuppId ? $this->getMappedId('supplier', $oldSuppId) : null;

            $existingId = $this->getMappedId('purchase', $oldId);
            $purchase = $existingId ? Purchase::find($existingId) : null;

            $data = [
                'store_id' => $storeId,
                'supplier_id' => $newSuppId ? (int)$newSuppId : null,
                'supplier_name' => $p['supplier_name'] ?? ($p['supplier']['name'] ?? 'Supplier'),
                'supplier_gstin' => $p['supplier_gstin'] ?? ($p['supplier']['gstin'] ?? null),
                'invoice_number' => $invoiceNumber,
                'invoice_date' => !empty($p['invoice_date']) ? date('Y-m-d', strtotime($p['invoice_date'])) : date('Y-m-d'),
                'module_key' => $p['module_key'] ?? 'purchase',
                'subtotal' => (float)($p['subtotal'] ?? 0),
                'tax_total' => (float)($p['tax_total'] ?? $p['tax_amount'] ?? 0),
                'round_off' => (float)($p['round_off'] ?? 0),
                'grand_total' => (float)($p['grand_total'] ?? $p['total'] ?? 0),
                'paid_amount' => (float)($p['paid_amount'] ?? 0),
                'status' => $p['status'] ?? 'received',
                'cancel_reason' => $p['cancel_reason'] ?? null,
            ];

            if (!$purchase) {
                $purchase = Purchase::create($data);
            } else {
                $purchase->update($data);
            }

            $this->mapId($storeId, $runUuid, 'purchase', $oldId, $purchase->id);

            // Purchase items
            $items = $p['items'] ?? [];
            if (!empty($items)) {
                PurchaseItem::where('purchase_id', $purchase->id)->delete();
                foreach ($items as $item) {
                    $oldPId = $item['product_id'] ?? null;
                    $newPId = $oldPId ? $this->getMappedId('product', $oldPId) : null;

                    PurchaseItem::create([
                        'purchase_id' => $purchase->id,
                        'product_id' => $newPId ? (int)$newPId : null,
                        'product_name' => $item['product_name'] ?? $item['name'] ?? 'Item',
                        'batch_no' => $item['batch_no'] ?? 'DEFAULT',
                        'expiry_date' => !empty($item['expiry_date']) ? date('Y-m-d', strtotime($item['expiry_date'])) : date('Y-m-d', strtotime('+2 years')),
                        'qty' => (float)($item['qty'] ?? 1),
                        'purchase_rate' => (float)($item['purchase_rate'] ?? $item['rate'] ?? 0),
                        'mrp' => (float)($item['mrp'] ?? 0),
                        'gst_percent' => (float)($item['gst_percent'] ?? 0),
                        'tax_amount' => (float)($item['tax_amount'] ?? 0),
                        'total_amount' => (float)($item['total_amount'] ?? 0),
                    ]);
                }
            }

            $count++;
        }

        return $count;
    }

    protected function migrateStockAdjustments(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $adjustments = $sourceData['stock_adjustments'] ?? [];

        foreach ($adjustments as $adj) {
            $oldId = $adj['id'] ?? null;
            $oldPId = $adj['product_id'] ?? null;
            $newPId = $oldPId ? $this->getMappedId('product', $oldPId) : null;
            if (!$newPId) continue;

            $record = StockAdjustment::create([
                'store_id' => $storeId,
                'product_id' => (int)$newPId,
                'batch_no' => $adj['batch_no'] ?? null,
                'adjustment_type' => $adj['adjustment_type'] ?? 'audit',
                'qty' => (float)($adj['qty'] ?? $adj['quantity'] ?? 0),
                'reason' => $adj['reason'] ?? 'Migration stock adjustment',
            ]);

            if ($oldId) {
                $this->mapId($storeId, $runUuid, 'stock_adj', $oldId, $record->id);
            }
            $count++;
        }

        return $count;
    }

    protected function migrateStockTransfers(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $transfers = $sourceData['stock_transfers'] ?? [];

        foreach ($transfers as $tr) {
            $transferNo = $tr['transfer_number'] ?? 'TR-' . Str::random(6);
            $record = StockTransfer::create([
                'from_store_id' => $storeId,
                'to_store_id' => $storeId, // If single store migrated, points to self
                'transfer_number' => $transferNo,
                'status' => $tr['status'] ?? 'received',
                'notes' => $tr['notes'] ?? 'Migrated transfer',
            ]);

            if (!empty($tr['items'])) {
                foreach ($tr['items'] as $item) {
                    $oldPId = $item['product_id'] ?? null;
                    $newPId = $oldPId ? $this->getMappedId('product', $oldPId) : null;
                    if ($newPId) {
                        StockTransferItem::create([
                            'stock_transfer_id' => $record->id,
                            'product_id' => (int)$newPId,
                            'batch_no' => $item['batch_no'] ?? 'DEFAULT',
                            'qty' => (float)($item['qty'] ?? 1),
                        ]);
                    }
                }
            }
            $count++;
        }

        return $count;
    }

    protected function migrateExpenses(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $expenses = $sourceData['expenses'] ?? $sourceData['expense_documents'] ?? [];

        foreach ($expenses as $e) {
            $amount = (float)($e['amount'] ?? $e['total_amount'] ?? 0);
            if ($amount <= 0) continue;

            $record = Expense::create([
                'store_id' => $storeId,
                'expense_head' => $e['expense_head'] ?? ($e['category']['name'] ?? 'General Expense'),
                'amount' => $amount,
                'payment_mode' => $e['payment_mode'] ?? 'Cash',
                'reference_no' => $e['reference_no'] ?? $e['voucher_no'] ?? null,
                'notes' => $e['notes'] ?? $e['description'] ?? null,
                'expense_date' => !empty($e['expense_date']) ? date('Y-m-d', strtotime($e['expense_date'])) : date('Y-m-d'),
            ]);

            if (isset($e['id'])) {
                $this->mapId($storeId, $runUuid, 'expense', $e['id'], $record->id);
            }
            $count++;
        }

        return $count;
    }

    protected function migrateCustomerPayments(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $payments = $sourceData['customer_payments'] ?? $sourceData['customer_loans'] ?? [];

        foreach ($payments as $p) {
            $amount = (float)($p['amount'] ?? 0);
            if ($amount <= 0) continue;

            $oldCustId = $p['customer_id'] ?? null;
            $newCustId = $oldCustId ? $this->getMappedId('customer', $oldCustId) : null;
            if (!$newCustId) continue;

            $record = CustomerPayment::create([
                'store_id' => $storeId,
                'customer_id' => (int)$newCustId,
                'amount' => $amount,
                'payment_mode' => $p['payment_mode'] ?? 'Cash',
                'reference_no' => $p['reference_no'] ?? null,
                'notes' => $p['notes'] ?? 'Migrated customer payment',
                'payment_date' => !empty($p['payment_date']) ? date('Y-m-d', strtotime($p['payment_date'])) : date('Y-m-d'),
            ]);

            if (isset($p['id'])) {
                $this->mapId($storeId, $runUuid, 'payment', $p['id'], $record->id);
            }
            $count++;
        }

        return $count;
    }

    protected function migrateHeldBills(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $heldBills = $sourceData['device_holds'] ?? [];

        foreach ($heldBills as $hold) {
            $payload = $hold['payload'] ?? $hold;
            $items = $payload['items'] ?? [];
            if (empty($items)) continue;

            $invNumber = 'DRAFT-' . Str::upper(Str::random(6));
            $subtotal = 0;
            foreach ($items as $item) {
                $subtotal += ((float)($item['qty'] ?? 1)) * ((float)($item['rate'] ?? $item['unitPrice'] ?? 0));
            }

            $invoice = Invoice::create([
                'store_id' => $storeId,
                'invoice_number' => $invNumber,
                'invoice_date' => date('Y-m-d'),
                'customer_name' => $payload['customerName'] ?? 'Walk-in Customer',
                'subtotal' => $subtotal,
                'grand_total' => $subtotal,
                'paid_amount' => 0,
                'payment_mode' => 'Cash',
                'status' => 'draft',
                'cancel_reason' => 'Migrated from device held bill: ' . ($hold['label'] ?? 'Held POS Basket'),
            ]);

            foreach ($items as $item) {
                InvoiceItem::create([
                    'invoice_id' => $invoice->id,
                    'product_name' => $item['name'] ?? $item['description'] ?? 'Item',
                    'qty' => (float)($item['qty'] ?? 1),
                    'unit_price' => (float)($item['rate'] ?? $item['unitPrice'] ?? 0),
                    'total_amount' => ((float)($item['qty'] ?? 1)) * ((float)($item['rate'] ?? $item['unitPrice'] ?? 0)),
                ]);
            }

            $this->mapId($storeId, $runUuid, 'invoice', $hold['id'] ?? $invNumber, $invoice->id);
            $count++;
        }

        return $count;
    }
}
