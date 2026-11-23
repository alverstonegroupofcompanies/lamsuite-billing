<?php

namespace App\Console\Commands;

use App\Models\Purchase;
use App\Models\Store;
use App\Services\Tax\TaxEngine;
use Illuminate\Console\Command;

class BackfillPurchaseIdentifiersCommand extends Command
{
    protected $signature = 'purchases:backfill-identifiers
        {--apply : Write the recovered values (default is a dry run)}
        {--store= : Limit to one store id}';

    protected $description = 'Fill supplier_invoice_no and place_of_supply on purchases written before identity columns existed';

    /**
     * A till's own purchase number (C01-PUR-1001) is not a supplier bill, so it must never
     * be copied into supplier_invoice_no. Historic rows keep the till number in
     * invoice_number when the payload carried no supplier bill at all; those rows cannot
     * be told apart from a supplier bill with certainty, so the shape check is the only
     * honest filter. Anything left null is genuinely unrecoverable — the push payload
     * was not retained.
     */
    private const TILL_NUMBER_PATTERN = '/^[A-Z0-9]+-PUR-/i';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store');

        $stores = Store::when($storeId, fn ($q) => $q->whereKey((int) $storeId))->get()->keyBy('id');

        $purchases = Purchase::when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->orderBy('store_id')
            ->orderBy('id')
            ->get();

        $rows = [];
        $documentNumbersLost = 0;

        foreach ($purchases as $purchase) {
            $updates = [];
            $module = strtolower((string) ($purchase->module_key ?: 'purchase'));
            $isReturn = in_array($module, ['purchase_return', 'debit_note'], true);

            if ($purchase->supplier_invoice_no === null
                && !$isReturn
                && $purchase->invoice_number
                && !preg_match(self::TILL_NUMBER_PATTERN, (string) $purchase->invoice_number)
            ) {
                $updates['supplier_invoice_no'] = $purchase->invoice_number;
            }

            if (empty($purchase->place_of_supply)) {
                $stateCode = $stores->get($purchase->store_id)?->state_code;
                if ($stateCode) {
                    $updates['place_of_supply'] = TaxEngine::cleanStateCode((string) $stateCode, (string) $stateCode);
                }
            }

            if ($purchase->document_number === null) {
                $documentNumbersLost++;
            }

            if ($updates === []) {
                continue;
            }

            $rows[] = [
                $purchase->store_id,
                $purchase->id,
                $purchase->invoice_number,
                $updates['supplier_invoice_no'] ?? '—',
                $updates['place_of_supply'] ?? '—',
            ];

            if ($apply) {
                $purchase->update($updates);
            }
        }

        if ($rows === []) {
            $this->info('Nothing to backfill.');
        } else {
            $this->table(['Store', 'Id', 'Invoice Number', 'Supplier Bill', 'Place Of Supply'], $rows);

            if ($apply) {
                $this->info('Updated ' . count($rows) . ' purchase row(s).');
            } else {
                $this->warn('Dry run: ' . count($rows) . ' purchase row(s) would change. Re-run with --apply to write them.');
            }
        }

        if ($documentNumbersLost > 0) {
            $this->warn("{$documentNumbersLost} purchase row(s) still have no till document number. That value was not retained when the bill was ingested and cannot be reconstructed.");
        }

        return self::SUCCESS;
    }
}
