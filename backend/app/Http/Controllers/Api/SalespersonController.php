<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Counter;
use App\Models\Salesperson;
use App\Models\Store;
use App\Support\PharmacistRule;
use App\Support\RequestTenant;
use App\Support\SalespersonBillRule;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GAP-01 / SPR-002, 006, 010 — the list a till bills against.
 *
 * A counter is shown only the people it may carry, and the same document says
 * whether naming one is optional, required or switched off, so the cashier's
 * type-ahead and the server's refusal are measured from one answer. The list is
 * cached offline, which is why it is small and carries no credential.
 */
class SalespersonController extends Controller
{
    public function eligible(Request $request): JsonResponse
    {
        $storeId = RequestTenant::requireStoreId($request);
        $counterId = RequestTenant::counterId($request);

        if ($requested = $request->query('counter_id')) {
            $counter = Counter::where('store_id', $storeId)->find((int) $requested);

            if (!$counter) {
                return response()->json([
                    'success' => false,
                    'error' => 'COUNTER_NOT_FOUND',
                    'message' => 'That counter does not belong to this store.',
                ], 422);
            }

            $counterId = (int) $counter->id;
        }

        $people = Salesperson::ofStore($storeId)
            ->selectable()
            ->orderBy('name')
            ->get()
            ->filter(fn (Salesperson $person) => $person->mayBeSelectedAt($counterId === null ? null : (int) $counterId))
            ->values();

        // PHR-011: only a pharmacy is told who may confirm a restricted drug.
        // Anywhere else the words are not in the payload at all.
        $keepsPharmacists = PharmacistRule::shows(Store::find($storeId));

        return response()->json([
            'success' => true,
            'salespeople' => $people->map(function (Salesperson $person) use ($keepsPharmacists): array {
                $row = [
                    'id' => (int) $person->id,
                    'name' => $person->name,
                    'code' => $person->code,
                    'phone' => $person->phone,
                    'has_pin' => $person->has_pin,
                    'counter_ids' => $person->counter_ids,
                    'updated_at' => $person->updated_at?->toIso8601String(),
                ];

                if (!$keepsPharmacists) {
                    return $row;
                }

                $refusal = PharmacistRule::refusal($person);

                return array_merge($row, [
                    'is_pharmacist' => (bool) $person->is_pharmacist,
                    'reg_no' => $person->reg_no,
                    'registration_valid' => $refusal === null,
                    'registration_refusal' => $refusal,
                ]);
            }),
            'salesperson_on_bill' => SalespersonBillRule::mode($storeId),
            'salesperson_required' => SalespersonBillRule::enforced($storeId),
        ]);
    }
}
