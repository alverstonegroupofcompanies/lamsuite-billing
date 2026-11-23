<?php

namespace App\Console\Commands;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\ProductBatch;
use App\Services\Tax\MrpCeiling;
use App\Support\Gst\StateCodes;
use Illuminate\Console\Command;

/**
 * G11-TAX damage survey (dry run).
 *
 * The four tax defects are fixed where a document is made, but the books a till
 * already pushed still hold what it computed: a credit note that re-added GST on an
 * MRP price, a walk-in sale booked inter-state, a line discounted twice, a rate above
 * the printed MRP. This reads those stored documents and lists every line that could
 * only have come from one of them, so the owner knows what to re-file and which tills
 * still need updating.
 *
 * It never writes to the ledger — no row is touched, and nothing here can move a
 * rupee. `--out` puts the same findings in a CSV for the accountant.
 */
class AuditG11TaxCommand extends Command
{
    protected $signature = 'billing:audit-g11-tax
        {--store= : Limit the survey to one store id}
        {--from= : First invoice date to read (YYYY-MM-DD)}
        {--to= : Last invoice date to read (YYYY-MM-DD)}
        {--out= : Also write the findings to this CSV path}';

    protected $description = 'Dry-run survey of stored documents for the G11-TAX defects: re-priced returns, double discounts, wrong place of supply, above-MRP rates';

    /** @var array<string, ?ProductBatch> batch master cache, keyed store:product:batch_no */
    private array $batches = [];

    public function handle(): int
    {
        $rows = [];
        $documents = 0;

        foreach ($this->documents()->cursor() as $invoice) {
            $documents++;

            if ($invoice->module_key !== 'invoice') {
                foreach ($invoice->items as $index => $item) {
                    $this->returnFinding($invoice, $item, $index + 1, $rows);
                }

                continue;
            }

            foreach ($invoice->items as $index => $item) {
                $this->discountFinding($invoice, $item, $index + 1, $rows);
                $this->mrpFinding($invoice, $item, $index + 1, $rows);
            }
            $this->placeOfSupplyFindings($invoice, $rows);
        }

        $this->info("Read {$documents} document(s). Nothing was changed — this survey only reports.");

        if ($rows === []) {
            $this->writeRequestedCsv($rows);
            $this->info('No line shows the mark of the G11-TAX defects.');

            return self::SUCCESS;
        }

        $counts = [];
        foreach ($rows as $row) {
            $counts[$row['finding']] = ($counts[$row['finding']] ?? 0) + 1;
        }
        ksort($counts);
        foreach ($counts as $finding => $count) {
            $this->line(sprintf('%-22s %d', $finding, $count));
        }

        $this->table(
            ['Store', 'Document', 'Date', 'Line', 'Product', 'Finding', 'Billed', 'Expected', 'Detail'],
            array_map(fn (array $row): array => [
                $row['store_id'],
                $row['document'],
                $row['date'],
                $row['line'],
                $row['product'],
                $row['finding'],
                number_format($row['billed'], 2),
                number_format($row['expected'], 2),
                $row['detail'],
            ], $rows)
        );

        $this->writeRequestedCsv($rows);

        return self::SUCCESS;
    }

    private function documents(): \Illuminate\Database\Eloquent\Builder
    {
        return Invoice::query()
            ->with(['items.product', 'store', 'customer'])
            ->whereIn('module_key', ['invoice', 'credit_note', 'sales_return'])
            ->where('status', '!=', 'cancelled')
            ->when($this->option('store'), fn ($q, $storeId) => $q->where('store_id', (int) $storeId))
            ->when($this->option('from'), fn ($q, $from) => $q->whereDate('invoice_date', '>=', $from))
            ->when($this->option('to'), fn ($q, $to) => $q->whereDate('invoice_date', '<=', $to))
            ->orderBy('id');
    }

