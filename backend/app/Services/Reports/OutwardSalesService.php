<?php

namespace App\Services\Reports;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Support\Money;
use Illuminate\Support\Collection;

/**
 * The one outward-sales reading every report shares. It answers the questions
 * that used to be re-implemented (and answered differently) in each controller:
 * which modules are sales, which are returns, what is the exclusive taxable
 * base, and how much of a tender actually stayed with the business.
 *
 * All totals are accumulated as integer paise so a report cannot publish float
 * noise, and returns are subtracted at the line that produced them.
 */
final class OutwardSalesService
{
    public const SALES_MODULES = ['invoice', 'pos'];

    public const RETURN_MODULES = ['credit_note', 'sales_return'];

    /** @var Collection<int, Invoice> */
    private Collection $invoices;

    /** @var array<string, mixed>|null */
    private ?array $gst = null;

    /** @var array<string, float>|null */
    private ?array $tenders = null;

    public function __construct(iterable $invoices)
    {
        $this->invoices = collect($invoices);
    }

    public static function forWindow(?int $storeId, string $startDate, string $endDate, ?string $counterId = null): self
    {
        $query = Invoice::with(['items', 'payments'])
            ->whereDate('invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoice_date', '<=', substr($endDate, 0, 10))
            ->where('status', '!=', 'cancelled')
            ->orderBy('invoice_date')
            ->orderBy('id');

        if ($storeId) {
            $query->where('store_id', $storeId);
        }

        if ($counterId !== null && $counterId !== '') {
            $query->where('counter_id', $counterId);
        }

        return new self($query->get());
    }

    public static function fromInvoices(iterable $invoices): self
    {
        return new self($invoices);
    }

    /** @return Collection<int, Invoice> */
    public function invoices(): Collection
    {
        return $this->invoices;
    }

    public static function isReturn(Invoice $invoice): bool
    {
        return in_array($invoice->module_key, self::RETURN_MODULES, true);
    }

    public static function isSale(Invoice $invoice): bool
    {
        return in_array($invoice->module_key, self::SALES_MODULES, true);
    }

    public static function sign(Invoice $invoice): int
    {
        return self::isReturn($invoice) ? -1 : 1;
    }

    public function grossSales(): float
    {
        return Money::sum(
            $this->invoices
                ->filter(fn (Invoice $invoice) => self::isSale($invoice))
                ->pluck('grand_total')
                ->all()
        );
    }

    public function totalReturns(): float
    {
        return Money::sum(
            $this->invoices
                ->filter(fn (Invoice $invoice) => self::isReturn($invoice))
                ->pluck('grand_total')
                ->all()
        );
    }

    public function netSales(): float
    {
        return self::roundPaise(Money::paise($this->grossSales()) - Money::paise($this->totalReturns()));
    }

    public function billsCount(): int
    {
        return $this->invoices->filter(fn (Invoice $invoice) => self::isSale($invoice))->count();
    }

    public function returnsCount(): int
    {
        return $this->invoices->filter(fn (Invoice $invoice) => self::isReturn($invoice))->count();
    }

    /**
     * One line's tax-exclusive value in paise — the same reading the GST
     * slabs and the salesperson register use, so a line is never worth two
     * different amounts in two reports.
     */
    public static function lineTaxablePaise(InvoiceItem $item): int
    {
        return $item->taxable_amount !== null
            ? Money::paise($item->taxable_amount)
            : Money::paise($item->total_amount)
                - Money::paise($item->cgst_amount)
                - Money::paise($item->sgst_amount)
                - Money::paise($item->igst_amount)
                - Money::paise($item->cess_amount);
    }

    /**
     * Exclusive taxable base for a document, in rupees.
     *
     * `taxable_subtotal` is the source of truth when it was written. Legacy and
     * synced header-only bills leave it at 0 (not null), so the base has to be
     * derived from the grand total less the tax, never read as 0.
     */
    public function taxableBase(Invoice $invoice): float
    {
        $taxableSubtotal = Money::paise($invoice->taxable_subtotal);
        if ($taxableSubtotal > 0) {
            return Money::toFloat($taxableSubtotal);
        }

        $items = $invoice->relationLoaded('items') ? $invoice->items : $invoice->items()->get();
        if ($items->isNotEmpty()) {
            $linePaise = 0;
            foreach ($items as $item) {
                $linePaise += self::lineTaxablePaise($item);
            }

            if ($linePaise > 0) {
                return Money::toFloat($linePaise);
            }
        }

        $derived = Money::paise($invoice->grand_total) - Money::paise($invoice->tax_total);
        if ($derived > 0) {
            return Money::toFloat($derived);
        }

        // A zero-value document has no taxable base even when a stale subtotal
        // was left on the row; a 0.00 bill must never inflate turnover.
        if (Money::paise($invoice->grand_total) <= 0) {
            return 0.0;
        }

        return Money::round2($invoice->subtotal);
    }

