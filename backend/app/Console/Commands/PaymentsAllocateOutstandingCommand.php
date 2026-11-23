<?php

namespace App\Console\Commands;

use App\Models\CustomerPayment;
use App\Models\Party;
use App\Models\PaymentAllocation;
use App\Models\SupplierPayment;
use App\Services\Payments\PaymentAllocationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * PAY-05 — the receipts that only moved a balance.
 *
 * Before allocations existed, a receipt settled a customer's running balance and
 * left the invoice it paid reading "unpaid". This command places that money on the
 * bills it was owed, oldest debt first, exactly as the allocator does for a new
 * receipt — and it reads only the part of each receipt that is not yet placed, so
 * a receipt that was already allocated is left alone.
 *
 * The party balance is not touched: it moved when the receipt was recorded, and
 * placing the same money on a bill is a bookkeeping correction, not a second debit.
 */
class PaymentsAllocateOutstandingCommand extends Command
{
    protected $signature = 'payments:allocate-outstanding
        {--apply : Write the allocations (default is a dry run)}
        {--store= : Limit to one store id}
        {--kind=both : customer, supplier or both}';

    protected $description = 'Place receipts and supplier payments recorded before payments were allocated onto the bills they settled';

    public function handle(PaymentAllocationService $allocator): int
    {
        $apply = (bool) $this->option('apply');
        $storeId = $this->option('store');
        $kind = strtolower((string) $this->option('kind'));

        if (!in_array($kind, ['customer', 'supplier', 'both'], true)) {
            $this->error('--kind must be customer, supplier or both.');

            return self::FAILURE;
        }

        $rows = [];
        $onAccount = [];
        $placed = 0;

        $scope = fn ($query) => $query->when($storeId, fn ($q) => $q->where('store_id', (int) $storeId));

        if ($kind !== 'supplier') {
            foreach ($scope(CustomerPayment::orderBy('store_id')->orderBy('id'))->get() as $payment) {
                $this->sweep(
                    $rows,
                    $onAccount,
                    $placed,
                    $apply,
                    'Receipt',
                    'customer_payment',
                    $allocator,
                    $payment,
                    (int) $payment->customer_id
                );
            }
        }

        if ($kind !== 'customer') {
            foreach ($scope(SupplierPayment::orderBy('store_id')->orderBy('id'))->get() as $payment) {
                $this->sweep(
                    $rows,
                    $onAccount,
                    $placed,
                    $apply,
                    'Payment',
                    'supplier_payment',
                    $allocator,
                    $payment,
                    (int) $payment->supplier_id
                );
            }
        }

        if ($rows === []) {
            $this->info('Nothing to backfill.');
        } else {
            $this->table(['Store', 'Kind', 'Id', 'Party', 'Unplaced', 'Placed now', 'Bills it settles'], $rows);

            if ($apply) {
                $this->info('Allocated ' . $placed . ' payment(s).');
            } else {
                $this->warn('Dry run: ' . count($rows) . ' payment(s) would be placed on their bills. Re-run with --apply to write them.');
            }
        }

        foreach ($onAccount as [$store, $label, $id, $party, $open]) {
            $this->line("{$label} #{$id} ({$party}, store {$store}) of ₹" . number_format($open, 2, '.', '')
                . ' has no open bill left to settle; it stays on account as an advance.');
        }

        return self::SUCCESS;
    }

    /**
     * @param array<int, array<int, mixed>> $rows
     * @param array<int, array<int, mixed>> $onAccount
     */
    private function sweep(
        array &$rows,
        array &$onAccount,
        int &$placed,
        bool $apply,
        string $label,
        string $paymentType,
        PaymentAllocationService $allocator,
        CustomerPayment|SupplierPayment $payment,
        int $partyId
    ): void {
        $already = (float) PaymentAllocation::where('payment_type', $paymentType)
            ->where('payment_id', $payment->id)
            ->sum('amount');

        $open = round((float) $payment->amount - $already, 2);
        if ($open <= 0.005) {
            return;
        }

        $plan = $paymentType === 'customer_payment'
            ? $allocator->planCustomerAllocation((int) $payment->store_id, $partyId, $open)
            : $allocator->planSupplierAllocation((int) $payment->store_id, $partyId, $open);

        $party = Party::find($partyId)?->name ?? "party #{$partyId}";

        if ($plan === []) {
            $onAccount[] = [$payment->store_id, $label, $payment->id, $party, $open];
            return;
        }

        $rows[] = [
            $payment->store_id,
            $label,
            $payment->id,
            $party,
            $open,
            round(array_sum(array_column($plan, 'amount')), 2),
            implode('; ', array_map(
                fn (array $step) => ($step['document']->invoice_number ?? ('#' . $step['document']->id))
                    . ' ₹' . number_format($step['amount'], 2, '.', ''),
                $plan
            )),
        ];

        $placed++;

        if ($apply) {
            // One transaction per receipt: a failure leaves the rest of the run
            // as it was found, and the plan is re-read the next time.
            DB::transaction(fn () => $paymentType === 'customer_payment'
                ? $allocator->allocateCustomerPayment((int) $payment->id, (int) $payment->store_id, $partyId, $open, null)
                : $allocator->allocateSupplierPayment((int) $payment->id, (int) $payment->store_id, $partyId, $open, null));
        }
    }
}
