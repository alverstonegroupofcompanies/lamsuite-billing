<?php

namespace App\Services;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\Invoice;
use InvalidArgumentException;

/**
 * CNT-014 — document number series are owned by the counter, not the device
 * and not the store.
 *
 * One canonical doc-type set is seeded for every counter, a lease moves only
 * the series it names, and an incoming document number is either adopted (the
 * counter issued it) or replaced (the counter did not). A temporary number is
 * never allowed to become a book number.
 */
class CounterSequenceService
{
    /** The series every counter holds, with the tail its prefix ends in. */
    public const DOC_TAILS = [
        'invoice' => 'INV',
        'sales_return' => 'SR',
        'quotation' => 'QUO',
        'purchase_bill' => 'PUR',
        'receipt' => 'REC',
        'stock_adjustment' => 'ADJ',
        'stock_transfer' => 'TRF',
    ];

    /** Names tills, print templates and older builds use for the same series. */
    public const DOC_TYPE_ALIASES = [
        'bill' => 'invoice',
        'sales' => 'invoice',
        'return' => 'sales_return',
        'credit_note' => 'sales_return',
        'creditnote' => 'sales_return',
        'sales-return' => 'sales_return',
        'estimate' => 'quotation',
        'quotation_request' => 'quotation',
        'purchase' => 'purchase_bill',
        'inward' => 'purchase_bill',
        'payment' => 'receipt',
        'receipt_voucher' => 'receipt',
        'adjustment' => 'stock_adjustment',
        'stock-adjustment' => 'stock_adjustment',
        'transfer' => 'stock_transfer',
        'stock-transfer' => 'stock_transfer',
    ];

    public const DEFAULT_START = 1001;

    public const DEFAULT_BLOCK_SIZE = 50;

    public function currentFinancialYear(): string
    {
        $month = (int) date('n');
        $year = (int) date('Y');

        return $month >= 4
            ? $year . '-' . substr((string) ($year + 1), -2)
            : ($year - 1) . '-' . substr((string) $year, -2);
    }

    /** Canonical name for anything the field calls a document type, or null. */
    public static function normalizeDocType(?string $docType): ?string
    {
        $key = strtolower(trim((string) $docType));

        if ($key === '') {
            return null;
        }

        if (isset(self::DOC_TAILS[$key])) {
            return $key;
        }

        return self::DOC_TYPE_ALIASES[$key] ?? null;
    }

    /** The series a stored document row belongs to, by its module key. */
    public static function forModuleKey(?string $moduleKey): ?string
    {
        return self::normalizeDocType($moduleKey);
    }

    /** A number the counter wrote in the dark, never a book number. */
    public static function isTemporary(?string $number): bool
    {
        $number = trim((string) $number);

        return $number !== '' && (bool) preg_match('/^(TEMP|TMP|OFFLINE)[-_]/i', $number);
    }

    public function prefixFor(Counter $counter, string $docType): string
    {
        return "{$counter->counter_code}-" . self::DOC_TAILS[$docType];
    }

    /** Which store numbering series a counter doc type inherits its default from. */
    public const SERIES_OF_DOC_TYPE = [
        'invoice' => 'invoice',
        'sales_return' => 'sales_return',
        'purchase_return' => 'purchase_return',
        'purchase_bill' => 'purchase',
        'quotation' => 'quotation',
        'receipt' => 'receipt',
        'stock_adjustment' => 'adjustment',
        'stock_transfer' => 'transfer',
    ];

    /** @var array<int, array<string, mixed>> store_id => the store's per-series numbering rules */
    private array $storeNumberingCache = [];

