<?php

namespace App\Services\Gst;

use App\Models\Store;
use App\Support\GstStateCodes;

/**
 * One answer to "which state does this party belong to?" for every writer:
 * the GSTIN prefix is the registered place, otherwise an explicit valid state,
 * otherwise the store the party was created in.
 */
final class PartyStateResolver
{
    public function resolve(?string $explicit, ?string $gstin, ?Store $store): string
    {
        if ($fromGstin = GstStateCodes::fromGstin($gstin)) {
            return $fromGstin;
        }

        $explicit = GstStateCodes::normalize($explicit);
        if (GstStateCodes::isValid($explicit)) {
            return $explicit;
        }

        $storeState = GstStateCodes::normalize($store?->state_code);
        if (GstStateCodes::isValid($storeState)) {
            return $storeState;
        }

        // Legacy stores can still carry an unvalidated state; the repair
        // command reports them. Never trust it beyond this last resort.
        return '32';
    }

    public function forStoreId(?string $explicit, ?string $gstin, ?int $storeId): string
    {
        return $this->resolve($explicit, $gstin, $storeId ? Store::find($storeId) : null);
    }
}
