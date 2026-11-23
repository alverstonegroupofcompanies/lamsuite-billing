<?php

namespace App\Services\Purchase;

use App\Models\CompanySetting;
use App\Models\Expense;
use App\Models\MasterLookup;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseChargeAllocation;
use App\Models\PurchaseItem;
use App\Services\Masters\ChargeHeadDefaultsService;
use Illuminate\Validation\ValidationException;

/**
 * CR-C posting. A charge line entered on a supplier bill is stored exactly as the shared
 * tax engine priced it: its own row (so a return can reverse it and a register can total
 * it), its paisa-exact share on every goods line it spread onto, the resulting landed
 * cost on the batch while the supplier's rate stays visible, and an expense register row
 * when the store chose to book it as an expense instead of a cost.
 *
 * The engine decides every number here — this service only moves money into rows, so the
 * same payload through either write path must produce the same paisa (SYNC-007).
 */
class PurchaseChargeService
{
    private const TREATMENTS = ['add_to_cost', 'expense'];

    private const SPREADS = ['value', 'quantity', 'weight'];

    private const ITC = ['eligible', 'ineligible', 'blocked', 'partial'];

    public function __construct(private readonly ChargeHeadDefaultsService $heads)
    {
    }

    /**
     * Purchase lines in the shape the shared engine expects, from either write payload.
     * The purchase rate is statutory tax-exclusive (rate_basis ptr), so a charge spread by
     * value lands on the same taxable base the till spread on.
     *
     * @return array<int, array<string, mixed>>
     */
    public function engineLines(array $rows): array
    {
        $lines = [];

        foreach (array_values($rows) as $idx => $row) {
            $discountType = $row['discount_type'] ?? 'percent';
            $upp = (int) ($row['units_per_pack'] ?? 1);

            $weight = $row['gross_weight_kg'] ?? null;

            $lines[] = [
                'line_id' => (string) $idx,
                'product_id' => (string) ($row['product_id'] ?? ''),
                'product_name' => $row['product_name'] ?? 'Item',
                'hsn_code' => $row['hsn_code'] ?? null,
                'qty' => (float) ($row['pack_qty'] ?? $row['qty'] ?? 1),
                'loose_qty' => (float) ($row['loose_qty'] ?? 0),
                'free_qty' => (float) ($row['free_qty'] ?? 0),
                'free_loose_qty' => (float) ($row['free_loose_qty'] ?? 0),
                'units_per_pack' => $upp > 0 ? $upp : 1,
                'unit_price' => (float) ($row['purchase_rate'] ?? $row['unit_price'] ?? 0),
                'mrp' => (float) ($row['mrp'] ?? 0),
                'rate_basis' => 'ptr',
                'discount_percent' => $discountType === 'percent' ? (float) ($row['discount_percent'] ?? 0) : 0,
                'discount_amount' => $discountType === 'amount' ? (float) ($row['discount_amount'] ?? 0) : 0,
                'gst_percent' => (float) ($row['gst_percent'] ?? 0),
                'cess_percent' => (float) ($row['cess_percent'] ?? 0),
                'gross_weight_kg' => ($weight === null || $weight === '') ? null : (float) $weight,
                'is_tax_inclusive' => false,
            ];
        }

        return $lines;
    }

