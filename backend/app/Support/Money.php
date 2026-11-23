<?php

namespace App\Support;

/**
 * Money in this codebase is stored as decimal strings/floats, but report totals
 * add many of them together. Adding binary floats leaves noise such as
 * 0.30000000000000004 in the JSON, so every sum is accumulated as integer paise
 * and converted back once.
 */
final class Money
{
    public static function paise(mixed $value): int
    {
        if ($value === null || $value === '') {
            return 0;
        }

        return (int) round(((float) $value) * 100);
    }

    public static function toFloat(int $paise): float
    {
        return $paise / 100;
    }

    public static function round2(mixed $value): float
    {
        return self::toFloat(self::paise($value));
    }

    /**
     * @param  array<int|string, mixed>  $values
     */
    public static function sum(array $values): float
    {
        $total = 0;

        foreach ($values as $value) {
            $total += self::paise($value);
        }

        return self::toFloat($total);
    }
}
