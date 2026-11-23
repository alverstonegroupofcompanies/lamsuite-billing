<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\CounterProfileException;
use App\Models\CounterSequence;
use App\Models\Invoice;
use App\Models\User;
use App\Services\Counter\CounterPresenceService;
use App\Services\CounterSequenceService;
use App\Support\RequestTenant;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use App\Services\Counter\CounterShiftService;
use App\Models\DeviceSession;
use App\Models\Store;
use App\Models\StoreDayClose;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CounterController
{
    /**
     * List all counters for a store: status, last activity and bill, operator,
     * sync backlog and offline periods, plus the permission watermark.
     */
    public function index(Request $request): JsonResponse
    {
        // G1-SEC: the authenticated tenant's counters only; never store 1 by default.
        $storeId = RequestTenant::requireStoreId($request);

        $counters = Counter::where('store_id', $storeId)
            ->with(['sequences'])
            ->orderBy('counter_code', 'asc')
            ->get();

        $counterIds = $counters->pluck('id')->all();
        $deviceUuids = $counters->pluck('device_uuid')->filter()->unique()->values()->all();

        // CNT-01: the last bill each counter issued, and the last salesperson
        // stamped on one of its bills (GAP-01), as two aggregates over the store.
        $lastBills = $this->latestBills($storeId, $counterIds, false);
        $lastSoldBills = $this->latestBills($storeId, $counterIds, true);

        // CNT-01: the latest session beat per counter, which carries the operator
        // and the sync backlog the till last reported.
        $sessions = $this->latestSessions($storeId, $counterIds, $deviceUuids);
        $operatorNames = User::whereIn(
            'id',
            $sessions->pluck('user_id')->filter()->unique()->values()->all()
        )->pluck('name', 'id');

        // CNT-01: offline spans recorded from heartbeats.
        $presence = app(CounterPresenceService::class)->summaries($counters);

        $openExceptions = CounterProfileException::whereIn('counter_id', $counterIds)
            ->where('status', CounterProfileException::STATUS_OPEN)
            ->selectRaw('counter_id, COUNT(*) as total')
            ->groupBy('counter_id')
            ->pluck('total', 'counter_id');

        $data = $counters->map(function (Counter $counter) use ($lastBills, $lastSoldBills, $sessions, $operatorNames, $presence, $openExceptions) {
            $id = (int) $counter->id;
            $session = $sessions->get('counter:' . $id)
                ?? ($counter->device_uuid ? $sessions->get('device:' . $counter->device_uuid) : null);
            $presenceRow = $presence[$id] ?? null;

            $lastActivity = $counter->last_seen_at;
            foreach ([$session?->last_active_at, $presenceRow['last_beat_at'] ?? null] as $candidate) {
                $at = $candidate instanceof Carbon ? $candidate : ($candidate ? Carbon::parse($candidate) : null);
                if ($at && (! $lastActivity || $at->gt($lastActivity))) {
                    $lastActivity = $at;
                }
            }

            $isOnline = $lastActivity !== null && $lastActivity->gt(now()->subMinutes(2));

            // CNT-01: the open offline period starts at the last moment the store
            // heard from the counter by any channel, not only its last span.
            if ($presenceRow && $lastActivity && ! empty($presenceRow['offline_since'])
                && $lastActivity->gt(Carbon::parse($presenceRow['offline_since']))) {
                $presenceRow['offline_since'] = $lastActivity->toIso8601String();
                $presenceRow['offline_periods'] = array_map(fn (array $period) => $period['ended_at'] === null
                    ? [
                        'started_at' => $lastActivity->toIso8601String(),
                        'ended_at' => null,
                        'minutes' => max(0, (int) round($lastActivity->diffInSeconds(now()) / 60)),
                    ]
                    : $period, $presenceRow['offline_periods']);
            }

            // The salesperson is whoever the owner's master says sold the last
            // bill; the signed-in user is only the operator, reported apart.
            $lastBill = $lastBills->get($id);
            $lastSold = $lastSoldBills->get($id);
            $salespersonId = $lastSold?->salesperson_id ?? $counter->last_salesperson_id;
            $salespersonName = $lastSold?->salesperson_name ?? $counter->last_salesperson_name;
            $operatorId = $session?->user_id ? (int) $session->user_id : null;
            $operatorName = $operatorId ? ($operatorNames[$operatorId] ?? null) : null;

            $lastBillAt = $lastBill?->created_at;

            return array_merge($counter->toArray(), [
                'is_online' => (bool) $isOnline,
                // PRF-006: the panel needs to know a PIN exists without ever seeing it.
                'unlock_pin_set' => $counter->unlock_pin_hash !== null,
                'status_display' => $counter->status === 'active' ? ($isOnline ? 'Online' : 'Offline') : ucfirst($counter->status),
                // PRF-001/Q1: what the counter works inside, and whether anything
                // it made in the dark is still waiting for the owner.
                'permission_profile_version' => (int) ($counter->permission_profile_version ?? \App\Support\Counter\CounterProfile::VERSION),
                'open_profile_exceptions' => (int) ($openExceptions[$id] ?? $openExceptions[(string) $id] ?? 0),
                // CNT-01: what the owner asked to see — when the counter last
                // worked, what it last sold, and when it was dark.
                'last_activity_at' => $lastActivity?->toIso8601String(),
                'last_bill_at' => $lastBillAt ? Carbon::parse($lastBillAt)->toIso8601String() : null,
                'last_bill_number' => $lastBill?->invoice_number,
                'last_salesperson_id' => $salespersonId ? (int) $salespersonId : null,
                'last_salesperson_name' => $salespersonName ?: null,
                'last_operator_id' => $operatorName ? $operatorId : null,
                'last_operator_name' => $operatorName,
                'unsynced_items_count' => (int) ($session?->unsynced_items_count ?? 0),
                'offline_since' => $presenceRow['offline_since'] ?? null,
                'offline_periods' => $presenceRow['offline_periods'] ?? [],
            ]);
        });

        return response()->json([
            'success' => true,
            'counters' => $data,
        ]);
    }

    /**
     * CNT-01: the newest bill per counter in one query — optionally only bills
     * that carry a salesperson — keyed by counter id.
     *
     * @param array<int, int> $counterIds
     * @return Collection<int, Invoice>
     */
    private function latestBills(int $storeId, array $counterIds, bool $withSalesperson): Collection
    {
        if ($counterIds === []) {
            return collect();
        }

        $latestIds = Invoice::query()
            ->selectRaw('MAX(id)')
            ->where('store_id', $storeId)
            ->whereIn('counter_id', $counterIds)
            ->where('module_key', 'invoice')
            ->when($withSalesperson, fn ($q) => $q->whereNotNull('salesperson_name')->where('salesperson_name', '!=', ''))
            ->groupBy('counter_id');

        return Invoice::query()
            ->whereIn('id', $latestIds)
            ->get(['id', 'counter_id', 'invoice_number', 'created_at', 'salesperson_id', 'salesperson_name'])
            ->keyBy(fn (Invoice $invoice) => (int) $invoice->counter_id);
    }

    /**
     * The latest session beat for each counter, keyed both by counter and by
     * device so a counter whose workstation has not claimed it yet still finds
     * its session.
     *
     * @param array<int, int> $counterIds
     * @param array<int, string> $deviceUuids
     * @return Collection<string, DeviceSession>
     */
    private function latestSessions(int $storeId, array $counterIds, array $deviceUuids): Collection
    {
        if ($counterIds === [] && $deviceUuids === []) {
            return collect();
        }

        $rows = DeviceSession::where('store_id', $storeId)
            ->where(function ($query) use ($counterIds, $deviceUuids) {
                $query->whereIn('counter_id', $counterIds);
                if ($deviceUuids !== []) {
                    $query->orWhereIn('device_uuid', $deviceUuids);
                }
            })
            ->orderByDesc('last_active_at')
            ->get();

        $byKey = collect();
        foreach ($rows as $row) {
            if ($row->counter_id !== null && ! $byKey->has('counter:' . $row->counter_id)) {
                $byKey->put('counter:' . $row->counter_id, $row);
            }
            if ($row->device_uuid && ! $byKey->has('device:' . $row->device_uuid)) {
                $byKey->put('device:' . $row->device_uuid, $row);
            }
        }

        return $byKey;
    }

    /**
     * Store Owner approves, rejects, or revokes a counter.
     */
    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $counter = Counter::findOrFail($id);
        $validated = $request->validate([
            'status' => 'required|in:active,pending_approval,revoked,locked',
            'revoke_reason' => 'nullable|string',
            'role_profile' => 'nullable|array',
            'is_digital_only' => 'nullable|boolean',
            'location_name' => 'nullable|string',
        ]);

        $oldStatus = $counter->status;
        $counter->update([
            'status' => $validated['status'],
            'revoke_reason' => $validated['status'] === 'revoked' ? ($validated['revoke_reason'] ?? 'Revoked by administrator') : null,
            'role_profile' => $validated['role_profile'] ?? $counter->role_profile,
            'is_digital_only' => isset($validated['is_digital_only']) ? (bool)$validated['is_digital_only'] : $counter->is_digital_only,
            'location_name' => $validated['location_name'] ?? $counter->location_name,
        ]);

        // Auto-initialize sequence series if approved. A status change never mints
        // a token: CNT-013 makes a claimed activation code the only way onto a till.
        if ($counter->status === 'active') {
            app(CounterSequenceService::class)->ensureFor($counter);
        }

        AuditLog::log(
            'counter_status_update',
            'Counter',
            (string)$counter->id,
            ['status' => $oldStatus],
            ['status' => $counter->status, 'reason' => $counter->revoke_reason],
            $counter->store_id
        );

        return response()->json([
            'success' => true,
            'counter' => $counter->fresh(['sequences']),
            'message' => "Counter '{$counter->counter_name}' ({$counter->counter_code}) status set to {$counter->status}.",
        ]);
    }

    /**
     * Update settings (printer, receipt, visible menus, role permissions) for a counter.
     */
    public function updateSettings(Request $request, string $id): JsonResponse
    {
        $counter = Counter::findOrFail($id);
        $validated = $request->validate([
            'printer_profile' => 'nullable|array',
            'receipt_customization' => 'nullable|array',
            'role_profile' => 'nullable|array',
            'allowed_user_ids' => 'nullable|array',
            'visible_menus' => 'nullable|array',
            'is_digital_only' => 'nullable|boolean',
            'location_name' => 'nullable|string',
        ]);

        $counter->update(array_filter($validated, fn($val) => !is_null($val)));

        AuditLog::log(
            'counter_settings_update',
            'Counter',
            (string)$counter->id,
            null,
            $validated,
            $counter->store_id
        );

        return response()->json([
            'success' => true,
            'counter' => $counter,
            'message' => "Settings updated for counter {$counter->counter_code}.",
        ]);
    }

    /**
     * CNT-014 — lease or reshape a counter\'s document series.
     *
     * The path parameter is a counter id or, as tills in the field have always
     * sent it, a counter code; the code is read inside the store the request
     * names, so one counter cannot be reached through another store.
     */
    public function leaseSequence(Request $request, string $id): JsonResponse
    {
        $counter = $this->resolveCounter($request, $id);

        if (!$counter) {
            return response()->json([
                'success' => false,
                'error' => 'counter_not_found',
                'message' => "No counter {$id} in this store.",
            ], 404);
        }

        $service = app(CounterSequenceService::class);

        $validated = $request->validate([
            'doc_type' => ['required', 'string', Rule::in(array_merge(
                CounterSequenceService::docTypes(),
                array_keys(CounterSequenceService::DOC_TYPE_ALIASES)
            ))],
            'financial_year' => 'nullable|string',
            'prefix' => 'nullable|string',
            'range_start' => 'nullable|integer',
            'range_end' => 'nullable|integer',
            'next_number' => 'nullable|integer',
            'allocate_block' => 'nullable|boolean',
            'block_size' => 'nullable|integer|min:5|max:1000',
        ], [
            'doc_type.in' => 'The document series must be one of: ' . implode(', ', CounterSequenceService::docTypes()) . '.',
        ]);

        $fy = $validated['financial_year'] ?? $service->currentFinancialYear();
        $docType = CounterSequenceService::normalizeDocType($validated['doc_type']);

        if (!empty($validated['allocate_block'])) {
            $block = $service->lease(
                $counter,
                $docType,
                (int) ($validated['block_size'] ?? CounterSequenceService::DEFAULT_BLOCK_SIZE),
                $fy,
            );

            $sequence = CounterSequence::where('counter_id', $counter->id)
                ->where('doc_type', $block['doc_type'])
                ->where('financial_year', $fy)
                ->first();

            if (!empty($validated['prefix'])) {
                $sequence->update(['prefix' => $validated['prefix']]);
                $block['prefix'] = $validated['prefix'];
            }

            return response()->json([
                'success' => true,
                'counter_id' => (int) $counter->id,
                'counter_code' => $counter->counter_code,
                'doc_type' => $block['doc_type'],
                'sequence' => $sequence,
                'leased_block' => $block,
                'message' => "Allocated number block {$block['range_start']}-{$block['range_end']} for {$block['prefix']}.",
            ]);
        }

        $sequence = $service->sequenceFor($counter, $docType, $fy);
        $sequence->update(array_filter([
            'prefix' => $validated['prefix'] ?? null,
            'range_start' => $validated['range_start'] ?? null,
            'range_end' => $validated['range_end'] ?? null,
            'next_number' => $validated['next_number'] ?? null,
        ], fn ($v) => $v !== null));

        return response()->json([
            'success' => true,
            'counter_id' => (int) $counter->id,
            'counter_code' => $counter->counter_code,
            'doc_type' => $sequence->fresh()->doc_type,
            'sequence' => $sequence->fresh(),
            'leased_block' => null,
            'message' => "Document series leased for {$counter->counter_code} ({$sequence->prefix}).",
        ]);
    }

    /** A counter addressed by its server id or, the way tills do, by its code. */
    private function resolveCounter(Request $request, string $key): ?Counter
    {
        // G1-SEC: only a counter of the authenticated store; a counter's token
        // may only lease for itself.
        $storeId = \App\Support\RequestTenant::requireStoreId($request);
        $query = Counter::where('store_id', $storeId);
        $counter = is_numeric($key)
            ? $query->whereKey($key)->first()
            : $query->where('counter_code', strtoupper(trim($key)))->first();

        $own = \App\Support\RequestTenant::counterId($request);
        if ($counter && $own !== null && (int) $counter->id !== $own) {
            return null;
        }

        return $counter;
    }

    /**
     * Open a counter shift with opening cash float.
     *
     * B9 / PRF-007: this is the panel's path — a person opening the drawer of a
     * counter they can see, recorded as `panel_user`. A till opens its own
     * drawer at `/api/counter/shift/open` with its device token and its PIN, and
     * its rows are keyed to the counter with no person at all.
     */
    public function openShift(Request $request, string $id, CounterShiftService $shifts): JsonResponse
    {
        $counter = $this->panelCounter($request, $id);
        $validated = $request->validate([
            'opening_float' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string',
        ]);

        $shift = $shifts->open(
            $counter,
            [
                'opening_float' => $validated['opening_float'] ?? 0,
                'notes' => $validated['notes'] ?? null,
            ],
            CounterShiftService::VIA_PANEL_USER,
            $request->user()?->id
        );

        return response()->json([
            'success' => true,
            'shift' => $shift,
            'message' => "Shift opened with opening float ₹" . number_format((float) $shift->opening_float, 2)
                . " for counter {$counter->counter_code}.",
        ]);
    }

    /**
     * Close a counter shift (reconciliation of cash, card, UPI, and discrepancy).
     *
     * The variance is computed rather than accepted: the drawer's components come
     * from whoever counted it, but what they add up to is the store's figure, and
     * the answer carries the cloud's own tally for the same counter beside it.
     */
    public function closeShift(Request $request, string $id, CounterShiftService $shifts): JsonResponse
    {
        $counter = $this->panelCounter($request, $id);
        $validated = $request->validate([
            'closing_cash_actual' => 'required|numeric|min:0',
            'cash_sales' => 'nullable|numeric|min:0',
            'digital_sales' => 'nullable|numeric|min:0',
            'cash_refunds' => 'nullable|numeric|min:0',
            'cash_in' => 'nullable|numeric|min:0',
            'cash_drops' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string',
        ]);

        $result = $shifts->close($counter, $validated, CounterShiftService::VIA_PANEL_USER, $request->user()?->id);

        return response()->json([
            'success' => true,
            'shift' => $result['shift'],
            'expected_cash' => $result['expected_cash'],
            'variance' => $result['variance'],
            'server_tally' => $result['reconciliation']['server'] ?? null,
            'ignored_client_totals' => $result['reconciliation']['ignored_client_totals'] ?? [],
            'reconciliation' => $result['reconciliation'],
            'message' => "Shift closed for counter {$counter->counter_code}. Variance ₹"
                . number_format($result['variance'], 2) . '.',
        ]);
    }

    /** A counter inside the store the panel is working in, or a 404. */
    private function panelCounter(Request $request, string $id): Counter
    {
        $storeId = $request->attributes->get('active_store_id');

        return Counter::where('id', $id)
            ->when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->firstOrFail();
    }

    /**
     * Store-wide combined Day Close consolidating all counters.
     */
    public function closeStoreDay(Request $request): JsonResponse
    {
        // G1-SEC: the day is closed for the authenticated tenant's store only.
        $storeId = (int) (\App\Support\RequestTenant::storeId($request) ?? 0);
        $closeDate = (string) $request->input('close_date', now()->toDateString());

        if (! $storeId) {
            return response()->json([
                'success' => false,
                'error' => 'STORE_REQUIRED',
                'message' => 'A store is required to close the day.',
            ], 422);
        }

        $service = app(\App\Services\DayClose\StoreDayCloseService::class);

        try {
            $dayClose = $service->close($storeId, $closeDate, $request->user()?->id, $request->input('notes'));
        } catch (\App\Exceptions\BusinessRuleException $e) {
            return $e->render();
        }

        return response()->json([
            'success' => true,
            'day_close' => $dayClose,
            'summary' => $service->summary($storeId, $closeDate),
            'message' => "Store day close consolidated for date {$closeDate}.",
        ]);
    }

    /**
     * Live heartbeat and revocation watcher for counter & store status.
     */
    public function watch(Request $request, string $id): JsonResponse
    {
        $counter = Counter::with(['store'])->find($id);

        if (!$counter) {
            return response()->json(['error' => 'Counter not found'], 404);
        }

        $store = $counter->store;
        $isStoreActive = $store ? (bool)$store->is_active : false;
        $licenseStatus = $store ? ($store->license_status ?? 'active') : 'expired';

        // Update last seen
        $counter->update([
            'last_seen_at' => now(),
            'ip_address' => $request->ip(),
        ]);

        if ($counter->device_uuid) {
            DeviceSession::recordHeartbeat(
                $counter->device_uuid,
                $request->ip(),
                $counter->device_name,
                $counter->counter_name
            );
        }

        return response()->json([
            'success' => true,
            'counter_id' => $counter->id,
            'counter_code' => $counter->counter_code,
            'counter_status' => $counter->status,
            'is_counter_active' => $counter->status === 'active',
            'store_id' => $counter->store_id,
            'is_store_active' => $isStoreActive,
            'license_status' => $licenseStatus,
            'timestamp' => now()->toIso8601String(),
        ]);
    }

}
