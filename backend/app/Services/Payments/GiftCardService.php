<?php

namespace App\Services\Payments;

use App\Models\GiftCard;
use App\Models\GiftCardTransaction;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class GiftCardService
{
    private const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    /**
     * Issue a new gift card with a unique, human-readable code.
     */
    public function issue(int $storeId, array $data, ?int $userId = null): GiftCard
    {
        $initial = round((float) ($data['initial_balance'] ?? $data['amount'] ?? 0), 2);
        if ($initial <= 0) {
            throw ValidationException::withMessages(['initial_balance' => 'Initial balance must be greater than zero.']);
        }

        $requestedCode = isset($data['code']) ? $this->normalizeCode((string) $data['code']) : null;
        if ($requestedCode !== null && $requestedCode !== '') {
            if (GiftCard::where('store_id', $storeId)->where('code', $requestedCode)->exists()) {
                throw ValidationException::withMessages(['code' => 'A gift card with this code already exists for this store.']);
            }
            $code = $requestedCode;
        } else {
            $code = $this->uniqueCode($storeId);
        }

        return DB::transaction(function () use ($storeId, $data, $userId, $initial, $code) {
            $card = GiftCard::create([
                'store_id' => $storeId,
                'code' => $code,
                'initial_balance' => $initial,
                'balance' => $initial,
                'status' => GiftCard::STATUS_ACTIVE,
                'issued_to_name' => $data['issued_to_name'] ?? null,
                'issued_to_phone' => $data['issued_to_phone'] ?? null,
                'customer_id' => $data['customer_id'] ?? null,
                'expires_at' => $data['expires_at'] ?? null,
                'notes' => $data['notes'] ?? null,
                'created_by' => $userId,
            ]);

            GiftCardTransaction::create([
                'gift_card_id' => $card->id,
                'store_id' => $storeId,
                'type' => GiftCardTransaction::TYPE_ISSUE,
                'amount' => $initial,
                'balance_after' => $initial,
                'reference_type' => 'gift_card',
                'reference_id' => (string) $card->id,
                'notes' => 'Card issued',
                'created_by' => $userId,
            ]);

            return $card;
        });
    }

    /**
     * Redeem value from a card. Must run inside the caller's transaction when
     * part of an invoice so that the sale and the deduction commit together.
     */
    public function redeem(
        int $storeId,
        string $code,
        float $amount,
        ?int $invoiceId = null,
        ?string $referenceType = null,
        ?string $referenceId = null,
        ?int $userId = null
    ): GiftCardTransaction {
        $amount = round($amount, 2);
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Redemption amount must be greater than zero.']);
        }

        $normalized = $this->normalizeCode($code);
        if ($normalized === '') {
            throw new \DomainException('Gift card code is required for gift card tenders.');
        }

        return DB::transaction(function () use ($storeId, $normalized, $amount, $invoiceId, $referenceType, $referenceId, $userId) {
            /** @var GiftCard|null $card */
            $card = GiftCard::where('store_id', $storeId)
                ->where('code', $normalized)
                ->lockForUpdate()
                ->first();

            if (!$card) {
                throw new \DomainException("Gift card '{$normalized}' was not found for this store.");
            }

            if ($card->status === GiftCard::STATUS_DISABLED) {
                throw new \DomainException('This gift card has been disabled.');
            }
            if ($card->expires_at && $card->expires_at->lt(Carbon::today())) {
                $this->markExpired($card);
                throw new \DomainException('This gift card has expired.');
            }
            if ((float) $card->balance + 0.001 < $amount) {
                throw new \DomainException(sprintf('Insufficient gift card balance: available ₹%.2f, requested ₹%.2f.', (float) $card->balance, $amount));
            }

            $newBalance = round((float) $card->balance - $amount, 2);
            $card->balance = $newBalance;
            if ($newBalance <= 0.001) {
                $card->status = GiftCard::STATUS_EXHAUSTED;
            }
            $card->save();

            return GiftCardTransaction::create([
                'gift_card_id' => $card->id,
                'store_id' => $storeId,
                'type' => GiftCardTransaction::TYPE_REDEEM,
                'amount' => $amount,
                'balance_after' => $newBalance,
                'reference_type' => $referenceType,
                'reference_id' => $referenceId,
                'invoice_id' => $invoiceId,
                'created_by' => $userId,
            ]);
        });
    }

    /**
     * Return value to a card (e.g. invoice cancellation).
     */
    public function refund(int $storeId, string $code, float $amount, ?int $invoiceId = null, ?int $userId = null): GiftCardTransaction
    {
        return DB::transaction(function () use ($storeId, $code, $amount, $invoiceId, $userId) {
            $normalized = $this->normalizeCode($code);
            /** @var GiftCard|null $card */
            $card = GiftCard::where('store_id', $storeId)->where('code', $normalized)->lockForUpdate()->first();
            if (!$card) {
                throw new \DomainException("Gift card '{$normalized}' was not found for this store.");
            }

            $newBalance = round((float) $card->balance + $amount, 2);
            $card->balance = $newBalance;
            if ($card->status === GiftCard::STATUS_EXHAUSTED) {
                $card->status = GiftCard::STATUS_ACTIVE;
            }
            $card->save();

            return GiftCardTransaction::create([
                'gift_card_id' => $card->id,
                'store_id' => $storeId,
                'type' => GiftCardTransaction::TYPE_REFUND,
                'amount' => $amount,
                'balance_after' => $newBalance,
                'reference_type' => 'invoice',
                'reference_id' => $invoiceId ? (string) $invoiceId : null,
                'invoice_id' => $invoiceId,
                'notes' => 'Value returned from cancelled invoice',
                'created_by' => $userId,
            ]);
        });
    }

    public function findByCode(int $storeId, string $code): ?GiftCard
    {
        return GiftCard::where('store_id', $storeId)->where('code', $this->normalizeCode($code))->first();
    }

    /**
     * Apply an administrative credit or debit and record the ledger entry.
     */
    public function adjust(int $storeId, GiftCard $card, float $amount, string $direction, ?string $notes = null, ?int $userId = null): GiftCardTransaction
    {
        $amount = round($amount, 2);
        if ($amount <= 0) {
            throw ValidationException::withMessages(['amount' => 'Adjustment amount must be greater than zero.']);
        }

        return DB::transaction(function () use ($storeId, $card, $amount, $direction, $notes, $userId) {
            /** @var GiftCard $locked */
            $locked = GiftCard::where('id', $card->id)->lockForUpdate()->firstOrFail();
            $delta = $direction === 'debit' ? -$amount : $amount;
            $newBalance = round((float) $locked->balance + $delta, 2);
            if ($newBalance < 0) {
                throw ValidationException::withMessages(['amount' => 'Adjustment would make the card balance negative.']);
            }

            $locked->balance = $newBalance;
            if ($newBalance <= 0.001) {
                $locked->status = GiftCard::STATUS_EXHAUSTED;
            } elseif ($locked->status === GiftCard::STATUS_EXHAUSTED) {
                $locked->status = GiftCard::STATUS_ACTIVE;
            }
            $locked->save();

            return GiftCardTransaction::create([
                'gift_card_id' => $locked->id,
                'store_id' => $storeId,
                'type' => GiftCardTransaction::TYPE_ADJUST,
                'amount' => $amount,
                'balance_after' => $newBalance,
                'reference_type' => 'adjustment',
                'notes' => $notes ?? ucfirst($direction) . ' adjustment',
                'created_by' => $userId,
            ]);
        });
    }

    public function normalizeCode(string $code): string
    {
        return strtoupper(preg_replace('/[\s\-]+/', '', trim($code)) ?? '');
    }

    private function markExpired(GiftCard $card): void
    {
        if ($card->status === GiftCard::STATUS_ACTIVE) {
            $card->status = GiftCard::STATUS_EXPIRED;
            $card->save();
        }
    }

    private function uniqueCode(int $storeId): string
    {
        for ($attempt = 0; $attempt < 20; $attempt++) {
            $raw = '';
            for ($i = 0; $i < 12; $i++) {
                $raw .= self::CODE_ALPHABET[random_int(0, strlen(self::CODE_ALPHABET) - 1)];
            }
            $code = 'GC' . $raw;
            if (!GiftCard::where('store_id', $storeId)->where('code', $code)->exists()) {
                return $code;
            }
        }

        return 'GC' . strtoupper(Str::random(12));
    }
}
