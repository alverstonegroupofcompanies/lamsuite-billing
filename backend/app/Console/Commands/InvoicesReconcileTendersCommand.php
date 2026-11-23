<?php

namespace App\Console\Commands;

use App\Models\Invoice;
use App\Models\InvoicePayment;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

/**
 * PAY-02 — the bills a till filed before payments were settled server-side.
 *
 * Those tills wrote the note, not what the bill kept: ₹500 handed over for a ₹210
 * bill became a ₹500 payment row, and on some bills a ₹500 paid_amount too. This
 * command re-reads each tender with the same arithmetic the server applies on
 * write — non-cash lines settle in full, cash fills what is left over and the rest
 * is change — and stores both halves of the story.
 *
 * Nothing is re-validated here: a UPI reference that was optional when the bill
 * was filed stays optional, because this command moves no money. It also never
 * lowers a paid_amount that is inside its own bill, because later receipts
 * legitimately raise that number without a tender row of their own.
 */
class InvoicesReconcileTendersCommand extends Command
{
    protected $signature = 'invoices:reconcile-tenders
        {--apply : Write the corrected tenders and headers (default is a dry run)}
        {--store= : Limit to one store id}';

    protected $description = 'Recompute applied amounts and change on tender rows written before payments were settled server-side';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store');

        $invoices = Invoice::where('module_key', 'invoice')
            ->where('status', '!=', 'cancelled')
            ->when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->orderBy('store_id')
            ->orderBy('id')
            ->get();

        $rows = [];
        $illegal = [];
        $unreconcilable = [];
        $changeBooked = 0.0;

        foreach ($invoices as $invoice) {
            $payments = InvoicePayment::where('invoice_id', $invoice->id)
                ->orderBy('id')
                ->get();

            if ($payments->isEmpty()) {
                if ((float) $invoice->paid_amount > (float) $invoice->grand_total + 0.005) {
                    $unreconcilable[] = [$invoice->store_id, $invoice->invoice_number, (float) $invoice->paid_amount];
                }
                continue;
            }

            $settled = $this->settle((float) $invoice->grand_total, $payments);

            if ($settled['over_tendered']) {
                $illegal[] = [
                    $invoice->store_id,
                    $invoice->invoice_number,
                    round((float) $invoice->grand_total, 2),
                    $settled['non_cash'],
                ];
                continue;
            }

            $fixes = [];
            foreach ($settled['lines'] as $line) {
                $updates = [];
                if ($this->money($line['payment']->amount) !== $line['applied']) {
                    $updates['amount'] = $line['applied'];
                }
                if ($line['payment']->tendered_amount === null
                    || $this->money($line['payment']->tendered_amount) !== $line['tendered']) {
                    $updates['tendered_amount'] = $line['tendered'];
                }
                if ($line['payment']->change_amount === null
                    || $this->money($line['payment']->change_amount) !== $line['change']) {
                    $updates['change_amount'] = $line['change'];
                }
                if ($updates !== []) {
                    $fixes[] = [$line['payment'], $updates];
                }
            }

            $header = [];
            if ($this->money($invoice->paid_amount) > round((float) $invoice->grand_total, 2)) {
                $header = ['paid_amount' => round((float) $invoice->grand_total, 2), 'payment_status' => 'paid'];
            }

            if ($fixes === [] && $header === []) {
                continue;
            }

            $rows[] = [
                $invoice->store_id,
                $invoice->invoice_number,
                round((float) $invoice->grand_total, 2),
                $this->money($invoice->paid_amount),
                $settled['paid'],
                $settled['change'],
                count($fixes),
            ];
            $changeBooked = $this->money($changeBooked + $settled['change']);

            if ($apply) {
                foreach ($fixes as [$payment, $updates]) {
                    $payment->update($updates);
                }
                if ($header !== []) {
                    $invoice->update($header);
                }
            }
        }

