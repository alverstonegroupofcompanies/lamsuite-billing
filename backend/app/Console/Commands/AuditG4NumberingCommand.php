<?php

namespace App\Console\Commands;

use App\Models\CounterSequence;
use App\Models\Invoice;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * G4-NUMBERING damage survey (dry run).
 *
 * Until the lease fix a till leased a fresh block of 50 numbers on every health
 * tick and the online bill route filed whatever number the till sent. Bills that
 * were printed under those numbers keep them — a printed bill is never renamed —
 * so this only reports what the series now looks like, for the owner and the
 * accountant:
 *
 *  - gaps: numbers inside a counter's series that no stored document carries;
 *  - duplicates: the same number filed twice in one store;
 *  - run-ahead: how far the series' next number sits past the last filed one.
 *
 * It reads the documents kept in `invoices` (sales invoices, credit notes,
 * quotations). It never writes: no sequence is rewound and no number changes.
 */
class AuditG4NumberingCommand extends Command
{
    protected $signature = 'billing:audit-g4-numbering
        {--store= : Limit the survey to one store id}
        {--out= : Also write the gap and duplicate findings to this CSV path}';

    protected $description = 'Dry-run survey of counter number series: gaps, duplicate numbers, and series that ran ahead of the bills (G4-NUMBERING)';

    public function handle(): int
    {
        $findings = [];

        $sequences = CounterSequence::query()
            ->when($this->option('store'), fn ($q, $store) => $q->where('store_id', (int) $store))
            ->orderBy('store_id')->orderBy('counter_id')->orderBy('doc_type')->orderBy('financial_year')
            ->get();

        $summary = [];

        foreach ($sequences as $sequence) {
            $numbers = $this->filedNumbers($sequence);

            if ($numbers === []) {
                continue;
            }

            $first = $numbers[0];
            $last = $numbers[count($numbers) - 1];
            $missing = 0;

            foreach ($this->gaps($numbers) as [$from, $to]) {
                $missing += $to - $from + 1;
                $findings[] = [
                    'kind' => 'gap',
                    'store_id' => $sequence->store_id,
                    'counter_id' => $sequence->counter_id,
                    'series' => $sequence->prefix,
                    'financial_year' => $sequence->financial_year,
                    'from' => "{$sequence->prefix}-{$from}",
                    'to' => "{$sequence->prefix}-{$to}",
                    'count' => $to - $from + 1,
                ];
            }

            $summary[] = [
                $sequence->store_id,
                $sequence->prefix,
                $sequence->financial_year,
                count($numbers),
                "{$first}–{$last}",
                $missing,
                max(0, (int) $sequence->next_number - ($last + 1)),
            ];
        }

        foreach ($this->duplicates() as $dup) {
            $findings[] = [
                'kind' => 'duplicate',
                'store_id' => $dup->store_id,
                'counter_id' => '',
                'series' => '',
                'financial_year' => '',
                'from' => $dup->invoice_number,
                'to' => $dup->invoice_number,
                'count' => (int) $dup->filed,
            ];
        }

        $this->info('G4-NUMBERING survey (dry run — nothing is written).');
        $this->table(
            ['Store', 'Series', 'FY', 'Filed', 'Range', 'Missing in range', 'Run-ahead'],
            $summary
        );

        $gaps = array_filter($findings, fn ($f) => $f['kind'] === 'gap');
        $dups = array_filter($findings, fn ($f) => $f['kind'] === 'duplicate');
        $this->line(sprintf('%d gap(s), %d duplicate number(s).', count($gaps), count($dups)));

        if ($dups !== []) {
            $this->table(['Store', 'Number', 'Times filed'], array_map(
                fn ($d) => [$d['store_id'], $d['from'], $d['count']],
                $dups
            ));
        }

        if ($out = $this->option('out')) {
            $this->writeCsv($out, $findings);
            $this->line("Findings written to {$out}");
        }

        return self::SUCCESS;
    }

    /** @return list<int> the numeric parts this series' documents carry, ascending */
    private function filedNumbers(CounterSequence $sequence): array
    {
        $pattern = '/^' . preg_quote($sequence->prefix, '/') . '-(\d+)$/';

        $numbers = Invoice::query()
            ->where('store_id', $sequence->store_id)
            ->where('invoice_number', 'like', $sequence->prefix . '-%')
            ->pluck('invoice_number')
            ->map(fn ($n) => preg_match($pattern, (string) $n, $m) ? (int) $m[1] : null)
            ->filter(fn ($n) => $n !== null)
            ->unique()
            ->sort()
            ->values()
            ->all();

        return $numbers;
    }

    /**
     * @param list<int> $numbers ascending, unique
     * @return list<array{0:int,1:int}> inclusive ranges no document carries
     */
    private function gaps(array $numbers): array
    {
        $gaps = [];

        for ($i = 1; $i < count($numbers); $i++) {
            if ($numbers[$i] > $numbers[$i - 1] + 1) {
                $gaps[] = [$numbers[$i - 1] + 1, $numbers[$i] - 1];
            }
        }

        return $gaps;
    }

    private function duplicates()
    {
        return DB::table('invoices')
            ->select('store_id', 'invoice_number', DB::raw('COUNT(*) as filed'))
            ->when($this->option('store'), fn ($q, $store) => $q->where('store_id', (int) $store))
            ->groupBy('store_id', 'invoice_number')
            ->having('filed', '>', 1)
            ->orderBy('store_id')
            ->get();
    }

    private function writeCsv(string $path, array $rows): void
    {
        $handle = fopen($path, 'w');
        fputcsv($handle, ['kind', 'store_id', 'counter_id', 'series', 'financial_year', 'from', 'to', 'count']);

        foreach ($rows as $row) {
            fputcsv($handle, array_values($row));
        }

        fclose($handle);
    }
}
