<?php

namespace App\Services\Sales;

use App\Exceptions\BusinessRuleException;
use App\Models\Salesperson;
use App\Support\SalespersonBillRule;

/**
 * GAP-01 / SPR-002, 006, 010 — the one answer to "who sold this bill".
 *
 * Both paths a till bill arrives by — the live save and the offline upload —
 * have to credit the same person, so the rule lives here: the row must be one
 * of this store's live salespeople, allowed at the counter that sold it, and
 * the bill keeps the name carried with it. A store that switched the field off
 * tracks nobody at all.
 */
final class SalespersonAttribution
{
    /**
     * @return array{salesperson_id:int, salesperson_name:string}|null
     */
    public static function resolve(int $storeId, ?int $counterId, mixed $salespersonId, ?string $sentName = null): ?array
    {
        if (!SalespersonBillRule::shows($storeId)) {
            return null;
        }

        $id = is_scalar($salespersonId) ? trim((string) $salespersonId) : '';

        if ($id === '' || $id === '0') {
            if (SalespersonBillRule::enforced($storeId)) {
                throw new BusinessRuleException(
                    'salesperson_required',
                    'This bill must name the salesperson who sold it.',
                    'SPR-006',
                    null,
                    'salesperson_id',
                    'Choose the salesperson in the bill header. The owner adds people under Identity & Staff → Salespeople.'
                );
            }

            return null;
        }

        $person = Salesperson::ofStore($storeId)->selectable()->find((int) $id);

        if (!$person) {
            throw new BusinessRuleException(
                'salesperson_unknown',
                'That salesperson is not an active person of this store.',
                'SPR-001',
                null,
                'salesperson_id',
                'Pick someone from the list on the bill header.'
            );
        }

        if (!$person->mayBeSelectedAt($counterId)) {
            throw new BusinessRuleException(
                'salesperson_not_allowed_here',
                "{$person->name} may not be billed at this counter.",
                'SPR-002',
                null,
                'salesperson_id',
                'Ask the owner which counters this salesperson is allowed on.'
            );
        }

        // The name that travels with an offline bill is the one the cashier
        // printed; a live save takes the master's own words.
        $name = trim((string) $sentName) !== '' ? trim((string) $sentName) : $person->name;

        return ['salesperson_id' => (int) $person->id, 'salesperson_name' => $name];
    }
}
