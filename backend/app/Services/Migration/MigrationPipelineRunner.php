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
use App\Services\Gst\PartyStateResolver;
use App\Services\Tax\StoreTaxPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Throwable;

class MigrationPipelineRunner
{
    private array $idMapCache = [];

    /** Per-run tallies of what the normalizer had to work around, reported with the stats. */
    private array $documentStats = [
        'credit_notes' => 0,
        'debit_notes' => 0,
        'guessed_rates' => 0,
        'unlinked' => 0,
        'renumbered' => 0,
    ];

    private array $productRateCache = [];

    private LegacyRecordNormalizer $normalizer;

    public function __construct(?LegacyRecordNormalizer $normalizer = null)
    {
        $this->normalizer = $normalizer ?? new LegacyRecordNormalizer();
    }

    /**
     * The sale-side documents in a source, credit bills folded in. The merge itself lives in
     * the normalizer so the reconciliation totals cannot disagree with the rows that were
     * imported; this wrapper only arranges for a discarded duplicate to become a review item.
     *
     * @return array<int, array{0: array, 1: bool}>
     */
    private function saleDocuments(int $storeId, string $runUuid, array $sourceData): array
    {
        return $this->normalizer->saleDocuments(
            $sourceData,
            fn (array $row, string $list) => $this->recordDuplicateDocument($storeId, $runUuid, 'invoice', $row, $list)
        );
    }

    /**
     * @return array<int, array{0: array, 1: bool}>
     */
    private function purchaseDocuments(int $storeId, string $runUuid, array $sourceData): array
    {
        return $this->normalizer->purchaseDocuments(
            $sourceData,
            fn (array $row, string $list) => $this->recordDuplicateDocument($storeId, $runUuid, 'purchase', $row, $list)
        );
    }

