<?php

namespace App\Services\Payments;

use App\Models\Party;
use App\Support\Payments\PaymentModePolicy;
use DomainException;

/**
 * PAY-02 / PAY-03 — one authoritative reading of a settlement payload.
 *
 * `amount` on the way in may be what the customer handed over (legacy tills)
 * or the applied amount with `tendered_amount` beside it (new tills). Either
 * way this service decides what the bill kept, what went back as change, and
 * whether the bill is settled at all — so reports, the drawer and the invoice
 * cannot disagree.
 */
class TenderSettlementService
{
    public function __construct(private PaymentModePolicy $policy)
    {
    }

    /**
     * @param array<int,array<string,mixed>>|null $rawPayments
     * @return array{
     *   lines: array<int,array<string,mixed>>,
     *   paid: float,
     *   credit: float,
     *   cash: float,
     *   digital: float,
     *   gift_card: float,
     *   change_due: float,
     *   balance_due: float,
     *   primary_mode: string,
     *   payment_status: string
     * }
     */
    public function settle(
        float $grandTotal,
        ?array $rawPayments,
        mixed $legacyPaidAmount,
        ?string $legacyMode,
        ?Party $party,
        int $storeId,
        ?int $ignoreInvoiceId = null,
        bool $offlineIngest = false
    ): array {
        $grand = $this->money($grandTotal);
        // A bill a till already rang up offline has moved its goods and money.
        // Store-policy rules (walk-in settles in full, credit limit, reference
        // required) are recorded against it rather than refusing it; rules about
        // what money can physically mean (change only from cash, non-cash cannot
        // exceed the bill, no receivable for nobody) still refuse.
        $policyExceptions = [];
        $policy = function (string $message) use ($offlineIngest, &$policyExceptions): void {
            if (!$offlineIngest) {
                throw new DomainException($message);
            }
            $policyExceptions[] = $message;
        };
        $explicit = $this->hasExplicitTender($rawPayments);
        $draft = [];

        if (!empty($rawPayments) && is_array($rawPayments)) {
            foreach ($rawPayments as $payment) {
                if (!is_array($payment)) {
                    continue;
                }

                $mode = $this->modeName((string) ($payment['mode'] ?? $payment['payment_mode'] ?? 'Cash'));
                $amount = $this->money($payment['amount'] ?? 0);
                $tendered = $explicit
                    ? max($amount, $this->money($payment['tendered_amount'] ?? $amount))
                    : $amount;

                if ($tendered <= 0) {
                    continue;
                }

                $extra = $payment['extra_fields'] ?? null;
                if (is_string($extra)) {
                    $extra = json_decode($extra, true) ?: null;
                }
                $extra = is_array($extra) ? $extra : [];
                $reference = $payment['reference_no'] ?? ($payment['reference'] ?? null);
                $reference = $reference === null ? null : trim((string) $reference);

                if ($this->isGiftCard($mode) && empty($extra['gift_card_code']) && $reference) {
                    $extra['gift_card_code'] = $reference;
                }

                $declaredChange = $this->money($payment['change_amount'] ?? 0);
                $draft[] = [
                    'mode' => $mode,
                    'tendered' => $tendered,
                    'declared_applied' => $amount,
                    'declared_change' => $declaredChange,
                    'reference_no' => $reference !== '' ? $reference : null,
                    'status' => (string) ($payment['status'] ?? 'received') ?: 'received',
                    'extra_fields' => $extra ?: null,
                    'notes' => $payment['notes'] ?? null,
                    'is_gift_card' => $this->isGiftCard($mode),
                ];
            }
        } else {
            // Legacy single-mode payload: paid_amount is what the invoice says
            // it collected; absent that, the historical default is "paid in full".
            $paid = $legacyPaidAmount === null ? $grand : $this->money($legacyPaidAmount);
            if ($paid > 0) {
                $mode = $this->modeName((string) ($legacyMode ?: 'Cash'));
                $draft[] = [
                    'mode' => $mode,
                    'tendered' => $paid,
                    'declared_applied' => $paid,
                    'declared_change' => 0.0,
                    'reference_no' => null,
                    'status' => 'received',
                    'extra_fields' => null,
                    'notes' => null,
                    'is_gift_card' => $this->isGiftCard($mode),
                ];
            }
        }

        $cash = 0.0;
        $nonCash = 0.0;
        $credit = 0.0;

        foreach ($draft as $line) {
            if ($this->isCredit($line['mode'])) {
                $credit += $line['tendered'];
            } elseif ($this->isCash($line['mode'])) {
                $cash += $line['tendered'];
            } else {
                if ($line['declared_change'] > 0.005) {
                    throw new DomainException('Change can only be returned on a Cash tender.');
                }
                $nonCash += $line['tendered'];
            }
        }

        $cash = $this->money($cash);
        $nonCash = $this->money($nonCash);
        $credit = $this->money($credit);

        if ($this->money($nonCash + $credit) > $this->money($grand + 0.005)) {
            throw new DomainException('Non-cash payments (UPI, Card, Bank) cannot exceed the amount due. Change can only be returned for Cash.');
        }

        if ($credit > 0.001 && $this->isWalkIn($party)) {
            throw new DomainException('Credit sale is not allowed for Walk-in Customers. Please select or create a registered customer.');
        }

        $remaining = max(0.0, $this->money($grand - $nonCash - $credit));
        $lines = [];
        $appliedPaid = 0.0;
        $changeDue = 0.0;
        $digital = 0.0;
        $giftCard = 0.0;

        foreach ($draft as $line) {
            if ($this->isCash($line['mode'])) {
                $applied = min($line['tendered'], $remaining);
                $applied = $this->money($applied);
                $change = $this->money($line['tendered'] - $applied);
                $remaining = $this->money($remaining - $applied);
            } else {
                $applied = $line['tendered'];
                $change = 0.0;
            }

            $isCredit = $this->isCredit($line['mode']);
            if (!$isCredit) {
                $appliedPaid += $applied;
                if ($line['is_gift_card']) {
                    $giftCard += $applied;
                } elseif (!$this->isCash($line['mode'])) {
                    $digital += $applied;
                }
            }

            $changeDue += $change;

            $lines[] = [
                'mode' => $line['mode'],
                'amount' => $applied,
                'tendered_amount' => $this->money($line['tendered']),
                'change_amount' => $change,
                'reference_no' => $line['reference_no'],
                'status' => $line['status'],
                'extra_fields' => $line['extra_fields'],
                'notes' => $line['notes'],
                'is_gift_card' => $line['is_gift_card'],
                'is_credit' => $isCredit,
            ];
        }

        $appliedPaid = $this->money($appliedPaid);
        $changeDue = $this->money($changeDue);
        $balanceDue = max(0.0, $this->money($grand - $appliedPaid - $credit));

        if ($this->isWalkIn($party) && $balanceDue > 0.005) {
            $policy('Walk-in bills must be settled in full. Add a payment line or select a registered customer for credit.');
        }

        if ($credit > 0.001) {
            $limit = (float) ($party?->credit_limit ?? 0);
            if ($limit > 0) {
                $current = (float) ($party?->current_balance ?? 0);
                $newBalance = $this->money($current + $credit);
                if ($newBalance > $limit) {
                    $policy("Customer '{$party->name}' credit limit of ₹{$limit} exceeded (New balance would be ₹{$newBalance}).");
                }
            }
        }

        foreach ($lines as $line) {
            if ($line['amount'] <= 0 || $line['is_credit']) {
                continue;
            }
            $reference = $line['reference_no'];
            if ($this->isGiftCard($line['mode']) && !$reference) {
                $reference = $line['extra_fields']['gift_card_code'] ?? null;
            }
            try {
                $this->policy->assertLine($storeId, $line['mode'], $reference, $ignoreInvoiceId);
            } catch (DomainException $e) {
                $policy($e->getMessage());
            }
        }

        // Credit is a receivable, not money in hand: paid_amount keeps the
        // historical meaning of "collected now".
        $banked = $appliedPaid;
        if ($credit >= $this->money($grand - 0.01)) {
            $paymentStatus = 'unpaid';
        } elseif ($credit > 0.001 || $banked < $this->money($grand - 0.01)) {
            $paymentStatus = 'partially_paid';
        } else {
            $paymentStatus = 'paid';
        }

        $primaryMode = count($lines) > 1
            ? 'Split'
            : ($lines[0]['mode'] ?? ($legacyMode ? $this->modeName($legacyMode) : 'Cash'));

        return [
            'lines' => $lines,
            'paid' => $appliedPaid,
            'credit' => $credit,
            'cash' => $this->money(array_sum(array_map(
                fn ($l) => $this->isCash($l['mode']) ? $l['amount'] : 0,
                $lines
            ))),
            'digital' => $this->money($digital),
            'gift_card' => $this->money($giftCard),
            'change_due' => $changeDue,
            'balance_due' => $balanceDue,
            'primary_mode' => $primaryMode,
            'payment_status' => $paymentStatus,
            'policy_exceptions' => $policyExceptions,
        ];
    }

