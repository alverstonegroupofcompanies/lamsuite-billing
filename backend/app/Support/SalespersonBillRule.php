<?php

namespace App\Support;

use App\Models\CompanySetting;
use App\Models\Salesperson;

/**
 * SPR-006 — whether a bill has to name the person who sold it.
 *
 * The store chooses once; the till and the server read the same word. `required`
 * only bites where there is somebody to name, so a store that upgraded with an
 * empty master keeps billing until its owner lists a salesperson — the moment
 * one exists, every new bill has to say who sold it.
 */
final class SalespersonBillRule
{
    public const OFF = 'off';

    public const OPTIONAL = 'optional';

    public const REQUIRED = 'required';

    public const MODES = [self::OFF, self::OPTIONAL, self::REQUIRED];

    public static function mode(int $storeId): string
    {
        $stored = CompanySetting::where('store_id', $storeId)
            ->where('key', 'salesperson_on_bill')
            ->value('value');

        // `value` is a json document, so a bare word arrives decoded as text.
        $word = is_array($stored) ? ($stored[0] ?? null) : $stored;

        return in_array($word, self::MODES, true) ? $word : self::REQUIRED;
    }

    /** The field is on the bill at all when the store has not switched it off. */
    public static function shows(int $storeId): bool
    {
        return self::mode($storeId) !== self::OFF;
    }

    /** A bill may not be saved without one. */
    public static function enforced(int $storeId): bool
    {
        return self::mode($storeId) === self::REQUIRED
            && Salesperson::ofStore($storeId)->selectable()->exists();
    }
}
