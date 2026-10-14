<?php

namespace App\Services\Migration;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\MigrationReconciliationReport;
use App\Models\MigrationRun;

class MigrationReconciliationService
{
    /**
     * Compares source dataset against migrated database entities.
     * Evaluates counts, sales & purchase totals (to the paisa), tax slabs,
     * inventory balances, customer/supplier balances, and records discrepancies.
     */
    public function reconcile(MigrationRun $run, array $sourceData): MigrationReconciliationReport
    {
        $storeId = $run->store_id;
        $runUuid = $run->run_uuid;
        $discrepancies = [];

        // 1. Record counts
        $sourceCounts = [
            'products' => count($sourceData['products'] ?? []),
            'batches' => count($sourceData['product_batches'] ?? []),
            'customers' => count($sourceData['customers'] ?? []),
            'suppliers' => count($sourceData['suppliers'] ?? []),
            'invoices' => count($sourceData['invoices'] ?? []),
            'purchases' => count($sourceData['purchases'] ?? $sourceData['purchase_documents'] ?? []),
        ];

        $targetCounts = [
            'products' => Product::where('store_id', $storeId)->count(),
            'batches' => ProductBatch::where('store_id', $storeId)->count(),
            'customers' => Party::where('store_id', $storeId)->where('type', 'customer')->count(),
            'suppliers' => Party::where('store_id', $storeId)->where('type', 'supplier')->count(),
            'invoices' => Invoice::where('store_id', $storeId)->count(),
            'purchases' => Purchase::where('store_id', $storeId)->count(),
        ];

        foreach ($sourceCounts as $entity => $sCount) {
            $tCount = $targetCounts[$entity] ?? 0;
            if ($sCount > 0 && $tCount < $sCount) {
                $discrepancies[] = [
                    'category' => 'count',
                    'entity' => $entity,
                    'message' => "Count mismatch for {$entity}: source has {$sCount}, target has {$tCount}.",
                ];
            }
        }

        // 2. Financial totals (Sales & Purchases)
        $sourceSalesTotal = 0.0;
        $sourceSalesTax = 0.0;
        foreach ($sourceData['invoices'] ?? [] as $inv) {
            $sourceSalesTotal += (float)($inv['grand_total'] ?? $inv['total'] ?? 0);
            $sourceSalesTax += (float)($inv['tax_total'] ?? $inv['tax_amount'] ?? 0);
        }

        $sourcePurchasesTotal = 0.0;
        $sourcePurchasesTax = 0.0;
        foreach ($sourceData['purchases'] ?? $sourceData['purchase_documents'] ?? [] as $p) {
            $sourcePurchasesTotal += (float)($p['grand_total'] ?? $p['total'] ?? 0);
            $sourcePurchasesTax += (float)($p['tax_total'] ?? $p['tax_amount'] ?? 0);
        }

        $targetSalesTotal = (float)Invoice::where('store_id', $storeId)->where('status', '!=', 'draft')->sum('grand_total');
        $targetSalesTax = (float)Invoice::where('store_id', $storeId)->where('status', '!=', 'draft')->sum('tax_total');
        $targetPurchasesTotal = (float)Purchase::where('store_id', $storeId)->sum('grand_total');
        $targetPurchasesTax = (float)Purchase::where('store_id', $storeId)->sum('tax_total');

        $salesDiff = round(abs($sourceSalesTotal - $targetSalesTotal), 2);
        if ($salesDiff > 0.05) {
            $discrepancies[] = [
                'category' => 'financial',
                'entity' => 'sales',
                'message' => "Sales total mismatch: source ₹{$sourceSalesTotal} vs target ₹{$targetSalesTotal} (diff: ₹{$salesDiff}).",
            ];
        }

        $purchaseDiff = round(abs($sourcePurchasesTotal - $targetPurchasesTotal), 2);
        if ($purchaseDiff > 0.05) {
            $discrepancies[] = [
                'category' => 'financial',
                'entity' => 'purchases',
                'message' => "Purchase total mismatch: source ₹{$sourcePurchasesTotal} vs target ₹{$targetPurchasesTotal} (diff: ₹{$purchaseDiff}).",
            ];
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

        $isPassed = empty($discrepancies);

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
}
