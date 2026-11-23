<?php

namespace App\Services\Counter;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\CounterProfileException;
use App\Models\Invoice;
use App\Models\Purchase;
use App\Models\StockTransfer;
use App\Services\Sales\PharmacistGate;
use App\Support\Counter\CounterProfile;
use App\Support\RestrictedDrugResolver;
use Illuminate\Support\Facades\DB;

/**
 * Q1 (b) — what the server does with a document a counter made in the dark.
 *
 * It accepts it. A till that could not reach the cloud cannot be asked to obey
 * a rule it never received, and a store must not lose a sale it genuinely made,
 * so ingest never refuses an offline document on a permission the counter has
 * since lost. What it does instead is run the same
 * {@see CounterProfilePolicy} the live gate runs — one truth, two paths — and
 * file what the document broke in the exception register for the owner to
 * review.
 *
 * Two versions ride every row. The one the till stamped when it wrote the
 * document, and the one in force now. When they differ the register says so
 * plainly: the rule may be newer than the bill, and that is the first thing an
 * owner needs before doing anything about it.
 */
final class CounterProfileIngest
{
    public function __construct(private readonly CounterProfilePolicy $policy) {}

    /**
     * A bill, credit note or revision as the server now holds it.
     *
     * The facts come from the stored document rather than the payload, because
     * what was filed is what the store has to live with; the payload only
     * supplies the watermark the till stamped.
     */
    public function invoice(?Counter $counter, Invoice $invoice, array $payload = [], bool $isRevision = false): void
    {
        $this->guard(function () use ($counter, $invoice, $payload, $isRevision) {
            if (!$counter || !$invoice->exists) {
                return;
            }

            $items = $invoice->items()->get();

            // The stored document is the evidence: subtotal is what the lines
            // were worth before anything came off, discount_total is the whole
            // discount, and a single line can carry a percentage the bill as a
            // unit never shows.
            $gross = (float) ($invoice->subtotal ?: $items->sum(fn ($item) => (float) $item->qty * (float) $item->unit_price));
            $discountAmount = (float) ($invoice->discount_total ?: $items->sum('discount_amount'));
            $discountPct = $gross > 0 ? $discountAmount / $gross * 100 : 0.0;

            foreach ($items as $item) {
                $discountPct = max($discountPct, (float) $item->discount_percent);
            }

            $modes = $this->modes([
                $invoice->payment_mode,
                ...$invoice->payments()->pluck('payment_mode')->all(),
            ]);

            $isReturn = $this->isReturn($invoice->module_key);

            $checks = [
                'pos.save_bill' => [],
                'pos.discount' => [
                    'discount_pct' => round($discountPct, 4),
                    'discount_amount' => round($discountAmount, 2),
                ],
                'pos.payment_mode' => ['payment_modes' => $modes],
            ];

            $override = $this->priceOverride($counter, $items);

            if ($override !== null) {
                $checks['pos.price_override'] = $override + ['inferred' => true];
            }

            if ($isReturn) {
                $checks['return.create'] = ['value' => (float) $invoice->grand_total];
            }

            if ($isRevision) {
                $checks['invoice.edit'] = ['invoice_date' => $invoice->invoice_date];
            }

            if (strtolower((string) $invoice->status) === 'cancelled') {
                $checks['invoice.cancel'] = [];
            }

            // PHR-004: a restricted drug that no pharmacist vouched for in the
            // dark is not a document the server can still refuse — the goods
            // left the shelf and the money was taken — but it is an exception
            // the owner has to see. The PIN itself never comes here.
            $pharmacist = $this->pharmacistConfirmation($invoice, $payload);

            $this->record(
                $counter,
                'invoice',
                (string) $invoice->id,
                $invoice->invoice_number,
                $this->stamped($payload),
                $checks,
                $pharmacist === null ? [] : [$pharmacist]
            );
        });
    }

    /** A purchase or purchase return the till queued. */
    public function purchase(?Counter $counter, Purchase $purchase, array $payload = []): void
    {
        $this->guard(function () use ($counter, $purchase, $payload) {
            if (!$counter || !$purchase->exists) {
                return;
            }

            $checks = ['purchase.entry' => []];

            if ($this->isReturn($purchase->module_key)) {
                $checks['return.purchase'] = ['value' => (float) $purchase->grand_total];
            }

            $this->record($counter, 'purchase', (string) $purchase->id, $purchase->invoice_number, $this->stamped($payload), $checks);
        });
    }

