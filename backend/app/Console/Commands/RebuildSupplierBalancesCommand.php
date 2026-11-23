<?php

namespace App\Console\Commands;

use App\Models\Party;
use App\Services\Parties\SupplierBalanceService;
use Illuminate\Console\Command;

class RebuildSupplierBalancesCommand extends Command
{
    protected $signature = 'parties:rebuild-supplier-balances
        {--apply : Write the recomputed balances (default is a dry run)}
        {--store= : Limit to one store id}';

    protected $description = 'Recompute parties.current_balance for suppliers from purchases, returns and payments';

    public function handle(SupplierBalanceService $balances): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store');

        $suppliers = Party::where('type', 'supplier')
            ->when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->orderBy('store_id')
            ->orderBy('id')
            ->get();

        $rows = [];
        $changed = 0;

        foreach ($suppliers as $supplier) {
            $stored = round((float) $supplier->current_balance, 2);
            $expected = $balances->expectedBalance($supplier);

            if (abs($expected - $stored) < 0.005) {
                continue;
            }

            $changed++;
            $rows[] = [
                $supplier->store_id,
                $supplier->id,
                $supplier->name,
                number_format($stored, 2, '.', ''),
                number_format($expected, 2, '.', ''),
                number_format($expected - $stored, 2, '.', ''),
            ];

            if ($apply) {
                $supplier->update(['current_balance' => $expected]);
            }
        }

        if ($rows === []) {
            $this->info('All supplier balances already match their documents.');

            return self::SUCCESS;
        }

        $this->table(
            ['Store', 'Id', 'Supplier', 'Stored', 'Expected', 'Delta'],
            $rows
        );

        if ($apply) {
            $this->info("Updated {$changed} supplier balance(s).");
        } else {
            $this->warn("Dry run: {$changed} supplier balance(s) differ. Re-run with --apply to write them.");
        }

        return self::SUCCESS;
    }
}
