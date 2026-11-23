<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Salesperson;
use App\Models\Store;
use App\Support\PharmacistRule;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GAP-01 / SPR-001..003, 005, 017 — the salesperson master, owned by the panel.
 *
 * A person is one store's, their code repeats across stores and never inside
 * one, and the counters they may be sold at is a restriction the till obeys and
 * the server enforces. Someone who has already sold something is archived, not
 * deleted: the bills that name them are the record of their work.
 */
class AdminSalespersonController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        if (!$storeId) {
            return $this->noStore();
        }

        $query = Salesperson::ofStore($storeId)->orderBy('name');

        if ($search = trim((string) $request->query('q', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('code', 'like', "%{$search}%")
                    ->orWhere('phone', 'like', "%{$search}%");
            });
        }

        if (!filter_var($request->query('include_archived'), FILTER_VALIDATE_BOOLEAN)) {
            $query->whereNull('archived_at');
        }

        return response()->json([
            'success' => true,
            'salespeople' => $query->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        if (!$storeId) {
            return $this->noStore();
        }

        $validated = $request->validate([
            'name' => 'required|string|max:191',
            'code' => 'nullable|string|max:40',
            'phone' => 'nullable|string|max:20',
            'counter_ids' => 'nullable|array',
            'counter_ids.*' => 'integer',
            'pin' => 'nullable|string|min:4|max:64',
            'is_pharmacist' => 'nullable|boolean',
            'reg_no' => 'nullable|string|max:60',
            'reg_valid_from' => 'nullable|date',
            'reg_valid_until' => 'nullable|date',
            'is_active' => 'nullable|boolean',
        ]);

        if ($refusal = $this->pharmacistGuard($validated, $storeId)) {
            return $refusal;
        }

        $code = strtoupper(trim((string) ($validated['code'] ?? '')));

        if ($code === '') {
            $code = $this->nextCode($storeId);
        }

        if (Salesperson::ofStore($storeId)->where('code', $code)->exists()) {
            return response()->json([
                'message' => 'That salesperson code is already used in this store.',
                'errors' => ['code' => ["The code {$code} already belongs to someone else in this store."]],
            ], 422);
        }

        if ($error = $this->counterIdsError($storeId, $validated['counter_ids'] ?? null)) {
            return $error;
        }

        if ($pin = (string) ($validated['pin'] ?? '')) {
            if ($refusal = $this->pinRefusal($pin, $storeId, $validated, null)) {
                return $refusal;
            }
        }

        $salesperson = Salesperson::create([
            'store_id' => $storeId,
            'name' => trim($validated['name']),
            'code' => $code,
            'phone' => trim((string) ($validated['phone'] ?? '')) ?: null,
            'counter_ids' => $this->normaliseCounterIds($validated['counter_ids'] ?? null),
            'pin' => $pin ?: null,
            'is_pharmacist' => (bool) ($validated['is_pharmacist'] ?? false),
            'reg_no' => $validated['reg_no'] ?? null,
            'reg_valid_from' => $validated['reg_valid_from'] ?? null,
            'reg_valid_until' => $validated['reg_valid_until'] ?? null,
            'is_active' => (bool) ($validated['is_active'] ?? true),
            'version' => 1,
        ]);

        AuditLog::log('salesperson_created', 'Salesperson', (string) $salesperson->id, null, [
            'name' => $salesperson->name,
            'code' => $salesperson->code,
            'phone' => $salesperson->phone,
            'counter_ids' => $salesperson->counter_ids,
            'is_active' => $salesperson->is_active,
            'is_pharmacist' => $salesperson->is_pharmacist,
            'reg_no' => $salesperson->reg_no,
            'reg_valid_from' => $salesperson->reg_valid_from?->toDateString(),
            'reg_valid_until' => $salesperson->reg_valid_until?->toDateString(),
            'has_pin' => $salesperson->has_pin,
        ], $storeId);

        return response()->json(['success' => true, 'salesperson' => $salesperson], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $storeId = $this->storeId($request);
        $salesperson = $this->find($request, $id);

        if (!$salesperson) {
            return $this->notFound();
        }

        if ($request->has('version') && (int) $request->input('version') !== (int) $salesperson->version) {
            return response()->json([
                'success' => false,
                'code' => 'salesperson_version_conflict',
                'message' => 'This salesperson was changed by someone else. Reload to see the current record.',
                'current_version' => (int) $salesperson->version,
            ], 409);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:191',
            'code' => 'nullable|string|max:40',
            'phone' => 'nullable|string|max:20',
            'counter_ids' => 'nullable|array',
            'counter_ids.*' => 'integer',
            'pin' => 'nullable|string|min:4|max:64',
            'is_pharmacist' => 'nullable|boolean',
            'reg_no' => 'nullable|string|max:60',
            'reg_valid_from' => 'nullable|date',
            'reg_valid_until' => 'nullable|date',
            'is_active' => 'nullable|boolean',
        ]);

        if ($refusal = $this->pharmacistGuard($validated, (int) $salesperson->store_id, $salesperson)) {
            return $refusal;
        }

        if (array_key_exists('code', $validated)) {
            $code = strtoupper(trim((string) $validated['code']));

            if ($code !== '' && Salesperson::ofStore($salesperson->store_id)
                ->where('code', $code)
                ->where('id', '!=', $salesperson->id)
                ->exists()
            ) {
                return response()->json([
                    'message' => 'That salesperson code is already used in this store.',
                    'errors' => ['code' => ["The code {$code} already belongs to someone else in this store."]],
                ], 422);
            }

            $validated['code'] = $code;
        }

        if ($error = $this->counterIdsError($salesperson->store_id, $validated['counter_ids'] ?? null)) {
            return $error;
        }

        if (array_key_exists('pin', $validated)) {
            $pin = (string) $validated['pin'];

            if ($pin !== '' && ($refusal = $this->pinRefusal($pin, (int) $salesperson->store_id, $validated, $salesperson))) {
                return $refusal;
            }

            // An empty PIN clears the credential; anything else replaces it.
            $salesperson->pin = $pin === '' ? null : $pin;
            unset($validated['pin']);
        }

        $before = $salesperson->only(array_keys($validated));

        if (array_key_exists('counter_ids', $validated)) {
            $validated['counter_ids'] = $this->normaliseCounterIds($validated['counter_ids']);
        }

        $validated['version'] = $salesperson->version + 1;
        $salesperson->fill($validated)->save();

        AuditLog::log('salesperson_updated', 'Salesperson', (string) $salesperson->id, $before, [
            'name' => $salesperson->name,
            'code' => $salesperson->code,
            'phone' => $salesperson->phone,
            'counter_ids' => $salesperson->counter_ids,
            'is_active' => $salesperson->is_active,
            'is_pharmacist' => $salesperson->is_pharmacist,
            'reg_no' => $salesperson->reg_no,
            'reg_valid_from' => $salesperson->reg_valid_from?->toDateString(),
            'reg_valid_until' => $salesperson->reg_valid_until?->toDateString(),
            'has_pin' => $salesperson->has_pin,
            'version' => $salesperson->version,
        ], (int) $salesperson->store_id);

        return response()->json(['success' => true, 'salesperson' => $salesperson]);
    }

    /**
     * SPR-003: history outranks tidiness. A person who has sold something is
     * archived so their bills keep naming them; a person who never did is gone.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $salesperson = $this->find($request, $id);

        if (!$salesperson) {
            return $this->notFound();
        }

        $documents = Invoice::where('salesperson_id', $salesperson->id)->count();

        if ($documents > 0) {
            $salesperson->update([
                'is_active' => false,
                'archived_at' => now(),
                'version' => $salesperson->version + 1,
            ]);

            AuditLog::log('salesperson_archived', 'Salesperson', (string) $salesperson->id, [
                'is_active' => true,
                'archived_at' => null,
            ], [
                'is_active' => false,
                'archived_at' => $salesperson->archived_at?->toIso8601String(),
                'bills_preserved' => $documents,
            ], (int) $salesperson->store_id);

            return response()->json([
                'success' => true,
                'archived' => true,
                'bills' => $documents,
                'salesperson' => $salesperson->fresh(),
                'message' => "Archived. {$documents} saved bill(s) still name this salesperson.",
            ]);
        }

        $snapshot = $salesperson->only(['name', 'code', 'phone', 'counter_ids', 'is_active']);
        $salesperson->delete();

        AuditLog::log('salesperson_deleted', 'Salesperson', (string) $id, $snapshot, null, (int) $salesperson->store_id);

        return response()->json(['success' => true, 'deleted' => true]);
    }

    /** SPR-001: a blank code is numbered in the store, the way counters are. */
    private function nextCode(int $storeId): string
    {
        $highest = Salesperson::ofStore($storeId)
            ->where('code', 'like', 'SP-%')
            ->orderByDesc('code')
            ->value('code');

        $next = $highest ? (int) substr((string) $highest, 3) + 1 : 1;

        return 'SP-' . str_pad((string) $next, 2, '0', STR_PAD_LEFT);
    }

    /**
     * SPR-002: a counter list is only meaningful inside the same store, so a
     * foreign id is a data-entry error rather than a restriction.
     */
    private function counterIdsError(int $storeId, ?array $counterIds): ?JsonResponse
    {
        if ($counterIds === null || $counterIds === []) {
            return null;
        }

        $unknown = count(array_unique(array_map('intval', $counterIds)))
            - Counter::where('store_id', $storeId)->whereIn('id', $counterIds)->count();

        if ($unknown > 0) {
            return response()->json([
                'message' => 'A salesperson may only be allowed at counters of their own store.',
                'errors' => ['counter_ids' => ['One or more counters do not belong to this store.']],
            ], 422);
        }

        return null;
    }

    /** @return list<int>|null null keeps "every counter of the store" */
    private function normaliseCounterIds(?array $counterIds): ?array
    {
        if ($counterIds === null || $counterIds === []) {
            return null;
        }

        $ids = array_values(array_unique(array_map('intval', $counterIds)));
        sort($ids);

        return $ids;
    }

    /**
     * PHR-002, PHR-011: the pharmacist flag is only a pharmacist with a
     * registration behind it, and only in a store that sells drugs.
     *
     * Un-flagging is always allowed — a person who stops practising stays on
     * the staff list and their bills stay theirs — so only a record that will
     * carry the flag has to answer for a registration number and a window.
     *
     * @param  array<string,mixed>  $validated
     */
    private function pharmacistGuard(array &$validated, int $storeId, ?Salesperson $person = null): ?JsonResponse
    {
        $willBe = array_key_exists('is_pharmacist', $validated)
            ? filter_var($validated['is_pharmacist'], FILTER_VALIDATE_BOOLEAN)
            : (bool) ($person?->is_pharmacist ?? false);

        if (!$willBe) {
            return null;
        }

        if (!PharmacistRule::shows(Store::find($storeId))) {
            return response()->json([
                'message' => 'Only a pharmacy registers pharmacists. This store is not a pharmacy, so its staff list keeps no pharmacist.',
                'errors' => ['is_pharmacist' => ['A pharmacist belongs to a pharmacy. Change the store type under Stores & Locations first.']],
            ], 422);
        }

        $regNo = trim((string) (array_key_exists('reg_no', $validated)
            ? $validated['reg_no']
            : ($person?->reg_no ?? '')));

        if ($regNo === '') {
            return response()->json([
                'message' => 'A pharmacist must carry the registration number the council issued them.',
                'errors' => ['reg_no' => ['Record the registration number, or leave the pharmacist flag off.']],
            ], 422);
        }

        $from = array_key_exists('reg_valid_from', $validated)
            ? $validated['reg_valid_from']
            : $person?->reg_valid_from?->toDateString();
        $until = array_key_exists('reg_valid_until', $validated)
            ? $validated['reg_valid_until']
            : $person?->reg_valid_until?->toDateString();

        if (blank($from)) {
            return response()->json([
                'message' => "Registration {$regNo} needs the date it started.",
                'errors' => ['reg_valid_from' => ['A registration without a start date cannot be checked against a bill.']],
            ], 422);
        }

        if (blank($until)) {
            return response()->json([
                'message' => "Registration {$regNo} needs the date it expires.",
                'errors' => ['reg_valid_until' => ['An open-ended registration cannot confirm a restricted-drug bill.']],
            ], 422);
        }

        if (strtotime((string) $from) > strtotime((string) $until)) {
            return response()->json([
                'message' => "Registration {$regNo} ends before it starts.",
                'errors' => ['reg_valid_until' => ['Check the two dates — the expiry cannot come first.']],
            ], 422);
        }

        $validated['is_pharmacist'] = true;
        $validated['reg_no'] = $regNo;
        $validated['reg_valid_from'] = date('Y-m-d', strtotime((string) $from));
        $validated['reg_valid_until'] = date('Y-m-d', strtotime((string) $until));

        return null;
    }

    /**
     * PHR-008: the digits are judged by the domain of the job they serve, and
     * a pharmacist may not share a secret with the counter or the approver.
     *
     * @param  array<string,mixed>  $validated
     */
    private function pinRefusal(string $pin, int $storeId, array $validated, ?Salesperson $person): ?JsonResponse
    {
        $isPharmacist = array_key_exists('is_pharmacist', $validated)
            ? filter_var($validated['is_pharmacist'], FILTER_VALIDATE_BOOLEAN)
            : (bool) ($person?->is_pharmacist ?? false);

        $refusal = $isPharmacist
            ? PharmacistRule::pinRefusal($pin)
            : Salesperson::validatePinPolicy($pin);

        if ($refusal === null && $isPharmacist) {
            $collides = PharmacistRule::pinCollision($storeId, $pin, $person?->id);
            $refusal = PharmacistRule::pinCollisionRefusal($collides, $storeId);
        }

        if ($refusal === null) {
            return null;
        }

        return response()->json([
            'message' => $refusal,
            'errors' => ['pin' => [$refusal]],
        ], 422);
    }

    private function find(Request $request, string $id): ?Salesperson
    {
        $storeId = $this->storeId($request);

        return Salesperson::where('id', $id)
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->first();
    }

    private function storeId(Request $request): ?int
    {
        $storeId = $request->attributes->get('active_store_id') ?? $request->get('active_store_id');

        return $storeId ? (int) $storeId : null;
    }

    private function noStore(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Select a store before managing salespeople.',
            'errors' => ['store_id' => ['A single store must be selected.']],
        ], 422);
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'That salesperson belongs to another store or no longer exists.',
        ], 404);
    }
}
