<?php

namespace App\Services\Payments;

use App\Models\CustomerPayment;
use App\Models\InvoicePayment;
use App\Models\SettlementBatch;
use App\Models\SettlementLine;
use Illuminate\Support\Facades\DB;

class SettlementReconService
{
    private const TOLERANCE = 0.01;

    /**
     * Parse a settlement CSV. Header names are matched loosely so exports from
     * banks/UPI/card providers can be imported with minimal edits.
     *
     * @return array{rows: array<int, array<string, mixed>>, errors: array<int, string>}
     */
    public function parseCsv(string $csv): array
    {
        $csv = trim(preg_replace('/^\xEF\xBB\xBF/', '', $csv) ?? '');
        if ($csv === '') {
            return ['rows' => [], 'errors' => ['The uploaded file is empty.']];
        }

        $temp = fopen('php://temp', 'r+');
        fwrite($temp, $csv);
        rewind($temp);

        $header = fgetcsv($temp);
        if (!$header) {
            fclose($temp);
            return ['rows' => [], 'errors' => ['Unable to read the header row.']];
        }

        $keys = array_map(fn ($h) => strtolower(trim((string) $h)), $header);
        $idx = $this->resolveColumnIndexes($keys);

        $rows = [];
        $errors = [];
        $lineNo = 1;

        while (($data = fgetcsv($temp)) !== false) {
            $lineNo++;
            if ($data === [null] || (count($data) === 1 && trim((string) $data[0]) === '')) {
                continue;
            }

            $reference = trim((string) ($data[$idx['reference']] ?? ''));
            $amount = (float) str_replace([',', '₹', ' '], '', (string) ($data[$idx['amount']] ?? ''));

            if ($reference === '') {
                $errors[] = "Row {$lineNo}: missing transaction reference.";
                continue;
            }
            if ($amount <= 0) {
                $errors[] = "Row {$lineNo}: invalid amount.";
                continue;
            }

            $rows[] = [
                'txn_date' => $this->parseDate($this->cell($data, $idx['date'])),
                'reference' => substr($reference, 0, 128),
                'amount' => round($amount, 2),
                'mode' => $this->normalizeMode($this->cell($data, $idx['mode'])),
                'payer_ref' => $this->nullableString($this->cell($data, $idx['payer'])),
            ];
        }
        fclose($temp);

        if (empty($rows) && empty($errors)) {
            $errors[] = 'No data rows found.';
        }

        return ['rows' => $rows, 'errors' => $errors];
    }

    private function cell(array $data, int $index): ?string
    {
        if ($index < 0) return null;
        return isset($data[$index]) ? (string) $data[$index] : null;
    }

    private function resolveColumnIndexes(array $keys): array
    {
        $find = function (array $candidates) use ($keys): ?int {
            foreach ($keys as $i => $key) {
                foreach ($candidates as $candidate) {
                    if ($key === $candidate || str_contains($key, $candidate)) {
                        return $i;
                    }
                }
            }
            return null;
        };

        $reference = $find(['utr', 'rrn', 'txn_ref', 'transaction_ref', 'reference', 'ref_no', 'txn_id', 'transaction_id']);
        $amount = $find(['amount', 'credit', 'net_amount', 'settled_amount']);
        $date = $find(['date', 'value_date']);
        $mode = $find(['mode', 'payment_mode', 'tender', 'instrument', 'type']);
        $payer = $find(['payer', 'customer', 'description', 'narration', 'remarks']);

        $missing = [];
        if ($reference === null) $missing[] = 'reference (UTR/RRN)';
        if ($amount === null) $missing[] = 'amount';
        if (!empty($missing)) {
            throw new \InvalidArgumentException('CSV header must include: ' . implode(', ', $missing) . '.');
        }

        return [
            'reference' => $reference,
            'amount' => $amount,
            'date' => $date ?? -1,
            'mode' => $mode ?? -1,
            'payer' => $payer ?? -1,
        ];
    }

    public function preview(int $storeId, array $rows): array
    {
        return array_map(
            fn (array $row) => array_merge($row, $this->matchRow($storeId, $row)),
            $rows
        );
    }