    /**
     * A stock adjustment document the till queued.
     *
     * Only a real adjustment is measured: the same ingest path also carries the
     * ledger deltas a sale or a purchase leaves behind, and a counter is never
     * expected to hold permission to adjust stock in order to sell.
     */
    public function stockAdjustment(?Counter $counter, array $payload = [], ?string $documentReference = null): void
    {
        $this->guard(function () use ($counter, $payload, $documentReference) {
            if (!$counter) {
                return;
            }

            $quantity = 0.0;

            foreach ([...((array) ($payload['lines'] ?? [])), ...((array) ($payload['items'] ?? []))] as $line) {
                if (!is_array($line)) {
                    continue;
                }

                // A counted-stock line states what is on the shelf, not what
                // moved, and the profile limits what may move. The count is the
                // only magnitude the payload offers, so it is the one measured.
                $change = abs((float) ($line['adjustment_qty']
                    ?? $line['qty']
                    ?? $line['counted_qty']
                    ?? $line['qty_delta']
                    ?? $line['quantity']
                    ?? 0));

                if ($change > $quantity) {
                    $quantity = $change;
                }
            }

            $quantity = max($quantity, abs((float) ($payload['adjustment_qty'] ?? $payload['qty_delta'] ?? 0)));

            $this->record($counter, 'stock_adjustment', $this->idOf($payload), $documentReference, $this->stamped($payload), [
                'stock.adjust' => ['qty' => $quantity],
            ]);
        });
    }

    /** A transfer the till dispatched or received while offline. */
    public function transfer(?Counter $counter, string $direction, ?StockTransfer $transfer = null, array $payload = []): void
    {
        $this->guard(function () use ($counter, $direction, $transfer, $payload) {
            if (!$counter) {
                return;
            }

            $this->record(
                $counter,
                'stock_transfer',
                $transfer?->id !== null ? (string) $transfer->id : $this->idOf($payload),
                $transfer?->transfer_number ?? ($payload['transfer_number'] ?? null),
                $this->stamped($payload),
                [$direction === 'receive' ? 'transfer.receive' : 'transfer.dispatch' => []]
            );
        });
    }

    /** A collection or payment the till queued. */
    public function payment(?Counter $counter, array $payload = [], ?string $reference = null): void
    {
        $this->guard(function () use ($counter, $payload, $reference) {
            if (!$counter) {
                return;
            }

            $supplier = str_contains(strtolower((string) ($payload['type'] ?? '')), 'supplier')
                || !empty($payload['supplier_id'])
                || !empty($payload['party_type']);

            $this->record($counter, 'payment', $this->idOf($payload), $reference, $this->stamped($payload), [
                $supplier ? 'payment.supplier' : 'payment.customer' => [],
                'pos.payment_mode' => ['payment_modes' => $this->modes([
                    $payload['payment_mode'] ?? ($payload['mode'] ?? null),
                ])],
            ]);
        });
    }

    /** Settings the till changed while it could not ask. */
    public function settings(?Counter $counter, array $payload = []): void
    {
        $this->guard(function () use ($counter, $payload) {
            if (!$counter) {
                return;
            }

            $this->record($counter, 'settings', null, (string) ($counter->counter_code ?? ''), $this->stamped($payload), [
                'settings.change' => ['setting_keys' => array_keys($this->settingsOf($payload))],
            ]);
        });
    }

    /** Staff rows the till managed offline, which is a counter-owned screen. */
    public function staff(?Counter $counter, array $payload = []): void
    {
        $this->guard(function () use ($counter, $payload) {
            if (!$counter) {
                return;
            }

            $this->record($counter, 'staff', $this->idOf($payload), $payload['username'] ?? ($payload['code'] ?? null), $this->stamped($payload), [
                'staff.manage' => [],
            ]);
        });
    }

    /**
     * A drawer a till opened or closed while it could not ask.
     *
     * The counted cash is the fact worth checking: a profile may allow the
     * drawer and still set a ceiling on what leaves it without a grant.
     */
    public function shift(?Counter $counter, array $payload = [], ?string $documentReference = null, bool $closing = false): void
    {
        $this->guard(function () use ($counter, $payload, $documentReference, $closing) {
            if (!$counter) {
                return;
            }

            $this->record($counter, 'shift', $this->idOf($payload), $documentReference, $this->stamped($payload), [
                'pos.cash_drawer' => [],
                $closing ? 'shift.close' : 'shift.open' => [],
            ]);
        });
    }

