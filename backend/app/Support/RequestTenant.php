<?php

namespace App\Support;

use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * G1-SEC — the one answer to "which store, which counter is this request for?".
 *
 * Authentication middleware decides it and leaves it on the request:
 *  - AuthenticateDevice sets `device_store_id` / `device_counter_id` from the
 *    counter's device token;
 *  - ScopeStore (directly, or through AuthenticateCounterOrUser for a person on
 *    a till route) sets `active_store_id` after checking the person may reach it.
 *
 * Controllers read it from here and never from a body field, header or query
 * string, and never fall back to "the first store".
 */
final class RequestTenant
{
    public static function storeId(Request $request): ?int
    {
        $device = $request->attributes->get('device_store_id');
        if ($device !== null && $device !== '') {
            return (int) $device;
        }

        $active = $request->attributes->get('active_store_id');
        if ($active !== null && $active !== '') {
            return (int) $active;
        }

        return null;
    }

    /** The store, or a 422 the client can show; never a guess. */
    public static function requireStoreId(Request $request): int
    {
        $storeId = self::storeId($request);
        if ($storeId === null) {
            throw new HttpException(422, 'Select a store: this request is not bound to one.');
        }

        return $storeId;
    }

    /** The counter whose device token made the request, if a counter made it. */
    public static function counterId(Request $request): ?int
    {
        $counter = $request->attributes->get('device_counter_id');

        return ($counter === null || $counter === '') ? null : (int) $counter;
    }

    public static function isCounter(Request $request): bool
    {
        return $request->attributes->get('device_store_id') !== null;
    }
}
