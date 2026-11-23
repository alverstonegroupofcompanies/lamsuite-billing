<?php

namespace App\Console\Commands;

use App\Models\Party;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockLedgerEntry;
use App\Services\Parties\SupplierBalanceService;
use App\Services\Purchase\PurchasePostingService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * G3-PURCHASE-SYNC / PUR-06 — one supplier, one bill number, one row.
 *
 * Before the server refused a second bill with the same supplier number, a retried push
 * could file the same purchase twice, moving its stock and its payable twice. This
 * command finds those groups, keeps the earliest row, and cancels the rest — taking back
 * exactly the stock a cancelled row can prove it moved. It never guesses: a row with no
 * stock ledger entry is cancelled without touching stock, and the report says so.
 *
 * Dry run unless --apply. A full supplier-balance recompute follows the merge, so the
 * `current_balance` column ends where the ledger screen says it should.
 */
class PurchasesDedupeBillsCommand extends Command
{
    protected $signature = 'purchases:dedupe-bills
        {--apply : Cancel the duplicate rows instead of only reporting them}
        {--store= : Limit to one store id}';

    protected $description = 'Find (and with --apply, cancel) purchases that share a supplier bill number';

    public function handle(PurchasePostingService $posting, SupplierBalanceService $balances): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store') !== null ? (int) $this->option('store') : null;

        $query = Purchase::query()
            ->where(function ($q) {
                $q->whereNull('module_key')->orWhereNotIn('module_key', ['purchase_order', 'order']);
            })
            ->where('status', '!=', 'cancelled');

        if ($storeId) {
            $query->where('store_id', $storeId);
        }

        $groups = [];

        foreach ($query->orderBy('id')->cursor() as $purchase) {
            $key = $posting->billKeyFor($purchase);

            if ($key === null) {
                continue;
            }

            $groups[$purchase->store_id . '|' . $key][] = $purchase;
        }

        $duplicateGroups = array_filter($groups, fn (array $rows) => count($rows) > 1);

        if ($duplicateGroups === []) {
            $this->info('No duplicate supplier bills found.');

            return self::SUCCESS;
        }

        $supplierIds = [];
        $cancelled = 0;

        foreach ($duplicateGroups as $label => $rows) {
            /** @var Purchase[] $rows */
            $keep = array_shift($rows);

            $this->line('');
            $this->warn("Duplicate: {$label} (store {$keep->store_id})");
            $this->line(sprintf(
                '  keep #%d  %s  %s  Rs %s',
                $keep->id,
                optional($keep->invoice_date)->toDateString(),
                $keep->status,
                number_format((float) $keep->grand_total, 2)
            ));

            foreach ($rows as $duplicate) {
                $hasLedger = $this->hasStockLedger($duplicate);

                $this->line(sprintf(
                    '  cancel #%d  %s  %s  Rs %s  stock posted: %s',
                    $duplicate->id,
                    optional($duplicate->invoice_date)->toDateString(),
                    $duplicate->status,
                    number_format((float) $duplicate->grand_total, 2),
                    $hasLedger ? 'yes (will be reversed)' : 'no'
                ));

                $supplierIds[] = $duplicate->supplier_id;

                if (!$apply) {
                    continue;
                }

                $this->cancelDuplicate($posting, $duplicate, $hasLedger);
                $cancelled++;
            }
        }

        if (!$apply) {
            $this->line('');
            $this->info('Dry run. Re-run with --apply to cancel these rows.');

            return self::SUCCESS;
        }

        $this->recomputeSupplierBalances($balances, array_filter(array_unique($supplierIds)));

        $this->line('');
        $this->info("Cancelled {$cancelled} duplicate purchase row(s) and recomputed supplier balances.");

        return self::SUCCESS;
    }

    private function cancelDuplicate(PurchasePostingService $posting, Purchase $duplicate, bool $hasLedger): void
    {
        DB::transaction(function () use ($posting, $duplicate, $hasLedger): void {
            $items = PurchaseItem::where('purchase_id', $duplicate->id)->get();

            if ($hasLedger) {
                try {
                    $posting->reverse($duplicate, $items, 0.0, $duplicate->supplier_id ? (int) $duplicate->supplier_id : null);
                } catch (ValidationException $e) {
                    $this->warn('    stock could not be reversed: ' . $e->validator->errors()->first());
                }
            }

            $duplicate->forceFill([
                'status' => 'cancelled',
                'cancel_reason' => 'Duplicate supplier bill merged by purchases:dedupe-bills',
                'bill_key' => null,
            ])->save();
        });
    }

    private function hasStockLedger(Purchase $purchase): bool
    {
        return StockLedgerEntry::where('store_id', $purchase->store_id)
            ->whereIn('reference_type', ['PURCHASE', 'PURCHASE_RETURN'])
            ->where('reference_id', (string) $purchase->id)
            ->exists();
    }

    /**
     * @param  int[]  $supplierIds
     */
    private function recomputeSupplierBalances(SupplierBalanceService $balances, array $supplierIds): void
    {
        foreach ($supplierIds as $supplierId) {
            $supplier = Party::whereKey($supplierId)->where('type', 'supplier')->first();

            if (!$supplier) {
                continue;
            }

            $expected = $balances->expectedBalance($supplier);
            $current = round((float) $supplier->current_balance, 2);

            if (abs($expected - $current) < 0.005) {
                continue;
            }

            $supplier->forceFill(['current_balance' => $expected])->save();
            $this->line(sprintf(
                '  supplier #%d balance %.2f → %.2f',
                $supplier->id,
                $current,
                $expected
            ));
        }
    }
}