    /**
     * Validate a payload's charge lines against this store's own heads (rule R12) and
     * return them in the shape both tax engines consume, with the head presets filled in.
     *
     * @return array<int, array<string, mixed>>
     */
    public function resolveForStore(int $storeId, array $charges, ?string $placeOfSupply = null): array
    {
        // The till names a state ("32-State", "32-Kerala"); the charge grid may name the same
        // state by its code. Both are normalised here so a bill is judged against its own place
        // of supply instead of the label a screen happened to print (PUR-01).
        $documentPos = $this->cleanPos($placeOfSupply);

        $this->heads->seedDefaultsForStore($storeId);
        $rows = MasterLookup::where('store_id', $storeId)->where('type', 'charge_head')->get();

        $resolved = [];
        foreach (array_values($charges) as $idx => $raw) {
            if (!is_array($raw)) {
                continue;
            }

            $head = $this->findHead($rows, (string) ($raw['head_code'] ?? ''));
            if (!$head) {
                throw ValidationException::withMessages([
                    "charges.{$idx}.head_code" => [
                        'Charge head "' . trim((string) ($raw['head_code'] ?? '')) . '" does not exist in this store (rule R12).',
                    ],
                ]);
            }

            if (!$head->is_active) {
                throw ValidationException::withMessages([
                    "charges.{$idx}.head_code" => ["Charge head \"{$head->name}\" is deactivated in this store."],
                ]);
            }

            $amount = round((float) ($raw['amount'] ?? 0), 2);
            if (abs($amount) < 0.005) {
                // An empty grid row is not a charge; dropping it keeps the ledger clean
                // without failing a bill the operator already keyed.
                continue;
            }

            $allowed = (string) ($this->preset($head, 'allowed_sign') ?? 'positive');
            if (($amount < 0 && $allowed === 'positive') || ($amount > 0 && $allowed === 'negative')) {
                throw ValidationException::withMessages([
                    "charges.{$idx}.amount" => [
                        "\"{$head->name}\" only accepts " . ($allowed === 'positive' ? 'positive' : 'negative') . ' amounts.',
                    ],
                ]);
            }

            $chargePos = $this->cleanPos($raw['place_of_supply'] ?? null);
            if ($chargePos !== null && $documentPos !== null && $chargePos !== $documentPos) {
                throw ValidationException::withMessages([
                    "charges.{$idx}.place_of_supply" => [
                        'A charge is taxed by the place of supply of its supplier bill, not its own.',
                    ],
                ]);
            }

            $resolved[] = [
                'charge_id' => (string) ($raw['external_id'] ?? 'C' . ($idx + 1)),
                'external_id' => ($raw['external_id'] ?? null) ?: null,
                'seq' => count($resolved) + 1,
                'head_code' => $this->headCodeOf($head),
                'head_name' => $head->name,
                'note' => $raw['note'] ?? null,
                'sac_code' => $this->sacOf($raw['sac_code'] ?? null, $head),
                'amount' => $amount,
                'gst_percent' => round((float) ($raw['gst_percent'] ?? 0), 2),
                'cess_percent' => round((float) ($raw['cess_percent'] ?? 0), 2),
                'treatment' => $this->choice($raw['treatment'] ?? null, $this->preset($head, 'default_treatment'), self::TREATMENTS, 'add_to_cost'),
                'spread_method' => $this->choice($raw['spread_method'] ?? null, $this->preset($head, 'default_spread_method'), self::SPREADS, 'value'),
                'itc_eligibility' => $this->choice($raw['itc_eligibility'] ?? null, $this->preset($head, 'default_itc_eligibility'), self::ITC, 'eligible'),
                'is_rcm' => (bool) ($raw['is_rcm'] ?? false),
                'paid_separately' => (bool) ($raw['paid_separately'] ?? false),
                'paid_to_label' => $raw['paid_to_label'] ?? null,
                'place_of_supply' => $chargePos ?? $documentPos,
                'source' => ($raw['source'] ?? 'manual') === 'legacy_freight' ? 'legacy_freight' : 'manual',
            ];
        }

        return $resolved;
    }

    /**
     * A bill keyed before CR-C carried one freight scalar. Presented through the same
     * head master keeps the charges path single (PUR-017); the legacy amount is never
     * re-taxed and never restated, so it always enters at 0%.
     *
     * @return array<int, array<string, mixed>>
     */
    public function legacyFreight(int $storeId, float $freightCharges, ?string $placeOfSupply = null): array
    {
        if (abs($freightCharges) < 0.005) {
            return [];
        }

        return $this->resolveForStore($storeId, [[
            'head_code' => PurchaseChargeNormaliser::LEGACY_HEAD_CODE,
            'amount' => $freightCharges,
            'gst_percent' => 0,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
            'note' => 'Legacy freight carried over from a pre-charges bill',
            'source' => 'legacy_freight',
        ]], $placeOfSupply);
    }