    /**
     * Line-level GST totals and rate slabs, returns subtracted at source.
     *
     * @return array{
     *     slabs: array<int, array<string, float|int>>,
     *     taxable_value: float,
     *     cgst_amount: float,
     *     sgst_amount: float,
     *     igst_amount: float,
     *     cess_amount: float,
     *     tax_amount: float
     * }
     */
    public function gst(): array
    {
        if ($this->gst !== null) {
            return $this->gst;
        }

        /** @var array<int, array<string, int>> $buckets */
        $buckets = [];

        foreach ($this->invoices as $invoice) {
            $sign = self::sign($invoice);
            $items = $invoice->relationLoaded('items') ? $invoice->items : $invoice->items()->get();

            if ($items->isNotEmpty()) {
                foreach ($items as $item) {
                    $cgst = Money::paise($item->cgst_amount);
                    $sgst = Money::paise($item->sgst_amount);
                    $igst = Money::paise($item->igst_amount);
                    $cess = Money::paise($item->cess_amount);
                    $tax = Money::paise($item->tax_amount);

                    $taxable = self::lineTaxablePaise($item);

                    if ($cgst + $sgst + $igst + $cess === 0 && $tax !== 0) {
                        [$cgst, $sgst, $igst] = $this->splitTax($tax, Money::paise($invoice->igst_total) > 0);
                    }

                    $rate = (int) round((float) ($item->gst_percent ?? 0));
                    $this->accumulate($buckets, $rate, $sign, $taxable, $cgst, $sgst, $igst, $cess);
                }

                continue;
            }

            $headerTax = Money::paise($invoice->tax_total);
            $cgst = Money::paise($invoice->cgst_total);
            $sgst = Money::paise($invoice->sgst_total);
            $igst = Money::paise($invoice->igst_total);
            $cess = Money::paise($invoice->cess_total);

            if ($cgst + $sgst + $igst + $cess === 0 && $headerTax !== 0) {
                [$cgst, $sgst, $igst] = $this->splitTax($headerTax, Money::paise($invoice->igst_total) > 0);
            }

            $taxTotal = $cgst + $sgst + $igst + $cess;
            if ($taxTotal === 0) {
                $taxTotal = $headerTax;
            }

            $taxable = Money::paise($this->taxableBase($invoice));
            $rate = $taxable !== 0 ? (int) round((($taxTotal / $taxable) * 100)) : 0;
            $this->accumulate($buckets, $rate, $sign, $taxable, $cgst, $sgst, $igst, $cess);
        }

        ksort($buckets);

        $slabs = [];
        $totals = ['taxable' => 0, 'cgst' => 0, 'sgst' => 0, 'igst' => 0, 'cess' => 0];

        foreach ($buckets as $rate => $bucket) {
            $slabs[] = [
                'rate' => $rate,
                'taxable_value' => Money::toFloat($bucket['taxable']),
                'cgst_amount' => Money::toFloat($bucket['cgst']),
                'sgst_amount' => Money::toFloat($bucket['sgst']),
                'igst_amount' => Money::toFloat($bucket['igst']),
                'cess_amount' => Money::toFloat($bucket['cess']),
                'total_tax' => Money::toFloat($bucket['cgst'] + $bucket['sgst'] + $bucket['igst'] + $bucket['cess']),
            ];

            foreach ($totals as $key => $value) {
                $totals[$key] = $value + $bucket[$key];
            }
        }

        return $this->gst = [
            'slabs' => $slabs,
            'taxable_value' => Money::toFloat($totals['taxable']),
            'cgst_amount' => Money::toFloat($totals['cgst']),
            'sgst_amount' => Money::toFloat($totals['sgst']),
            'igst_amount' => Money::toFloat($totals['igst']),
            'cess_amount' => Money::toFloat($totals['cess']),
            'tax_amount' => Money::toFloat($totals['cgst'] + $totals['sgst'] + $totals['igst'] + $totals['cess']),
        ];
    }

