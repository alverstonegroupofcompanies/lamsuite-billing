<?php

namespace App\Services\Gst;

use App\Models\Invoice;
use App\Models\Purchase;
use Illuminate\Support\Carbon;

class GstWorkingPaperService
{
    /**
     * GSTR-3B working paper: rate-wise outward supplies and ITC.
     */
    public function gstr3b(?array $storeIds, string $from, string $to): array
    {
        $outward = $this->outwardSummary($storeIds, $from, $to);
        $itc = $this->itcSummary($storeIds, $from, $to);

        $net = fn (float $payable, float $credit): float => max(0, round($payable - $credit, 2));

        $netCgst = $net($outward['total_cgst'], $itc['total_cgst']);
        $netSgst = $net($outward['total_sgst'], $itc['total_sgst']);
        $netIgst = $net($outward['total_igst'], $itc['total_igst']);
        $netCess = $net($outward['total_cess'], $itc['total_cess']);

        return [
            'period' => ['from' => $from, 'to' => $to],
            'outward' => $outward,
            'itc' => $itc,
            'net_payable' => [
                'cgst' => $netCgst,
                'sgst' => $netSgst,
                'igst' => $netIgst,
                'cess' => $netCess,
                'total' => round($netCgst + $netSgst + $netIgst + $netCess, 2),
            ],
            'notes' => [
                'Outward supplies include POS invoices and exclude cancelled documents; credit notes reduce the liability.',
                'ITC is computed from received purchase bills. Reverse-charge and ineligible purchases are excluded from available ITC.',
                'Documents without usable line tax values (e.g. synced POS bills) are grouped under "Header only" using header tax totals.',
                'This is a working paper prepared from books, not a filed return. Reconcile with the GST portal before filing.',
            ],
        ];
    }

    /**
     * GSTR-9 annual working paper aggregated for a fiscal year.
     */
    public function gstr9(?array $storeIds, string $from, string $to): array
    {
        $outward = $this->outwardSummary($storeIds, $from, $to);
        $itc = $this->itcSummary($storeIds, $from, $to);

        $storeIdsFilter = $storeIds;

        $grossSales = (float) Invoice::query()
            ->whereIn('module_key', ['invoice', 'pos'])
            ->where('status', '!=', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIdsFilter, fn ($q) => $q->whereIn('store_id', $storeIdsFilter))
            ->sum('grand_total');

        $returns = (float) Invoice::query()
            ->where('module_key', 'credit_note')
            ->where('status', '!=', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIdsFilter, fn ($q) => $q->whereIn('store_id', $storeIdsFilter))
            ->sum('grand_total');

        $invoiceCount = (int) Invoice::query()
            ->whereIn('module_key', ['invoice', 'pos'])
            ->where('status', '!=', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIdsFilter, fn ($q) => $q->whereIn('store_id', $storeIdsFilter))
            ->count();

        $creditNoteCount = (int) Invoice::query()
            ->where('module_key', 'credit_note')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIdsFilter, fn ($q) => $q->whereIn('store_id', $storeIdsFilter))
            ->count();

        $cancelledCount = (int) Invoice::query()
            ->where('status', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIdsFilter, fn ($q) => $q->whereIn('store_id', $storeIdsFilter))
            ->count();

        $purchaseCount = (int) Purchase::query()
            ->where('module_key', 'purchase')
            ->where('status', '!=', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIdsFilter, fn ($q) => $q->whereIn('store_id', $storeIdsFilter))
            ->count();

        $netTurnover = round($grossSales - $returns, 2);
        $booksTax = $outward['total_tax'];