    public function import(int $storeId, array $rows, array $meta, ?int $userId = null): SettlementBatch
    {
        return DB::transaction(function () use ($storeId, $rows, $meta, $userId) {
            $batch = SettlementBatch::create([
                'store_id' => $storeId,
                'source' => $meta['source'] ?? 'bank',
                'file_name' => $meta['file_name'] ?? null,
                'period_start' => $meta['period_start'] ?? null,
                'period_end' => $meta['period_end'] ?? null,
                'total_amount' => array_sum(array_map(fn ($r) => (float) $r['amount'], $rows)),
                'line_count' => count($rows),
                'status' => SettlementBatch::STATUS_IMPORTED,
                'imported_by' => $userId,
                'notes' => $meta['notes'] ?? null,
            ]);

            $matched = 0;
            $exceptions = 0;

            foreach ($rows as $row) {
                $match = $this->matchRow($storeId, $row);
                if ($match['status'] === SettlementLine::STATUS_MATCHED) {
                    $matched++;
                } elseif (in_array($match['status'], [SettlementLine::STATUS_EXCEPTION, SettlementLine::STATUS_UNMATCHED], true)) {
                    $exceptions++;
                }

                SettlementLine::create([
                    'settlement_batch_id' => $batch->id,
                    'store_id' => $storeId,
                    'txn_date' => $row['txn_date'] ?? null,
                    'reference' => $row['reference'],
                    'amount' => $row['amount'],
                    'mode' => $row['mode'] ?? null,
                    'payer_ref' => $row['payer_ref'] ?? null,
                    'status' => $match['status'],
                    'match_type' => $match['match_type'],
                    'match_id' => $match['match_id'],
                    'invoice_number' => $match['invoice_number'],
                    'note' => $match['note'],
                ]);
            }

            $batch->update([
                'matched_count' => $matched,
                'exception_count' => $exceptions,
                'status' => $this->batchStatus($matched, $exceptions),
            ]);

            return $batch->fresh('lines');
        });
    }

    public function rematch(SettlementBatch $batch): SettlementBatch
    {
        DB::transaction(function () use ($batch) {
            foreach ($batch->lines as $line) {
                if (in_array($line->status, [SettlementLine::STATUS_IGNORED, SettlementLine::STATUS_RESOLVED], true)) {
                    continue;
                }
                $match = $this->matchRow($batch->store_id, [
                    'reference' => $line->reference,
                    'amount' => (float) $line->amount,
                ]);
                $line->update([
                    'status' => $match['status'],
                    'match_type' => $match['match_type'],
                    'match_id' => $match['match_id'],
                    'invoice_number' => $match['invoice_number'],
                    'note' => $match['note'],
                ]);
            }
            $this->refreshBatchCounts($batch);
        });

        return $batch->fresh('lines');
    }

    public function resolveLine(SettlementLine $line, string $action, ?string $matchType = null, ?int $matchId = null, ?string $note = null): SettlementLine
    {
        if ($action === 'ignore') {
            $line->update(['status' => SettlementLine::STATUS_IGNORED, 'note' => $note ?? 'Manually ignored']);
        } elseif ($action === 'attach') {
            if (!$matchType || !$matchId) {
                throw new \InvalidArgumentException('Attach requires match_type and match_id.');
            }
            $invoiceNumber = null;
            if ($matchType === 'invoice_payment') {
                $invoiceNumber = InvoicePayment::with('invoice')->find($matchId)?->invoice?->invoice_number;
            }
            $line->update([
                'status' => SettlementLine::STATUS_RESOLVED,
                'match_type' => $matchType,
                'match_id' => $matchId,
                'invoice_number' => $invoiceNumber,
                'note' => $note ?? 'Manually matched',
            ]);
        } else {
            throw new \InvalidArgumentException('Unknown resolution action.');
        }

        $this->refreshBatchCounts($line->batch);
        return $line->fresh();
    }

    private function refreshBatchCounts(SettlementBatch $batch): void
    {
        $lines = $batch->lines()->get();
        $matched = $lines->whereIn('status', [SettlementLine::STATUS_MATCHED, SettlementLine::STATUS_RESOLVED])->count();
        $exceptions = $lines->whereIn('status', [SettlementLine::STATUS_UNMATCHED, SettlementLine::STATUS_EXCEPTION])->count();

        $batch->update([
            'matched_count' => $matched,
            'exception_count' => $exceptions,
            'status' => $this->batchStatus($matched, $exceptions),
        ]);
    }

