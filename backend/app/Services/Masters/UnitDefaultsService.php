<?php

namespace App\Services\Masters;

use App\Models\AuditLog;
use App\Models\MasterLookup;
use App\Models\Product;
use Illuminate\Support\Facades\DB;

/**
 * Units are store-scoped (P-STORE-SCOPE carve-out reversed). Every store owns
 * its own unit rows; defaults are seeded at store creation / first use, the set
 * can be reset to defaults, and an assigned unit cannot be deleted until its
 * products are reassigned to a replacement unit.
 */
class UnitDefaultsService
{
    public const DEFAULT_UNITS = [
        ['name' => 'Strip', 'code' => 'STP', 'precision' => 0],
        ['name' => 'Tablet', 'code' => 'TAB', 'precision' => 0],
        ['name' => 'Tabs', 'code' => 'TAB', 'precision' => 0],
        ['name' => 'Capsule', 'code' => 'CAP', 'precision' => 0],
        ['name' => 'Bottle', 'code' => 'BTL', 'precision' => 0],
        ['name' => 'Box', 'code' => 'BOX', 'precision' => 0],
        ['name' => 'Pack', 'code' => 'PAC', 'precision' => 0],
        ['name' => 'Piece', 'code' => 'PCS', 'precision' => 0],
        ['name' => 'Pcs', 'code' => 'PCS', 'precision' => 0],
        ['name' => 'Kilogram', 'code' => 'KGS', 'precision' => 3],
        ['name' => 'Gram', 'code' => 'GMS', 'precision' => 3],
        ['name' => 'Litre', 'code' => 'LTR', 'precision' => 2],
        ['name' => 'Millilitre', 'code' => 'ML', 'precision' => 2],
        ['name' => 'Carton', 'code' => 'CTN', 'precision' => 0],
        ['name' => 'Jar', 'code' => 'JAR', 'precision' => 0],
        ['name' => 'Case', 'code' => 'CAS', 'precision' => 0],
        ['name' => 'Set', 'code' => 'SET', 'precision' => 0],
    ];

    /**
     * Default unit names the store is missing (read-only probe).
     *
     * @return string[]
     */
    public function missingDefaultsForStore(int $storeId): array
    {
        $existing = MasterLookup::where('store_id', $storeId)
            ->where('type', 'unit')
            ->pluck('name')
            ->map(fn ($name) => mb_strtolower($name))
            ->all();

        return collect(self::DEFAULT_UNITS)
            ->pluck('name')
            ->filter(fn ($name) => ! in_array(mb_strtolower($name), $existing, true))
            ->values()
            ->all();
    }

    /**
     * Create any missing default unit rows for the store. Idempotent.
     *
     * @return string[] names that were created
     */
    public function seedDefaultsForStore(int $storeId): array
    {
        $existing = MasterLookup::where('store_id', $storeId)
            ->where('type', 'unit')
            ->pluck('name')
            ->map(fn ($name) => mb_strtolower($name))
            ->all();

        $seeded = [];
        foreach (self::DEFAULT_UNITS as $def) {
            if (in_array(mb_strtolower($def['name']), $existing, true)) {
                continue;
            }
            MasterLookup::create([
                'store_id' => $storeId,
                'type' => 'unit',
                'name' => $def['name'],
                'code' => $def['code'],
                'config' => ['precision' => $def['precision']],
                'is_active' => true,
            ]);
            $seeded[] = $def['name'];
        }

        return $seeded;
    }

    /**
     * Units are no longer shared: legacy NULL-store unit rows are removed once
     * every store owns its own set. Product references are by unit name, so the
     * per-store copies keep them intact.
     */
    public function purgeSharedUnitRows(): int
    {
        return MasterLookup::where('type', 'unit')->whereNull('store_id')->delete();
    }

    /**
     * Restore the default unit set for a store: missing defaults are re-seeded,
     * unused custom units are removed, custom units still assigned to products
     * are kept (an assigned unit can never be silently dropped).
     *
     * @return array{seeded: string[], removed: string[], kept: string[]}
     */
    public function resetForStore(int $storeId): array
    {
        $seeded = $this->seedDefaultsForStore($storeId);

        $defaultNames = collect(self::DEFAULT_UNITS)
            ->pluck('name')
            ->map(fn ($name) => mb_strtolower($name))
            ->all();

        $removed = [];
        $kept = [];

        $units = MasterLookup::where('store_id', $storeId)->where('type', 'unit')->get();
        foreach ($units as $unit) {
            if (in_array(mb_strtolower($unit->name), $defaultNames, true)) {
                continue;
            }
            if ($this->referencingProducts($storeId, $unit)) {
                $kept[] = $unit->name;
                continue;
            }
            $unit->delete();
            $removed[] = $unit->name;
        }

        return ['seeded' => $seeded, 'removed' => $removed, 'kept' => $kept];
    }

    /**
     * Products in the store that reference the unit — by name (products store
     * the unit name in unit_id) or by the unit's id string.
     *
     * @return string[] product names
     */
    public function referencingProducts(int $storeId, MasterLookup $unit): array
    {
        return $this->referenceQuery($storeId, $unit)->pluck('name')->all();
    }

    /**
     * Other active units in the store that could take over the references.
     */
    public function candidateUnits(int $storeId, MasterLookup $except): array
    {
        return MasterLookup::where('store_id', $storeId)
            ->where('type', 'unit')
            ->where('id', '!=', $except->id)
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name', 'code'])
            ->all();
    }

    /**
     * Reassign every referencing product to the replacement unit, then delete
     * the unit. The replacement must belong to the same store.
     */
    public function reassignAndDelete(int $storeId, MasterLookup $unit, int $replacementId): int
    {
        $replacement = MasterLookup::where('store_id', $storeId)
            ->where('type', 'unit')
            ->findOrFail($replacementId);

        if ((int) $replacement->id === (int) $unit->id) {
            abort(422, 'The replacement unit must be different from the unit being deleted.');
        }

        $count = $this->referenceQuery($storeId, $unit)->update([
            'unit_id' => $replacement->name,
            'version' => DB::raw('version + 1'),
        ]);

        $oldData = $unit->toArray();
        $unit->delete();

        AuditLog::log('reassign_unit', 'MasterLookup', (string) $unit->id, $oldData, [
            'reassigned_to' => $replacement->name,
            'reassigned_count' => $count,
        ], $storeId);

        return $count;
    }

    private function referenceQuery(int $storeId, MasterLookup $unit): \Illuminate\Database\Eloquent\Builder
    {
        return Product::where('store_id', $storeId)->where(function ($q) use ($unit) {
            $q->whereRaw('LOWER(unit_id) = ?', [mb_strtolower($unit->name)])
              ->orWhere('unit_id', (string) $unit->id);
        });
    }
}
