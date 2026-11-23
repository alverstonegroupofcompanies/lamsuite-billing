<?php

namespace App\Support;

/**
 * The GST place-of-supply codes a store or party may carry. A store's state
 * decides CGST+SGST vs IGST, so an arbitrary string here is a tax defect, not a
 * cosmetic one.
 */
final class GstStateCodes
{
    public const GSTIN_PATTERN = '/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/';

    public const NAMES = [
        '01' => 'Jammu and Kashmir',
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
        '26' => 'Dadra and Nagar Haveli and Daman and Diu',
        '27' => 'Maharashtra',
        '29' => 'Karnataka',
        '30' => 'Goa',
        '31' => 'Lakshadweep',
        '32' => 'Kerala',
        '33' => 'Tamil Nadu',
        '34' => 'Puducherry',
        '35' => 'Andaman and Nicobar Islands',
        '36' => 'Telangana',
        '37' => 'Andhra Pradesh',
        '38' => 'Ladakh',
        '97' => 'Other Territory',
    ];

    /** @return list<string> */
    public static function all(): array
    {
        return array_keys(self::NAMES);
    }

    public static function isValid(?string $code): bool
    {
        return is_string($code) && array_key_exists(trim($code), self::NAMES);
    }

    /**
     * Accepts "29" or "29-Karnataka"; anything else is returned unchanged so
     * the caller's validation still rejects it. In particular "3232" must not
     * collapse into "32".
     */
    public static function normalize(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim($value);
        if (preg_match('/^(\d{2})(?:-.+)?$/', $value, $matches) === 1) {
            return $matches[1];
        }

        return $value === '' ? null : $value;
    }

    public static function isValidGstin(?string $gstin): bool
    {
        if ($gstin === null) {
            return false;
        }

        return preg_match(self::GSTIN_PATTERN, strtoupper(trim($gstin))) === 1;
    }

    /** The GST state prefix of a valid GSTIN, or null. */
    public static function fromGstin(?string $gstin): ?string
    {
        if (!self::isValidGstin($gstin)) {
            return null;
        }

        $code = substr(strtoupper(trim((string) $gstin)), 0, 2);

        return self::isValid($code) ? $code : null;
    }
}