    /**
     * CR-C-11 / PUR-016: does this store bill a separately-paid charge into what the supplier is
     * owed? Read where the bill is priced, and the answer each line got is stored on that line,
     * so changing the policy later cannot restate a bill that has already been printed.
     */
    public function separatelyPaidInPayable(int $storeId): bool
    {
        $billing = CompanySetting::where('store_id', $storeId)->where('key', 'billing')->first()?->value;

        return is_array($billing)
            && is_array($billing['purchase_charges'] ?? null)
            && filter_var($billing['purchase_charges']['separately_paid_in_payable'] ?? false, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * Task 4.14 — the two per-store switches that were declared and read by nothing.
     *
     * A policy key nobody reads is worse than no key at all: an owner turns "no negative charges"
     * off, believes the till will now refuse a keyed credit, and finds out at the next GST review.
     * Both answers are measured here, where every write path — the API, the till's sync push and a
     * revision — has already priced the bill and not yet written a row of it, so a refused bill
     * leaves nothing behind to unwind.
     *
     * `allow_negative_charges` (default true) only ever tightens what the head's own `allowed_sign`
     * decided; a store that turns it off rejects a signed adjustment on any head.
     * `max_percent_of_goods` (unset or 0 = no cap) limits the charge money on one bill to that
     * percentage of the bill's own goods value, counted over every positive row so two rows cannot
     * each hide under it.
     */
    public function assertPolicyAllows(Purchase $purchase, array $engineCharges, array $result): void
    {
        $policy = $this->chargePolicy((int) $purchase->store_id);

        foreach (array_values($engineCharges) as $idx => $charge) {
            $amount = round((float) ($charge['amount'] ?? 0), 2);
            if ($amount < 0 && !$policy['allow_negative_charges']) {
                throw ValidationException::withMessages([
                    "charges.{$idx}.amount" => [
                        'This store\'s charge policy does not allow negative charge lines '
                        . '(billing.purchase_charges.allow_negative_charges).',
                    ],
                ]);
            }
        }

        $cap = $policy['max_percent_of_goods'];
        if ($cap === null || $cap <= 0) {
            return;
        }

        $goodsValue = round(array_sum(array_map(
            fn ($line) => (float) ($line['taxable_amount'] ?? 0),
            array_values($result['lines'] ?? [])
        )), 2);

        $chargeTotal = round(array_sum(array_map(
            fn ($charge) => max(0.0, round((float) ($charge['amount'] ?? 0), 2)),
            array_values($engineCharges)
        )), 2);

        $allowance = round($goodsValue * $cap / 100, 2);
        if ($chargeTotal > $allowance + 0.005) {
            throw ValidationException::withMessages([
                'charges' => [sprintf(
                    'This store bills at most %s%% of the goods value as charges: ₹%s of charges against ₹%s of goods allows ₹%s.',
                    rtrim(rtrim(number_format($cap, 2, '.', ''), '0'), '.'),
                    number_format($chargeTotal, 2, '.', ''),
                    number_format($goodsValue, 2, '.', ''),
                    number_format($allowance, 2, '.', '')
                )],
            ]);
        }
    }

    /**
     * The store's own charge policy, with the shipped defaults and the legacy `"1"`/`"true"`/`"0"`
     * spellings older profiles wrote (CFG-003).
     *
     * @return array{allow_negative_charges: bool, max_percent_of_goods: ?float}
     */
    public function chargePolicy(int $storeId): array
    {
        $billing = CompanySetting::where('store_id', $storeId)->where('key', 'billing')->first()?->value;
        $policy = is_array($billing) ? ($billing['purchase_charges'] ?? null) : null;
        $policy = is_array($policy) ? $policy : [];

        $cap = $policy['max_percent_of_goods'] ?? null;

        return [
            'allow_negative_charges' => filter_var($policy['allow_negative_charges'] ?? true, FILTER_VALIDATE_BOOLEAN),
            'max_percent_of_goods' => is_numeric($cap) ? (float) $cap : null,
        ];
    }

    /**
     * Write the engine's charge numbers onto the bill.
     *
     * @param array<int, array<string, mixed>> $engineCharges resolved charge lines, same order as the engine result
     * @param array<int, array<string, mixed>> $engineLines   engine lines handed to the engine
     * @param array<string, mixed>             $result        TaxEngine::calculateDocumentTaxes() output
     * @param array<string, int>               $itemIdsByLine engine line_id => purchase_items.id
     */
    public function post(
        Purchase $purchase,
        array $engineCharges,
        array $engineLines,
        array $result,
        array $itemIdsByLine,
        ?int $userId = null,
        ?string $externalKeyPrefix = null
    ): void {
        $this->assertPolicyAllows($purchase, $engineCharges, $result);

        $linesByLineId = collect($result['lines'] ?? [])->keyBy('line_id');

        // A re-post must leave no trace of the charges it replaced: the rows, their expense
        // register entries, and any charge that changed treatment since the last posting.
        $incoming = [];
        foreach (array_values($engineCharges) as $i => $resolved) {
            if ($resolved) {
                $incoming[] = $this->externalIdFor($purchase, $resolved, $externalKeyPrefix, (int) ($resolved['seq'] ?? $i + 1));
            }
        }

        $stale = PurchaseCharge::where('purchase_id', $purchase->id)
            ->when($incoming !== [], fn ($q) => $q->whereNotIn('external_id', $incoming))
            ->pluck('id');

        if ($stale->isNotEmpty()) {
            Expense::whereIn('purchase_charge_id', $stale->all())->delete();
            PurchaseCharge::whereIn('id', $stale->all())->delete();
        }

        $totals = ['charges' => 0, 'allocated' => 0.0, 'expense' => 0.0];

        foreach (array_values($result['charges'] ?? []) as $i => $calculated) {
            $resolved = $engineCharges[$i] ?? null;
            if (!$resolved) {
                continue;
            }

            $allocated = round((float) collect($calculated['allocations'] ?? [])->sum('allocated_amount'), 2);

            $charge = PurchaseCharge::updateOrCreate(
                [
                    'store_id' => (int) $purchase->store_id,
                    'external_id' => $this->externalIdFor($purchase, $resolved, $externalKeyPrefix, (int) ($resolved['seq'] ?? $i + 1)),
                ],
                [
                    'purchase_id' => $purchase->id,
                    'seq' => (int) ($resolved['seq'] ?? $i + 1),
                    'head_code' => $resolved['head_code'],
                    'head_name' => $resolved['head_name'],
                    'note' => $resolved['note'],
                    'treatment' => $calculated['treatment'],
                    'spread_method' => $calculated['spread_method'],
                    'spread_basis_used' => $calculated['spread_basis_used'],
                    'itc_eligibility' => $calculated['itc_eligibility'],
                    'is_rcm' => (bool) $calculated['is_rcm'],
                    'paid_separately' => (bool) $calculated['paid_separately'],
                    'in_payable' => (bool) $calculated['in_payable'],
                    'paid_to_label' => $calculated['paid_to_label'],
                    'place_of_supply' => $resolved['place_of_supply'] ?? ($result['place_of_supply'] ?? null),
                    'sac_code' => $calculated['sac_code'],
                    'amount' => $calculated['amount'],
                    'gst_percent' => $calculated['gst_rate'],
                    'taxable_amount' => $calculated['taxable_amount'],
                    'cgst_amount' => $calculated['cgst_amount'],
                    'sgst_amount' => $calculated['sgst_amount'],
                    'igst_amount' => $calculated['igst_amount'],
                    'cess_amount' => $calculated['cess_amount'],
                    'total_amount' => $calculated['total_amount'],
                    'allocated_amount' => $allocated,
                    'source' => $resolved['source'] ?? 'manual',
                    'created_by' => $userId,
                ]
            );

            $totals['charges']++;
            $totals['allocated'] += $allocated;

            $this->writeAllocations($purchase, $charge, $calculated, $engineLines, $linesByLineId, $itemIdsByLine);

            if ($calculated['treatment'] === 'expense') {
                $expense = $this->postExpense($purchase, $charge, $calculated, $userId);
                if ($expense) {
                    $charge->update(['expense_id' => $expense->id]);
                    $totals['expense'] += (float) $expense->amount;
                }
            } else {
                Expense::where('purchase_charge_id', $charge->id)->delete();
            }
        }

        $this->writeLandedCost($purchase, $result, $itemIdsByLine);
    }

    /**
     * PUR-014: a negative charge is a credit note line, not a negative payable.
     */
    public function assertStaysPayable(array $result): void
    {
        if ((float) ($result['grand_total'] ?? 0) >= 0) {
            return;
        }

        $offending = collect($result['charges'] ?? [])
            ->filter(fn ($c) => (float) $c['amount'] < 0)
            ->map(fn ($c) => $c['head_name'] . ' ' . $c['amount'])
            ->implode(', ');

        throw ValidationException::withMessages([
            'charges' => ['The charges on this bill would take the payable below zero' . ($offending !== '' ? " ({$offending})" : '') . '.'],
        ]);
    }

    private function writeAllocations(
        Purchase $purchase,
        PurchaseCharge $charge,
        array $calculated,
        array $engineLines,
        $linesByLineId,
        array $itemIdsByLine
    ): void {
        $basis = $this->basisFor($calculated['spread_basis_used'], $engineLines, $linesByLineId);
        $basisTotal = array_sum($basis);

        $keptItems = [];
        foreach ($calculated['allocations'] ?? [] as $allocation) {
            $itemId = $itemIdsByLine[(string) ($allocation['line_id'] ?? '')] ?? null;
            if (!$itemId) {
                continue;
            }
            $keptItems[] = (int) $itemId;

            $basisAmount = (float) ($basis[(string) $allocation['line_id']] ?? 0);

            PurchaseChargeAllocation::updateOrCreate(
                [
                    'purchase_charge_id' => $charge->id,
                    'purchase_item_id' => $itemId,
                ],
                [
                    'store_id' => (int) $purchase->store_id,
                    'batch_id' => $this->batchIdFor((int) $purchase->store_id, (int) $itemId),
                    'basis_amount' => round($basisAmount, 4),
                    'basis_share' => $basisTotal != 0 ? round($basisAmount / $basisTotal, 6) : 0,
                    'allocated_amount' => round((float) $allocation['allocated_amount'], 2),
                    'is_remainder_paisa' => (bool) ($allocation['is_remainder_paisa'] ?? false),
                ]
            );
        }

        if ($keptItems) {
            PurchaseChargeAllocation::where('purchase_charge_id', $charge->id)
                ->whereNotIn('purchase_item_id', $keptItems)
                ->delete();
        }
    }

    /**
     * engine line_id => the basis value that charge was spread on, per PUR-010.
     */
    private function basisFor(string $basisUsed, array $engineLines, $linesByLineId): array
    {
        $basis = [];

        foreach ($engineLines as $line) {
            $lineId = (string) $line['line_id'];
            $calculated = $linesByLineId->get($lineId);

            $basis[$lineId] = match ($basisUsed) {
                'weight' => (float) ($line['gross_weight_kg'] ?? 0),
                'quantity' => (float) ($calculated['total_units'] ?? 0),
                default => (float) ($calculated['taxable_amount'] ?? 0),
            };
        }

        return $basis;
    }

    /**
     * PUR-010/PUR-002: the grid and the batch carry the same landed figures the engine
     * computed, and the supplier's own rate is never overwritten.
     */
    private function writeLandedCost(Purchase $purchase, array $result, array $itemIdsByLine): void
    {
        foreach ($result['lines'] ?? [] as $line) {
            $itemId = $itemIdsByLine[(string) ($line['line_id'] ?? '')] ?? null;
            if (!$itemId) {
                continue;
            }

            $allocated = round((float) ($line['charge_allocation'] ?? 0), 2);

            PurchaseItem::where('id', $itemId)->update([
                'charge_allocation' => $allocated,
                'landed_unit_cost' => $line['landed_unit_cost'] ?? null,
                'effective_unit_cost' => $line['effective_unit_cost'] ?? 0,
            ]);

            if (abs($allocated) < 0.005) {
                continue;
            }

            $item = PurchaseItem::find($itemId);
            $units = (float) ($line['total_units'] ?? 0);
            $batch = $item ? $this->batchFor((int) $purchase->store_id, $item) : null;

            if ($batch && $units > 0) {
                // PUR-011: re-derived per receipt from this bill's own allocation.
                $batch->update([
                    'landed_cost_rate' => round((float) $item->purchase_rate + $allocated / $units, 4),
                ]);
            }
        }
    }

    private function postExpense(Purchase $purchase, PurchaseCharge $charge, array $calculated, ?int $userId): ?Expense
    {
        $amount = round((float) ($calculated['expense_posting'] ?? 0), 2);
        if (abs($amount) < 0.005) {
            return null;
        }

        $expense = Expense::where('purchase_charge_id', $charge->id)->first() ?? new Expense([
            'store_id' => (int) $purchase->store_id,
            'expense_number' => 'EXP-PC-' . $purchase->id . '-' . $charge->seq,
            'purchase_charge_id' => $charge->id,
            'created_by' => $userId,
        ]);

        $expense->fill([
            'store_id' => (int) $purchase->store_id,
            'expense_head' => $charge->head_name,
            'amount' => $amount,
            'payment_mode' => $calculated['paid_separately'] ? 'Paid Separately' : 'On Account',
            'reference_no' => $purchase->invoice_number,
            'notes' => trim('Booked from charge ' . $charge->head_name . ' on bill ' . $purchase->invoice_number
                . ($charge->note ? ' — ' . $charge->note : '')),
            'expense_date' => optional($purchase->invoice_date)->toDateString() ?: now()->toDateString(),
            'purchase_id' => $purchase->id,
            'gst_percent' => $calculated['gst_rate'],
            'cgst_amount' => $calculated['cgst_amount'],
            'sgst_amount' => $calculated['sgst_amount'],
            'igst_amount' => $calculated['igst_amount'],
            'itc_eligibility' => $calculated['itc_eligibility'],
            'paid_separately' => (bool) $calculated['paid_separately'],
        ])->save();

        return $expense;
    }

    /**
     * The till keys its charge lines itself, so a retry re-posts onto the same row instead of
     * duplicating money (NFR-DATA-01). A bill pushed by a till is namespaced by the till's own
     * bill id because line numbers like "1" repeat across bills.
     */
    private function externalIdFor(Purchase $purchase, array $resolved, ?string $externalKeyPrefix, int $seq): string
    {
        $external = $resolved['external_id'] ?? null;

        if ($external) {
            return $externalKeyPrefix ? $externalKeyPrefix . '|' . $external : $external;
        }

        return 'pur-' . $purchase->id . '-' . $seq;
    }

    private function batchFor(int $storeId, PurchaseItem $item): ?ProductBatch
    {
        if (!$item->product_id) {
            return null;
        }

        return ProductBatch::where('store_id', $storeId)
            ->where('product_id', $item->product_id)
            ->where('batch_no', (string) ($item->batch_no ?: 'BAT-01'))
            ->first();
    }

    private function batchIdFor(int $storeId, int $itemId): ?int
    {
        $item = PurchaseItem::find($itemId);

        return $item ? ($this->batchFor($storeId, $item)?->id) : null;
    }

    private function findHead($rows, string $needle): ?MasterLookup
    {
        $needle = trim($needle);
        if ($needle === '') {
            return null;
        }

        $lower = mb_strtolower($needle);

        return $rows->first(fn ($head) => mb_strtolower((string) $head->code) === $lower)
            ?? $rows->first(fn ($head) => mb_strtolower(trim((string) $head->name)) === $lower);
    }

    private function headCodeOf(MasterLookup $head): string
    {
        return $head->code ?: mb_strtoupper(mb_substr($head->name, 0, 40));
    }

    private function sacOf(?string $payloadSac, MasterLookup $head): ?string
    {
        $sac = trim((string) ($payloadSac ?? ''));
        if ($sac !== '') {
            return $sac;
        }

        $headSac = trim((string) ($this->preset($head, 'sac_code') ?? ''));

        return $headSac !== '' ? $headSac : null;
    }

    private function preset(MasterLookup $head, string $key): ?string
    {
        $config = is_array($head->config) ? $head->config : [];
        $value = $config[$key] ?? null;

        return $value === null || $value === '' ? null : (string) $value;
    }

    private function choice(?string $payload, ?string $fallback, array $allowed, string $default): string
    {
        foreach ([$payload, $fallback, $default] as $candidate) {
            if ($candidate !== null && in_array($candidate, $allowed, true)) {
                return $candidate;
            }
        }

        return $default;
    }

    private function cleanPos($value): ?string
    {
        $pos = preg_replace('/\D/', '', (string) ($value ?? ''));

        return $pos === '' ? null : substr(str_pad($pos, 2, '0', STR_PAD_LEFT), 0, 2);
    }
}
