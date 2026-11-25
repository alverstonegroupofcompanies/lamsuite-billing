<?php

namespace App\Services\Migration;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\MigrationReconciliationReport;
use App\Models\MigrationRun;
use App\Services\Tax\StoreTaxPolicy;

class MigrationReconciliationService
{
    /** `invoices.module_key` values that reduce turnover rather than adding to it. */
    private const SALE_NOTE_KEYS = ['credit_note', 'sales_return'];
    private const PURCHASE_NOTE_KEYS = ['debit_note', 'purchase_return'];

    private LegacyRecordNormalizer $normalizer;

    public function __construct(?LegacyRecordNormalizer $normalizer = null)
    {
        $this->normalizer = $normalizer ?? new LegacyRecordNormalizer();
    }

    /**
     * Compares source dataset against migrated database entities.
     * Evaluates counts, sales & purchase totals (to the paisa), tax slabs,
     * inventory balances, customer/supplier balances, and records discrepancies.
     *
     * A credit bill is netted against turnover on both sides of every comparison — this schema
     * stores one positive money figure per document and applies the sign where it is read, so
     * summing the column without it would count a year of returns as a year of extra sales.
     */
    public function reconcile(MigrationRun $run, array $sourceData): MigrationReconciliationReport
    {
        $storeId = $run->store_id;
        $runUuid = $run->run_uuid;
        $discrepancies = [];

        // 1. Record counts
        $sourceSales = $this->sourceSide($this->normalizer->saleDocuments($sourceData), true);
        $sourcePurchases = $this->sourceSide($this->normalizer->purchaseDocuments($sourceData), false);
        $sourceSalesTotal = $sourceSales['total'];
        $sourcePurchasesTotal = $sourcePurchases['total'];

        $sourceCounts = [
            'products' => count($sourceData['products'] ?? []),
            'batches' => count($sourceData['product_batches'] ?? $sourceData['batches'] ?? []),
            'customers' => count($sourceData['customers'] ?? []),
            'suppliers' => count($sourceData['suppliers'] ?? []),
            'invoices' => $sourceSales['documents'] - $sourceSales['notes'],
            'credit_notes' => $sourceSales['notes'],
            'purchases' => $sourcePurchases['documents'] - $sourcePurchases['notes'],
            'debit_notes' => $sourcePurchases['notes'],
        ];

        $targetCounts = [
            'products' => Product::where('store_id', $storeId)->count(),
            'batches' => ProductBatch::where('store_id', $storeId)->count(),
            'customers' => Party::where('store_id', $storeId)->where('type', 'customer')->count(),
            'suppliers' => Party::where('store_id', $storeId)->where('type', 'supplier')->count(),
            'invoices' => Invoice::where('store_id', $storeId)->whereNotIn('module_key', self::SALE_NOTE_KEYS)->count(),
            'credit_notes' => Invoice::where('store_id', $storeId)->whereIn('module_key', self::SALE_NOTE_KEYS)->count(),
            'purchases' => Purchase::where('store_id', $storeId)->whereNotIn('module_key', self::PURCHASE_NOTE_KEYS)->count(),
            'debit_notes' => Purchase::where('store_id', $storeId)->whereIn('module_key', self::PURCHASE_NOTE_KEYS)->count(),
        ];

        foreach ($sourceCounts as $entity => $sCount) {
            $tCount = $targetCounts[$entity] ?? 0;
            if ($sCount > 0 && $tCount < $sCount) {
                $discrepancies[] = [
                    'category' => 'count',
                    'severity' => 'error',
                    'entity' => $entity,
                    'message' => "Count mismatch for {$entity}: source has {$sCount}, target has {$tCount}.",
                ];
            }
        }

        // 2. Financial totals (Sales & Purchases), notes netted against turnover
        $targetSalesTotal = 0.0;
        foreach (Invoice::where('store_id', $storeId)->where('status', '!=', 'draft')->get(['grand_total', 'module_key']) as $row) {
            $sign = in_array((string) $row->module_key, self::SALE_NOTE_KEYS, true) ? -1.0 : 1.0;
            $targetSalesTotal += $sign * (float) $row->grand_total;
        }

        $targetPurchasesTotal = 0.0;
        foreach (Purchase::where('store_id', $storeId)->where('status', '!=', 'draft')->get(['grand_total', 'module_key']) as $row) {
            $sign = in_array((string) $row->module_key, self::PURCHASE_NOTE_KEYS, true) ? -1.0 : 1.0;
            $targetPurchasesTotal += $sign * (float) $row->grand_total;
        }

        $salesDiff = round(abs($sourceSalesTotal - $targetSalesTotal), 2);
        if ($salesDiff > 0.05) {
            $discrepancies[] = [
                'category' => 'financial',
                'severity' => 'error',
                'entity' => 'sales',
                'message' => "Sales total mismatch: source ₹{$sourceSalesTotal} vs target ₹{$targetSalesTotal} (diff: ₹{$salesDiff}).",
            ];
        }

        $purchaseDiff = round(abs($sourcePurchasesTotal - $targetPurchasesTotal), 2);
        if ($purchaseDiff > 0.05) {
            $discrepancies[] = [
                'category' => 'financial',
                'severity' => 'error',
                'entity' => 'purchases',
                'message' => "Purchase total mismatch: source ₹{$sourcePurchasesTotal} vs target ₹{$targetPurchasesTotal} (diff: ₹{$purchaseDiff}).",
            ];
        }

        $notImportable = $sourceSales['skipped'] + $sourcePurchases['skipped'];
        if ($notImportable > 0) {
            $discrepancies[] = [
                'category' => 'unmatched',
                'severity' => 'warning',
                'entity' => 'documents',
                'message' => "{$notImportable} source document(s) carry no id or no bill number under any known key and were listed for review instead of imported.",
            ];
        }

        // 2b. Statutory Tax Engine Audit on Migrated Invoices
        // The mode comes from the policy the till itself consults. It used to come from
        // `invoices.is_tax_inclusive`, a column this schema has never had, so the null it
        // always returned silently pinned every recomputation to 'exclusive'.
        $policy = (new StoreTaxPolicy())->forStore($storeId);
        $homeState = (string) (Store::find($storeId)?->state_code ?? '');

        $migratedInvoices = Invoice::with('items')
            ->where('store_id', $storeId)
            ->where('status', '!=', 'cancelled')
            ->get();

        foreach ($migratedInvoices as $mInv) {
            if ($mInv->items->isEmpty()) continue;

            $taxLines = [];
            $unrated = 0;
            foreach ($mInv->items as $item) {
                if ((float) $item->gst_percent <= 0.0 && (float) $item->tax_amount > 0.0) {
                    $unrated++;
                }
                $taxLines[] = [
                    'product_id' => $item->product_id,
                    'product_name' => $item->product_name,
                    'qty' => (float) $item->qty,
                    'unit_price' => (float) $item->unit_price,
                    'gst_percent' => (float) $item->gst_percent,
                    'discount_percent' => (float) ($item->discount_percent ?? 0),
                    'discount_amount' => (float) ($item->discount_amount ?? 0),
                ];
            }

            $isReturn = in_array((string) $mInv->module_key, self::SALE_NOTE_KEYS, true);
            $sign = $isReturn ? -1.0 : 1.0;
            $storedTax = (float) $mInv->tax_total;

            $recalc = \App\Services\Tax\TaxEngine::calculate([
                'store_state' => $mInv->store_state_code ?: ($homeState !== '' ? $homeState : null),
                'customer_gstin' => $mInv->customer_gstin,
                'place_of_supply' => $mInv->place_of_supply,
                'default_tax_mode' => $policy['tax_mode'],
                'lines' => $taxLines,
            ]);

            $engineTax = $sign * (float) $recalc['total_tax'];
            $taxDiff = round(abs($storedTax - $engineTax), 2);

            if ($unrated > 0 && $storedTax != 0.0) {
                $discrepancies[] = [
                    'category' => 'unrated_lines',
                    'severity' => 'warning',
                    'entity' => 'invoice',
                    'reference' => $mInv->invoice_number,
                    'message' => "Bill #{$mInv->invoice_number} records ₹{$storedTax} of tax on {$unrated} line(s) that carry a 0% rate. The export named no rate for them and none could be derived, so this bill would be filed as zero-rated.",
                ];
            }

            if ($taxDiff > 0.05) {
                $discrepancies[] = [
                    'category' => 'tax_engine_variance',
                    'severity' => 'warning',
                    'entity' => 'invoice',
                    'reference' => $mInv->invoice_number,
                    'message' => "Bill #{$mInv->invoice_number} recomputes to ₹{$engineTax} at the store's {$policy['tax_mode']} mode, but the source recorded ₹{$storedTax} (diff: ₹{$taxDiff}). The migrated rupees are kept as the legacy system reported them; check the slab on the lines before filing.",
                ];
            }
        }

        // 3. Tax Slabs (0, 5, 12, 18, 28)
        $slabs = [0, 5, 12, 18, 28];
        $slabReport = [];
        foreach ($slabs as $slab) {
            $targetTax = (float)InvoiceItem::whereHas('invoice', fn($q) => $q->where('store_id', $storeId))
                ->where('gst_percent', $slab)
                ->sum('tax_amount');
            $slabReport[$slab] = [
                'target_tax' => round($targetTax, 2),
            ];
        }

        // 4. Stock quantity & valuation
        $targetStockQty = (float)ProductBatch::where('store_id', $storeId)->sum('stock_qty');
        $targetStockValuation = (float)ProductBatch::where('store_id', $storeId)
            ->selectRaw('SUM(stock_qty * purchase_rate) as total_val')
            ->value('total_val');

        // 5. Customer & Supplier balances
        $targetCustBalance = (float)Party::where('store_id', $storeId)->where('type', 'customer')->sum('current_balance');
        $targetSuppBalance = (float)Party::where('store_id', $storeId)->where('type', 'supplier')->sum('current_balance');

        // A variance against the engine is not a lost rupee: the migrated money is copied as the
        // legacy system reported it. Only a count or total that does not reconcile — the source
        // has records this store does not — may hold a cutover.
        $blocking = array_values(array_filter(
            $discrepancies,
            fn ($d) => ($d['severity'] ?? 'error') === 'error'
        ));
        $isPassed = empty($blocking);

        $report = MigrationReconciliationReport::updateOrCreate(
            [
                'store_id' => $storeId,
                'migration_run_uuid' => $runUuid,
            ],
            [
                'is_passed' => $isPassed,
                'counts_comparison' => [
                    'source' => $sourceCounts,
                    'target' => $targetCounts,
                ],
                'financial_comparison' => [
                    'sales' => ['source' => round($sourceSalesTotal, 2), 'target' => round($targetSalesTotal, 2), 'diff' => $salesDiff],
                    'purchases' => ['source' => round($sourcePurchasesTotal, 2), 'target' => round($targetPurchasesTotal, 2), 'diff' => $purchaseDiff],
                ],
                'tax_slab_comparison' => $slabReport,
                'stock_comparison' => [
                    'total_stock_qty' => $targetStockQty,
                    'valuation' => round($targetStockValuation, 2),
                ],
                'balance_comparison' => [
                    'customer_balance' => round($targetCustBalance, 2),
                    'supplier_balance' => round($targetSuppBalance, 2),
                ],
                'discrepancies' => $discrepancies,
            ]
        );

        return $report;
    }