    /**
     * The numbering rule in either shape the panels write it (`suffix`/`serial_suffix`,
     * `width`/`serial_width`/`digits`, `pad`/`padZeros`/`pad_zeros`), or null when it sets nothing.
     *
     * @return array{suffix:?string,width:?int,pad:bool}|null
     */
    public static function normalizeNumbering(mixed $raw): ?array
    {
        if (!is_array($raw)) {
            return null;
        }

        $suffix = $raw['suffix'] ?? $raw['serial_suffix'] ?? null;
        $width = $raw['width'] ?? $raw['serial_width'] ?? $raw['digits'] ?? null;
        $pad = $raw['pad'] ?? $raw['padZeros'] ?? $raw['pad_zeros'] ?? null;

        if ($suffix === null && $width === null && $pad === null) {
            return null;
        }

        return [
            'suffix' => $suffix === null ? null : trim((string) $suffix),
            'width' => is_numeric($width) && (int) $width > 0 ? (int) $width : null,
            'pad' => filter_var($pad, FILTER_VALIDATE_BOOLEAN),
        ];
    }

    /** The store's own numbering defaults, as `company_settings.sequences.numbering` holds them. */
    public function storeNumbering(int $storeId): array
    {
        if (!array_key_exists($storeId, $this->storeNumberingCache)) {
            $sequences = CompanySetting::where('store_id', $storeId)
                ->where('key', 'sequences')
                ->value('value');

            $numbering = is_array($sequences) ? ($sequences['numbering'] ?? null) : null;
            $this->storeNumberingCache[$storeId] = is_array($numbering) ? $numbering : [];
        }

        return $this->storeNumberingCache[$storeId];
    }

    /**
     * How one series renders its serial: the counter's own rule when it carries one, the store's
     * default for that series otherwise, and nothing at all when neither is set — which prints the
     * bare number exactly as it did before rules existed.
     *
     * @return array{suffix:?string,width:?int,pad:bool}
     */
    public function ruleFor(CounterSequence $sequence): array
    {
        $rule = self::normalizeNumbering($sequence->numbering);

        if ($rule === null) {
            $series = self::SERIES_OF_DOC_TYPE[$sequence->doc_type] ?? $sequence->doc_type;
            $rule = self::normalizeNumbering($this->storeNumbering((int) $sequence->store_id)[$series] ?? null);
        }

        return $rule ?? ['suffix' => null, 'width' => null, 'pad' => false];
    }

    /**
     * The serial as it prints. `width` is a minimum, never a fixed length: a serial that has grown
     * past it keeps every digit, because truncating would hand out a number the book already holds.
     */
    public static function formatSerial(int $number, array $rule): string
    {
        $digits = (string) abs($number);
        $width = max((int) ($rule['width'] ?? 0), strlen($digits));

        if (!empty($rule['pad']) && strlen($digits) < $width) {
            $digits = str_pad($digits, $width, '0', STR_PAD_LEFT);
        }

        return ($number < 0 ? '-' : '') . $digits . trim((string) ($rule['suffix'] ?? ''));
    }

    /** The whole document number of a series: `PREFIX-SERIAL`. */
    public function formatNumber(CounterSequence $sequence, int $number): string
    {
        $serial = self::formatSerial($number, $this->ruleFor($sequence));
        $prefix = rtrim(trim((string) $sequence->prefix), '-');

        return $prefix === '' ? $serial : "{$prefix}-{$serial}";
    }

    /** The rule as the till receives it, under the key names its own formatter reads. */
    public function ruleFields(CounterSequence $sequence): array
    {
        $rule = $this->ruleFor($sequence);

        return [
            'suffix' => $rule['suffix'],
            'serial_width' => $rule['width'],
            'pad_zeros' => $rule['pad'],
        ];
    }

    /** @return list<string> every canonical doc type, in order */
    public static function docTypes(): array
    {
        return array_keys(self::DOC_TAILS);
    }

    public function ensureFor(Counter $counter, ?string $financialYear = null): void
    {
        $fy = $financialYear ?: $this->currentFinancialYear();

        foreach (self::DOC_TAILS as $docType => $tail) {
            CounterSequence::firstOrCreate(
                [
                    'counter_id' => $counter->id,
                    'doc_type' => $docType,
                    'financial_year' => $fy,
                ],
                [
                    'store_id' => $counter->store_id,
                    'prefix' => "{$counter->counter_code}-{$tail}",
                    'next_number' => self::DEFAULT_START,
                ]
            );
        }
    }