    private function recordDuplicateDocument(int $storeId, string $runUuid, string $entityType, array $row, string $list): void
    {
        $this->recordUnresolved($storeId, $runUuid, $entityType, isset($row['id']) ? (string) $row['id'] : null,
            "This document was already imported from another entity list under the same number and total; check the source for duplicated bill numbers. Skipped list: {$list}.",
            $row);
    }

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
            'credit_notes' => 0,
            'purchases' => 0,
            'debit_notes' => 0,
            'guessed_rates' => 0,
            'unlinked' => 0,
            'stock_adjustments' => 0,
            'transfers' => 0,
            'expenses' => 0,
            'payments' => 0,
            'held_bills' => 0,
            'renumbered' => 0,
            'unresolved' => 0,
            'errors' => [],
        ];

        // Preload existing ID maps for idempotency
        $existingMaps = MigrationIdMap::where('store_id', $storeId)->get();
        foreach ($existingMaps as $m) {
            $this->idMapCache[$m->entity_type . ':' . $m->old_id] = $m->new_id;
            if (!empty($m->old_uuid)) {
                $this->idMapCache[$m->entity_type . ':' . $m->old_uuid] = $m->new_id;
            }
        }

        DB::beginTransaction();
        try {
            // 1. Store Profile & Company Settings
            $stats['store'] = $this->migrateStoreProfile($storeId, $runUuid, $sourceData, $run);

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

            // 7. Sales Invoices & Credit Bills
            $this->documentStats = ['credit_notes' => 0, 'debit_notes' => 0, 'guessed_rates' => 0, 'unlinked' => 0, 'renumbered' => 0];
            $stats['invoices'] = $this->migrateInvoices($storeId, $runUuid, $sourceData);

            // 8. Purchases & Debit Notes
            $stats['purchases'] = $this->migratePurchases($storeId, $runUuid, $sourceData);
            // Merge, not `+=`: the zero placeholders above would otherwise swallow the tallies.
            $stats = array_merge($stats, $this->documentStats);

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

        // A legacy bill line names its product by the device-side uuid rather than the panel's
        // row id, so both handles resolve to the row this run imported.
        $uuid = trim((string) $oldUuid);
        if ($uuid !== '' && $uuid !== '0' && $uuid !== $oldIdStr) {
            $this->idMapCache[$entityType . ':' . $uuid] = $newIdStr;
        }

        MigrationIdMap::updateOrCreate(
            [
                'store_id' => $storeId,
                'entity_type' => $entityType,
                'old_id' => $oldIdStr,
            ],
            [
                'migration_run_uuid' => $runUuid,
                'new_id' => $newIdStr,
                'old_uuid' => $uuid !== '' ? $uuid : null,
            ]
        );
    }

    private function getMappedId(string $entityType, string|int $oldId): ?string
    {
        return $this->idMapCache[$entityType . ':' . (string)$oldId] ?? null;
    }

    private function recordUnresolved(int $storeId, string $runUuid, string $entityType, ?string $oldId, string $reason, array $payload): void
    {
        // A run is replayable, so the review list must not grow a second copy of every gap
        // each time the operator retries it.
        MigrationUnresolvedItem::updateOrCreate(
            [
                'store_id' => $storeId,
                'migration_run_uuid' => $runUuid,
                'entity_type' => $entityType,
                'old_id' => $oldId,
                'reason' => $reason,
            ],
            [
                'raw_payload' => $payload,
            ]
        );
    }

    // --- Entity Specific Migration Methods ---

    protected function migrateStoreProfile(int $storeId, string $runUuid, array $sourceData, MigrationRun $run): int
    {
        $store = Store::find($storeId);
        if (!$store) return 0;

        $storeData = $sourceData['store_profile'] ?? $sourceData['stores'][0] ?? null;
        if (!is_array($storeData)) {
            // A bundle of documents alone still carries the pricing answer the operator gave in
            // the wizard, and losing that silently is the one failure a report cannot show.
            $this->carryTaxMode($run, $storeId, $runUuid, $store, [], [], $sourceData);

            return 0;
        }

        // The v1 panel has no equivalent for the v2 feature menu, and a legacy list written
        // over it switched v2-only screens off in the till without an operator touching them.
        $store->update([
            'phone' => $storeData['phone'] ?? $store->phone,
            'email' => $storeData['email'] ?? $store->email,
            'address' => $storeData['address'] ?? $store->address,
            'state_code' => $storeData['state_code'] ?? $store->state_code,
            'gstin' => $storeData['gstin'] ?? $store->gstin,
            'fssai_no' => $storeData['fssai_no'] ?? $store->fssai_no,
            'invoice_prefix' => $storeData['invoice_prefix'] ?? $store->invoice_prefix,
            'drug_license_numbers' => $storeData['drug_license_numbers'] ?? $store->drug_license_numbers,
        ]);

        // Migrate company settings. A v2 bundle lists them as `{key, value}` rows; the legacy
        // panel answers with one flat object, and writing that object's every field over the v2
        // settings would copy v1-only keys (`sync_mode`, `logo_data_url`) into this schema, so
        // the flat shape is read for the billing mode alone and left out of the writes.
        $settings = $sourceData['company_settings'] ?? $sourceData['store_settings'] ?? [];
        $billingFromSource = [];
        foreach ($settings as $setting) {
            if (!is_array($setting)) {
                continue;
            }
            $key = $setting['key'] ?? $setting['setting_key'] ?? null;
            if (!$key) {
                continue;
            }
            $value = $setting['value'] ?? null;
            // The billing section decides how every price is read, so a legacy blob under that
            // name is merged field by field rather than dropped in over the v2 settings.
            if ($key === StoreTaxPolicy::BILLING_KEY || $key === StoreTaxPolicy::LEGACY_KEY) {
                if (is_array($value)) {
                    $billingFromSource = array_merge($billingFromSource, $value);
                }
                continue;
            }
            CompanySetting::updateOrCreate(
                ['store_id' => $storeId, 'key' => $key],
                ['value' => $value]
            );
        }

        $this->carryTaxMode($run, $storeId, $runUuid, $store, $storeData, $billingFromSource, $sourceData);

        return 1;
    }

    /**
     * The one store setting a wrong value cannot be spotted in a report: a shop that bills
     * exclusive and lands on the inclusive default has every price on every bill re-derived,
     * while totals still add up. So the mode is taken from the operator's own choice in the
     * wizard first, then from wherever the source states it, written into the setting the till
     * actually reads, and mirrored onto the store row the way the settings screen does.
     */
    private function carryTaxMode(
        MigrationRun $run,
        int $storeId,
        string $runUuid,
        Store $store,
        array $storeData,
        array $billingFromSource,
        array $sourceData
    ): void {
        $mapping = is_array($run->mapping_config) ? $run->mapping_config : [];
        $chosen = $mapping['tax_mode'] ?? null;
        $chosen = in_array($chosen, StoreTaxPolicy::TAX_MODES, true) ? (string) $chosen : null;

        $mode = $chosen
            ?? $this->normalizer->taxMode($storeData)
            ?? $this->normalizer->settingsTaxMode($billingFromSource)
            ?? $this->normalizer->settingsTaxMode($this->normalizer->settingsFields($sourceData));

        $billing = CompanySetting::where('store_id', $storeId)
            ->where('key', StoreTaxPolicy::BILLING_KEY)
            ->first();
        $current = is_array($billing?->value) ? $billing->value : [];

        if ($mode === null) {
            if ($this->normalizer->taxMode($current) === null) {
                $this->recordUnresolved($storeId, $runUuid, 'tax_mode', (string) $storeId,
                    'Neither the source nor the existing billing settings state whether prices include tax, so the till reads the store default and every migrated price is re-derived against it. Set the billing mode, or re-run with the mode chosen in the migration wizard.',
                    ['store_id' => $storeId]);
            }

            return;
        }

        $current['tax_mode'] = $mode;
        CompanySetting::updateOrCreate(
            ['store_id' => $storeId, 'key' => StoreTaxPolicy::BILLING_KEY],
            ['value' => $current, 'is_secret' => false]
        );
        if ($store->tax_mode !== $mode) {
            $store->update(['tax_mode' => $mode]);
        }
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

                // The uuid is the handle a legacy product row uses to name its group, brand or
                // unit, so a lookup mapped only by its panel id cannot be found from there.
                $this->mapId($storeId, $runUuid, $targetType, $oldId, $lookup->id, $item['external_id'] ?? null);
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
                    'state_code' => app(PartyStateResolver::class)->resolve(
                        $item['state_code'] ?? null,
                        $item['gstin'] ?? null,
                        Store::find($storeId)
                    ),
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

            // A legacy product names its masters by the device uuid rather than the panel's row
            // id, so reading `category_id` alone migrated 105 products with no group, brand or unit.
            $categoryId = $this->resolveRef($p, ['category_id', 'group_id', 'group_external_id'], 'group');
            $brandId = $this->resolveRef($p, ['brand_id', 'brand_external_id'], 'brand');
            $unitId = $this->resolveRef($p, ['unit_id', 'unit_external_id'], 'unit');

            $data = [
                'store_id' => $storeId,
                'barcode' => $p['barcode'] ?? null,
                'name' => $name,
                'print_name' => $p['print_name'] ?? $name,
                'generic_name' => $p['generic_name'] ?? null,
                'hsn_sac_code' => $this->clip($this->normalizer->hsnCode($p), 20),
                'category_id' => $categoryId,
                'brand_id' => $brandId,
                'unit_id' => $unitId,
                'mrp' => $this->normalizer->number($p, ['mrp', 'max_retail_price']),
                // The panel keeps its shelf price under `sale_price`, already falling back to the
                // first batch's selling rate when the product row states none.
                'sel_rate' => $this->normalizer->number($p, ['sel_rate', 'sale_price', 'selling_price']),
                'ptr' => $this->normalizer->number($p, ['ptr']),
                'pts' => $this->normalizer->number($p, ['pts']),
                // The slab a line inherits when the bill omits its own: the legacy catalog states
                // it as a CGST/SGST pair and frequently leaves `gst_percent` at zero.
                'gst_percent' => $this->normalizer->lineRate($p) ?? 0.0,
                'units_per_pack' => max(1, (int) $this->normalizer->number($p, ['units_per_pack', 'pack_size'], 1)),
                'rack_location' => $p['rack_location'] ?? null,
                'shelf_location' => $p['shelf_location'] ?? null,
                'reorder_level' => $this->normalizer->number($p, ['reorder_level'], 10),
                'current_stock' => $this->normalizer->number($p, ['current_stock', 'stock', 'stock_qty']),
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
        // The legacy pull has no batches entity: each product carries its own. Counting only a
        // top-level batch list is what migrated a stocked shop onto an empty shelf.
        $batches = $this->normalizer->batchesOf($sourceData);

        foreach ($batches as $b) {
            $row = $this->normalizer->batch($b);
            $oldId = $b['id'] ?? null;
            $oldProductId = $row['product_id'];
            $batchNo = $this->clip($row['batch_no'], 50) ?? 'DEFAULT';

            $newProductId = $oldProductId ? $this->getMappedId('product', $oldProductId) : null;
            if (!$newProductId) {
                $this->recordUnresolved($storeId, $runUuid, 'batch', (string)$oldId, "Parent product ID {$oldProductId} not found", $b);
                continue;
            }

            // Reading only `stock_qty` is what turned a full shelf into an empty one: the
            // legacy export names the same figure `stock`, `balance` or `in_stock`.
            $stockQty = (float) $row['stock_qty'];
            $expiryDate = $row['expiry_date'];
            if ($expiryDate === null) {
                // The column cannot be empty, so a placeholder is unavoidable — but an invented
                // date a pharmacist will trust has to be listed somewhere to be corrected.
                $expiryDate = date('Y-m-d', strtotime('+2 years'));
                $this->recordUnresolved($storeId, $runUuid, 'batch_expiry', (string) ($oldId ?? $batchNo),
                    "Batch {$batchNo} has no expiry date in the source under any known key; it was filed as {$expiryDate} and must be corrected on the shelf.",
                    $b);
            }

            $existingId = $oldId ? $this->getMappedId('batch', $oldId) : null;
            $batch = $existingId ? ProductBatch::find($existingId) : null;

            $data = [
                'store_id' => $storeId,
                'product_id' => (int)$newProductId,
                'batch_no' => $batchNo,
                'mfg_date' => $row['mfg_date'],
                'expiry_date' => $expiryDate,
                'stock_qty' => $stockQty,
                'mrp' => (float) $row['mrp'],
                'purchase_rate' => (float) $row['purchase_rate'],
                'selling_rate' => (float) $row['selling_rate'],
                'rack_location' => $this->clip($row['rack_location'], 50),
                'shelf_location' => $this->clip($row['shelf_location'], 50),
                'external_id' => (string)($row['external_id'] ?? $oldId),
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
        $homeState = $this->storeStateCode($storeId);

        foreach ($this->saleDocuments($storeId, $runUuid, $sourceData) as [$legacy, $filedAsNote]) {
            $doc = $this->normalizer->invoice($legacy, $filedAsNote);
            $isNote = $doc['module_key'] === LegacyRecordNormalizer::KIND_CREDIT_NOTE;

            $oldId = $legacy['id'] ?? null;
            if ($oldId === null || $oldId === '') {
                $this->recordUnresolved($storeId, $runUuid, 'invoice', null,
                    'A sales document reached the pipeline with no source id, so a repeat run could not recognise it.',
                    $legacy);
                continue;
            }

            $invoiceNumber = $this->clip($doc['invoice_number'], 50);
            if ($invoiceNumber === null) {
                $invoiceNumber = $this->normalizer->derivedDocumentNumber($legacy, 'MIGBILL');
                if ($invoiceNumber === null) {
                    $this->recordUnresolved($storeId, $runUuid, 'invoice', null,
                        'A sale document reached the pipeline with neither a bill number under any known key nor a row identity, so nothing could be traced back to it.',
                        $legacy);
                    continue;
                }

                // The bill is worth importing even unnumbered: its money, stock and customer
                // balance are real. It is filed under a number that announces itself as ours and
                // left on the review list to be renamed.
                $this->documentStats['renumbered']++;
                $this->recordUnresolved($storeId, $runUuid, 'document_number', (string) $oldId,
                    "A sale bill of ₹" . number_format(abs((float) $doc['grand_total']), 2) . ' carries no number in the old system; it is filed as ' . $invoiceNumber . ' and should be renamed before the return is filed.',
                    $legacy);
                $doc['invoice_number'] = $invoiceNumber;
            }

            $oldCustomerId = $doc['customer_id'];
            $newCustomerId = $oldCustomerId === null ? null : $this->getMappedId('customer', $oldCustomerId);
            if ($oldCustomerId !== null && !$newCustomerId) {
                $this->documentStats['unlinked']++;
                $this->recordUnresolved($storeId, $runUuid, 'customer', (string) $oldCustomerId,
                    "Bill #{$invoiceNumber} references this customer but the party was never imported, so the bill is filed as a walk-in sale.",
                    []);
            }

            $placeOfSupply = $doc['place_of_supply'] ?? $homeState;
            $tax = $doc['tax_total'];
            $grand = $doc['grand_total'];
            $subtotal = $doc['subtotal'];
            if ($subtotal == 0.0 && $grand != 0.0) {
                $subtotal = round($grand - $tax, 2);
            }
            $taxable = $doc['taxable_subtotal'] > 0.0 ? $doc['taxable_subtotal'] : $subtotal;
            $paid = $doc['paid_amount'];
            $status = $doc['status'];

            $existingId = $this->getMappedId('invoice', $oldId);
            $invoice = $existingId ? Invoice::find($existingId) : null;

            $originalId = $isNote && $doc['original_invoice_id'] !== null
                ? $this->getMappedId('invoice', $doc['original_invoice_id'])
                : null;

            [$cgst, $sgst, $igst] = $this->taxSplit($doc, $tax, $placeOfSupply, $homeState);

            $data = [
                'store_id' => $storeId,
                'customer_id' => $newCustomerId ? (int) $newCustomerId : null,
                'invoice_number' => $invoiceNumber,
                'module_key' => $doc['module_key'],
                'invoice_date' => $doc['invoice_date'] ?? date('Y-m-d'),
                'customer_name' => $doc['customer_name'] ?? 'Walk-in Customer',
                'customer_phone' => $doc['customer_phone'],
                'customer_gstin' => $doc['customer_gstin'],
                'place_of_supply' => $placeOfSupply,
                'store_state_code' => $homeState,
                'subtotal' => $subtotal,
                'taxable_subtotal' => $taxable,
                'discount_total' => $doc['discount_total'],
                'tax_total' => $tax,
                'cgst_total' => $cgst,
                'sgst_total' => $sgst,
                'igst_total' => $igst,
                'cess_total' => $doc['cess_total'],
                'round_off' => $doc['round_off'],
                'grand_total' => $grand,
                'paid_amount' => $paid,
                'payment_mode' => $doc['payment_mode'] ?? 'Cash',
                'payment_status' => $this->paymentStatus($paid, $grand),
                'status' => $status,
                'cancel_reason' => $doc['cancel_reason'],
                'cancelled_at' => $status === 'cancelled' ? ($doc['cancelled_at'] ?? null) : null,
                'patient_name' => $doc['patient_name'],
                'doctor_name' => $doc['doctor_name'],
                'doctor_reg_no' => $this->clip($doc['doctor_reg_no'], 50),
                'counter_code' => $this->clip($doc['counter_code'], 30),
                'salesperson_name' => $doc['salesperson_name'],
                'original_invoice_id' => $originalId ? (int) $originalId : null,
                'original_invoice_number' => $isNote ? $this->clip($doc['original_invoice_number'], 50) : null,
                'external_id' => (string) ($doc['external_id'] ?? $oldId),
            ];

            if (!$invoice) {
                $invoice = Invoice::create($data);
            } else {
                $invoice->update($data);
            }

            $this->mapId($storeId, $runUuid, 'invoice', $oldId, $invoice->id, $doc['external_id'] ?? ($legacy['external_id'] ?? null));

            if ($isNote) {
                $this->documentStats['credit_notes']++;
            }

            $guessed = 0;
            foreach ($doc['items'] as $line) {
                $oldProductId = $line['product_id'];
                $newProductId = $oldProductId === null ? null : $this->getMappedId('product', $oldProductId);
                if ($oldProductId !== null && !$newProductId) {
                    $this->documentStats['unlinked']++;
                    $this->recordUnresolved($storeId, $runUuid, 'product', (string) $oldProductId,
                        "Bill #{$invoiceNumber} sold this product but it was never imported, so the line carries its name without a stock link.",
                        []);
                }

                $qty = (float) $line['qty'];
                $unitPrice = (float) $line['unit_price'];
                $lineTaxable = (float) $line['taxable_amount'];
                $lineTax = (float) $line['tax_amount'];

                if ($lineTaxable <= 0.0 && $unitPrice > 0.0 && $qty > 0.0) {
                    $lineTaxable = round($unitPrice * $qty, 2);
                }
                if ($unitPrice <= 0.0 && $lineTaxable > 0.0 && $qty > 0.0) {
                    $unitPrice = round($lineTaxable / $qty, 2);
                }

                [$lineCgst, $lineSgst, $lineIgst] = $this->statedOrSplit(
                    (float) $line['cgst_amount'],
                    (float) $line['sgst_amount'],
                    (float) $line['igst_amount'],
                    $lineTax,
                    $placeOfSupply,
                    $homeState
                );

                $gstPercent = $line['gst_percent'];
                if ($gstPercent === null) {
                    // The export named no rate for this line. The rupees still have to balance,
                    // so the rate comes from the next authority — the product master, then the
                    // bill's own tax-over-taxable ratio — and the guess is reported, not hidden.
                    $gstPercent = $newProductId ? $this->productGstPercent($storeId, (int) $newProductId) : null;
                    if ($gstPercent === null && $taxable > 0.0 && $tax != 0.0) {
                        $gstPercent = round(($tax / $taxable) * 100.0, 2);
                    }
                    $gstPercent ??= 0.0;
                    $guessed++;
                }

                InvoiceItem::create([
                    'invoice_id' => $invoice->id,
                    'product_id' => $newProductId ? (int) $newProductId : null,
                    'product_name' => $this->clip($line['product_name'], 255) ?? 'Item',
                    'batch_no' => $this->clip($line['batch_no'], 50),
                    'expiry_date' => $line['expiry_date'],
                    'qty' => $qty,
                    'loose_qty' => (float) $line['loose_qty'],
                    'free_qty' => (float) $line['free_qty'],
                    'free_loose_qty' => (float) $line['free_loose_qty'],
                    'units_per_pack' => max(1, (int) $line['units_per_pack']),
                    'unit_price' => $unitPrice,
                    'mrp' => (float) $line['mrp'],
                    'rate_basis' => $this->clip($line['rate_basis'], 20),
                    'stock_action' => $this->clip($line['stock_action'], 30),
                    'discount_percent' => (float) $line['discount_percent'],
                    'discount_amount' => (float) $line['discount_amount'],
                    'allocated_discount' => (float) $line['allocated_discount'],
                    'taxable_amount' => $lineTaxable,
                    'gst_percent' => $gstPercent,
                    'cgst_amount' => $lineCgst,
                    'sgst_amount' => $lineSgst,
                    'igst_amount' => $lineIgst,
                    'cess_rate' => (float) $line['cess_rate'],
                    'cess_amount' => (float) $line['cess_amount'],
                    'tax_amount' => $lineTax,
                    'total_amount' => (float) $line['total_amount'],
                ]);
            }

            if ($guessed > 0) {
                $this->documentStats['guessed_rates'] += $guessed;
                $this->recordUnresolved($storeId, $runUuid, 'invoice_tax_rate', (string) $oldId,
                    "{$guessed} line(s) of bill #{$invoiceNumber} carry no GST rate in the source; the rate was taken from the product master or the bill's own tax ratio and must be confirmed before filing.",
                    []);
            }

            $count++;
        }

        return $count;
    }

    /**
     * CGST/SGST/IGST for a document. A source that already states the split keeps it — those
     * are the rupees that system filed — and only a single undivided tax figure is split here.
     */
    private function taxSplit(array $doc, float $tax, ?string $placeOfSupply, ?string $homeState): array
    {
        return $this->statedOrSplit(
            (float) $doc['cgst_total'],
            (float) $doc['sgst_total'],
            (float) $doc['igst_total'],
            $tax,
            $placeOfSupply,
            $homeState
        );
    }

    private function statedOrSplit(float $cgst, float $sgst, float $igst, float $tax, ?string $placeOfSupply, ?string $homeState): array
    {
        if ($cgst != 0.0 || $sgst != 0.0 || $igst != 0.0) {
            return [$cgst, $sgst, $igst];
        }

        $split = $this->normalizer->splitTax($tax, $placeOfSupply, $homeState);

        return [$split['cgst'], $split['sgst'], $split['igst']];
    }

    private function paymentStatus(float $paid, float $grand): string
    {
        if ($paid <= 0.009) {
            return 'unpaid';
        }

        return $paid + 0.01 >= $grand ? 'paid' : 'partially_paid';
    }

    private function storeStateCode(int $storeId): ?string
    {
        $code = trim((string) (Store::find($storeId)?->state_code ?? ''));

        return $code === '' ? null : $code;
    }

    private function productGstPercent(int $storeId, int $productId): ?float
    {
        $key = $storeId . ':' . $productId;
        if (!array_key_exists($key, $this->productRateCache)) {
            $rate = Product::where('store_id', $storeId)->whereKey($productId)->value('gst_percent');
            $this->productRateCache[$key] = $rate === null ? null : round((float) $rate, 2);
        }

        return $this->productRateCache[$key];
    }

    /**
     * A column this schema measures in characters, not paragraphs. A legacy bill number longer
     * than the column throws, and because one run is one transaction that single row would
     * undo every document migrated before it.
     */
    /**
     * A master this source row points at, by whichever handle it uses — a panel row id or the
     * device uuid a legacy pull names it with. An unmatched reference stays null rather than
     * becoming a plausible-looking wrong link.
     */
    private function resolveRef(array $row, array $keys, string $entityType): ?string
    {
        foreach ($keys as $key) {
            $ref = $this->normalizer->idRef($row, [$key]);
            if ($ref === null) {
                continue;
            }
            $mapped = $this->getMappedId($entityType, $ref);
            if ($mapped !== null) {
                return $mapped;
            }
        }

        return null;
    }

    private function clip(?string $value, int $max): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value === '' ? null : substr($value, 0, $max);
    }

    protected function migratePurchases(int $storeId, string $runUuid, array $sourceData): int
    {
        $count = 0;
        $homeState = $this->storeStateCode($storeId);

        foreach ($this->purchaseDocuments($storeId, $runUuid, $sourceData) as [$legacy, $filedAsNote]) {
            $doc = $this->normalizer->purchase($legacy, $filedAsNote);
            $isNote = $doc['module_key'] === LegacyRecordNormalizer::KIND_DEBIT_NOTE;

            $oldId = $legacy['id'] ?? null;
            if ($oldId === null || $oldId === '') {
                $this->recordUnresolved($storeId, $runUuid, 'purchase', null,
                    'A purchase document reached the pipeline with no source id, so a repeat run could not recognise it.',
                    $legacy);
                continue;
            }

            $invoiceNumber = $this->clip($doc['invoice_number'], 50);
            if ($invoiceNumber === null) {
                $invoiceNumber = $this->normalizer->derivedDocumentNumber($legacy, 'MIGPUR');
                if ($invoiceNumber === null) {
                    $this->recordUnresolved($storeId, $runUuid, 'purchase', null,
                        'A purchase document reached the pipeline with neither a supplier bill number under any known key nor a row identity, so nothing could be traced back to it.',
                        $legacy);
                    continue;
                }

                $this->documentStats['renumbered']++;
                $this->recordUnresolved($storeId, $runUuid, 'document_number', (string) $oldId,
                    'A purchase bill of ₹' . number_format(abs((float) $doc['grand_total']), 2) . ' carries no supplier bill number in the old system; it is filed as ' . $invoiceNumber . ' and should be renamed before the return is filed.',
                    $legacy);
                $doc['invoice_number'] = $invoiceNumber;
            }

            $oldSupplierId = $doc['supplier_id'];
            $newSupplierId = $oldSupplierId === null ? null : $this->getMappedId('supplier', $oldSupplierId);
            if ($oldSupplierId !== null && !$newSupplierId) {
                $this->documentStats['unlinked']++;
                $this->recordUnresolved($storeId, $runUuid, 'supplier', (string) $oldSupplierId,
                    "Purchase bill #{$invoiceNumber} references this supplier but the party was never imported, so the bill carries the name without a ledger link.",
                    []);
            }

            $placeOfSupply = $doc['place_of_supply'] ?? $homeState;
            $tax = $doc['tax_total'];
            $subtotal = $doc['subtotal'];
            $grand = $doc['grand_total'];
            if ($subtotal == 0.0 && $grand != 0.0) {
                $subtotal = round($grand - $tax - (float) $doc['freight_charges'], 2);
            }
            $existingId = $this->getMappedId('purchase', $oldId);
            $purchase = $existingId ? Purchase::find($existingId) : null;

            [$cgst, $sgst, $igst] = $this->taxSplit($doc, $tax, $placeOfSupply, $homeState);

            $data = [
                'store_id' => $storeId,
                'supplier_id' => $newSupplierId ? (int) $newSupplierId : null,
                'supplier_name' => $doc['supplier_name'] ?? 'Supplier',
                'supplier_gstin' => $doc['supplier_gstin'],
                'invoice_number' => $invoiceNumber,
                'document_number' => $this->clip($doc['document_number'], 50),
                'supplier_invoice_no' => $this->clip($doc['supplier_invoice_no'] ?? $invoiceNumber, 50),
                'invoice_date' => $doc['invoice_date'] ?? date('Y-m-d'),
                'module_key' => $doc['module_key'],
                'subtotal' => $subtotal,
                'tax_total' => $tax,
                'cgst_total' => $cgst,
                'sgst_total' => $sgst,
                'igst_total' => $igst,
                'cess_total' => $doc['cess_total'],
                'is_interstate' => $placeOfSupply !== null && $homeState !== null && $placeOfSupply !== $homeState,
                'freight_charges' => (float) $doc['freight_charges'],
                'bill_discount' => (float) $doc['bill_discount'],
                'place_of_supply' => $placeOfSupply,
                'round_off' => (float) $doc['round_off'],
                'grand_total' => $grand,
                'paid_amount' => $doc['paid_amount'],
                'status' => $doc['status'],
                'cancel_reason' => $doc['cancel_reason'],
                'notes' => $doc['notes'],
                'external_id' => (string) ($doc['external_id'] ?? $oldId),
            ];

            if (!$purchase) {
                $purchase = Purchase::create($data);
            } else {
                $purchase->update($data);
            }

            $this->mapId($storeId, $runUuid, 'purchase', $oldId, $purchase->id, $doc['external_id'] ?? ($legacy['external_id'] ?? null));

            if ($isNote) {
                $this->documentStats['debit_notes']++;
            }

            $guessed = 0;
            foreach ($doc['items'] as $line) {
                $oldProductId = $line['product_id'];
                $newProductId = $oldProductId === null ? null : $this->getMappedId('product', $oldProductId);
                if ($oldProductId !== null && !$newProductId) {
                    $this->documentStats['unlinked']++;
                    $this->recordUnresolved($storeId, $runUuid, 'product', (string) $oldProductId,
                        "Purchase bill #{$invoiceNumber} bought this product but it was never imported, so the line carries its name without a stock link.",
                        []);
                }

                $qty = (float) $line['qty'];
                $rate = (float) $line['purchase_rate'];
                $lineTaxable = (float) $line['taxable_amount'];
                $lineTax = (float) $line['tax_amount'];

                if ($lineTaxable <= 0.0 && $rate > 0.0 && $qty > 0.0) {
                    $lineTaxable = round($rate * $qty, 2);
                }
                if ($rate <= 0.0 && $lineTaxable > 0.0 && $qty > 0.0) {
                    $rate = round($lineTaxable / $qty, 2);
                }

                [$lineCgst, $lineSgst, $lineIgst] = $this->statedOrSplit(
                    (float) $line['cgst_amount'],
                    (float) $line['sgst_amount'],
                    (float) $line['igst_amount'],
                    $lineTax,
                    $placeOfSupply,
                    $homeState
                );

                $gstPercent = $line['gst_percent'];
                if ($gstPercent === null) {
                    $gstPercent = $newProductId ? $this->productGstPercent($storeId, (int) $newProductId) : null;
                    if ($gstPercent === null && $subtotal > 0.0 && $tax != 0.0) {
                        $gstPercent = round(($tax / $subtotal) * 100.0, 2);
                    }
                    $gstPercent ??= 0.0;
                    $guessed++;
                }

                PurchaseItem::create([
                    'purchase_id' => $purchase->id,
                    'product_id' => $newProductId ? (int) $newProductId : null,
                    'product_name' => $this->clip($line['product_name'], 255) ?? 'Item',
                    'hsn_code' => $this->clip($line['hsn_code'], 20),
                    'batch_no' => $this->clip($line['batch_no'], 50),
                    'mfg_date' => $line['mfg_date'],
                    'expiry_date' => $line['expiry_date'],
                    'pack_qty' => (float) $line['pack_qty'],
                    'loose_qty' => (float) $line['loose_qty'],
                    'free_qty' => (float) $line['free_qty'],
                    'units_per_pack' => max(1, (int) $line['units_per_pack']),
                    'qty' => $qty,
                    'received_qty' => (float) $line['received_qty'],
                    'purchase_rate' => $rate,
                    'ptr' => (float) $line['ptr'],
                    'pts' => (float) $line['pts'],
                    'ptss' => (float) $line['ptss'],
                    'selling_rate' => (float) $line['selling_rate'],
                    'mrp' => (float) $line['mrp'],
                    'discount_percent' => (float) $line['discount_percent'],
                    'discount_amount' => (float) $line['discount_amount'],
                    'taxable_amount' => $lineTaxable,
                    'gst_percent' => $gstPercent,
                    'cgst_amount' => $lineCgst,
                    'sgst_amount' => $lineSgst,
                    'igst_amount' => $lineIgst,
                    'cess_amount' => (float) $line['cess_amount'],
                    'tax_amount' => $lineTax,
                    'total_amount' => (float) $line['total_amount'],
                ]);
            }

            if ($guessed > 0) {
                $this->documentStats['guessed_rates'] += $guessed;
                $this->recordUnresolved($storeId, $runUuid, 'purchase_tax_rate', (string) $oldId,
                    "{$guessed} line(s) of purchase bill #{$invoiceNumber} carry no GST rate in the source; the rate was taken from the product master or the bill's own tax ratio and must be confirmed before filing.",
                    []);
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
