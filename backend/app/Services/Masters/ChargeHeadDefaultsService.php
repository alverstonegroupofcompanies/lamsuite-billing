<?php

namespace App\Services\Masters;

use App\Models\AuditLog;
use App\Models\MasterLookup;
use App\Models\PurchaseCharge;
use Illuminate\Support\Facades\DB;

/**
 * Charge heads are store-scoped (rule R12): every store owns its own `charge_head`
 * rows, the seeded set is created at store creation or on first read, the set can be
 * reset, and a head already referenced by posted charges cannot be deleted until those
 * charges are reassigned — the lifecycle units gained in v2.1.1, applied to charges.
 */
class ChargeHeadDefaultsService
{
    public const DEFAULT_CHARGE_HEADS = [
        ['name' => 'Freight', 'code' => 'FREIGHT', 'sac_code' => '996731',
            'default_treatment' => 'add_to_cost', 'default_spread_method' => 'value',
            'default_itc_eligibility' => 'eligible', 'allowed_sign' => 'positive'],
        ['name' => 'Packing', 'code' => 'PACKING', 'sac_code' => null,
            'default_treatment' => 'add_to_cost', 'default_spread_method' => 'value',
            'default_itc_eligibility' => 'eligible', 'allowed_sign' => 'positive'],
        ['name' => 'Loading/Unloading', 'code' => 'LOADING', 'sac_code' => null,
            'default_treatment' => 'add_to_cost', 'default_spread_method' => 'quantity',
            'default_itc_eligibility' => 'eligible', 'allowed_sign' => 'positive'],
        ['name' => 'Insurance', 'code' => 'INSURANCE', 'sac_code' => null,
            'default_treatment' => 'add_to_cost', 'default_spread_method' => 'value',
            'default_itc_eligibility' => 'eligible', 'allowed_sign' => 'positive'],
        ['name' => 'Other', 'code' => 'OTHER', 'sac_code' => null,
            'default_treatment' => 'expense', 'default_spread_method' => 'value',
            'default_itc_eligibility' => 'eligible', 'allowed_sign' => 'both'],
    ];

    /**
     * Default head names the store is missing (read-only probe).
     *
     * @return string[]
     */
    public function missingDefaultsForStore(int $storeId): array
    {
        $existing = $this->headNames($storeId);

        return collect(self::DEFAULT_CHARGE_HEADS)
            ->pluck('name')
            ->filter(fn ($name) => ! in_array(mb_strtolower($name), $existing, true))
            ->values()
            ->all();
    }

    /**
     * Create any missing default charge head rows for the store. Idempotent.
     *
     * @return string[] names that were created
     */
    public function seedDefaultsForStore(int $storeId): array
    {
        $existing = $this->headNames($storeId);

        $seeded = [];
        foreach (self::DEFAULT_CHARGE_HEADS as $def) {
            if (in_array(mb_strtolower($def['name']), $existing, true)) {
                continue;
            }

            MasterLookup::create([
                'store_id' => $storeId,
                'type' => 'charge_head',
                'name' => $def['name'],
                'code' => $def['code'],
                'config' => [
                    'sac_code' => $def['sac_code'],
                    'default_treatment' => $def['default_treatment'],
                    'default_spread_method' => $def['default_spread_method'],
                    'default_itc_eligibility' => $def['default_itc_eligibility'],
                    'allowed_sign' => $def['allowed_sign'],
                    'seeded' => true,
                ],
                'is_active' => true,
            ]);

            $seeded[] = $def['name'];
        }

        return $seeded;
    }

    /**
     * Restore the default head set: missing defaults re-seeded, unreferenced custom
     * heads removed, referenced custom heads kept.
     *
     * @return array{seeded: string[], removed: string[], kept: string[]}
     */
    public function resetForStore(int $storeId): array
    {
        $seeded = $this->seedDefaultsForStore($storeId);

        $defaultNames = collect(self::DEFAULT_CHARGE_HEADS)
            ->pluck('name')
            ->map(fn ($name) => mb_strtolower($name))
            ->all();

        $removed = [];
        $kept = [];

        foreach ($this->headsQuery($storeId)->get() as $head) {
            if (in_array(mb_strtolower($head->name), $defaultNames, true)) {
                continue;
            }
            if ($this->referencingCharges($storeId, $head) !== []) {
                $kept[] = $head->name;
                continue;
            }
            $head->delete();
            $removed[] = $head->name;
        }

        return ['seeded' => $seeded, 'removed' => $removed, 'kept' => $kept];
    }

    /**
     * Posted bills whose charge lines still reference the head, by code or by name.
     *
     * @return array<int, array{purchase_id: int, invoice_number: string, amount: float}>
     */
    public function referencingCharges(int $storeId, MasterLookup $head): array
    {
        return $this->referenceQuery($storeId, $head)
            ->join('purchases', 'purchases.id', '=', 'purchase_charges.purchase_id')
            ->groupBy('purchase_charges.purchase_id', 'purchases.invoice_number')
            ->orderBy('purchases.invoice_number')
            ->get([
                'purchase_charges.purchase_id',
                'purchases.invoice_number',
                DB::raw('SUM(ROUND(purchase_charges.total_amount, 2)) as charge_total'),
            ])
            ->map(fn ($row) => [
                'purchase_id' => (int) $row->purchase_id,
                'invoice_number' => (string) $row->invoice_number,
                'amount' => round((float) $row->charge_total, 2),
            ])
            ->all();
    }

    /**
     * Other active heads in the store that could take over the references.
     */
    public function candidateHeads(int $storeId, MasterLookup $except): array
    {
        return $this->headsQuery($storeId)
            ->where('id', '!=', $except->id)
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'code'])
            ->all();
    }

    /**
     * Retag every referencing charge to the replacement head, then delete the head.
     * Posted money is untouched — only the head identity moves. The replacement must
     * belong to the same store.
     */
    public function reassignAndDelete(int $storeId, MasterLookup $head, int $replacementId): int
    {
        $replacement = $this->headsQuery($storeId)->findOrFail($replacementId);

        if ((int) $replacement->id === (int) $head->id) {
            abort(422, 'The replacement charge head must be different from the head being deleted.');
        }

        $count = $this->referenceQuery($storeId, $head)->update([
            'head_code' => $replacement->code ?: mb_strtoupper(mb_substr($replacement->name, 0, 40)),
            'head_name' => $replacement->name,
        ]);

        $oldData = $head->toArray();
        $head->delete();

        AuditLog::log('reassign_charge_head', 'MasterLookup', (string) $head->id, $oldData, [
            'reassigned_to' => $replacement->name,
            'reassigned_count' => $count,
        ], $storeId);

        return $count;
    }

    /**
     * A charge row stores head_code and head_name, never a foreign key, so deleting a
     * head can never strand a bill.
     */
    private function referenceQuery(int $storeId, MasterLookup $head): \Illuminate\Database\Eloquent\Builder
    {
        return PurchaseCharge::query()
            ->where('purchase_charges.store_id', $storeId)
            ->where(function ($query) use ($head) {
                if ($head->code) {
                    $query->orWhere('head_code', $head->code);
                }
                $query->orWhereRaw('LOWER(head_name) = ?', [mb_strtolower($head->name)]);
            });
    }

    private function headsQuery(int $storeId): \Illuminate\Database\Eloquent\Builder
    {
        return MasterLookup::where('store_id', $storeId)->where('type', 'charge_head');
    }

    /** @return string[] */
    private function headNames(int $storeId): array
    {
        return collect($this->headsQuery($storeId)->pluck('name')->all())
            ->map(fn ($name) => mb_strtolower($name))
            ->all();
    }
}