    /** The whole set for one financial year — what a till boots from. */
    public function manifest(Counter $counter, ?string $financialYear = null): array
    {
        $fy = $financialYear ?: $this->currentFinancialYear();
        $this->ensureFor($counter, $fy);

        $rows = CounterSequence::where('counter_id', $counter->id)
            ->where('financial_year', $fy)
            ->get()
            ->keyBy('doc_type');

        $items = [];

        foreach (self::DOC_TAILS as $docType => $tail) {
            $row = $rows->get($docType);

            $items[] = array_merge([
                'counter_id' => (int) $counter->id,
                'doc_type' => $docType,
                'financial_year' => $fy,
                'prefix' => $row?->prefix ?? $this->prefixFor($counter, $docType),
                'next_number' => (int) ($row?->next_number ?? self::DEFAULT_START),
                'range_start' => $row?->range_start !== null ? (int) $row->range_start : null,
                'range_end' => $row?->range_end !== null ? (int) $row->range_end : null,
            ], $row ? $this->ruleFields($row) : ['suffix' => null, 'serial_width' => null, 'pad_zeros' => false]);
        }

        return [
            'counter_id' => (int) $counter->id,
            'counter_code' => $counter->counter_code,
            'financial_year' => $fy,
            'doc_types' => self::docTypes(),
            'items' => $items,
        ];
    }

    public function sequenceFor(Counter $counter, string $docType, ?string $financialYear = null): CounterSequence
    {
        $docType = self::normalizeDocType($docType);

        if ($docType === null) {
            throw new InvalidArgumentException('Unknown document type.');
        }

        $fy = $financialYear ?: $this->currentFinancialYear();
        $this->ensureFor($counter, $fy);

        return CounterSequence::where('counter_id', $counter->id)
            ->where('doc_type', $docType)
            ->where('financial_year', $fy)
            ->first();
    }

    /** The number the next document on this series will take. */
    public function nextNumber(Counter $counter, string $docType, ?string $financialYear = null): int
    {
        return (int) $this->sequenceFor($counter, $docType, $financialYear)->next_number;
    }

    /** Take the next number on the series. */
    public function issue(Counter $counter, string $docType, ?string $financialYear = null): string
    {
        $sequence = $this->sequenceFor($counter, $docType, $financialYear);

        return $this->consume($sequence);
    }

    /**
     * Reserve a block of numbers for a counter working away from the server.
     *
     * A lease reserves, it does not spend: the counter keeps the block it is
     * already holding until that block is used up, so a till asking on every
     * heartbeat cannot burn the series. `$usedThrough` is how a till that
     * numbered bills while it could not reach the server reports how far it
     * got; it closes that block without waiting for the bills to sync.
     */
    public function lease(Counter $counter, string $docType, int $blockSize = self::DEFAULT_BLOCK_SIZE, ?string $financialYear = null, ?int $usedThrough = null): array
    {
        $sequence = $this->sequenceFor($counter, $docType, $financialYear);
        $docType = $sequence->doc_type;

        return $this->transaction(function () use ($sequence, $blockSize, $counter, $docType, $usedThrough) {
            $row = $this->lockRow($sequence);
            $next = $this->advancePastReportedUse($row, $usedThrough);

            if ($row->range_end !== null && $next <= (int) $row->range_end) {
                return $this->blockOf($row, $counter, $docType, $next);
            }

            $start = $next;
            $end = $start + $blockSize - 1;

            $row->forceFill([
                'range_start' => $start,
                'range_end' => $end,
            ])->save();

            return $this->blockOf($row, $counter, $docType, $start);
        });
    }

    /** The block as the till receives it. */
    private function blockOf(CounterSequence $row, Counter $counter, string $docType, int $nextNumber): array
    {
        return array_merge([
            'counter_id' => (int) $counter->id,
            'counter_code' => $counter->counter_code,
            'doc_type' => $docType,
            'financial_year' => $row->financial_year,
            'prefix' => $row->prefix,
            'range_start' => (int) $row->range_start,
            'range_end' => (int) $row->range_end,
            'block_size' => (int) $row->range_end - (int) $row->range_start + 1,
            'next_number' => $nextNumber,
        ], $this->ruleFields($row));
    }

