<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\CounterProfileException;
use App\Models\PermissionProfileTemplate;
use App\Services\Auth\PinPolicy;
use App\Services\Counter\CounterProfileSaveException;
use App\Services\Counter\CounterProfileSaver;
use App\Support\Counter\CounterProfile;
use App\Services\CounterSequenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * CNT-002 / CNT-009 / CNT-010 — the owner owns the counter master.
 * Counters are pre-created here; a till can only claim one with an activation code.
 */
class AdminCounterController
{
    public function store(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);
        if (!$storeId) {
            return response()->json([
                'message' => 'Select a store before creating a counter.',
                'errors' => ['store_id' => ['A single store must be selected.']],
            ], 422);
        }

        $validated = $request->validate([
            'counter_name' => 'required|string|max:100',
            'counter_code' => 'nullable|string|max:20',
            'location_name' => 'nullable|string|max:100',
            'is_remote' => 'nullable|boolean',
            'is_hub' => 'nullable|boolean',
            'is_digital_only' => 'nullable|boolean',
        ]);

        $code = strtoupper(trim((string) ($validated['counter_code'] ?? '')));
        if ($code === '') {
            $code = $this->nextCounterCode($storeId);
        }

        if (Counter::where('store_id', $storeId)->where('counter_code', $code)->exists()) {
            return response()->json([
                'message' => 'That counter code is already used in this store.',
                'errors' => ['counter_code' => ["The counter code {$code} is already used in this store."]],
            ], 422);
        }

        $conflict = Counter::nameConflict($storeId, $validated['counter_name']);
        if ($conflict) {
            return $this->nameConflictResponse($conflict);
        }

        $counter = Counter::create([
            'store_id' => $storeId,
            'counter_code' => $code,
            'counter_name' => trim($validated['counter_name']),
            'location_name' => $validated['location_name'] ?? 'Main Shop',
            'is_remote' => (bool) ($validated['is_remote'] ?? false),
            'is_hub' => (bool) ($validated['is_hub'] ?? false),
            'is_digital_only' => (bool) ($validated['is_digital_only'] ?? false),
            'status' => Counter::STATUS_UNCLAIMED,
            'created_by' => $request->user()?->id,
            'printer_profile' => [
                'type' => 'thermal_80mm',
                'auto_print' => true,
                'copies' => 1,
            ],
        ]);

        // CNT-014: the series belongs to the counter, so it exists from the
        // moment the owner names the counter — a till never brings its own.
        app(CounterSequenceService::class)->ensureFor($counter);

        AuditLog::log('counter_created', 'Counter', (string) $counter->id, null, [
            'counter_code' => $counter->counter_code,
            'counter_name' => $counter->counter_name,
            'location_name' => $counter->location_name,
            'status' => $counter->status,
        ], $storeId);

        return response()->json(['success' => true, 'counter' => $counter], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $validated = $request->validate([
            'counter_name' => 'sometimes|required|string|max:100',
            'counter_code' => 'sometimes|required|string|max:20',
            'location_name' => 'nullable|string|max:100',
            'is_remote' => 'nullable|boolean',
            'is_hub' => 'nullable|boolean',
            'is_digital_only' => 'nullable|boolean',
            'idle_lock_minutes' => 'nullable|integer|min:0|max:240',
            'grace_hours' => 'nullable|integer|min:0|max:720',
        ]);

        $changes = [];

        if (array_key_exists('counter_code', $validated)) {
            $code = strtoupper(trim($validated['counter_code']));
            $taken = Counter::where('store_id', $counter->store_id)
                ->where('counter_code', $code)
                ->where('id', '!=', $counter->id)
                ->exists();
            if ($taken) {
                return response()->json([
                    'message' => 'That counter code is already used in this store.',
                    'errors' => ['counter_code' => ["The counter code {$code} is already used in this store."]],
                ], 422);
            }
            $changes['counter_code'] = $code;
        }

        if (array_key_exists('counter_name', $validated)) {
            $conflict = Counter::nameConflict($counter->store_id, $validated['counter_name'], $counter->id);
            if ($conflict) {
                return $this->nameConflictResponse($conflict);
            }
            $changes['counter_name'] = trim($validated['counter_name']);
        }

        foreach (['location_name', 'idle_lock_minutes', 'grace_hours'] as $key) {
            if (array_key_exists($key, $validated)) {
                $changes[$key] = $validated[$key];
            }
        }

        foreach (['is_remote', 'is_hub', 'is_digital_only'] as $key) {
            if (array_key_exists($key, $validated)) {
                $changes[$key] = (bool) $validated[$key];
            }
        }

        // The lifecycle status is never a "detail edit" — it moves through
        // lock/unlock/revoke/retire so each transition stays auditable.
        $old = $counter->only(array_keys($changes));
        $counter->update($changes);

        AuditLog::log('counter_updated', 'Counter', (string) $counter->id, $old, $changes, $counter->store_id);

        return response()->json(['success' => true, 'counter' => $counter->fresh()]);
    }