    /**
     * Tenders by bucket, using the amount applied to the bill — a 500 note on a
     * 210 bill contributes 210 and a credit note's refund subtracts.
     *
     * @return array<string, float>
     */
    public function tenders(): array
    {
        if ($this->tenders !== null) {
            return $this->tenders;
        }

        $paise = [
            'cash' => 0,
            'upi' => 0,
            'card' => 0,
            'bank_transfer' => 0,
            'credit' => 0,
            'other' => 0,
        ];

        foreach ($this->invoices as $invoice) {
            $sign = self::sign($invoice);
            $payments = $invoice->relationLoaded('payments') ? $invoice->payments : $invoice->payments()->get();

            if ($payments->isNotEmpty()) {
                $collectible = max(0, Money::paise($invoice->grand_total));
                $remaining = $collectible;

                foreach ($payments as $payment) {
                    if (in_array($payment->status, ['refunded', 'bounced'], true)) {
                        continue;
                    }

                    $applied = min($this->appliedPaymentPaise($payment), $remaining);
                    $applied = max(0, $applied);
                    $remaining -= $applied;

                    $paise[self::tenderBucket($payment->payment_mode)] += $applied * $sign;
                }

                continue;
            }

            $collectible = max(0, Money::paise($invoice->grand_total));
            $fallback = Money::paise($invoice->paid_amount);
            if ($fallback <= 0) {
                $fallback = $collectible;
            }

            $paise[self::tenderBucket($invoice->payment_mode)] += min($fallback, $collectible) * $sign;
        }

        $totals = [];
        foreach ($paise as $bucket => $value) {
            $totals[$bucket] = Money::toFloat($value);
        }

        return $this->tenders = $totals;
    }

    public function roundOff(): float
    {
        return Money::sum(
            $this->invoices
                ->map(fn (Invoice $invoice) => (float) ($invoice->round_off ?? 0) * self::sign($invoice))
                ->all()
        );
    }

    public static function tenderBucket(?string $mode): string
    {
        $value = strtolower(trim((string) $mode));

        if ($value === '') {
            return 'other';
        }
        if (str_contains($value, 'cash')) {
            return 'cash';
        }
        if (str_contains($value, 'upi') || str_contains($value, 'gpay') || str_contains($value, 'phonepe') || str_contains($value, 'paytm') || str_contains($value, 'qr')) {
            return 'upi';
        }
        if (str_contains($value, 'card') || str_contains($value, 'visa') || str_contains($value, 'pos') || str_contains($value, 'debit')) {
            return 'card';
        }
        if (str_contains($value, 'bank') || str_contains($value, 'neft') || str_contains($value, 'rtgs') || str_contains($value, 'imps') || str_contains($value, 'transfer')) {
            return 'bank_transfer';
        }
        if (str_contains($value, 'credit') || str_contains($value, 'udhari') || str_contains($value, 'due') || str_contains($value, 'ledger')) {
            return 'credit';
        }

        return 'other';
    }

    private function appliedPaymentPaise($payment): int
    {
        if ($payment->tendered_amount !== null) {
            $applied = Money::paise($payment->tendered_amount) - Money::paise($payment->change_amount);
            if ($applied > 0) {
                return $applied;
            }
        }

        return max(0, Money::paise($payment->amount));
    }

    /**
     * @return array{0: int, 1: int, 2: int}  [cgst, sgst, igst] in paise
     */
    private function splitTax(int $tax, bool $interState): array
    {
        if ($interState) {
            return [0, 0, $tax];
        }

        $cgst = intdiv($tax, 2);

        return [$cgst, $tax - $cgst, 0];
    }

    private function accumulate(array &$buckets, int $rate, int $sign, int $taxable, int $cgst, int $sgst, int $igst, int $cess): void
    {
        if (!isset($buckets[$rate])) {
            $buckets[$rate] = ['taxable' => 0, 'cgst' => 0, 'sgst' => 0, 'igst' => 0, 'cess' => 0];
        }

        $buckets[$rate]['taxable'] += $taxable * $sign;
        $buckets[$rate]['cgst'] += $cgst * $sign;
        $buckets[$rate]['sgst'] += $sgst * $sign;
        $buckets[$rate]['igst'] += $igst * $sign;
        $buckets[$rate]['cess'] += $cess * $sign;
    }

    private static function roundPaise(int $paise): float
    {
        return Money::toFloat($paise);
    }
}
