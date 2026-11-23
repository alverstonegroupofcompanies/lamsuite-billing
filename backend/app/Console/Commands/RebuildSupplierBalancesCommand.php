<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Party;
use App\Models\Purchase;
use App\Models\SupplierPayment;
use App\Services\Parties\SupplierBalanceService;
use Illuminate\Console\Command;

class RebuildSupplierBalancesCommand extends Command
{
    protected $signature = 'parties:rebuild-supplier-balances
        {--apply : Write the recomputed balances (default is a dry run)}
        {--store= : Limit to one store id}
        {--include-undocumented : Also reset suppliers whose balance no bill or payment explains}';

    protected $description = 'Recompute parties.current_balance for suppliers from purchases, returns and payments';

    public function handle(SupplierBalanceService $balances): int
    {
        $apply = (bool) $this->option('apply');
        $includeUndocumented = (bool) $this->option('include-undocumented');
        $storeId = $this->option('store');

        $suppliers = Party::where('type', 'supplier')
            ->when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->orderBy('store_id')
            ->orderBy('id')
            ->get();

        $rows = [];
        $changed = 0;
        $held = 0;

        foreach ($suppliers as $supplier) {
            $stored = round((float) $supplier->current_balance, 2);
            $expected = $balances->expectedBalance($supplier);

            if (abs($expected - $stored) < 0.005) {
                continue;
            }

            // A balance carried over from another system (the migration runner, an import)
            // arrives with no bill or payment behind it. The arithmetic would reset it to the
            // opening balance and lose a real debt, so it is reported and left alone unless
            // the owner says otherwise.
            $undocumented = !$this->hasDocuments($supplier);
            $hold = $undocumented && !$includeUndocumented;

            $rows[] = [
                $supplier->store_id,
                $supplier->id,
                $supplier->name,
                number_format($stored, 2, '.', ''),
                number_format($expected, 2, '.', ''),
                number_format($expected - $stored, 2, '.', ''),
                $hold ? 'held: no documents (imported balance?)' : ($undocumented ? 'reset: no documents' : 'recompute'),
            ];

            if ($hold) {
                $held++;
                continue;
            }

            $changed++;

            if ($apply) {
                $supplier->update(['current_balance' => $expected]);

                AuditLog::log(
                    'supplier_balance_recomputed',
                    'Party',
                    (string) $supplier->id,
                    ['current_balance' => $stored],
                    ['current_balance' => $expected, 'source' => 'parties:rebuild-supplier-balances'],
                    (int) $supplier->store_id
                );
            }
        }

        if ($rows === []) {
            $this->info('All supplier balances already match their documents.');

            return self::SUCCESS;
        }

        $this->table(
            ['Store', 'Id', 'Supplier', 'Stored', 'Expected', 'Delta', 'Action'],
            $rows
        );

        if ($apply) {
            $this->info("Updated {$changed} supplier balance(s).");
        } else {
            $this->warn("Dry run: {$changed} supplier balance(s) would change. Re-run with --apply to write them.");
        }

        if ($held > 0) {
            $this->warn("{$held} supplier(s) have no documents behind their balance and were left as they are. "
                . 'Set their opening balance, or re-run with --include-undocumented to reset them.');
        }

        return self::SUCCESS;
    }

    private function hasDocuments(Party $supplier): bool
    {
        return Purchase::where('supplier_id', $supplier->id)
                ->where('store_id', $supplier->store_id)
                ->where(fn ($q) => $q->whereNull('module_key')->orWhereNotIn('module_key', ['purchase_order', 'order']))
                ->exists()
            || SupplierPayment::where('supplier_id', $supplier->id)->exists();
    }
}
