<?php

namespace App\Support\Payments;

use App\Models\CompanySetting;
use App\Models\InvoicePayment;
use DomainException;

/**
 * PAY-04 — the till has always described the rule, the server never applied it.
 *
 * A store's payment modes are stored under `company_settings.payments.modes`.
 * The defaults below mirror the till's own defaults, with UPI and Card now
 * requiring a reference so an unconfigured store cannot bank an unreconcilable
 * digital payment.
 */
class PaymentModePolicy
{
    public const DEFAULT_MODES = [
        ['id' => 'cash', 'name' => 'Cash', 'referenceRequirement' => 'off'],
        [
            'id' => 'upi',
            'name' => 'UPI',
            'referenceRequirement' => 'required',
            'referenceLabel' => 'UPI Transaction ID / UTR',
            'referenceRegex' => '^[0-9A-Za-z_-]{6,35}$',
            'referenceMinLength' => 6,
            'referenceMaxLength' => 35,
            'duplicateCheck' => 'warn',
        ],
        [
            'id' => 'card',
            'name' => 'Card',
            'referenceRequirement' => 'required',
            'referenceLabel' => 'Card Approval Code / Auth Code',
            'duplicateCheck' => 'warn',
        ],
        [
            'id' => 'bank_transfer',
            'name' => 'Bank Transfer',
            'referenceRequirement' => 'optional',
            'referenceLabel' => 'Bank Reference / UTR',
            'duplicateCheck' => 'warn',
        ],
        [
            'id' => 'cheque',
            'name' => 'Cheque',
            'referenceRequirement' => 'required',
            'referenceLabel' => 'Cheque Number',
            'referenceMinLength' => 6,
            'referenceMaxLength' => 20,
            'duplicateCheck' => 'block',
        ],
        [
            'id' => 'wallet',
            'name' => 'Wallet / Store Credit',
            'referenceRequirement' => 'optional',
            'duplicateCheck' => 'warn',
        ],
        [
            'id' => 'gift_voucher',
            'name' => 'Gift Voucher',
            'referenceRequirement' => 'required',
            'referenceLabel' => 'Voucher Code',
            'duplicateCheck' => 'block',
        ],
        ['id' => 'credit', 'name' => 'Credit (Udhari)', 'referenceRequirement' => 'off'],
    ];

    /** @return array<int,array<string,mixed>> */
    public function modesForStore(int $storeId): array
    {
        $value = CompanySetting::where('store_id', $storeId)->where('key', 'payments')->value('value');
        $modes = is_array($value) && !empty($value['modes']) && is_array($value['modes'])
            ? $value['modes']
            : self::DEFAULT_MODES;

        return array_values(array_filter($modes, fn ($m) => is_array($m)));
    }

    public function assertLine(int $storeId, string $mode, ?string $reference, ?int $ignoreInvoiceId = null): void
    {
        $reference = trim((string) $reference);
        $config = $this->configFor($storeId, $mode);
        if (!$config) {
            return;
        }

        $requirement = strtolower((string) ($config['referenceRequirement'] ?? 'off'));
        $label = (string) ($config['referenceLabel'] ?? ($mode . ' Reference'));

        if ($requirement === 'required' && $reference === '') {
            throw new DomainException("{$label} is required for {$mode} payments.");
        }

        if ($reference === '') {
            return;
        }

        $min = (int) ($config['referenceMinLength'] ?? 0);
        if ($min > 0 && mb_strlen($reference) < $min) {
            throw new DomainException("{$label} must be at least {$min} characters.");
        }

        $max = (int) ($config['referenceMaxLength'] ?? 0);
        if ($max > 0 && mb_strlen($reference) > $max) {
            throw new DomainException("{$label} cannot exceed {$max} characters.");
        }

        $regex = (string) ($config['referenceRegex'] ?? '');
        if ($regex !== '') {
            $pattern = '#' . str_replace('#', '\#', $regex) . '#u';
            if (@preg_match($pattern, $reference) !== 1) {
                throw new DomainException("Invalid format for {$label}.");
            }
        }

        if (strtolower((string) ($config['duplicateCheck'] ?? 'off')) === 'block') {
            $duplicate = InvoicePayment::query()
                ->where('store_id', $storeId)
                ->where('reference_no', $reference)
                ->where('status', '!=', 'refunded')
                ->when($ignoreInvoiceId, fn ($q) => $q->where('invoice_id', '!=', $ignoreInvoiceId))
                ->exists();

            if ($duplicate) {
                throw new DomainException("The reference '{$reference}' has already been used on another payment.");
            }
        }
    }

    /** @return array<string,mixed>|null */
    public function configFor(int $storeId, string $mode): ?array
    {
        $key = $this->modeKey($mode);
        foreach ($this->modesForStore($storeId) as $config) {
            $id = $this->modeKey((string) ($config['id'] ?? ''));
            $name = $this->modeKey((string) ($config['name'] ?? ''));
            if ($key === $id || $key === $name) {
                return $config;
            }
        }

        return null;
    }

    public function modeKey(string $mode): string
    {
        $key = strtolower(trim($mode));
        $aliases = [
            'gift card' => 'gift_voucher',
            'gift_card' => 'gift_voucher',
            'giftcard' => 'gift_voucher',
            'gift voucher' => 'gift_voucher',
            'udhari' => 'credit',
        ];

        return $aliases[$key] ?? preg_replace('/[^a-z0-9]+/', '_', $key);
    }
}