        return [
            'fiscal_year' => $this->fiscalYearLabel($from),
            'period' => ['from' => $from, 'to' => $to],
            'turnover' => [
                'gross_sales' => round($grossSales, 2),
                'returns' => round($returns, 2),
                'net_turnover' => $netTurnover,
                'taxable_turnover' => $outward['total_taxable'],
                'nil_exempt_turnover' => $outward['nil_rated_taxable'],
                'tax_on_outward' => $booksTax,
            ],
            'rate_wise_outward' => $outward['rate_wise'],
            'itc' => [
                'rate_wise' => $itc['rate_wise'],
                'total_taxable' => $itc['total_taxable'],
                'total_itc' => $itc['total_itc'],
                'ineligible_itc' => $itc['ineligible_itc'],
                'reverse_charge_tax' => $itc['rcm_tax'],
            ],
            'reconciliation' => [
                'gstr1_turnover' => $netTurnover,
                'books_turnover' => $netTurnover,
                'turnover_difference' => 0,
                'tax_per_books' => $booksTax,
                'itc_availed' => $itc['total_itc'],
                'net_tax_estimate' => round(max(0, $booksTax - $itc['total_itc']), 2),
            ],
            'documents' => [
                'invoices' => $invoiceCount,
                'credit_notes' => $creditNoteCount,
                'cancelled' => $cancelledCount,
                'purchase_bills' => $purchaseCount,
            ],
            'notes' => [
                'Annual aggregate working paper; not a substitute for the GSTR-9 filing on the GST portal.',
                'Turnover and tax figures are derived from booked invoices and purchase bills for the fiscal year.',
            ],
        ];
    }

    private function outwardSummary(?array $storeIds, string $from, string $to): array
    {
        $invoices = Invoice::with('items')
            ->whereIn('module_key', ['invoice', 'pos', 'credit_note'])
            ->where('status', '!=', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->get();

        $buckets = [];
        $nilTaxable = 0.0;
        $interState = 0.0;
        $intraState = 0.0;

        foreach ($invoices as $invoice) {
            $sign = $invoice->module_key === 'credit_note' ? -1 : 1;

            $lines = [];
            $itemTaxable = $invoice->items->sum(fn ($item) => (float) ($item->taxable_amount ?? 0));

            if ($invoice->items->isNotEmpty() && $itemTaxable > 0) {
                foreach ($invoice->items as $item) {
                    $tax = (float) ($item->tax_amount ?? 0);
                    $igst = (float) ($item->igst_amount ?? 0);
                    $cgst = (float) ($item->cgst_amount ?? 0);
                    $sgst = (float) ($item->sgst_amount ?? 0);
                    $cess = (float) ($item->cess_amount ?? 0);

                    if ($cgst + $sgst + $igst + $cess <= 0 && $tax > 0) {
                        if ((float) $invoice->igst_total > 0) {
                            $igst = $tax;
                        } else {
                            $cgst = round($tax / 2, 2);
                            $sgst = round($tax - $cgst, 2);
                        }
                    }

                    $lines[] = [
                        (float) ($item->gst_percent ?? 0),
                        (float) $item->taxable_amount,
                        $cgst,
                        $sgst,
                        $igst,
                        $cess,
                    ];
                }
            } else {
                // Bills without usable line detail (e.g. synced POS invoices) fall back to header totals
                $lines[] = $this->invoiceFallbackLine($invoice);
            }

            foreach ($lines as [$rate, $taxable, $cgst, $sgst, $igst, $cess]) {
                $this->accumulateLine($buckets, $rate, $sign, $taxable, $cgst, $sgst, $igst, $cess);

                if ($rate !== null && $rate <= 0) {
                    $nilTaxable += $sign * $taxable;
                }

                if ($igst > 0) {
                    $interState += $sign * $taxable;
                } else {
                    $intraState += $sign * $taxable;
                }
            }
        }

        $rows = $this->finalizeBuckets($buckets);

        return [
            'rate_wise' => $rows,
            'nil_rated_taxable' => round($nilTaxable, 2),
            'inter_state_taxable' => round($interState, 2),
            'intra_state_taxable' => round($intraState, 2),
            'total_taxable' => round(array_sum(array_column($rows, 'taxable_value')), 2),
            'total_cgst' => round(array_sum(array_column($rows, 'cgst_amount')), 2),
            'total_sgst' => round(array_sum(array_column($rows, 'sgst_amount')), 2),
            'total_igst' => round(array_sum(array_column($rows, 'igst_amount')), 2),
            'total_cess' => round(array_sum(array_column($rows, 'cess_amount')), 2),
            'total_tax' => round(array_sum(array_column($rows, 'tax_amount')), 2),
            'documents' => $invoices->count(),
        ];
    }

    private function itcSummary(?array $storeIds, string $from, string $to): array
    {
        $purchases = Purchase::with('items')
            ->where('module_key', 'purchase')
            ->where('status', '!=', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->get();

        $buckets = [];
        $ineligibleItc = 0.0;
        $rcmTaxable = 0.0;
        $rcmTax = 0.0;

        foreach ($purchases as $purchase) {
            $isRcm = (bool) $purchase->is_rcm;
            $ineligible = ($purchase->itc_eligibility ?? 'eligible') === 'ineligible';

            if ($isRcm || $ineligible) {
                $tax = (float) $purchase->cgst_total + (float) $purchase->sgst_total
                    + (float) $purchase->igst_total + (float) $purchase->cess_total;

                if ($isRcm) {
                    $rcmTaxable += (float) $purchase->subtotal;
                    $rcmTax += $tax;
                } else {
                    $ineligibleItc += $tax;
                }

                continue;
            }

            $lines = [];
            $itemTaxable = $purchase->items->sum(fn ($item) => (float) ($item->taxable_amount ?? 0));

            if ($purchase->items->isNotEmpty() && $itemTaxable > 0) {
                foreach ($purchase->items as $item) {
                    $tax = (float) ($item->tax_amount ?? 0);
                    $igst = (float) ($item->igst_amount ?? 0);
                    $cgst = (float) ($item->cgst_amount ?? 0);
                    $sgst = (float) ($item->sgst_amount ?? 0);
                    $cess = (float) ($item->cess_amount ?? 0);

                    if ($cgst + $sgst + $igst + $cess <= 0 && $tax > 0) {
                        if ((float) $purchase->igst_total > 0) {
                            $igst = $tax;
                        } else {
                            $cgst = round($tax / 2, 2);
                            $sgst = round($tax - $cgst, 2);
                        }
                    }

                    $lines[] = [
                        (float) ($item->gst_percent ?? 0),
                        (float) $item->taxable_amount,
                        $cgst,
                        $sgst,
                        $igst,
                        $cess,
                    ];
                }
            } else {
                $lines[] = $this->purchaseFallbackLine($purchase);
            }

            foreach ($lines as [$rate, $taxable, $cgst, $sgst, $igst, $cess]) {
                $this->accumulateLine($buckets, $rate, 1, $taxable, $cgst, $sgst, $igst, $cess);
            }
        }

        $rows = $this->finalizeBuckets($buckets);

        return [
            'rate_wise' => $rows,
            'total_taxable' => round(array_sum(array_column($rows, 'taxable_value')), 2),
            'total_cgst' => round(array_sum(array_column($rows, 'cgst_amount')), 2),
            'total_sgst' => round(array_sum(array_column($rows, 'sgst_amount')), 2),
            'total_igst' => round(array_sum(array_column($rows, 'igst_amount')), 2),
            'total_cess' => round(array_sum(array_column($rows, 'cess_amount')), 2),
            'total_itc' => round(array_sum(array_column($rows, 'tax_amount')), 2),
            'ineligible_itc' => round($ineligibleItc, 2),
            'rcm_taxable' => round($rcmTaxable, 2),
            'rcm_tax' => round($rcmTax, 2),
        ];
    }

    /**
     * Header-only line for invoices without usable item rows (e.g. synced POS bills).
     * The rate is null because per-line tax slabs are unavailable.
     */
    private function invoiceFallbackLine(Invoice $invoice): array
    {
        $tax = (float) $invoice->tax_total;
        $igst = (float) $invoice->igst_total;
        $cgst = (float) $invoice->cgst_total;
        $sgst = (float) $invoice->sgst_total;
        $cess = (float) $invoice->cess_total;

        if ($cgst + $sgst + $igst + $cess <= 0 && $tax > 0) {
            if ($igst > 0) {
                $igst = $tax;
            } else {
                $cgst = round($tax / 2, 2);
                $sgst = round($tax - $cgst, 2);
            }
        }

        $taxable = (float) $invoice->taxable_subtotal > 0
            ? (float) $invoice->taxable_subtotal
            : (float) $invoice->subtotal;

        return [null, $taxable, $cgst, $sgst, $igst, $cess];
    }

    /**
     * Header-only line for purchase bills without usable item rows.
     */
    private function purchaseFallbackLine(Purchase $purchase): array
    {
        $tax = (float) $purchase->tax_total;
        $igst = (float) $purchase->igst_total;
        $cgst = (float) $purchase->cgst_total;
        $sgst = (float) $purchase->sgst_total;
        $cess = (float) $purchase->cess_total;

        if ($cgst + $sgst + $igst + $cess <= 0 && $tax > 0) {
            if ($igst > 0) {
                $igst = $tax;
            } else {
                $cgst = round($tax / 2, 2);
                $sgst = round($tax - $cgst, 2);
            }
        }

        return [null, (float) $purchase->subtotal, $cgst, $sgst, $igst, $cess];
    }

    private function accumulateLine(
        array &$buckets,
        ?float $rate,
        float $sign,
        float $taxable,
        float $cgst,
        float $sgst,
        float $igst,
        float $cess
    ): void {
        $key = $rate === null ? 'header' : number_format($rate, 2, '.', '');

        if (!isset($buckets[$key])) {
            $buckets[$key] = [
                'rate' => $rate,
                'taxable_value' => 0.0,
                'cgst_amount' => 0.0,
                'sgst_amount' => 0.0,
                'igst_amount' => 0.0,
                'cess_amount' => 0.0,
                'tax_amount' => 0.0,
            ];
        }

        $buckets[$key]['taxable_value'] += $sign * $taxable;
        $buckets[$key]['cgst_amount'] += $sign * $cgst;
        $buckets[$key]['sgst_amount'] += $sign * $sgst;
        $buckets[$key]['igst_amount'] += $sign * $igst;
        $buckets[$key]['cess_amount'] += $sign * $cess;
        $buckets[$key]['tax_amount'] += $sign * ($cgst + $sgst + $igst + $cess);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function finalizeBuckets(array $buckets): array
    {
        $headerBucket = $buckets['header'] ?? null;
        unset($buckets['header']);

        ksort($buckets, SORT_NUMERIC);

        if ($headerBucket !== null) {
            $buckets['header'] = $headerBucket;
        }

        return array_values(array_map(fn (array $row) => [
            'rate' => $row['rate'],
            'rate_label' => $row['rate'] === null
                ? 'Header only'
                : rtrim(rtrim(number_format((float) $row['rate'], 2, '.', ''), '0'), '.') . '%',
            'taxable_value' => round($row['taxable_value'], 2),
            'cgst_amount' => round($row['cgst_amount'], 2),
            'sgst_amount' => round($row['sgst_amount'], 2),
            'igst_amount' => round($row['igst_amount'], 2),
            'cess_amount' => round($row['cess_amount'], 2),
            'tax_amount' => round($row['tax_amount'], 2),
        ], $buckets));
    }

    private function fiscalYearLabel(string $from): string
    {
        $date = Carbon::parse($from);
        $startYear = $date->month >= 4 ? $date->year : $date->year - 1;

        return sprintf('%d-%02d', $startYear, ($startYear + 1) % 100);
    }
}