        if ($rows === []) {
            $this->info('Nothing to backfill.');
        } else {
            $this->table(['Store', 'Invoice', 'Bill total', 'Paid as filed', 'Collected now', 'Change', 'Rows'], $rows);

            if ($apply) {
                $this->info('Reconciled ' . count($rows) . ' bill(s).');
            } else {
                $this->warn('Dry run: ' . count($rows) . ' bill(s) would change. Re-run with --apply to write them.');
            }
        }

        if ($this->money($changeBooked) > 0) {
            $this->warn('₹' . number_format($changeBooked, 2, '.', '')
                . ' in change was booked as cash collected on the bills above. Shifts already closed keep the totals they were signed off with;'
                . ' the server tally and the next close read the corrected tenders.');
        }

        foreach ($illegal as [$store, $number, $grand, $nonCash]) {
            $this->warn("{$number} (store {$store}) was filed with ₹" . number_format($nonCash, 2, '.', '')
                . ' in non-cash tender against a ₹' . number_format($grand, 2, '.', '')
                . ' bill — change can only come from cash, so its tenders are left as recorded. Correct the bill or its payments by hand.');
        }

        foreach ($unreconcilable as [$store, $number, $paid]) {
            $this->warn("{$number} (store {$store}) shows a paid amount of ₹" . number_format($paid, 2, '.', '')
                . ' with no tender row to read it from, so it cannot be reconciled here.');
        }

        return self::SUCCESS;
    }

    /**
     * The settlement the server would have written for these tenders.
     *
     * A row written before the fix holds the whole note in `amount`; a settled row
     * already names what stayed in the drawer beside what was handed over, and
     * reading it again is a no-op — which is what makes this command re-runnable.
     *
     * @param  Collection<int, InvoicePayment>  $payments
     * @return array{
     *   lines: array<int, array{payment: InvoicePayment, tendered: float, applied: float, change: float}>,
     *   paid: float,
     *   credit: float,
     *   non_cash: float,
     *   change: float,
     *   over_tendered: bool
     * }
     */
    private function settle(float $grandTotal, Collection $payments): array
    {
        $grand = $this->money($grandTotal);
        $credit = 0.0;
        $nonCash = 0.0;

        $tendered = [];
        foreach ($payments as $payment) {
            $note = $this->tendered($payment);
            $tendered[$payment->id] = $note;

            if ($this->isCredit((string) $payment->payment_mode)) {
                $credit = $this->money($credit + $note);
            } elseif (!$this->isCash((string) $payment->payment_mode)) {
                $nonCash = $this->money($nonCash + $note);
            }
        }

        $overTendered = $this->money($nonCash + $credit) > $grand;
        $remaining = max(0.0, $this->money($grand - $nonCash - $credit));
        $paid = 0.0;
        $change = 0.0;
        $lines = [];

        foreach ($payments as $payment) {
            $mode = (string) $payment->payment_mode;
            $note = $tendered[$payment->id];

            if ($this->isCash($mode)) {
                $applied = $this->money(min($note, $remaining));
                $lineChange = $this->money($note - $applied);
                $remaining = $this->money($remaining - $applied);
            } else {
                $applied = $note;
                $lineChange = 0.0;
            }

            if (!$this->isCredit($mode)) {
                $paid = $this->money($paid + $applied);
            }
            $change = $this->money($change + $lineChange);

            $lines[] = [
                'payment' => $payment,
                'tendered' => $note,
                'applied' => $applied,
                'change' => $lineChange,
            ];
        }

        return [
            'lines' => $lines,
            'paid' => $paid,
            'credit' => $credit,
            'non_cash' => $nonCash,
            'change' => $change,
            'over_tendered' => $overTendered,
        ];
    }

    private function tendered(InvoicePayment $payment): float
    {
        $applied = $this->money($payment->amount);
        $handedOver = $payment->tendered_amount === null ? $applied : $this->money($payment->tendered_amount);

        return max($applied, $handedOver);
    }

    private function isCash(string $mode): bool
    {
        return strtolower(trim($mode)) === 'cash';
    }

    private function isCredit(string $mode): bool
    {
        return in_array(strtolower(trim($mode)), ['credit', 'udhari'], true);
    }

    private function money(mixed $value): float
    {
        return round((float) $value, 2);
    }
}