    private function batchStatus(int $matched, int $exceptions): string
    {
        if ($exceptions === 0) return SettlementBatch::STATUS_RECONCILED;
        return $matched > 0 ? SettlementBatch::STATUS_PARTIAL : SettlementBatch::STATUS_IMPORTED;
    }

    private function matchRow(int $storeId, array $row): array
    {
        $reference = trim((string) ($row['reference'] ?? ''));
        $amount = round((float) ($row['amount'] ?? 0), 2);
        $needle = strtoupper($reference);

        if ($needle === '') {
            return ['status' => SettlementLine::STATUS_UNMATCHED, 'match_type' => null, 'match_id' => null, 'invoice_number' => null, 'note' => 'Missing reference.'];
        }

        $invoicePayments = InvoicePayment::with('invoice')
            ->where('store_id', $storeId)
            ->whereRaw('UPPER(TRIM(reference_no)) = ?', [$needle])
            ->get();

        $customerPayments = CustomerPayment::where('store_id', $storeId)
            ->whereRaw('UPPER(TRIM(reference_no)) = ?', [$needle])
            ->get();

        $candidates = [];
        foreach ($invoicePayments as $payment) {
            $candidates[] = [
                'type' => 'invoice_payment',
                'id' => $payment->id,
                'amount' => (float) $payment->amount,
                'invoice_number' => $payment->invoice?->invoice_number,
            ];
        }
        foreach ($customerPayments as $payment) {
            $candidates[] = [
                'type' => 'customer_payment',
                'id' => $payment->id,
                'amount' => (float) $payment->amount,
                'invoice_number' => null,
            ];
        }

        if (empty($candidates)) {
            return ['status' => SettlementLine::STATUS_UNMATCHED, 'match_type' => null, 'match_id' => null, 'invoice_number' => null, 'note' => 'No payment found with this reference.'];
        }

        $exact = array_values(array_filter($candidates, fn ($c) => abs($c['amount'] - $amount) <= self::TOLERANCE));
        if (count($exact) === 1) {
            return [
                'status' => SettlementLine::STATUS_MATCHED,
                'match_type' => $exact[0]['type'],
                'match_id' => $exact[0]['id'],
                'invoice_number' => $exact[0]['invoice_number'],
                'note' => null,
            ];
        }
        if (count($exact) > 1) {
            return ['status' => SettlementLine::STATUS_EXCEPTION, 'match_type' => null, 'match_id' => null, 'invoice_number' => null, 'note' => 'Multiple payments share this reference.'];
        }

        return [
            'status' => SettlementLine::STATUS_EXCEPTION,
            'match_type' => $candidates[0]['type'],
            'match_id' => $candidates[0]['id'],
            'invoice_number' => $candidates[0]['invoice_number'],
            'note' => sprintf('Amount mismatch: settled ₹%.2f vs recorded ₹%.2f.', $amount, $candidates[0]['amount']),
        ];
    }

    private function parseDate(?string $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '') return null;

        foreach (['Y-m-d', 'd/m/Y', 'd-m-Y', 'Y/m/d', 'd M Y', 'j/n/Y'] as $format) {
            $dt = \DateTime::createFromFormat($format, $value);
            if ($dt instanceof \DateTime) {
                return $dt->format('Y-m-d');
            }
        }

        try {
            return (new \DateTime($value))->format('Y-m-d');
        } catch (\Throwable) {
            return null;
        }
    }

    private function normalizeMode(?string $value): ?string
    {
        $value = strtolower(trim((string) $value));
        if ($value === '') return null;
        if (str_contains($value, 'upi')) return 'upi';
        if (str_contains($value, 'card')) return 'card';
        if (str_contains($value, 'cash')) return 'cash';
        if (str_contains($value, 'bank') || str_contains($value, 'neft') || str_contains($value, 'imps')) return 'bank';
        return substr($value, 0, 32);
    }

    private function nullableString(?string $value): ?string
    {
        $value = trim((string) $value);
        return $value === '' ? null : substr($value, 0, 255);
    }
}