    /**
     * PRF-001: the permission document this counter works inside, answered as a
     * complete one even when the owner has only ever set part of it.
     */
    public function profile(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        return response()->json([
            'success' => true,
            'counter_id' => $counter->id,
            'profile' => [
                'permissions' => CounterProfile::resolve($counter),
                'version' => $this->profileVersion($counter),
                'updated_at' => $counter->updated_at?->toIso8601String(),
            ],
        ]);
    }

    /**
     * PRF-001 / PRF-008: this save is how a till gains or loses a permission, so
     * it goes through the one path that stamps a new version, records the diff
     * and tells the attached counter to come and read the document.
     */
    public function updateProfile(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $validated = $request->validate(['profile' => 'required|array']);

        try {
            $saved = app(CounterProfileSaver::class)->save($counter, $validated['profile']);
        } catch (CounterProfileSaveException $e) {
            return $e->response();
        }

        return $this->profileResponse($saved['counter'], $saved['profile'], $saved['version'], $saved['changed']);
    }

    /**
     * PRF-002: hand this counter a stored template. The template's document
     * lands whole, so restrictions the counter already had do not survive a
     * document that does not mention them.
     */
    public function applyProfileTemplate(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $validated = $request->validate([
            'template_id' => 'required|integer',
            'version' => 'nullable|integer',
        ]);

        $template = PermissionProfileTemplate::where('store_id', $counter->store_id)
            ->where('id', $validated['template_id'])
            ->first();

        if (!$template) {
            return response()->json([
                'message' => 'That profile template belongs to another store.',
                'errors' => ['template_id' => ['Choose a template from this store.']],
            ], 422);
        }

        try {
            $saved = app(CounterProfileSaver::class)->applyTemplate($counter, $template);
        } catch (CounterProfileSaveException $e) {
            return $e->response();
        }

        return $this->profileResponse(
            $saved['counter'],
            $saved['profile'],
            $saved['version'],
            $saved['changed'],
            ['template' => ['id' => (int) $template->id, 'name' => $template->name]]
        );
    }

    /**
     * PRF-002: "copy from counter" duplicates another counter's live document
     * server-side, so the panel never holds two counters' permissions at once.
     */
    public function copyProfileFromCounter(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $validated = $request->validate([
            'from_counter_id' => 'required|integer',
            'version' => 'nullable|integer',
        ]);

        $source = Counter::where('store_id', $counter->store_id)
            ->where('id', $validated['from_counter_id'])
            ->first();

        if (!$source) {
            return response()->json([
                'message' => 'That counter belongs to another store.',
                'errors' => ['from_counter_id' => ['Choose a counter from this store.']],
            ], 422);
        }

        if ((int) $source->id === (int) $counter->id) {
            return response()->json([
                'message' => 'A counter already holds its own document.',
                'errors' => ['from_counter_id' => ['Choose a different counter.']],
            ], 422);
        }

        try {
            $saved = app(CounterProfileSaver::class)->copyFrom($counter, $source);
        } catch (CounterProfileSaveException $e) {
            return $e->response();
        }

        return $this->profileResponse(
            $saved['counter'],
            $saved['profile'],
            $saved['version'],
            $saved['changed'],
            ['copied_from' => ['id' => (int) $source->id, 'counter_code' => $source->counter_code, 'counter_name' => $source->counter_name]]
        );
    }