    /**
     * Net turnover for one family straight off the source rows, so the comparison measures the
     * same set of documents the pipeline was given rather than one hand-picked entity key.
     *
     * A row the importer cannot file — no source id, or no bill number under any key — is left
     * out of both the count and the money here and reported on its own below. Folding it into
     * the source total would book a mismatch against a document that was never importable, and
     * the operator would chase a difference in the totals that is really a record in the
     * unresolved list.
     *
     * @param  array<int, array{0: array, 1: bool}>  $documents
     * @return array{documents: int, notes: int, total: float, skipped: int}
     */
    private function sourceSide(array $documents, bool $isSale): array
    {
        $count = 0;
        $notes = 0;
        $skipped = 0;
        $total = 0.0;

        foreach ($documents as [$row, $filedAsNote]) {
            $doc = $isSale
                ? $this->normalizer->invoice($row, $filedAsNote)
                : $this->normalizer->purchase($row, $filedAsNote);
            $isNote = $doc['module_key'] === ($isSale
                ? LegacyRecordNormalizer::KIND_CREDIT_NOTE
                : LegacyRecordNormalizer::KIND_DEBIT_NOTE);

            if (!isset($row['id']) || $row['id'] === '' || $doc['invoice_number'] === null) {
                $skipped++;
                continue;
            }

            $count++;
            if ($isNote) {
                $notes++;
            }
            // The target side measures issued documents only, so a source draft is counted as a
            // record but stays out of turnover — otherwise the two sides net different sets.
            if ($doc['status'] === 'draft') {
                continue;
            }
            $total += $isNote ? -$doc['grand_total'] : $doc['grand_total'];
        }

        return ['documents' => $count, 'notes' => $notes, 'total' => round($total, 2), 'skipped' => $skipped];
    }
}
