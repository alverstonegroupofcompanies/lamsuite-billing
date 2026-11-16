<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Store;
use App\Services\Compliance\ComplianceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AdminComplianceController
{
    public function __construct(private ComplianceService $compliance)
    {
    }

    private function resolveStoreId(Request $request): ?int
    {
        if ($request->attributes->get('store_scope_all')) {
            return null;
        }

        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->header('Store-Id')
            ?? $request->input('store_id')
            ?? $request->query('store_id')
            ?? $request->user()?->store_id;

        if ($candidate !== null && $candidate !== '' && is_numeric($candidate)) {
            return (int) $candidate;
        }

        $store = Store::where('code', $candidate)->orWhere('id', $candidate)->first();

        return $store?->id ?? Store::orderBy('id')->value('id');
    }

    private function decorateInvoices(): callable
    {
        return fn (Invoice $invoice) => $this->compliance->decorate($invoice);
    }
    /**
     * Compliance work queue: invoices that need or carry IRN/e-way references.
     */
    public function index(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $document = strtolower((string) $request->query('document', 'irn')) === 'ewb' ? 'ewb' : 'irn';
        $status = strtolower((string) $request->query('status', 'pending'));
        $search = trim((string) $request->query('search'));
        $from = $request->query('from');
        $to = $request->query('to');
        $perPage = min(200, max(1, (int) $request->query('per_page', 25)));

        $query = Invoice::query()->with(['store', 'customer'])->orderByDesc('invoice_date')->orderByDesc('id');
        if ($storeId !== null) {
            $query->where('store_id', $storeId);
        }
        if ($from) {
            $query->where('invoice_date', '>=', $from);
        }
        if ($to) {
            $query->where('invoice_date', '<=', $to);
        }
        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                    ->orWhere('customer_name', 'like', "%{$search}%")
                    ->orWhere('customer_gstin', 'like', "%{$search}%");
            });
        }

        if ($status !== 'cancelled') {
            $query->where('status', '!=', 'cancelled');
        }

        if ($document === 'irn') {
            $query->whereNotNull('customer_gstin')->where('customer_gstin', '!=', '');
            if ($status === 'pending') {
                $query->whereNull('irn');
            } elseif ($status === 'generated') {
                $query->whereNotNull('irn')->where(function ($q) {
                    $q->whereNull('irn_status')->orWhere('irn_status', '!=', ComplianceService::IRN_CANCELLED);
                });
            } elseif ($status === 'cancelled') {
                $query->where('irn_status', ComplianceService::IRN_CANCELLED);
            } elseif ($status !== 'all') {
                $query->where('irn_status', $status);
            }
        } else {
            if ($status === 'pending') {
                $query->whereNull('ewb_number');
                $this->applyEwBThreshold($query, $storeId);
            } elseif ($status === 'active') {
                $query->whereNotNull('ewb_number')
                    ->where(function ($q) {
                        $q->whereNull('ewb_status')->orWhere('ewb_status', '!=', ComplianceService::EWB_CANCELLED);
                    })
                    ->where('ewb_valid_until', '>=', Carbon::now());
            } elseif ($status === 'expired') {
                $query->whereNotNull('ewb_number')
                    ->where(function ($q) {
                        $q->whereNull('ewb_status')->orWhere('ewb_status', '!=', ComplianceService::EWB_CANCELLED);
                    })
                    ->where('ewb_valid_until', '<', Carbon::now());
            } elseif ($status === 'cancelled') {
                $query->where('ewb_status', ComplianceService::EWB_CANCELLED);
            }
        }

        $paginated = $query->paginate($perPage);
        $paginated->getCollection()->transform($this->decorateInvoices());

        return response()->json([
            'data' => $paginated->items(),
            'meta' => [
                'total' => $paginated->total(),
                'page' => $paginated->currentPage(),
                'per_page' => $paginated->perPage(),
                'last_page' => $paginated->lastPage(),
                'document' => $document,
                'status' => $status,
                'store_id' => $storeId,
            ],
            'summary' => $this->compliance->summary($storeId),
            'provider' => [
                'driver' => $this->compliance->provider()->driver(),
                'label' => $this->compliance->provider()->label(),
            ],
        ]);
    }

    public function summary(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);

        return response()->json([
            'summary' => $this->compliance->summary($storeId),
            'recent_events' => $this->compliance->recentEvents($storeId, 15),
            'config' => $this->compliance->configFor($storeId),
            'provider' => [
                'driver' => $this->compliance->provider()->driver(),
                'label' => $this->compliance->provider()->label(),
                'supports_irn' => $this->compliance->provider()->supportsIrn(),
                'supports_eway' => $this->compliance->provider()->supportsEway(),
            ],
        ]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $invoice = Invoice::with(['store', 'customer', 'items', 'payments'])->findOrFail($id);
        $this->compliance->decorate($invoice);

        $events = \App\Models\ComplianceEvent::where('entity_type', 'invoice')
            ->where('entity_id', (string) $invoice->id)
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        return response()->json([
            'invoice' => $invoice,
            'events' => $events,
        ]);
    }

    public function recordIrn(Request $request, int $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $validated = $request->validate([
            'irn' => 'required|string|max:64',
            'ack_no' => 'required|string|max:32',
            'ack_date' => 'required|date',
            'qr' => 'nullable|string|max:20000',
            'force' => 'nullable|boolean',
        ]);

        $invoice = $this->compliance->recordIrn($invoice, $validated, $request->user()?->id);
        AuditLog::log('compliance_irn_recorded', 'Invoice', (string) $invoice->id, null, [
            'irn' => $invoice->irn,
            'invoice_number' => $invoice->invoice_number,
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            'invoice' => $this->compliance->decorate($invoice),
        ]);
    }

    public function cancelIrn(Request $request, int $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $validated = $request->validate([
            'reason' => 'required|string|min:3|max:255',
        ]);

        $invoice = $this->compliance->cancelIrn($invoice, $validated['reason'], $request->user()?->id);
        AuditLog::log('compliance_irn_cancelled', 'Invoice', (string) $invoice->id, ['irn' => $invoice->irn], [
            'reason' => $validated['reason'],
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            'invoice' => $this->compliance->decorate($invoice),
        ]);
    }

    public function recordEwb(Request $request, int $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $validated = $request->validate([
            'ewb_number' => 'required|string|max:16',
            'ewb_date' => 'nullable|date',
            'valid_until' => 'nullable|date',
            'transporter_name' => 'nullable|string|max:150',
            'transporter_id' => 'nullable|string|max:20',
            'transport_mode' => 'nullable|string|in:road,rail,air,ship',
            'vehicle_number' => 'nullable|string|max:20',
            'distance_km' => 'nullable|numeric|min:1|max:5000',
            'transport_doc_no' => 'nullable|string|max:50',
            'transport_doc_date' => 'nullable|string|max:30',
            'force' => 'nullable|boolean',
        ]);

        $invoice = $this->compliance->recordEwb($invoice, $validated, $request->user()?->id);
        AuditLog::log('compliance_eway_created', 'Invoice', (string) $invoice->id, null, [
            'ewb_number' => $invoice->ewb_number,
            'invoice_number' => $invoice->invoice_number,
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            'invoice' => $this->compliance->decorate($invoice),
        ]);
    }

    public function updateEwb(Request $request, int $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $validated = $request->validate([
            'vehicle_number' => 'nullable|string|max:20',
            'transport_doc_no' => 'nullable|string|max:50',
            'transport_doc_date' => 'nullable|string|max:30',
        ]);

        $invoice = $this->compliance->updateEwb($invoice, $validated, $request->user()?->id);
        AuditLog::log('compliance_eway_updated', 'Invoice', (string) $invoice->id, null, [
            'ewb_number' => $invoice->ewb_number,
            'part_b' => $invoice->ewb_part_b,
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            'invoice' => $this->compliance->decorate($invoice),
        ]);
    }

    public function cancelEwb(Request $request, int $id): JsonResponse
    {
        $invoice = Invoice::findOrFail($id);
        $validated = $request->validate([
            'reason' => 'required|string|min:3|max:255',
        ]);

        $invoice = $this->compliance->cancelEwb($invoice, $validated['reason'], $request->user()?->id);
        AuditLog::log('compliance_eway_cancelled', 'Invoice', (string) $invoice->id, ['ewb_number' => $invoice->ewb_number], [
            'reason' => $validated['reason'],
        ], $invoice->store_id);

        return response()->json([
            'success' => true,
            'invoice' => $this->compliance->decorate($invoice),
        ]);
    }

    /**
     * Pending B2B invoices, ready for IRP portal entry or bulk backfill import.
     */
    public function exportPending(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $payload = $this->compliance->exportPending($storeId, [
            'from' => $request->query('from'),
            'to' => $request->query('to'),
        ]);

        if ($request->query('download') === '1') {
            $filename = 'compliance_pending_' . Carbon::now()->format('Ymd_His') . '.json';

            return response()->json($payload, 200, [
                'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            ]);
        }

        return response()->json($payload);
    }

    public function backfillPreview(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        $payload = $this->compliance->exportPending($storeId, [
            'from' => $request->query('from'),
            'to' => $request->query('to'),
        ]);

        return response()->json([
            'pending_count' => $payload['count'],
            'sample' => array_slice($payload['invoices'], 0, 10),
            'store_id' => $storeId,
        ]);
    }

    /**
     * Import IRN/e-way references captured outside the app (manual portal
     * export, historic backfill sheet, or a future GSP batch file).
     */
    public function import(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        if ($storeId === null) {
            return response()->json([
                'success' => false,
                'message' => 'Select a store before importing compliance data.',
            ], 422);
        }

        $validated = $request->validate([
            'rows' => 'nullable|array',
            'csv' => 'nullable|string',
        ]);

        $rows = [];
        if (!empty($validated['rows'])) {
            $rows = $validated['rows'];
        } elseif (!empty($validated['csv'])) {
            $rows = $this->parseCsv((string) $validated['csv']);
        }

        if (empty($rows)) {
            return response()->json([
                'success' => false,
                'message' => 'Provide rows or CSV content to import.',
            ], 422);
        }

        $result = $this->compliance->importRows($rows, $storeId, $request->user()?->id);
        AuditLog::log('compliance_import', 'ComplianceEvent', (string) $storeId, null, [
            'applied' => $result['applied'],
            'failed' => $result['failed'],
        ], $storeId);

        return response()->json([
            'success' => $result['failed'] === 0,
            'applied' => $result['applied'],
            'failed' => $result['failed'],
            'results' => $result['results'],
        ]);
    }

    public function settings(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        if ($storeId === null) {
            return response()->json([
                'success' => false,
                'message' => 'Select a store to view compliance settings.',
            ], 422);
        }

        return response()->json([
            'store_id' => $storeId,
            'config' => $this->compliance->configFor($storeId),
            'defaults' => $this->compliance->defaults(),
            'provider' => [
                'driver' => $this->compliance->provider()->driver(),
                'label' => $this->compliance->provider()->label(),
            ],
        ]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        if ($storeId === null) {
            return response()->json([
                'success' => false,
                'message' => 'Select a store before changing compliance settings.',
            ], 422);
        }

        $validated = $request->validate([
            'enabled' => 'nullable|boolean',
            'irn.enabled' => 'nullable|boolean',
            'irn.b2b_only' => 'nullable|boolean',
            'irn.turnover_threshold' => 'nullable|numeric|min:0',
            'eway.enabled' => 'nullable|boolean',
            'eway.threshold_amount' => 'nullable|numeric|min:0',
            'eway.default_distance_km' => 'nullable|numeric|min:1|max:5000',
        ]);

        $config = $this->compliance->configFor($storeId);
        $config['enabled'] = (bool) ($validated['enabled'] ?? $config['enabled']);
        $config['irn']['enabled'] = (bool) ($validated['irn']['enabled'] ?? $config['irn']['enabled']);
        $config['irn']['b2b_only'] = (bool) ($validated['irn']['b2b_only'] ?? $config['irn']['b2b_only']);
        if (isset($validated['irn']['turnover_threshold'])) {
            $config['irn']['turnover_threshold'] = (float) $validated['irn']['turnover_threshold'];
        }
        $config['eway']['enabled'] = (bool) ($validated['eway']['enabled'] ?? $config['eway']['enabled']);
        if (isset($validated['eway']['threshold_amount'])) {
            $config['eway']['threshold_amount'] = (float) $validated['eway']['threshold_amount'];
        }
        if (isset($validated['eway']['default_distance_km'])) {
            $config['eway']['default_distance_km'] = (float) $validated['eway']['default_distance_km'];
        }

        $saved = $this->compliance->saveConfig($storeId, $config);
        AuditLog::log('compliance_settings_updated', 'CompanySetting', (string) $storeId, null, $saved, $storeId);

        return response()->json([
            'success' => true,
            'config' => $saved,
        ]);
    }

    private function applyEwBThreshold($query, ?int $storeId): void
    {
        $storeIds = $storeId !== null ? [$storeId] : Store::pluck('id')->map(fn ($id) => (int) $id)->all();
        $thresholds = [];
        foreach ($storeIds as $id) {
            $config = $this->compliance->configFor($id);
            if (!empty($config['eway']['enabled'])) {
                $thresholds[$id] = (float) ($config['eway']['threshold_amount'] ?? 50000);
            }
        }

        if (empty($thresholds)) {
            $query->whereRaw('1 = 0');
            return;
        }

        $query->where(function ($outer) use ($thresholds) {
            foreach ($thresholds as $id => $threshold) {
                $outer->orWhere(function ($inner) use ($id, $threshold) {
                    $inner->where('store_id', $id)->where('grand_total', '>=', $threshold);
                });
            }
        });
    }

    private function parseCsv(string $csv): array
    {
        $lines = preg_split('/\r\n|\r|\n/', trim($csv));
        if (!$lines) {
            return [];
        }

        $header = array_map(function ($h) {
            return strtolower(trim($h));
        }, str_getcsv(array_shift($lines)));

        $map = [
            'invoice_number' => ['invoice_number', 'invoice', 'invoice no', 'invoice no.', 'bill_no', 'bill no', 'bill_number'],
            'irn' => ['irn'],
            'ack_no' => ['ack_no', 'ack no', 'acknowledgement_no', 'acknowledgement no', 'acknowledgment_no', 'acknowledgment no'],
            'ack_date' => ['ack_date', 'ack date', 'acknowledgement_date', 'acknowledgement date', 'acknowledgment_date', 'acknowledgment date'],
            'qr' => ['qr', 'signed_qr', 'qr_code'],
            'ewb_number' => ['ewb_number', 'eway_bill_number', 'eway_number', 'ewb'],
            'ewb_date' => ['ewb_date', 'eway_date'],
            'valid_until' => ['valid_until', 'validity'],
            'vehicle_number' => ['vehicle_number', 'vehicle_no', 'vehicle'],
            'distance_km' => ['distance_km', 'distance'],
            'transporter_name' => ['transporter_name', 'transporter'],
        ];

        $positions = [];
        foreach ($map as $field => $aliases) {
            foreach ($header as $index => $column) {
                if (in_array($column, $aliases, true)) {
                    $positions[$field] = $index;
                    break;
                }
            }
        }

        $rows = [];
        foreach ($lines as $line) {
            if (trim($line) === '') {
                continue;
            }
            $cells = str_getcsv($line);
            $row = [];
            foreach ($positions as $field => $index) {
                $value = $cells[$index] ?? null;
                if ($value !== null && trim((string) $value) !== '') {
                    $row[$field] = trim((string) $value);
                }
            }
            if (!empty($row)) {
                $rows[] = $row;
            }
        }

        return $rows;
    }
}
