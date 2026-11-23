<?php

namespace App\Http\Controllers\Api;

use App\Models\PurchaseCharge;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CR-C Task 4.14 — the charges of every supplier bill, as rows an accountant can filter and export.
 *
 * The purchase register answers "what did this bill cost". This answers the different question a
 * multi-store owner actually asks — "what did we pay for freight, packing, insurance and courier
 * this month, in which store, and is that money inside what we owe the supplier or outside it" —
 * and it answers it from the stored row. `in_payable` is never re-derived from today's policy here
 * (PUR-016): a charge printed on a bill said one thing on paper, and a report that quietly updates
 * it would contradict the document.
 *
 * Read scope is the same rule as every other admin screen: a store user gets their own store, and a
 * cross-store read names the store on each row.
 */
class AdminPurchaseChargeController
{
    private const FLAGS = ['is_rcm', 'paid_separately', 'in_payable'];

    private const ENUMS = ['treatment', 'spread_method', 'itc_eligibility'];

    public function index(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $query = $this->filtered($request, $storeId);

        // The footer of the screen is the whole filtered answer, not the page on screen, so it is
        // measured before the paginator narrows anything.
        $summary = $this->summary($storeId, $request);

        $rows = $query->orderByDesc('purchases.invoice_date')
            ->orderByDesc('purchase_charges.purchase_id')
            ->orderBy('purchase_charges.seq');

        if ($request->query('export') === 'true') {
            return response()->json([
                'success' => true,
                'data' => $this->shape($rows->get()),
                'summary' => $summary,
            ]);
        }

        $perPage = min(max((int) $request->query('per_page', 25), 1), 500);
        $page = $rows->paginate($perPage);

        return response()->json([
            'success' => true,
            'data' => $this->shape(collect($page->items())),
            'meta' => [
                'total' => $page->total(),
                'per_page' => $perPage,
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
            ],
            'summary' => $summary,
        ]);
    }

    private function filtered(Request $request, ?int $storeId): \Illuminate\Database\Eloquent\Builder
    {
        $query = PurchaseCharge::query()
            ->join('purchases', 'purchases.id', '=', 'purchase_charges.purchase_id')
            ->with(['purchase:id,invoice_number,supplier_name,invoice_date', 'store:id,name,code'])
            ->select('purchase_charges.*')
            ->when($storeId, fn ($q) => $q->where('purchase_charges.store_id', $storeId));

        if ($head = $request->query('head_code')) {
            $query->where('purchase_charges.head_code', strtoupper(trim((string) $head)));
        }

        foreach (self::ENUMS as $field) {
            if ($value = $request->query($field)) {
                $query->where('purchase_charges.' . $field, $value);
            }
        }

        foreach (self::FLAGS as $field) {
            $value = $request->query($field);
            if ($value !== null && $value !== '') {
                $query->where('purchase_charges.' . $field, $this->truthy($value) ? 1 : 0);
            }
        }

        if ($from = $request->query('from')) {
            $query->whereDate('purchases.invoice_date', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate('purchases.invoice_date', '<=', $to);
        }

        if ($search = trim((string) $request->query('search'))) {
            $like = '%' . $search . '%';
            $query->where(function ($q) use ($like) {
                $q->where('purchase_charges.head_name', 'like', $like)
                    ->orWhere('purchase_charges.note', 'like', $like)
                    ->orWhere('purchase_charges.paid_to_label', 'like', $like)
                    ->orWhere('purchases.supplier_name', 'like', $like)
                    ->orWhere('purchases.invoice_number', 'like', $like);
            });
        }

        return $query;
    }

    /**
     * The three money columns of the charges screen: what was keyed, what rides in the supplier's
     * payable, and what was handed to somebody else. Split on the stored membership, because that
     * is what the bill's own paper said.
     *
     * @return array<string, float|int>
     */
    private function summary(?int $storeId, Request $request): array
    {
        $totals = $this->filtered($request, $storeId)
            ->selectRaw(
                'COUNT(*) as row_count,
                 COALESCE(SUM(ROUND(ABS(purchase_charges.amount), 2)), 0) as charge_amount_total,
                 COALESCE(SUM(CASE WHEN purchase_charges.in_payable = 1 THEN ROUND(purchase_charges.total_amount, 2) ELSE 0 END), 0) as in_payable_total,
                 COALESCE(SUM(CASE WHEN purchase_charges.in_payable = 1 THEN 0 ELSE ROUND(purchase_charges.total_amount, 2) END), 0) as outside_payable_total'
            )
            ->first();

        return [
            'row_count' => (int) ($totals->row_count ?? 0),
            'charge_amount_total' => round((float) ($totals->charge_amount_total ?? 0), 2),
            'in_payable_total' => round((float) ($totals->in_payable_total ?? 0), 2),
            'outside_payable_total' => round((float) ($totals->outside_payable_total ?? 0), 2),
        ];
    }

    /** @param \Illuminate\Support\Collection<int, PurchaseCharge> $charges */
    private function shape(\Illuminate\Support\Collection $charges): array
    {
        return $charges->map(fn (PurchaseCharge $charge): array => [
            'id' => $charge->id,
            'seq' => $charge->seq,
            'external_id' => $charge->external_id,
            'store' => $charge->store ? [
                'id' => $charge->store->id,
                'name' => $charge->store->name,
                'code' => $charge->store->code,
            ] : null,
            'purchase' => $charge->purchase ? [
                'id' => $charge->purchase->id,
                'invoice_number' => $charge->purchase->invoice_number,
                'supplier_name' => $charge->purchase->supplier_name,
                'invoice_date' => $charge->purchase->invoice_date,
            ] : null,
            'head_code' => $charge->head_code,
            'head_name' => $charge->head_name,
            'note' => $charge->note,
            'sac_code' => $charge->sac_code,
            'treatment' => $charge->treatment,
            'spread_method' => $charge->spread_method,
            'spread_basis_used' => $charge->spread_basis_used,
            'itc_eligibility' => $charge->itc_eligibility,
            'is_rcm' => (bool) $charge->is_rcm,
            'paid_separately' => (bool) $charge->paid_separately,
            'paid_to_label' => $charge->paid_to_label,
            'in_payable' => $charge->isInPayable(),
            'amount' => (float) $charge->amount,
            'gst_percent' => (float) $charge->gst_percent,
            'taxable_amount' => (float) $charge->taxable_amount,
            'cgst_amount' => (float) $charge->cgst_amount,
            'sgst_amount' => (float) $charge->sgst_amount,
            'igst_amount' => (float) $charge->igst_amount,
            'cess_amount' => (float) $charge->cess_amount,
            'total_tax' => $charge->taxAmount(),
            'total_amount' => (float) $charge->total_amount,
            'allocated_amount' => (float) $charge->allocated_amount,
            'reversed_amount' => (float) $charge->reversed_amount,
            'source' => $charge->source,
        ])->values()->all();
    }

    private function truthy(mixed $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
    }
}
