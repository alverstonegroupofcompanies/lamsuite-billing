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
 * G3-PURCHASE-SYNC / PUR-05 — a saved purchase that never reached the shelf.
 *
 * Purchases written before this fix could be saved with their lines and their money and
 * still move no stock: the batch stayed short, the stock ledger stayed silent and later
 * sales went negative. The repair posts exactly the documents that have no stock ledger
 * evidence, then recomputes every supplier balance from the documents themselves, which
 * also settles any payable that was posted twice or not at all.
 *
 * Dry run unless --apply. Safe to re-run: a document that already has its ledger entry
 * is never posted a second time.
 */
class PurchasesRepairPostingsCommand extends Command
{
    protected $signature = 'purchases:repair-postings
        {--apply : Post the missing stock instead of only reporting it}
        {--store= : Limit to one store id}';

    protected $description = 'Post stock for purchases saved without any stock movement, then rebuild supplier balances';

    public function handle(PurchasePostingService $posting, SupplierBalanceService $balances): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store') !== null ? (int) $this->option('store') : null;

        $query = Purchase::query()
            ->where(function ($q) {
                $q->whereNull('module_key')->orWhereNotIn('module_key', ['purchase_order', 'order']);
            })
            ->where('status', '!=', 'cancelled')
            ->orderBy('id');

        if ($storeId) {
            $query->where('store_id', $storeId);
        }

        $missing = 0;
        $posted = 0;
        $failed = 0;
        $lineless = 0;

        foreach ($query->cursor() as $purchase) {
            $items = PurchaseItem::where('purchase_id', $purchase->id)->get();

            // PUR-07: a debit note the server took without its lines moved nothing and cannot be
            // rebuilt here — the lines never arrived. The owner re-enters or cancels it.
            if ($items->isEmpty() && PurchasePostingService::isReturnModule($purchase->module_key)) {
                $lineless++;
                $this->warn(sprintf(
                    '  #%d  store %d  return %s  Rs %s  has no lines: the server never received them. Re-enter it from the till or cancel it.',
                    $purchase->id,
                    $purchase->store_id,
                    $purchase->invoice_number,
                    number_format((float) $purchase->grand_total, 2)
                ));
                continue;
            }

            if ($items->isEmpty() || $this->hasStockLedger($purchase)) {
                continue;
            }

            $missing++;
            $this->line(sprintf(
                '  #%d  store %d  %s  %s  Rs %s  (%d line(s))',
                $purchase->id,
                $purchase->store_id,
                PurchasePostingService::isReturnModule($purchase->module_key) ? 'return' : 'inward',
                optional($purchase->invoice_date)->toDateString(),
                number_format((float) $purchase->grand_total, 2),
                $items->count()
            ));

            $unitCounted = $items->filter(fn (PurchaseItem $item): bool => $this->countsUnitsInQty($item));
            foreach ($unitCounted as $item) {
                $this->line(sprintf(
                    '    line #%d %s: qty counted in units (%s) → %s pack(s) of %s',
                    $item->id,
                    $item->product_name,
                    $this->num((float) $item->qty),
                    $this->num((float) $item->pack_qty),
                    $this->num((float) $item->units_per_pack)
                ));
            }

            if (!$apply) {
                continue;
            }

            try {
                DB::transaction(function () use ($posting, $purchase, &$items, $unitCounted): void {
                    // The old POST /purchases stored billed units in qty; the book counts packs.
                    // Converted first, or the posting multiplies by units_per_pack a second time.
                    foreach ($unitCounted as $item) {
                        $item->forceFill(['qty' => $item->pack_qty])->save();
                    }
                    if ($unitCounted->isNotEmpty()) {
                        $items = PurchaseItem::where('purchase_id', $purchase->id)->get();
                    }

                    if (PurchasePostingService::isReturnModule($purchase->module_key)) {
                        $posting->moveStock($purchase, $items, [], -1.0);
                    } else {
                        $posting->moveStock($purchase, [], $items, 1.0);
                    }
                });

                $posted++;
            } catch (ValidationException $e) {
                $failed++;
                $this->warn('    skipped: ' . $e->validator->errors()->first());
            }
        }

        if ($lineless > 0) {
            $this->warn("{$lineless} debit note(s) have no lines and were left untouched.");
        }

        if ($missing === 0) {
            $this->info('Every purchase document already has its stock ledger entries.');
        } elseif (!$apply) {
            $this->line('');
            $this->info("Dry run: {$missing} document(s) have no stock movement. Re-run with --apply to post them.");
        }

        if (!$apply) {
            return self::SUCCESS;
        }

        $this->recomputeSupplierBalances($balances, $storeId);

        $this->line('');
        $this->info("Posted stock for {$posted} document(s); {$failed} could not be posted; supplier balances rebuilt.");

        return self::SUCCESS;
    }

    /**
     * A line the old POST /purchases wrote: qty holds billed units (packs × per-pack + loose)
     * rather than packs. Only a multi-unit pack can tell the two apart.
     */
    private function countsUnitsInQty(PurchaseItem $item): bool
    {
        $perPack = (float) ($item->units_per_pack ?: 1);
        if ($perPack <= 1) {
            return false;
        }

        $qty = (float) $item->qty;
        $packs = (float) $item->pack_qty;
        $billedUnits = $packs * $perPack + (float) $item->loose_qty;

        return abs($qty - $packs) > 0.0001 && abs($qty - $billedUnits) < 0.0001;
    }

    private function num(float $value): string
    {
        return rtrim(rtrim(number_format($value, 3, '.', ''), '0'), '.') ?: '0';
    }

    private function hasStockLedger(Purchase $purchase): bool
    {
        return StockLedgerEntry::where('store_id', $purchase->store_id)
            ->whereIn('reference_type', ['PURCHASE', 'PURCHASE_RETURN'])
            ->where('reference_id', (string) $purchase->id)
            ->exists();
    }

    private function recomputeSupplierBalances(SupplierBalanceService $balances, ?int $storeId): void
    {
        $suppliers = Party::where('type', 'supplier')
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->orderBy('id')
            ->cursor();

        $changed = 0;

        foreach ($suppliers as $supplier) {
            $expected = $balances->expectedBalance($supplier);
            $current = round((float) $supplier->current_balance, 2);

            if (abs($expected - $current) < 0.005) {
                continue;
            }

            $supplier->forceFill(['current_balance' => $expected])->save();
            $changed++;

            $this->line(sprintf(
                '  supplier #%d %.2f → %.2f',
                $supplier->id,
                $current,
                $expected
            ));
        }

        if ($changed === 0) {
            $this->info('Supplier balances already agree with their documents.');
        }
    }
}