    /**
     * Every check runs through the same policy the live gate runs, and nothing
     * here can stop the document it is describing.
     *
     * A rule the policy does not speak — a pharmacist confirmation is a
     * registration question, not a permission one — arrives already decided in
     * `$decided` and rides the same row.
     *
     * @param  array<string,array<string,mixed>>  $checks  action key => facts
     * @param  list<array<string,mixed>>  $decided  violations answered elsewhere
     */
    private function record(
        Counter $counter,
        string $documentType,
        ?string $documentId,
        ?string $documentReference,
        ?int $stampedVersion,
        array $checks,
        array $decided = []
    ): void {
        $profile = CounterProfile::resolve($counter);
        $current = (int) ($counter->permission_profile_version ?? CounterProfile::VERSION);

        $violations = [];
        $inferred = false;

        foreach ($checks as $action => $context) {
            $fromGuess = (bool) ($context['inferred'] ?? false);
            unset($context['inferred']);

            $answer = $this->policy->decide($profile, (string) $action, $context);

            if ($answer['allowed']) {
                continue;
            }

            $control = CounterActionRegistry::controlFor((string) $action);
            $isOverride = ($control['control'] ?? null) === 'price_override';

            $inferred = $inferred || $fromGuess || $isOverride;

            $violations[] = [
                'action' => $action,
                'control' => $control['control'] ?? null,
                'code' => $answer['code'] ?? CounterProfilePolicy::DENIED,
                'message' => $answer['message'] ?? "This counter's profile does not allow it.",
                'needs_grant' => ($answer['code'] ?? '') === CounterProfilePolicy::APPROVAL_REQUIRED,
                'inferred' => $fromGuess || $isOverride,
            ];
        }

        $violations = array_merge($violations, $decided);

        if ($violations === []) {
            return;
        }

        $existing = CounterProfileException::where('counter_id', $counter->id)
            ->where('document_type', $documentType)
            ->where('document_id', $documentId)
            ->latest('id')
            ->first();

        $row = $existing ?? new CounterProfileException([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'document_type' => $documentType,
            'document_id' => $documentId,
        ]);

        $row->fill([
            'document_reference' => $documentReference ?? $row->document_reference,
            'profile_version' => $stampedVersion ?? $row->profile_version,
            'profile_version_at_review' => $current,
            'violations' => $violations,
            'detected_at' => now(),
        ]);

        if ($row->exists) {
            $row->times_filed = (int) $row->times_filed + 1;
        }

        $row->save();

        AuditLog::log(
            'counter_profile_exception_filed',
            'CounterProfileException',
            (string) $row->id,
            $existing ? ['times_filed' => (int) $existing->times_filed] : null,
            [
                'document_type' => $documentType,
                'document_reference' => $documentReference,
                'actions' => array_column($violations, 'action'),
                'profile_version' => $stampedVersion,
                'profile_version_in_force' => $current,
                'rule_may_postdate_document' => $stampedVersion !== null && $stampedVersion < $current,
                'inferred' => $inferred,
            ],
            $counter->store_id
        );
    }

    /**
     * Whether the pharmacist a queued document names holds a registration the
     * rule still trusts. This decides an exception, never the document: the
     * bill was written in the dark and the store keeps it.
     *
     * The confirmation is read from the stored row when the payload says
     * nothing, because a revision that repeats no PIN is not evidence that no
     * pharmacist vouched for the sale.
     *
     * @return array<string,mixed>|null
     */
    private function pharmacistConfirmation(Invoice $invoice, array $payload): ?array
    {
        $restricted = RestrictedDrugResolver::forInvoice($invoice);

        if ($restricted === []) {
            return null;
        }

        $answer = PharmacistGate::review(
            (int) $invoice->store_id,
            $restricted,
            $payload['pharmacist_id'] ?? $invoice->pharmacist_id ?? null,
            $payload['pharmacist_pin'] ?? null
        );

        if ($answer['code'] === null) {
            return null;
        }

        return [
            'action' => PharmacistGate::ACTION,
            'control' => null,
            'code' => $answer['code'],
            'message' => $answer['reason'],
            'needs_grant' => false,
            'inferred' => false,
        ];
    }

    /**
     * Whether a line was billed at a rate the master does not carry.
     *
     * The line now records the rate basis the counter billed on, so a PTR or
     * loose-unit sale is not mistaken for a retyped price. The row is stamped
     * `inferred` so an owner is never told a guess is a fact.
     */
    private function priceOverride(Counter $counter, $items): ?array
    {
        $profile = CounterProfile::resolve($counter);
        $rule = (array) ($profile['price_override'] ?? []);

        if (($rule['allowed'] ?? true) !== false && ($rule['approval_pct'] ?? null) === null) {
            return null;
        }

        $facts = BillPriceFacts::overrideFacts($counter->store_id, $items);

        return $facts === [] ? null : $facts + ['inferred' => true];
    }

    /**
     * The watermark the till stamped when it wrote the document. A payload from
     * an older build carries nothing, which the register leaves null rather
     * than pretending the document predates every rule.
     */
    private function stamped(array $payload): ?int
    {
        foreach (['permission_profile_version', 'profile_version'] as $key) {
            if (isset($payload[$key]) && is_numeric($payload[$key])) {
                return (int) $payload[$key];
            }
        }

        return null;
    }

    private function idOf(array $payload): ?string
    {
        foreach (['id', 'external_id', 'document_id', 'idempotency_key'] as $key) {
            if (!empty($payload[$key])) {
                return (string) $payload[$key];
            }
        }

        return null;
    }

    /** @return list<string> the tenders named, empties dropped */
    private function modes(array $values): array
    {
        return array_values(array_filter(array_map(
            static fn ($mode) => $mode === null ? null : (string) $mode,
            $values
        ), static fn (?string $mode) => $mode !== null && trim($mode) !== ''));
    }

    /** @return array<string,mixed> */
    private function settingsOf(array $payload): array
    {
        $settings = $payload['settings'] ?? $payload;

        return is_array($settings) ? $settings : [];
    }

    private function isReturn(mixed $moduleKey): bool
    {
        $key = strtolower(trim((string) $moduleKey));

        return str_contains($key, 'return')
            || str_contains($key, 'debit')
            || str_contains($key, 'credit_note')
            || str_contains($key, 'refund');
    }

    /** Flagging must never cost the store a document, whatever it throws. */
    private function guard(callable $review): void
    {
        try {
            DB::transaction($review);
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