    /**
     * Move the series past the numbers the till says it spent. A till cannot
     * legitimately number beyond the block it was given, so a report past that
     * ceiling is not allowed to burn the series.
     */
    private function advancePastReportedUse(CounterSequence $row, ?int $usedThrough): int
    {
        $next = (int) $row->next_number;

        if ($usedThrough === null || $usedThrough < $next) {
            return $next;
        }

        $ceiling = $row->range_end !== null ? (int) $row->range_end : $next - 1;
        $next = min($usedThrough, $ceiling) + 1;

        $row->forceFill(['next_number' => $next])->save();

        return $next;
    }

    /**
     * Decide the number a document is filed under.
     *
     * `$stored` is what the server already holds for this document (null for a
     * first sync). A document that already has a real number keeps it, so a
     * retry from the till's queue cannot rename or duplicate it. Otherwise the
     * counter's own series decides: a number it issued is adopted, a temporary
     * number or one another counter issued is replaced, and a number that
     * belongs to no counter at all — the store's own legacy numbering — is kept
     * so an old document is not renamed every time it is re-pushed.
     *
     * @return array{number:string, replaced_from:?string}
     */
    public function resolve(Counter $counter, string $docType, ?string $incoming, ?string $stored = null, ?string $financialYear = null): array
    {
        $sequence = $this->sequenceFor($counter, $docType, $financialYear);
        $incoming = is_string($incoming) ? trim($incoming) : null;

        if ($stored !== null && $stored !== '' && !self::isTemporary($stored)) {
            return ['number' => $stored, 'replaced_from' => null];
        }

        if ($incoming === null || $incoming === '') {
            return ['number' => $this->consume($sequence), 'replaced_from' => null];
        }

        if (self::isTemporary($incoming)) {
            return ['number' => $this->consume($sequence), 'replaced_from' => $incoming];
        }

        $adopted = $this->adopt($counter, $sequence, $incoming);

        if ($adopted !== null) {
            return $adopted;
        }

        if ($this->issuedByAnotherCounter($counter, $incoming)) {
            return ['number' => $this->consume($sequence), 'replaced_from' => $incoming];
        }

        return ['number' => $incoming, 'replaced_from' => null];
    }

    /** Resolve by module key, so an ingest path can pass its own row shape. */
    public function resolveForDocument(Counter $counter, string $moduleKey, ?string $incoming, ?string $stored = null): array
    {
        $docType = self::forModuleKey($moduleKey);

        if ($docType === null) {
            return ['number' => $incoming, 'replaced_from' => null];
        }

        return $this->resolve($counter, $docType, $incoming, $stored);
    }

    /**
     * The number a live document is filed under.
     *
     * Unlike a synced document, a live bill has never been printed, so its
     * number is the counter's to issue: a number on this counter's own series
     * that it has not already given out is kept — that is the number the
     * cashier saw — and anything else (a temporary marker, another counter's
     * number, a legacy store number, or one already filed) is replaced by the
     * counter's next number before the bill exists.
     *
     * @return array{number:string, replaced_from:?string}
     */
    public function numberLiveDocument(Counter $counter, string $docType, ?string $incoming, ?string $financialYear = null): array
    {
        $sequence = $this->sequenceFor($counter, $docType, $financialYear);
        $incoming = is_string($incoming) ? trim($incoming) : null;

        if ($incoming === null || $incoming === '') {
            return ['number' => $this->consume($sequence), 'replaced_from' => null];
        }

        $part = $this->ownSeriesPart($sequence, $incoming);

        if ($part === null) {
            return ['number' => $this->consume($sequence), 'replaced_from' => $incoming];
        }

        $filed = $this->transaction(function () use ($counter, $sequence, $incoming, $part) {
            $row = $this->lockRow($sequence);

            // A number the counter already moved past is not this bill's to
            // take, even when the bill that used it was later deleted.
            if ($part < (int) $row->next_number || $this->numberAlreadyFiled($counter, $incoming, $sequence, $part)) {
                return false;
            }

            $this->stepPast($sequence, $part);

            return true;
        });

        return $filed
            ? ['number' => $incoming, 'replaced_from' => null]
            : ['number' => $this->consume($sequence), 'replaced_from' => $incoming];
    }