    /**
     * PRF-008: the document's own history. Every save left a diff behind, so an
     * owner can see which control moved, from what to what, who moved it and
     * which version the till was handed — without the trail holding a second
     * copy of the whole document each time.
     */
    public function profileHistory(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $rows = AuditLog::with(['user:id,name,email', 'impersonator:id,name,email'])
            ->where('store_id', $counter->store_id)
            ->where('entity_type', 'Counter')
            ->where('entity_id', (string) $counter->id)
            ->where('action', 'counter_profile_updated')
            ->latest('id')
            ->paginate(min(200, max(1, (int) $request->input('per_page', 50))));

        $history = collect($rows->items())->map(function (AuditLog $row) {
            $after = is_array($row->new_values) ? $row->new_values : [];
            $before = is_array($row->old_values) ? $row->old_values : [];

            $version = (int) ($after['profile_version'] ?? 0);
            $source = (string) ($after['source'] ?? 'manual');
            unset($after['profile_version'], $after['source']);

            return [
                'id' => (int) $row->id,
                'version' => $version,
                'at' => $row->created_at?->toIso8601String(),
                'source' => $source,
                'by' => $row->user ? ['id' => (int) $row->user->id, 'name' => $row->user->name, 'email' => $row->user->email] : null,
                'impersonated_by' => $row->impersonator?->name,
                'ip' => $row->ip_address,
                'moved' => array_values(array_map(
                    static fn (string $control) => [
                        'control' => $control,
                        'from' => $before[$control] ?? null,
                        'to' => $after[$control] ?? null,
                    ],
                    array_keys($after)
                )),
            ];
        });

        return response()->json([
            'success' => true,
            'counter_id' => (int) $counter->id,
            'current_version' => $this->profileVersion($counter),
            'total' => $rows->total(),
            'data' => $history,
        ]);
    }

    /**
     * Q1 (b): the documents this counter made in the dark that sit outside the
     * permissions it holds today. They are here because they were accepted —
     * the register is what the owner reviews, not a second gate, and nothing on
     * this list reverses a sale.
     */
    public function profileExceptions(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $rows = CounterProfileException::with(['counter:id,counter_code,counter_name', 'reviewedBy:id,name'])
            ->where('store_id', $counter->store_id)
            ->where('counter_id', $counter->id)
            ->when($request->filled('status'), fn ($q) => $q->where('status', (string) $request->input('status')))
            ->latest('detected_at')
            ->paginate(min(200, max(1, (int) $request->input('per_page', 50))));

        return response()->json([
            'success' => true,
            'counter_id' => (int) $counter->id,
            'profile_version' => $this->profileVersion($counter),
            'open_count' => CounterProfileException::where('counter_id', $counter->id)
                ->where('status', CounterProfileException::STATUS_OPEN)
                ->count(),
            'total' => $rows->total(),
            'data' => collect($rows->items())->map(fn (CounterProfileException $row) => $row->present()),
        ]);
    }

    /**
     * Reviewing an exception is the owner's decision, recorded as one: the
     * document stands either way, and what changes is who has said they have
     * seen it.
     */
    public function reviewProfileException(Request $request, string $id, string $exceptionId): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $validated = $request->validate([
            'status' => 'required|in:reviewed,dismissed,open',
            'note' => 'nullable|string|max:500',
        ]);

        $exception = CounterProfileException::where('store_id', $counter->store_id)
            ->where('counter_id', $counter->id)
            ->where('id', (int) $exceptionId)
            ->firstOrFail();

        $exception->update([
            'status' => $validated['status'],
            'note' => $validated['note'] ?? null,
            'reviewed_at' => $validated['status'] === CounterProfileException::STATUS_OPEN ? null : now(),
            'reviewed_by' => $validated['status'] === CounterProfileException::STATUS_OPEN ? null : auth()->id(),
        ]);

        AuditLog::log(
            'counter_profile_exception_reviewed',
            'CounterProfileException',
            (string) $exception->id,
            null,
            [
                'status' => $exception->status,
                'note' => $exception->note,
                'document_type' => $exception->document_type,
                'document_reference' => $exception->document_reference,
                'actions' => array_column((array) $exception->violations, 'action'),
            ],
            $counter->store_id
        );