    /**
     * TAX-01: a percent and the rupees it produced travel in one payload and the engine
     * that added them together took that money off twice — so the rupees stored on the
     * line are double what its own percent takes. The fixed engine cannot write that
     * figure: two discounts agreeing come off once, and two disagreeing never sum to
     * exactly twice the percent. The gap the line's own money left is measured too, so a
     * line that only looks doubled is not sent to the owner.
     */
    private function discountFinding(Invoice $invoice, InvoiceItem $item, int $line, array &$rows): void
    {
        $percent = (float) ($item->discount_percent ?? 0);
        $amount = (float) ($item->discount_amount ?? 0);

        if ($percent <= 0 || $amount <= 0) {
            return;
        }

        // Every basis but a loose rate quotes the pack, so a line's gross is the rate
        // across the packs it sold plus any loose part at its share of the pack price.
        $unitsPerPack = max(1, (int) ($item->units_per_pack ?: 1));
        $rate = (float) ($item->unit_price ?? 0);
        $loose = max(0, (float) ($item->loose_qty ?? 0));
        $gross = $this->isLooseBasis($item)
            ? ((float) $item->qty * $unitsPerPack + $loose) * $rate
            : round((float) $item->qty * $rate, 2) + ($loose > 0 ? round($loose * $rate / $unitsPerPack, 2) : 0.0);

        $byPercent = round($gross * min(100.0, $percent) / 100.0, 2);
        $twice = round(2 * $byPercent, 2);

        if ($byPercent <= 0 || abs($amount - $twice) > 0.05) {
            return;
        }

        // How much really came off is held two ways: an inclusive price leaves it as the
        // gap to the total, an exclusive one as the gap to the taxable figure, and a
        // stored line does not say which it was. Both gaps are read.
        $cameOff = [
            round($gross - (float) ($item->total_amount ?? 0), 2),
            round($gross - (float) ($item->taxable_amount ?? 0), 2),
        ];

        foreach ($cameOff as $off) {
            if (abs($off - $amount) > 0.05) {
                continue;
            }

            $rows[] = $this->row($invoice, $item, $line, 'DOUBLE_DISCOUNT', $off, $byPercent, sprintf(
                '%1$s%% took Rs %2$s and the Rs %2$s it produced was taken again; the line lost Rs %3$s.',
                $this->rupees($percent),
                $this->rupees($byPercent),
                $this->rupees($off)
            ));

            return;
        }
    }

    /**
     * TAX-02: a rate above the printed MRP. The ceiling is the master's, so a line whose
     * product no longer exists cannot be judged and is left alone.
     */
    private function mrpFinding(Invoice $invoice, InvoiceItem $item, int $line, array &$rows): void
    {
        $product = $item->product;
        if (!$product) {
            return;
        }

        $batch = $this->batchFor((int) $invoice->store_id, $product->id, $item->batch_no);
        $unitsPerPack = max(1, (int) ($item->units_per_pack ?: $product->units_per_pack ?: 1));
        $cap = MrpCeiling::rateCap($product, $batch, ['rate_basis' => $item->rate_basis], $unitsPerPack);
        $rate = (float) ($item->unit_price ?? 0);

        if (!MrpCeiling::isBreach($rate, $cap)) {
            return;
        }

        $rows[] = $this->row($invoice, $item, $line, 'ABOVE_MRP', $rate, $cap, sprintf(
            'Billed against an MRP of Rs %.2f%s.',
            (float) ($batch->mrp ?? $product->mrp ?? 0),
            $this->isLooseBasis($item) ? ' split across ' . $unitsPerPack . ' units' : ''
        ));
    }

    /**
     * TAX-03: a walk-in sale is supplied where the counter stands. A bill whose place of
     * supply is not the buyer's state — or one that charges IGST on a same-state sale —
     * holds the hardcoded place of supply this defect left behind.
     */
    private function placeOfSupplyFindings(Invoice $invoice, array &$rows): void
    {
        $storeCode = StateCodes::code($invoice->store?->state_code) ?? '32';
        $buyerCode = StateCodes::code($invoice->customer_gstin)
            ?? StateCodes::code($invoice->customer?->gstin)
            ?? StateCodes::code($invoice->customer?->state_code);
        $posCode = StateCodes::code($invoice->place_of_supply);
        $expected = $buyerCode ?? $storeCode;

        if ($posCode !== null && $posCode !== $expected) {
            $rows[] = $this->headerFinding(
                $invoice,
                'WRONG_PLACE_OF_SUPPLY',
                $posCode,
                $expected,
                'Place of supply does not follow the buyer.'
            );

            return;
        }

        $igst = (float) ($invoice->igst_total ?? 0);
        if ($igst > 0 && $storeCode === $expected) {
            $rows[] = $this->headerFinding(
                $invoice,
                'IGST_ON_LOCAL_SALE',
                $igst,
                0.0,
                'IGST charged on a same-state sale; it should be CGST + SGST.'
            );
        }
    }

