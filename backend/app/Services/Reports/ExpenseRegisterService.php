<?php

namespace App\Services\Reports;

use App\Models\Expense;
use App\Models\PurchaseCharge;

/**
 * CR-C Task 4.13 / REP-008 — the Expense Register.
 *
 * It did not exist before CR-C because a charge booked as an expense only appeared once its
 * twin row in `expenses` happened to be there. The register therefore reads the *bill* side
 * (`purchase_charges`, treatment `expense`) for charge rows and `expenses` for the rest, so a
 * supplier bill's freight shows up whether or not its register row survived an edit, and never
 * twice.
 */
class ExpenseRegisterService
{
    public const SOURCE_ALL = 'all';
    public const SOURCE_MANUAL = 'manual';
    public const SOURCE_CHARGE = 'purchase_charge';

    /**
     * @param  array{from?: ?string, to?: ?string, store_ids?: ?array<int>, head?: ?string, source?: ?string}  $filter
     * @return array<string, mixed>
     */
    public function register(array $filter = []): array
    {
        $from = $filter['from'] ?? null;
        $to = $filter['to'] ?? null;
        $storeIds = isset($filter['store_ids']) && $filter['store_ids'] !== null
            ? array_values(array_map('intval', $filter['store_ids']))
            : null;
        $source = $filter['source'] ?? self::SOURCE_ALL;
        $head = trim((string) ($filter['head'] ?? ''));

        $rows = [];

        if ($source !== self::SOURCE_MANUAL) {
            foreach ($this->chargeRows($from, $to, $storeIds, $head) as $row) {
                $rows[] = $row;
            }
        }

        if ($source !== self::SOURCE_CHARGE) {
            foreach ($this->manualRows($from, $to, $storeIds, $head) as $row) {
                $rows[] = $row;
            }
        }

        usort($rows, function (array $a, array $b) {
            return ($a['date'] <=> $b['date']) ?: ($a['purchase_number'] <=> $b['purchase_number'])
                ?: ($a['seq'] <=> $b['seq']) ?: strcmp($a['head'], $b['head']);
        });

        return [
            'period' => ['from' => $from, 'to' => $to],
            'rows' => $rows,
            'totals' => $this->totals($rows),
            'reconciliation' => $this->reconciliation($rows),
        ];
    }

    /**
     * @return \Illuminate\Support\Collection<int, array<string, mixed>>
     */
    private function chargeRows(?string $from, ?string $to, ?array $storeIds, string $head): \Illuminate\Support\Collection
    {
        $charges = PurchaseCharge::query()
            ->with(['purchase:id,store_id,invoice_number,supplier_name,invoice_date,status,module_key', 'expense'])
            ->where('treatment', 'expense')
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->when($from, fn ($q) => $q->whereHas('purchase', fn ($p) => $p->whereDate('invoice_date', '>=', $from)))
            ->when($to, fn ($q) => $q->whereHas('purchase', fn ($p) => $p->whereDate('invoice_date', '<=', $to)))
            ->when($head !== '', function ($q) use ($head) {
                $q->where(fn ($sub) => $sub->where('head_name', 'like', "%{$head}%")
                    ->orWhere('head_code', 'like', "%{$head}%"));
            })
            ->orderBy('id')
            ->get();

        return $charges
            // A cancelled bill reverses its own postings, and a cancelled note's reversal rows are
            // deleted with it; anything still pointing at a dead document stays out of the register.
            ->reject(fn (PurchaseCharge $charge) => $charge->purchase
                && $charge->purchase->status === 'cancelled')
            ->map(function (PurchaseCharge $charge) {
                $tax = $this->taxOf($charge);
                $creditable = $charge->itc_eligibility === 'eligible';
                $creditableTax = $creditable ? $tax : 0.0;
                $nonCreditableTax = round($tax - $creditableTax, 2);

                return [
                    'date' => optional($charge->purchase?->invoice_date)->toDateString()
                        ?? optional($charge->created_at)->toDateString(),
                    'source' => self::SOURCE_CHARGE,
                    'origin' => $charge->source,
                    'store_id' => (int) $charge->store_id,
                    'purchase_id' => $charge->purchase_id ? (int) $charge->purchase_id : null,
                    'purchase_number' => (string) ($charge->purchase?->invoice_number ?? ''),
                    'supplier_name' => (string) ($charge->purchase?->supplier_name ?? ''),
                    'seq' => (int) $charge->seq,
                    'head' => (string) $charge->head_name,
                    'head_code' => (string) $charge->head_code,
                    'sac_code' => $charge->sac_code,
                    'note' => $charge->note,
                    'taxable_amount' => round((float) $charge->taxable_amount, 2),
                    'gst_percent' => round((float) $charge->gst_percent, 2),
                    'cgst_amount' => round((float) $charge->cgst_amount, 2),
                    'sgst_amount' => round((float) $charge->sgst_amount, 2),
                    'igst_amount' => round((float) $charge->igst_amount, 2),
                    'cess_amount' => round((float) $charge->cess_amount, 2),
                    'tax_amount' => round($tax, 2),
                    'itc_eligibility' => (string) $charge->itc_eligibility,
                    'creditable' => $creditable,
                    'creditable_tax' => round($creditableTax, 2),
                    'non_creditable_tax' => $nonCreditableTax,
                    // PUR-012: the register takes the ex-tax charge plus the tax that can never be
                    // claimed back, so a blocked head cannot lose value from the books.
                    'amount' => round((float) $charge->taxable_amount + $nonCreditableTax, 2),
                    'is_rcm' => (bool) $charge->is_rcm,
                    'paid_separately' => (bool) $charge->paid_separately,
                    'in_payable' => (bool) $charge->in_payable,
                    'paid_to_label' => $charge->paid_to_label,
                    'payment_mode' => $charge->expense?->payment_mode
                        ?? ($charge->paid_separately ? 'Paid Separately' : 'On Account'),
                    'reference_no' => (string) ($charge->expense?->reference_no
                        ?? ($charge->purchase?->invoice_number ?? '')),
                    'purchase_charge_id' => (int) $charge->id,
                    'expense_id' => $charge->expense_id ? (int) $charge->expense_id : null,
                    'reversed_amount' => round((float) $charge->reversed_amount, 2),
                ];
            });
    }