    /**
     * A number this counter issued is kept and the series steps over it; a
     * number already in the store's book is not the same document, so it is
     * not adopted.
     */
    private function adopt(Counter $counter, CounterSequence $sequence, string $number): ?array
    {
        $part = $this->ownSeriesPart($sequence, $number);

        if ($part === null) {
            return null;
        }

        if ($part < (int) $sequence->next_number && $this->numberAlreadyFiled($counter, $number, $sequence, $part)) {
            return null;
        }

        $this->stepPast($sequence, $part);

        return ['number' => $number, 'replaced_from' => null];
    }

    /** The numeric part of a number on this counter's own series, or null. */
    private function ownSeriesPart(CounterSequence $sequence, string $number): ?int
    {
        $suffix = preg_quote(trim((string) ($this->ruleFor($sequence)['suffix'] ?? '')), '/');

        // The suffix is optional because a series keeps the bills it printed before the rule was
        // written: `C01-SR-5` is the same serial as `C01-SR-00005/26`, and reading it as foreign
        // would have the counter replace a number it legitimately issued.
        $pattern = '/^' . preg_quote(trim((string) $sequence->prefix), '/') . '-(\d+)(?:' . $suffix . ')?$/';

        if (!preg_match($pattern, trim($number), $matches)) {
            return null;
        }

        return (int) $matches[1];
    }

    /** Move the series past a number the counter has issued. */
    private function stepPast(CounterSequence $sequence, int $part): void
    {
        $this->transaction(function () use ($sequence, $part) {
            $row = $this->lockRow($sequence);

            if ($part >= (int) $row->next_number) {
                $row->forceFill([
                    'next_number' => $part + 1,
                    'range_end' => $row->range_end !== null ? max((int) $row->range_end, $part) : null,
                ])->save();
            }
        });
    }

    /** A number carrying another counter of this store's own code and tail. */
    private function issuedByAnotherCounter(Counter $counter, string $number): bool
    {
        $tails = implode('|', array_values(self::DOC_TAILS));

        // A series may ride a suffix on the end of its serial (`C02-SR-00007/26`), so the tail of the
        // number is anything that is not another digit run.
        if (!preg_match('/^(?<code>.+)-(?<tail>' . $tails . ')-\d+(?:\D.*)?$/', strtoupper(trim($number)), $m)) {
            return false;
        }

        if ($m['code'] === strtoupper(trim((string) $counter->counter_code))) {
            return false;
        }

        return Counter::where('store_id', $counter->store_id)
            ->where('counter_code', $m['code'])
            ->exists();
    }

    private function numberAlreadyFiled(Counter $counter, string $number, ?CounterSequence $sequence = null, ?int $part = null): bool
    {
        $spellings = [$number];

        // Padding and suffix are part of a number's spelling, not of its value: a bill filed as
        // `C01-INV-273` holds the same book number as the `C01-INV-0273` the rule now prints, and
        // missing that would let one serial be issued twice.
        if ($sequence !== null && $part !== null) {
            $spellings[] = $this->formatNumber($sequence, $part);
            $spellings[] = trim((string) $sequence->prefix) . '-' . $part;
        }

        return Invoice::where('store_id', $counter->store_id)
            ->whereIn('invoice_number', array_values(array_unique(array_filter($spellings))))
            ->exists();
    }

    /** @return string the number handed out */
    private function consume(CounterSequence $sequence): string
    {
        return $this->transaction(function () use ($sequence) {
            $row = $this->lockRow($sequence);
            $number = (int) $row->next_number;

            $row->forceFill(['next_number' => $number + 1])->save();

            return $this->formatNumber($row, $number);
        });
    }

    private function lockRow(CounterSequence $sequence): CounterSequence
    {
        return CounterSequence::whereKey($sequence->id)->lockForUpdate()->firstOrFail();
    }

    private function transaction(callable $work)
    {
        return \Illuminate\Support\Facades\DB::transaction($work);
    }
}
