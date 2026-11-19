<?php

namespace App\Services\Tax;

use App\Models\CompanySetting;
use App\Models\Store;

/**
 * Single source of truth for a store's GST profile.
 *
 * The POS settings screen and the admin panel both persist tax mode inside the
 * "billing" company setting and mirror it onto the stores row, so "billing" is what
 * the API must read first. The older "tax_settings" key is consulted next for stores
 * configured by previous builds; nothing writes it any more. The stores columns are
 * last because they carry non-null defaults, so a plain "inclusive"/"regular" there
 * cannot be told apart from a store that was never configured.
 */
class StoreTaxPolicy
{
    public const BILLING_KEY = 'billing';
    public const LEGACY_KEY = 'tax_settings';

    public const TAX_MODES = ['inclusive', 'exclusive'];

    public const GST_TYPES = ['regular', 'composition', 'no_tax', 'unregistered'];

    /**
     * @return array{tax_mode: string, purchase_tax_mode: string, gst_type: string, allow_override: bool}
     */
    public function forStore(?int $storeId): array
    {
        $billing = $this->settings($storeId, self::BILLING_KEY);
        $legacy = $this->settings($storeId, self::LEGACY_KEY);
        $store = $storeId ? Store::find($storeId) : null;

        $taxMode = $this->pickMode($billing['tax_mode'] ?? null)
            ?? $this->pickMode($legacy['tax_mode'] ?? null)
            ?? $this->pickMode($store?->tax_mode)
            ?? 'inclusive';

        $purchaseTaxMode = $this->pickMode($billing['purchase_tax_mode'] ?? null)
            ?? $this->pickMode($legacy['purchase_tax_mode'] ?? null)
            ?? 'exclusive';

        $gstType = $this->pickType($billing['gst_type'] ?? null)
            ?? $this->pickType($legacy['gst_type'] ?? null)
            ?? $this->pickType($store?->gst_type)
            ?? 'regular';

        $allowOverride = $this->pickBool($billing['allow_tax_override_per_bill'] ?? null)
            ?? $this->pickBool($legacy['allow_tax_override_per_bill'] ?? null)
            ?? false;

        return [
            'tax_mode' => $taxMode,
            'purchase_tax_mode' => $purchaseTaxMode,
            'gst_type' => $gstType,
            'allow_override' => $allowOverride,
        ];
    }

    private function settings(?int $storeId, string $key): array
    {
        if (!$storeId) {
            return [];
        }

        $setting = CompanySetting::where('store_id', $storeId)->where('key', $key)->first();

        return is_array($setting?->value) ? $setting->value : [];
    }

    private function pickMode(mixed $value): ?string
    {
        return in_array($value, self::TAX_MODES, true) ? $value : null;
    }

    private function pickType(mixed $value): ?string
    {
        return in_array($value, self::GST_TYPES, true) ? $value : null;
    }

    private function pickBool(mixed $value): ?bool
    {
        return $value === null ? null : filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }
}