    /**
     * RET-01: a credit note reverses the bill it credits. Crediting more than the share
     * of what that bill charged for the same units means the till re-priced the return —
     * GST added on top of a price that already held it.
     */
    private function returnFinding(Invoice $invoice, InvoiceItem $item, int $line, array &$rows): void
    {
        $original = $this->originalOf($invoice);
        if (!$original) {
            return;
        }

        $originalItem = $original->items->first(
            fn (InvoiceItem $it): bool => (string) $it->product_id === (string) $item->product_id
                || trim((string) $it->product_name) === trim((string) $item->product_name)
        );
        if (!$originalItem) {
            return;
        }

        $sold = $this->baseUnits($originalItem);
        $returned = $this->baseUnits($item);
        $charged = (float) ($originalItem->total_amount ?? 0);

        if ($sold <= 0 || $returned <= 0 || $charged <= 0) {
            return;
        }

        $expected = round($charged * min($returned, $sold) / $sold, 2);
        $credited = (float) ($item->total_amount ?? 0);

        if ($credited <= $expected + 0.02) {
            return;
        }

        $rows[] = $this->row($invoice, $item, $line, 'RETURN_REPRICED', $credited, $expected, sprintf(
            'Credits %s of the %s units the bill charged Rs %.2f for; the extra Rs %.2f was GST the price already held.',
            $this->rupees($returned),
            $this->rupees($sold),
            $charged,
            round($credited - $expected, 2)
        ));
    }

    private function originalOf(Invoice $note): ?Invoice
    {
        if (empty($note->original_invoice_number)) {
            return null;
        }

        // The bill being credited is read with its lines; without them the note cannot
        // be measured against anything.
        return Invoice::query()
            ->with('items')
            ->where('store_id', $note->store_id)
            ->where('invoice_number', $note->original_invoice_number)
            ->where('module_key', 'invoice')
            ->first();
    }

    private function baseUnits(InvoiceItem $item): float
    {
        $upp = max(1, (int) ($item->units_per_pack ?: 1));

        return max(0, (float) ($item->qty ?? 0)) * $upp + max(0, (float) ($item->loose_qty ?? 0));
    }

    private function isLooseBasis(InvoiceItem $item): bool
    {
        return strtolower(trim((string) $item->rate_basis)) === 'loose_rate';
    }

    private function batchFor(int $storeId, int $productId, ?string $batchNo): ?ProductBatch
    {
        $key = "{$storeId}:{$productId}:" . trim((string) $batchNo);

        if (!array_key_exists($key, $this->batches)) {
            $this->batches[$key] = ProductBatch::where('store_id', $storeId)
                ->where('product_id', $productId)
                ->when($batchNo, fn ($q, $no) => $q->where('batch_no', $no))
                ->orderBy('id')
                ->first();
        }

        return $this->batches[$key];
    }

    private function headerFinding(Invoice $invoice, string $finding, float $billed, float $expected, string $detail): array
    {
        return [
            'store_id' => $invoice->store_id,
            'document' => (string) $invoice->invoice_number,
            'date' => (string) $invoice->invoice_date,
            'line' => 0,
            'product' => (string) ($invoice->customer_name ?? ''),
            'finding' => $finding,
            'billed' => $billed,
            'expected' => $expected,
            'detail' => $detail,
        ];
    }

    private function row(Invoice $invoice, InvoiceItem $item, int $line, string $finding, float $billed, float $expected, string $detail): array
    {
        return [
            'store_id' => $invoice->store_id,
            'document' => (string) $invoice->invoice_number,
            'date' => (string) $invoice->invoice_date,
            'line' => $line,
            'product' => (string) ($item->product_name ?? ''),
            'finding' => $finding,
            'billed' => $billed,
            'expected' => $expected,
            'detail' => $detail,
        ];
    }

    private function rupees(float $value): string
    {
        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    }

    /**
     * A file the owner asked for is written whether or not anything was found: a clean
     * run still has to land as an empty report, not as a missing one.
     */
    private function writeRequestedCsv(array $rows): void
    {
        $out = $this->option('out');

        if ($out === null || $out === '') {
            return;
        }

        $this->writeCsv((string) $out, $rows);
        $this->info(count($rows) . ' finding(s) written to ' . $out);
    }

    private function writeCsv(string $path, array $rows): void
    {
        $handle = fopen($path, 'wb');
        if ($handle === false) {
            $this->error('Could not open ' . $path . ' for writing; the findings above are complete as they are.');

            return;
        }

        fputcsv($handle, ['store_id', 'document', 'date', 'line', 'product', 'finding', 'billed', 'expected', 'detail']);
        foreach ($rows as $row) {
            fputcsv($handle, array_values($row));
        }
        fclose($handle);
    }
}
