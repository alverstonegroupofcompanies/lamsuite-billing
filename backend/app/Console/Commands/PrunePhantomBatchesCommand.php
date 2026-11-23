<?php

namespace App\Console\Commands;

use App\Models\ProductBatch;
use App\Models\StockAdjustmentLine;
use App\Models\StockLedgerEntry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * PRD-01 created a batch for every product added in Masters even when the owner
 * typed no stock: batch "B1", quantity 0, and an expiry invented as the day the
 * row was written plus one year. Nothing else in the codebase produces that
 * triple by accident, so all three signals must agree before a row is called a
 * phantom. A batch that any ledger or adjustment line mentions is kept even at
 * zero quantity — that one is part of the stock history.
 */
class PrunePhantomBatchesCommand extends Command
{
    protected $signature = 'stock:prune-phantom-batches
        {--apply : Delete the phantom batches (default is a dry run)}
        {--store= : Limit to one store id}';

    protected $description = 'Delete the zero-quantity B1 batches with invented expiries that PRD-01 wrote for products opened without stock';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store');

        $batches = ProductBatch::with('product')
            ->when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->where('stock_qty', 0)
            ->whereRaw('UPPER(batch_no) = ?', ['B1'])
            ->orderBy('store_id')
            ->orderBy('id')
            ->get();

        $rows = [];

        foreach ($batches as $batch) {
            if (!$this->expiryLooksInvented($batch)) {
                continue;
            }
            if (StockLedgerEntry::where('store_id', $batch->store_id)->where('batch_id', $batch->id)->exists()) {
                continue;
            }
            if (StockAdjustmentLine::where('batch_id', $batch->id)->exists()) {
                continue;
            }
            // A document that names the batch keeps it, even at zero stock.
            if (DB::table('invoice_items')->where('product_id', $batch->product_id)->where('batch_no', $batch->batch_no)->exists()
                || DB::table('purchase_items')->where('product_id', $batch->product_id)->where('batch_no', $batch->batch_no)->exists()
                || DB::table('stock_transfer_items')->where('product_id', $batch->product_id)->where('batch_no', $batch->batch_no)->exists()) {
                continue;
            }

            $rows[] = [
                $batch->store_id,
                $batch->id,
                $batch->product?->name ?? '(product deleted)',
                $batch->batch_no,
                optional($batch->expiry_date)->toDateString(),
                optional($batch->created_at)->toDateString(),
            ];

            if ($apply) {
                $batch->delete();
            }
        }

        if ($rows === []) {
            $this->info('No phantom opening batches found.');

            return self::SUCCESS;
        }

        $this->table(['Store', 'Id', 'Product', 'Batch', 'Invented Expiry', 'Written On'], $rows);

        if ($apply) {
            $this->info('Deleted ' . count($rows) . ' phantom batch(es). These products now show no batch, which is what they were meant to have.');
        } else {
            $this->warn('Dry run: ' . count($rows) . ' phantom batch(es) would be deleted. Re-run with --apply to remove them.');
        }

        return self::SUCCESS;
    }

    /**
     * The old form prefill computed the expiry in the browser and the row was
     * stamped in server time, so a product created near midnight can sit one day
     * either side of the exact year.
     */
    private function expiryLooksInvented(ProductBatch $batch): bool
    {
        $expiry = $batch->expiry_date?->toDateString();
        $written = $batch->created_at?->toDateString();

        if ($expiry === null || $written === null) {
            return false;
        }

        $difference = (int) \DateTime::createFromFormat('Y-m-d', $written)
            ->modify('+1 year')
            ->diff(\DateTime::createFromFormat('Y-m-d', $expiry))
            ->format('%r%a');

        return abs($difference) <= 1;
    }
}
