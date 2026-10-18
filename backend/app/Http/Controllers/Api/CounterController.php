<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\CounterShift;
use App\Models\Store;
use App\Models\StoreDayClose;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CounterController
{
    /**
     * List all counters for a store with online status, sync watermark, and sequence summary.
     */
    public function index(Request $request): JsonResponse
    {
        $storeId = $request->header('X-Store-Id') ?: $request->query('store_id', 1);

        $counters = Counter::where('store_id', $storeId)
            ->with(['sequences'])
            ->orderBy('counter_code', 'asc')
            ->get();

        $data = $counters->map(function (Counter $counter) {
            $isOnline = $counter->last_seen_at && $counter->last_seen_at->gt(now()->subMinutes(2));
            return array_merge($counter->toArray(), [
                'is_online' => (bool)$isOnline,
                'status_display' => $counter->status === 'active' ? ($isOnline ? 'Online' : 'Offline') : ucfirst($counter->status),
            ]);
        });

        return response()->json([
            'success' => true,
            'counters' => $data,
        ]);
    }

    /**
     * Submit new device registration for store owner approval.
     */
    public function enroll(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required',
            'device_uuid' => 'required|string',
            'counter_name' => 'required|string|max:100',
            'counter_code' => 'required|string|max:20',
            'location_name' => 'nullable|string|max:100',
            'is_remote' => 'nullable|boolean',
            'is_digital_only' => 'nullable|boolean',
            'mac_address' => 'nullable|string',
        ]);

        $store = is_numeric($validated['store_id'])
            ? Store::find($validated['store_id'])
            : Store::where('code', $validated['store_id'])->first();

        if (!$store) {
            return response()->json(['error' => 'Store not found'], 404);
        }

        // Check if device or counter code already exists
        $existing = Counter::where('store_id', $store->id)
            ->where(function ($q) use ($validated) {
                $q->where('device_uuid', $validated['device_uuid'])
                  ->orWhere('counter_code', $validated['counter_code']);
            })->first();

        if ($existing) {
            // Update device details
            $existing->update([
                'device_uuid' => $validated['device_uuid'],
                'counter_name' => $validated['counter_name'],
                'location_name' => $validated['location_name'] ?? $existing->location_name,
                'ip_address' => $request->ip(),
                'last_seen_at' => now(),
            ]);

            return response()->json([
                'success' => true,
                'counter' => $existing,
                'status' => $existing->status,
                'message' => "Device enrollment updated. Current status: {$existing->status}",
            ]);
        }

        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => strtoupper($validated['counter_code']),
            'counter_name' => $validated['counter_name'],
            'location_name' => $validated['location_name'] ?? 'Remote Office',
            'is_remote' => (bool)($validated['is_remote'] ?? true),
            'is_digital_only' => (bool)($validated['is_digital_only'] ?? false),
            'status' => 'pending_approval',
            'device_uuid' => $validated['device_uuid'],
            'mac_address' => $validated['mac_address'] ?? null,
            'ip_address' => $request->ip(),
            'last_seen_at' => now(),
            'role_profile' => [
                'allow_cancel' => false,
                'allow_price_change' => false,
                'allow_stock_adj' => false,
                'require_manager_pin' => false,
            ],
            'printer_profile' => [
                'type' => 'thermal_80mm',
                'auto_print' => true,
                'copies' => 1,
            ],
        ]);

        AuditLog::log(
            'counter_enroll_requested',
            'Counter',
            (string)$counter->id,
            null,
            ['device_uuid' => $counter->device_uuid, 'location' => $counter->location_name],
            $store->id
        );

        return response()->json([
            'success' => true,
            'counter' => $counter,
            'status' => 'pending_approval',
            'message' => 'Remote counter registered successfully. Awaiting store owner approval in Admin Panel.',
        ], 201);
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

        // Auto-initialize sequence series if approved
        if ($counter->status === 'active') {
            $fy = $this->calculateFinancialYear();
            $this->ensureCounterSequences($counter, $fy);
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
            'manager_pin' => 'nullable|string',
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
     * Lease or allocate number sequences for a counter.
     */
    public function leaseSequence(Request $request, string $id): JsonResponse
    {
        $counter = Counter::findOrFail($id);
        $validated = $request->validate([
            'doc_type' => 'required|in:invoice,sales_return,receipt,stock_transfer',
            'financial_year' => 'nullable|string',
            'prefix' => 'nullable|string',
            'range_start' => 'nullable|integer',
            'range_end' => 'nullable|integer',
            'next_number' => 'nullable|integer',
        ]);

        $fy = $validated['financial_year'] ?? $this->calculateFinancialYear();
        $defaultPrefix = $validated['prefix'] ?? "{$counter->counter_code}-" . strtoupper(substr($validated['doc_type'], 0, 3));

        $sequence = CounterSequence::updateOrCreate(
            [
                'counter_id' => $counter->id,
                'doc_type' => $validated['doc_type'],
                'financial_year' => $fy,
            ],
            [
                'store_id' => $counter->store_id,
                'prefix' => $defaultPrefix,
                'range_start' => $validated['range_start'] ?? null,
                'range_end' => $validated['range_end'] ?? null,
                'next_number' => $validated['next_number'] ?? 1001,
            ]
        );

        return response()->json([
            'success' => true,
            'sequence' => $sequence,
            'message' => "Document series leased for {$counter->counter_code} ({$sequence->prefix}).",
        ]);
    }

    /**
     * Close a counter shift (reconciliation of cash, card, UPI, and discrepancy).
     */
    public function closeShift(Request $request, string $id): JsonResponse
    {
        $counter = Counter::findOrFail($id);
        $validated = $request->validate([
            'closing_cash_actual' => 'required|numeric',
            'closing_discrepancy' => 'nullable|numeric',
            'cash_sales' => 'nullable|numeric',
            'digital_sales' => 'nullable|numeric',
            'cash_refunds' => 'nullable|numeric',
            'cash_drops' => 'nullable|numeric',
            'notes' => 'nullable|string',
        ]);

        $shift = CounterShift::create([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'opened_by_user_id' => $request->user()?->id,
            'closed_by_user_id' => $request->user()?->id,
            'opening_float' => 0.00,
            'cash_sales' => $validated['cash_sales'] ?? 0.00,
            'digital_sales' => $validated['digital_sales'] ?? 0.00,
            'cash_refunds' => $validated['cash_refunds'] ?? 0.00,
            'cash_drops' => $validated['cash_drops'] ?? 0.00,
            'closing_cash_actual' => $validated['closing_cash_actual'],
            'closing_discrepancy' => $validated['closing_discrepancy'] ?? 0.00,
            'status' => 'closed',
            'opened_at' => now()->startOfDay(),
            'closed_at' => now(),
            'notes' => $validated['notes'] ?? null,
        ]);

        return response()->json([
            'success' => true,
            'shift' => $shift,
            'message' => "Shift closed for counter {$counter->counter_code}.",
        ]);
    }

    /**
     * Store-wide combined Day Close consolidating all counters.
     */
    public function closeStoreDay(Request $request): JsonResponse
    {
        $storeId = $request->header('X-Store-Id') ?: $request->input('store_id', 1);
        $closeDate = $request->input('close_date', now()->toDateString());

        // Consolidate all invoices for this store & date across all counters
        $invoices = DB::table('invoices')
            ->where('store_id', $storeId)
            ->whereDate('invoice_date', $closeDate)
            ->where('status', '!=', 'cancelled')
            ->get();

        $grossSales = $invoices->sum('total_amount');
        $taxCollected = $invoices->sum('tax_amount');
        $totalBills = $invoices->count();

        // Breakdown per counter
        $breakdowns = [];
        $counters = Counter::where('store_id', $storeId)->get();
        foreach ($counters as $c) {
            $cInvoices = $invoices->where('counter_code', $c->counter_code);
            $breakdowns[$c->counter_code] = [
                'counter_id' => $c->id,
                'counter_name' => $c->counter_name,
                'location_name' => $c->location_name,
                'bills_count' => $cInvoices->count(),
                'gross_total' => round($cInvoices->sum('total_amount'), 2),
                'tax_total' => round($cInvoices->sum('tax_amount'), 2),
            ];
        }

        $dayClose = StoreDayClose::updateOrCreate(
            ['store_id' => $storeId, 'close_date' => $closeDate],
            [
                'total_gross_sales' => $grossSales,
                'total_tax_collected' => $taxCollected,
                'total_cash_collected' => $grossSales, // aggregated
                'total_digital_collected' => 0.00,
                'total_refunds' => 0.00,
                'net_cash_in_hand' => $grossSales,
                'total_bills_count' => $totalBills,
                'counter_breakdowns' => $breakdowns,
                'closed_by_user_id' => $request->user()?->id,
                'reconciliation_notes' => $request->input('notes', 'Automated store day close consolidation'),
            ]
        );

        return response()->json([
            'success' => true,
            'day_close' => $dayClose,
            'message' => "Store day close consolidated for date {$closeDate}.",
        ]);
    }

    private function calculateFinancialYear(): string
    {
        $month = (int)date('n');
        $year = (int)date('Y');
        if ($month >= 4) {
            return $year . '-' . substr((string)($year + 1), -2);
        }
        return ($year - 1) . '-' . substr((string)$year, -2);
    }

    private function ensureCounterSequences(Counter $counter, string $fy): void
    {
        $docTypes = [
            'invoice' => "{$counter->counter_code}-INV",
            'sales_return' => "{$counter->counter_code}-SR",
            'receipt' => "{$counter->counter_code}-REC",
        ];

        foreach ($docTypes as $type => $prefix) {
            CounterSequence::firstOrCreate(
                [
                    'counter_id' => $counter->id,
                    'doc_type' => $type,
                    'financial_year' => $fy,
                ],
                [
                    'store_id' => $counter->store_id,
                    'prefix' => $prefix,
                    'next_number' => 1001,
                ]
            );
        }
    }
}
