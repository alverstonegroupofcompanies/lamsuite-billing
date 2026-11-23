<?php

namespace App\Console\Commands;

use App\Models\StockLedgerEntry;
use App\Models\TransferProductMapping;
use App\Support\Catalog\ProductIdentity;
use Illuminate\Console\Command;

/**
 * STK-02 remembered a barcode-only match as a product mapping, so every later
 * transfer to that store quietly credited a different article. The stock those
 * transfers moved is real and stays where it is — only the remembered choice is
 * wrong, and that is what --delete-mappings removes so the next receive asks.
 * A mapping a person picked by hand is kept even when the two products disagree:
 * receive honours it, so deleting it here would change behaviour silently.
 */
class AuditTransferMappingsCommand extends Command
{
    protected $signature = 'stock:audit-transfer-mappings
        {--delete-mappings : Forget the machine-remembered mappings whose two products disagree (default is a dry run)}
        {--store= : Limit to mappings where this store id sends or receives}';

    protected $description = 'Report transfer product mappings that pair two different articles, and the stock already credited through them';

    public function handle(): int
    {
        $delete = (bool) $this->option('delete-mappings');
        $storeId = $this->option('store');

        $mappings = TransferProductMapping::with(['sourceProduct', 'destProduct'])
            ->when($storeId, function ($query) use ($storeId) {
                $id = (int) $storeId;
                $query->where(fn ($q) => $q->where('from_store_id', $id)->orWhere('to_store_id', $id));
            })
            ->orderBy('from_store_id')
            ->orderBy('to_store_id')
            ->orderBy('id')
            ->get();

        if ($mappings->isEmpty()) {
            $this->info('No transfer product mappings to audit.');

            return self::SUCCESS;
        }

        $rows = [];
        $machineMade = 0;
        $byPerson = 0;

        foreach ($mappings as $mapping) {
            $source = $mapping->sourceProduct;
            $dest = $mapping->destProduct;

            $conflicts = ($source && $dest)
                ? ProductIdentity::conflicts($source, $dest)
                : ['one side of the mapping no longer exists'];

            if ($conflicts === []) {
                continue;
            }

            $credited = StockLedgerEntry::where('store_id', $mapping->to_store_id)
                ->where('product_id', $mapping->dest_product_id)
                ->where('event_type', 'TRANSFER_IN')
                ->get(['qty_delta']);

            $chosenByPerson = $mapping->matched_by === 'manual';
            $chosenByPerson ? $byPerson++ : $machineMade++;

            $rows[] = [
                $mapping->id,
                $mapping->from_store_id . ' → ' . $mapping->to_store_id,
                $source?->name ?? '(missing ' . $mapping->source_product_id . ')',
                $dest?->name ?? '(missing ' . $mapping->dest_product_id . ')',
                $mapping->matched_by,
                implode(', ', $conflicts),
                number_format((float) $credited->sum('qty_delta'), 3, '.', ''),
                $credited->count(),
                $chosenByPerson ? 'kept — a person chose it' : 'can be forgotten',
            ];

            if ($delete && !$chosenByPerson) {
                $mapping->delete();
            }
        }

        $this->info('Audited ' . $mappings->count() . ' mapping(s).');

        if ($rows === []) {
            $this->info('Every mapping pairs products that agree on HSN/SAC, GST rate and pack size.');

            return self::SUCCESS;
        }

        $this->table(
            ['Id', 'Stores', 'Sending Product', 'Receiving Product', 'Matched By', 'Disagrees On', 'Qty Credited', 'Moves', 'Verdict'],
            $rows
        );

        if ($delete) {
            $this->info('Forgot ' . $machineMade . ' machine-remembered mapping(s). The next receive for these products asks which destination product to use.');
            $this->warn('The stock already moved is untouched — correct it with a stock adjustment between the two products.');
            if ($byPerson > 0) {
                $this->warn($byPerson . ' mapping(s) a person chose also disagree and were kept, because receive still honours them. Re-receive those lines deliberately if the pairing was a mistake.');
            }
        } else {
            $this->warn(sprintf(
                'Dry run: %d mapping(s) pair different articles, %d of them machine-remembered. Re-run with --delete-mappings to forget those.',
                count($rows),
                $machineMade
            ));
        }

        return self::SUCCESS;
    }
}