    /**
     * @return \Illuminate\Support\Collection<int, array<string, mixed>>
     */
    private function manualRows(?string $from, ?string $to, ?array $storeIds, string $head): \Illuminate\Support\Collection
    {
        $expenses = Expense::query()
            ->whereNull('purchase_charge_id')
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->when($from, fn ($q) => $q->whereDate('expense_date', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('expense_date', '<=', $to))
            ->when($head !== '', fn ($q) => $q->where('expense_head', 'like', "%{$head}%"))
            ->orderBy('id')
            ->get();

        return $expenses->map(fn (Expense $expense) => [
            'date' => optional($expense->expense_date)->toDateString(),
            'source' => self::SOURCE_MANUAL,
            'origin' => 'manual',
            'store_id' => (int) $expense->store_id,
            'purchase_id' => $expense->purchase_id ? (int) $expense->purchase_id : null,
            'purchase_number' => '',
            'supplier_name' => '',
            'seq' => 0,
            'head' => (string) $expense->expense_head,
            'head_code' => '',
            'sac_code' => null,
            'note' => $expense->notes,
            'taxable_amount' => round((float) $expense->amount, 2),
            'gst_percent' => round((float) $expense->gst_percent, 2),
            'cgst_amount' => round((float) $expense->cgst_amount, 2),
            'sgst_amount' => round((float) $expense->sgst_amount, 2),
            'igst_amount' => round((float) $expense->igst_amount, 2),
            'cess_amount' => 0.0,
            'tax_amount' => round((float) $expense->cgst_amount + (float) $expense->sgst_amount
                + (float) $expense->igst_amount, 2),
            'itc_eligibility' => (string) ($expense->itc_eligibility ?? 'eligible'),
            'creditable' => ($expense->itc_eligibility ?? 'eligible') === 'eligible',
            'creditable_tax' => 0.0,
            'non_creditable_tax' => 0.0,
            'amount' => round((float) $expense->amount, 2),
            'is_rcm' => false,
            'paid_separately' => (bool) $expense->paid_separately,
            'in_payable' => false,
            'paid_to_label' => null,
            'payment_mode' => (string) $expense->payment_mode,
            'reference_no' => (string) ($expense->reference_no ?? ''),
            'purchase_charge_id' => null,
            'expense_id' => (int) $expense->id,
            'reversed_amount' => 0.0,
        ]);
    }

    private function taxOf(PurchaseCharge $charge): float
    {
        return round(
            (float) $charge->cgst_amount + (float) $charge->sgst_amount
            + (float) $charge->igst_amount + (float) $charge->cess_amount,
            2
        );
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, float|int>
     */
    private function totals(array $rows): array
    {
        $sum = fn (string $key, ?callable $where = null) => round(array_sum(array_map(
            fn (array $row) => $where && !$where($row) ? 0.0 : (float) $row[$key],
            $rows
        )), 2);

        $isCharge = fn (array $row) => $row['source'] === self::SOURCE_CHARGE;

        return [
            'rows' => count($rows),
            'postings' => $sum('amount'),
            'taxable' => $sum('taxable_amount'),
            'tax' => $sum('tax_amount'),
            'creditable_tax' => $sum('creditable_tax'),
            'non_creditable_tax' => $sum('non_creditable_tax'),
            'manual_postings' => $sum('amount', fn (array $row) => !$isCharge($row)),
            'charge_postings' => $sum('amount', $isCharge),
            'separately_paid_postings' => $sum('amount', fn (array $row) => $row['paid_separately']),
            'rcm_postings' => $sum('amount', fn (array $row) => $row['is_rcm']),
        ];
    }

    /**
     * The expense half of the reconciliation identity in `specs/modules/purchase-management.md`:
     * every charge posting equals its taxable plus the tax that can never be claimed, and the
     * register's charge total is that sum over the rows shown.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private function reconciliation(array $rows): array
    {
        $charges = array_values(array_filter($rows, fn (array $row) => $row['source'] === self::SOURCE_CHARGE));

        $postings = round(array_sum(array_map(fn (array $row) => (float) $row['amount'], $charges)), 2);
        $buildUp = round(array_sum(array_map(
            fn (array $row) => (float) $row['taxable_amount'] + (float) $row['non_creditable_tax'],
            $charges
        )), 2);

        return [
            'identity' => 'Σ expense-register charge postings = Σ charge taxable + non-creditable charge tax',
            'charge_postings' => $postings,
            'charge_taxable_plus_non_creditable_tax' => $buildUp,
            'delta' => round($postings - $buildUp, 2),
            'balanced' => abs($postings - $buildUp) < 0.005,
        ];
    }
}
