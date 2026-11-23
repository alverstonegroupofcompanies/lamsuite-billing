<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * STK-01 left two kinds of wrong data behind: a product whose batches hold
 * stock while the product itself says zero, and batches whose opening units were
 * never written to the ledger. Both are reconciliations of what the batches
 * already say — no quantity is invented here.
 */
class BackfillStockOpeningCommand extends Command
{
    protected $signature = 'stock:backfill-opening
        {--apply : Write the reconciled stock and the missing opening ledger rows (default is a dry run)}
        {--store= : Limit to one store id}';

    protected $description = 'Reconcile products.current_stock with its batches and post the opening-stock ledger rows STK-01 never wrote';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store');

        $products = Product::when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->with('batches')
            ->orderBy('store_id')
            ->orderBy('id')
            ->get();

        $rows = [];
        $stockWithoutBatch = [];
        $unexplained = [];

        foreach ($products as $product) {
            // A product with stock but no batch cannot be repaired here: the
            // batch it needs has an expiry date nobody recorded.
            if ($product->batches->isEmpty()) {
                if ((float) $product->current_stock > 0) {
                    $stockWithoutBatch[] = [$product->store_id, $product->id, $product->name, (float) $product->current_stock];
                }
                continue;
            }

            $batchSum = (float) $product->batches->sum('stock_qty');
            $drift = round($batchSum - (float) $product->current_stock, 3);

            // Per batch: what the batch holds minus what the ledger explains.
            $opening = [];
            foreach ($product->batches as $batch) {
                $gap = round((float) $batch->stock_qty - (float) StockLedgerEntry::where('batch_id', $batch->id)->sum('qty_delta'), 3);
                if (abs($gap) < 0.0005) {
                    continue;
                }

                // Only stock an owner typed into Masters is opening stock. Any other
                // gap comes from another defect (purchases, sync) and is reported,
                // not papered over with an invented opening row.
                if ($gap > 0
                    && $this->createdInMasters($batch)
                    && !StockLedgerEntry::where('batch_id', $batch->id)->where('event_type', 'OPENING_STOCK')->exists()) {
                    $opening[] = [$batch, $gap];
                } else {
                    $unexplained[] = [$product->store_id, $product->id, $product->name, $batch->batch_no, number_format($gap, 3, '.', '')];
                }
            }

            if (abs($drift) < 0.0001 && $opening === []) {
                continue;
            }

            $rows[] = [
                $product->store_id,
                $product->id,
                $product->name,
                number_format((float) $product->current_stock, 3, '.', ''),
                number_format($batchSum, 3, '.', ''),
                collect($opening)->map(fn ($pair) => $pair[0]->batch_no . ' +' . rtrim(rtrim(number_format($pair[1], 3, '.', ''), '0'), '.'))->implode(', ') ?: '—',
            ];

            if (!$apply) {
                continue;
            }

            DB::transaction(function () use ($product, $opening, $drift, $batchSum) {
                foreach ($opening as [$batch, $gap]) {
                    $entry = StockLedgerEntry::create([
                        'store_id' => $product->store_id,
                        'product_id' => $product->id,
                        'batch_id' => $batch->id,
                        'event_type' => 'OPENING_STOCK',
                        'qty_delta' => $gap,
                        'reference_type' => 'opening_stock',
                        'reference_id' => (string) $batch->id,
                        // Opening stock precedes every later movement of the batch.
                        'balance_after' => $gap,
                        'idempotency_key' => "opening_stock_batch_{$batch->id}",
                    ]);
                    // Date it when the batch was opened so the ledger reads in order.
                    $entry->forceFill(['created_at' => $batch->created_at ?? $entry->created_at])->save();
                }

                if (abs($drift) >= 0.0001) {
                    Product::where('store_id', $product->store_id)
                        ->where('id', $product->id)
                        ->update(['current_stock' => $batchSum]);
                }
            });
        }

        if ($rows === []) {
            $this->info('Nothing to backfill.');
        } else {
            $this->table(['Store', 'Id', 'Product', 'On Product', 'In Batches', 'Ledger Rows Missing For'], $rows);
            if ($apply) {
                $this->info('Reconciled ' . count($rows) . ' product(s).');
            } else {
                $this->warn('Dry run: ' . count($rows) . ' product(s) would change. Re-run with --apply to write them.');
            }
        }

        if ($stockWithoutBatch !== []) {
            $this->table(
                ['Store', 'Id', 'Product', 'Stock'],
                $stockWithoutBatch
            );
            $this->warn(count($stockWithoutBatch) . ' product(s) hold stock with no batch at all. A batch needs a real expiry date, which no backfill can guess — enter it in Masters.');
        }

        if ($unexplained !== []) {
            $this->table(['Store', 'Id', 'Product', 'Batch', 'Batch minus ledger'], $unexplained);
            $this->warn(count($unexplained) . ' batch(es) disagree with the ledger for a reason this command cannot prove was opening stock. They are reported only.');
        }

        return self::SUCCESS;
    }

    /** The batch was written by AdminMasterController (product create or add batch). */
    private function createdInMasters(ProductBatch $batch): bool
    {
        return AuditLog::where(function ($q) use ($batch) {
            $q->where(fn ($p) => $p->where('action', 'create_product')->where('entity_type', 'Product')->where('entity_id', (string) $batch->product_id))
                ->orWhere(fn ($b) => $b->where('action', 'add_batch')->where('entity_type', 'ProductBatch')->where('entity_id', (string) $batch->id));
        })->exists();
    }
}
