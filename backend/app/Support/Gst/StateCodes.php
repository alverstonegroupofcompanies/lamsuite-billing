<?php

namespace App\Support\Gst;

/**
 * The GST state codes a document can name. Every place of supply is stored as
 * "<code>-<state>" (the till and the admin UI both print it that way), so one
 * table turns a store's or a party's state into the label a document keeps.
 */
final class StateCodes
{
    public const NAMES = [
        '01' => 'Jammu & Kashmir',
        '02' => 'Himachal Pradesh',
        '03' => 'Punjab',
        '04' => 'Chandigarh',
        '05' => 'Uttarakhand',
        '06' => 'Haryana',
        '07' => 'Delhi',
        '08' => 'Rajasthan',
        '09' => 'Uttar Pradesh',
        '10' => 'Bihar',
        '11' => 'Sikkim',
        '12' => 'Arunachal Pradesh',
        '13' => 'Nagaland',
        '14' => 'Manipur',
        '15' => 'Mizoram',
        '16' => 'Tripura',
        '17' => 'Meghalaya',
        '18' => 'Assam',
        '19' => 'West Bengal',
        '20' => 'Jharkhand',
        '21' => 'Odisha',
        '22' => 'Chhattisgarh',
        '23' => 'Madhya Pradesh',
        '24' => 'Gujarat',
        '25' => 'Daman & Diu',
        '26' => 'Dadra & Nagar Haveli and Daman & Diu',
        '27' => 'Maharashtra',
        '28' => 'Andhra Pradesh (old)',
        '29' => 'Karnataka',
        '30' => 'Goa',
        '31' => 'Lakshadweep',
        '32' => 'Kerala',
        '33' => 'Tamil Nadu',
        '34' => 'Puducherry',
        '35' => 'Andaman & Nicobar Islands',
        '36' => 'Telangana',
        '37' => 'Andhra Pradesh',
        '38' => 'Ladakh',
        '97' => 'Other Territory',
        '99' => 'Centre Jurisdiction',
    ];

    /**
     * The two-digit code at the front of a state code, a label ("32-Kerala")
     * or a GSTIN ("32ABCDE1234F1Z5"), or null when it is not a known code.
     */
    public static function code(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim($value);

        if (strlen($value) < 2 || !ctype_digit(substr($value, 0, 2))) {
            return null;
        }

        $code = substr($value, 0, 2);

        return isset(self::NAMES[$code]) ? $code : null;
    }

    public static function label(?string $value): ?string
    {
        $code = self::code($value);

        return $code === null ? null : "{$code}-" . self::NAMES[$code];
    }
}