    /** @param array<int,mixed>|null $payments */
    private function hasExplicitTender(?array $payments): bool
    {
        if (empty($payments)) {
            return false;
        }
        foreach ($payments as $payment) {
            if (is_array($payment) && array_key_exists('tendered_amount', $payment)) {
                return true;
            }
        }

        return false;
    }

    private function isWalkIn(?Party $party): bool
    {
        if (!$party) {
            return true;
        }
        $name = strtolower(trim((string) $party->name));

        return $name === '' || str_contains($name, 'walk-in') || str_contains($name, 'walk in');
    }

    private function isCash(string $mode): bool
    {
        return $this->modeKey($mode) === 'cash';
    }

    private function isCredit(string $mode): bool
    {
        return in_array($this->modeKey($mode), ['credit', 'udhari'], true);
    }

    private function isGiftCard(string $mode): bool
    {
        return in_array($this->modeKey($mode), ['gift_voucher', 'gift_card', 'giftcard'], true);
    }

    private function modeKey(string $mode): string
    {
        return $this->policy->modeKey($mode);
    }

    private function modeName(string $mode): string
    {
        $mode = trim($mode);
        if ($mode === '') {
            return 'Cash';
        }
        $key = $this->modeKey($mode);
        $names = [
            'cash' => 'Cash',
            'upi' => 'UPI',
            'card' => 'Card',
            'bank_transfer' => 'Bank Transfer',
            'cheque' => 'Cheque',
            'wallet' => 'Wallet',
            'gift_voucher' => 'Gift Voucher',
            'credit' => 'Credit',
        ];

        return $names[$key] ?? ucwords(str_replace('_', ' ', $mode));
    }

    private function money(mixed $value): float
    {
        return round((float) $value + 0.0, 2);
    }
}
