<?php

namespace App\Services\Migration;

use App\Models\MigrationIdMap;
use App\Models\MigrationRun;
use App\Models\MigrationUnresolvedItem;
use App\Models\MigrationReconciliationReport;
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
use App\Models\MasterLookup;
use Illuminate\Support\Facades\DB;
use Throwable;

class MigrationRollbackService
{
    /**
     * Reverts all migrated entities associated with the given migration run or store
     * using the tracking records in migration_id_maps.
     */
    public function rollback(MigrationRun $run): array
    {
        $runUuid = $run->run_uuid;
        $storeId = $run->store_id;

        $stats = [
            'invoices_deleted' => 0,
            'purchases_deleted' => 0,
            'stock_adjustments_deleted' => 0,
            'transfers_deleted' => 0,
            'expenses_deleted' => 0,
            'payments_deleted' => 0,
            'batches_deleted' => 0,
            'products_deleted' => 0,
            'parties_deleted' => 0,
            'lookups_deleted' => 0,
        ];

        DB::beginTransaction();
        try {
            // Delete in reverse dependency order
            $mapRows = MigrationIdMap::where('store_id', $storeId)
                ->where('migration_run_uuid', $runUuid)
                ->get()
                ->groupBy('entity_type');

            // 1. Transactions
            if (isset($mapRows['invoice'])) {
                $invIds = $mapRows['invoice']->pluck('new_id')->all();
                InvoiceItem::whereIn('invoice_id', $invIds)->delete();
                $stats['invoices_deleted'] = Invoice::whereIn('id', $invIds)->delete();
            }

            if (isset($mapRows['purchase'])) {
                $purchIds = $mapRows['purchase']->pluck('new_id')->all();
                PurchaseItem::whereIn('purchase_id', $purchIds)->delete();
                $stats['purchases_deleted'] = Purchase::whereIn('id', $purchIds)->delete();
            }

            if (isset($mapRows['stock_adj'])) {
                $adjIds = $mapRows['stock_adj']->pluck('new_id')->all();
                $stats['stock_adjustments_deleted'] = StockAdjustment::whereIn('id', $adjIds)->delete();
            }

            if (isset($mapRows['expense'])) {
                $eIds = $mapRows['expense']->pluck('new_id')->all();
                $stats['expenses_deleted'] = Expense::whereIn('id', $eIds)->delete();
            }

            if (isset($mapRows['payment'])) {
                $pIds = $mapRows['payment']->pluck('new_id')->all();
                $stats['payments_deleted'] = CustomerPayment::whereIn('id', $pIds)->delete();
            }

            // 2. Batches & Products
            if (isset($mapRows['batch'])) {
                $bIds = $mapRows['batch']->pluck('new_id')->all();
                $stats['batches_deleted'] = ProductBatch::whereIn('id', $bIds)->delete();
            }

            if (isset($mapRows['product'])) {
                $prodIds = $mapRows['product']->pluck('new_id')->all();
                $stats['products_deleted'] = Product::whereIn('id', $prodIds)->delete();
            }

            // 3. Parties
            foreach (['customer', 'supplier', 'doctor', 'patient'] as $pType) {
                if (isset($mapRows[$pType])) {
                    $partyIds = $mapRows[$pType]->pluck('new_id')->all();
                    $stats['parties_deleted'] += Party::whereIn('id', $partyIds)->delete();
                }
            }

            // 4. Lookups
            foreach (['group', 'brand', 'unit', 'bank', 'location', 'department', 'designation', 'discount_schema', 'expense_head'] as $lType) {
                if (isset($mapRows[$lType])) {
                    $lIds = $mapRows[$lType]->pluck('new_id')->all();
                    $stats['lookups_deleted'] += MasterLookup::whereIn('id', $lIds)->delete();
                }
            }

            // Clean up migration records for this run
            MigrationIdMap::where('migration_run_uuid', $runUuid)->delete();
            MigrationUnresolvedItem::where('migration_run_uuid', $runUuid)->delete();
            MigrationReconciliationReport::where('migration_run_uuid', $runUuid)->delete();

            $run->update([
                'status' => 'rolled_back',
            ]);

            DB::commit();
            return $stats;
        } catch (Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }
}
