<?php

namespace App\Services\Tax;

use App\Models\Party;
use App\Models\Store;
use App\Support\Gst\StateCodes;

/**
 * Where a document is supplied from the server's point of view.
 *
 * A till used to name the place of supply itself and every R3 till said
 * "32-Kerala" for walk-in sales, which booked a Karnataka sale as inter-state.
 * The place of supply follows the buyer: the customer's GSTIN, then the
 * customer's registered state, and only then the store's own state. A
 * client-supplied value never overrides those facts.
 */
class PlaceOfSupply
{
    /**
     * @return array{code: string, label: string}
     */
    public function forDocument(?Store $store, ?Party $party = null, ?string $customerGstin = null): array
    {
        $code = StateCodes::code($customerGstin)
            ?? StateCodes::code($party?->gstin)
            ?? StateCodes::code($party?->state_code)
            ?? StateCodes::code($store?->state_code)
            ?? '32';

        return ['code' => $code, 'label' => StateCodes::label($code)];
    }
}