        return response()->json([
            'success' => true,
            'exception' => $exception->fresh(['counter', 'reviewedBy'])->present(),
        ]);
    }

    /**
     * Q1 (b) across the store: every counter's unread exceptions in one list,
     * newest first, so an owner with four tills sees the backlog rather than
     * clicking through four counters.
     */
    public function storeProfileExceptions(Request $request): JsonResponse
    {
        $storeId = $this->storeId($request);

        $rows = CounterProfileException::with(['counter:id,counter_code,counter_name', 'reviewedBy:id,name'])
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->when($request->filled('counter_id'), fn ($q) => $q->where('counter_id', (int) $request->input('counter_id')))
            ->when($request->filled('status'), fn ($q) => $q->where('status', (string) $request->input('status')))
            ->latest('detected_at')
            ->paginate(min(200, max(1, (int) $request->input('per_page', 50))));

        return response()->json([
            'success' => true,
            'open_count' => CounterProfileException::when($storeId, fn ($q) => $q->where('store_id', $storeId))
                ->where('status', CounterProfileException::STATUS_OPEN)
                ->count(),
            'total' => $rows->total(),
            'data' => collect($rows->items())->map(fn (CounterProfileException $row) => $row->present()),
        ]);
    }

    /** @param array<string,mixed> $extra */
    private function profileResponse(Counter $counter, array $profile, int $version, array $changed, array $extra = []): JsonResponse
    {
        return response()->json([
            'success' => true,
            'counter_id' => $counter->id,
            'profile' => [
                'permissions' => $profile,
                'version' => $version,
                'updated_at' => $counter->updated_at?->toIso8601String(),
            ],
            'changed' => $changed,
        ] + $extra);
    }

    /** CNT-009: lock a counter so its till stops accepting work on the next call. */
    public function lock(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);
        $validated = $request->validate(['reason' => 'nullable|string|max:255']);

        if ($counter->status === Counter::STATUS_REVOKED) {
            return response()->json(['message' => 'A retired counter cannot be locked.'], 422);
        }

        $old = $counter->status;
        $counter->update(['status' => Counter::STATUS_LOCKED, 'revoke_reason' => null]);

        AuditLog::log('counter_locked', 'Counter', (string) $counter->id, ['status' => $old], [
            'status' => Counter::STATUS_LOCKED,
            'reason' => $validated['reason'] ?? null,
        ], $counter->store_id);

        return response()->json(['success' => true, 'counter' => $counter->fresh()]);
    }

    public function unlock(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        if ($counter->status !== Counter::STATUS_LOCKED) {
            return response()->json(['message' => 'Only a locked counter can be unlocked.'], 422);
        }

        $old = $counter->status;
        $counter->update([
            'status' => Counter::STATUS_ACTIVE,
            'unlock_failed_attempts' => 0,
            'unlock_locked_until' => null,
        ]);

        AuditLog::log('counter_unlocked', 'Counter', (string) $counter->id, ['status' => $old], [
            'status' => Counter::STATUS_ACTIVE,
        ], $counter->store_id);

        return response()->json(['success' => true, 'counter' => $counter->fresh()]);
    }

    /**
     * PRF-006 / B7: the counter's own unlock PIN — set or reset here, by an owner,
     * and nowhere else. Only the bcrypt hash is persisted, and a reset is also how
     * a counter that locked itself out of five wrong attempts gets back to work.
     */
    public function resetUnlockPin(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $validated = $request->validate([
            'pin' => 'required|string|max:8',
        ]);

        if ($error = PinPolicy::validate($validated['pin'], PinPolicy::DOMAIN_COUNTER)) {
            return response()->json([
                'message' => $error,
                'errors' => ['pin' => [$error]],
            ], 422);
        }

        $hadPin = $counter->unlock_pin_hash !== null;

        $counter->update([
            'unlock_pin_hash' => Hash::make($validated['pin']),
            'unlock_failed_attempts' => 0,
            'unlock_locked_until' => null,
        ]);

        AuditLog::log('counter_unlock_pin_reset', 'Counter', (string) $counter->id, null, [
            'credential' => 'counter_unlock',
            'algorithm' => 'bcrypt',
            'replaced_existing' => $hadPin,
        ], $counter->store_id);

        return response()->json([
            'success' => true,
            'pin_set' => true,
            'message' => 'The counter unlock PIN is set. It will never be shown again.',
            'counter' => $counter->fresh(),
        ]);
    }

    /**
     * CNT-010: a counter without documents is erased; one that owns documents is
     * retired, because its invoices, ledger movements and number series are history.
     */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $documentCount = $this->documentCount($counter);

        if ($documentCount > 0 && !$request->boolean('confirm_retire')) {
            return response()->json([
                'error' => 'counter_has_documents',
                'message' => "This counter has {$documentCount} saved document(s). Retiring it keeps the history; deleting it is not allowed.",
                'documents' => $documentCount,
            ], 409);
        }

        if ($documentCount > 0) {
            $previousStatus = $counter->status;
            $counter->update([
                'status' => Counter::STATUS_REVOKED,
                'retired_at' => now(),
                'revoke_reason' => $request->input('reason', 'Retired by owner'),
            ]);

            AuditLog::log('counter_retired', 'Counter', (string) $counter->id, [
                'status' => $previousStatus,
            ], [
                'status' => Counter::STATUS_REVOKED,
                'documents_preserved' => $documentCount,
            ], $counter->store_id);

            return response()->json([
                'success' => true,
                'retired' => true,
                'documents' => $documentCount,
                'counter' => $counter->fresh(),
            ]);
        }

        AuditLog::log('counter_deleted', 'Counter', (string) $counter->id, $counter->only([
            'counter_code', 'counter_name', 'status', 'device_uuid',
        ]), null, $counter->store_id);

        $counter->delete();

        return response()->json(['success' => true, 'retired' => false]);
    }

    /**
     * CNT-003 / CNT-004: issue a one-time activation code for one counter.
     * The raw code is present in exactly this one response.
     */
    public function activationCode(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $validated = $request->validate([
            'label' => 'nullable|string|max:100',
            'ttl_hours' => 'nullable|integer|min:1|max:720',
        ]);

        if ($counter->status !== Counter::STATUS_UNCLAIMED) {
            return response()->json([
                'error' => 'counter_not_unclaimed',
                'message' => 'Only an unclaimed counter can receive a first activation code. Use re-issue to replace the device that already holds it.',
            ], 422);
        }

        // Any still-open code for this counter is superseded before a new one exists.
        \App\Models\ActivationKey::where('counter_id', $counter->id)
            ->whereNull('consumed_at')
            ->where('is_revoked', false)
            ->get()
            ->each(fn ($key) => $key->revoke('Superseded by a new code'));

        $issued = \App\Models\ActivationKey::generateForCounter($counter, [
            'label' => $validated['label'] ?? null,
            'ttl_hours' => $validated['ttl_hours'] ?? \App\Models\ActivationKey::DEFAULT_TTL_HOURS,
            'created_by' => $request->user()?->id,
        ]);

        AuditLog::log('counter_activation_code_issued', 'ActivationKey', (string) $issued['model']->id, null, [
            'counter_id' => $counter->id,
            'label' => $issued['model']->label,
            'key_prefix' => $issued['model']->key_prefix,
            'expires_at' => $issued['model']->expires_at?->toIso8601String(),
        ], $counter->store_id);

        return response()->json([
            'success' => true,
            'code' => $issued['raw_key'],
            'activation_key_id' => $issued['model']->id,
            'key_prefix' => $issued['model']->key_prefix,
            'expires_at' => $issued['model']->expires_at?->toIso8601String(),
            'qr_payload' => $issued['qr_payload'],
            'message' => 'Show or send this code once. It cannot be retrieved again.',
        ]);
    }

    /** CNT-009: the code lifecycle is visible, but only ever masked. */
    public function activationCodes(Request $request, string $id): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $codes = \App\Models\ActivationKey::where('counter_id', $counter->id)
            ->latest('id')
            ->get()
            ->map(fn ($key) => [
                'id' => $key->id,
                'label' => $key->label,
                'key_prefix' => $key->key_prefix,
                'state' => $key->is_revoked ? 'revoked'
                    : ($key->consumed_at ? 'consumed'
                    : ($key->expires_at && $key->expires_at->isPast() ? 'expired' : 'open')),
                'ttl_hours' => $key->ttl_hours,
                'expires_at' => $key->expires_at?->toIso8601String(),
                'consumed_at' => $key->consumed_at?->toIso8601String(),
                'consumed_device_uuid' => $key->consumed_device_uuid,
                'created_at' => $key->created_at?->toIso8601String(),
            ]);

        return response()->json(['success' => true, 'codes' => $codes]);
    }

    /**
     * CNT-005 / CNT-007: kill a code that is still open. Every other open code for
     * the counter goes with it, because only one code may ever be live.
     */
    public function revokeCode(Request $request, string $id, string $code): JsonResponse
    {
        $counter = $this->findCounter($request, $id);

        $key = \App\Models\ActivationKey::where('id', $code)
            ->where('counter_id', $counter->id)
            ->firstOrFail();

        $validated = $request->validate([
            'reason' => 'nullable|string|max:200',
        ]);

        $reason = $validated['reason'] ?? 'Revoked by owner';

        DB::transaction(function () use ($key, $counter, $reason) {
            $key->revoke($reason);

            \App\Models\ActivationKey::where('counter_id', $counter->id)
                ->whereKeyNot($key->id)
                ->whereNull('consumed_at')
                ->where('is_revoked', false)
                ->get()
                ->each(fn ($open) => $open->revoke($reason));
        });

        AuditLog::log('counter_activation_code_revoked', 'ActivationKey', (string) $key->id, [
            'key_prefix' => $key->key_prefix,
            'is_revoked' => false,
        ], [
            'key_prefix' => $key->key_prefix,
            'is_revoked' => true,
            'counter_id' => $counter->id,
            'reason' => $reason,
        ], $counter->store_id);

        return response()->json([
            'success' => true,
            'revoked' => true,
            'key_prefix' => $key->fresh()->key_prefix,
            'revoked_at' => $key->fresh()->revoked_at?->toIso8601String(),
        ]);
    }

    /**
     * CNT-007: replace the workstation that holds this counter. The current
     * device is revoked and exactly one new code is issued.
     */
    public function reissue(Request $request, string $id, \App\Services\CounterClaimService $claims): JsonResponse
    {
        $counter = $this->findCounter($request, $id);
        $previousDeviceUuid = $counter->device_uuid;

        $validated = $request->validate([
            'label' => 'nullable|string|max:100',
            'ttl_hours' => 'nullable|integer|min:1|max:720',
        ]);

        $result = $claims->reissue($counter, [
            'label' => $validated['label'] ?? null,
            'ttl_hours' => $validated['ttl_hours'] ?? \App\Models\ActivationKey::DEFAULT_TTL_HOURS,
            'created_by' => $request->user()?->id,
        ]);

        AuditLog::log('counter_reissued', 'Counter', (string) $counter->id, [
            'device_uuid' => $previousDeviceUuid,
        ], [
            'revoked_device_uuid' => $result['revoked_device_uuid'],
            'key_prefix' => $result['key_prefix'],
        ], $counter->store_id);

        return response()->json(['success' => true] + $result);
    }

    /** CNT-009: the store numbers its own counters C01, C02, … when the owner gives no code. */
    private function nextCounterCode(int $storeId): string
    {
        $codes = Counter::where('store_id', $storeId)
            ->pluck('counter_code')
            ->map(fn ($code) => strtoupper((string) $code));

        $highest = 0;
        foreach ($codes as $code) {
            if (preg_match('/^C(\d+)$/', $code, $matches)) {
                $highest = max($highest, (int) $matches[1]);
            }
        }

        do {
            $candidate = sprintf('C%02d', ++$highest);
        } while ($codes->contains($candidate));

        return $candidate;
    }

    private function documentCount(Counter $counter): int
    {
        return \Illuminate\Support\Facades\DB::table('invoices')->where('counter_id', (string) $counter->id)->count()
            + \Illuminate\Support\Facades\DB::table('stock_ledger_entries')->where('counter_id', $counter->id)->count();
    }

    private function profileVersion(Counter $counter): int
    {
        return (int) ($counter->permission_profile_version ?? CounterProfile::VERSION);
    }

    private function findCounter(Request $request, string $id): Counter
    {
        $storeId = $this->storeId($request);

        return Counter::where('id', $id)
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->firstOrFail();
    }

    private function storeId(Request $request): ?int
    {
        $storeId = $request->attributes->get('active_store_id') ?? $request->get('active_store_id');

        return $storeId ? (int) $storeId : null;
    }

    private function nameConflictResponse(Counter $conflict): JsonResponse
    {
        return response()->json([
            'message' => 'That counter name is already in use in this store.',
            'errors' => ['counter_name' => [
                "The name \"{$conflict->counter_name}\" ({$conflict->counter_code}) is already live in this store. Revoked counters release their name.",
            ]],
        ], 422);
    }
}
