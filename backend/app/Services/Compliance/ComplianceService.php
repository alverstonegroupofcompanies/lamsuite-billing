<?php

namespace App\Services\Compliance;

use App\Models\CompanySetting;
use App\Models\ComplianceEvent;
use App\Models\Invoice;
use App\Models\Store;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ComplianceService
{
    public const IRN_PENDING = 'pending';
    public const IRN_GENERATED = 'generated';
    public const IRN_CANCELLED = 'cancelled';
    public const IRN_FAILED = 'failed';
    public const IRN_NOT_APPLICABLE = 'not_applicable';

    public const EWB_PENDING = 'pending';
    public const EWB_ACTIVE = 'active';
    public const EWB_EXPIRED = 'expired';
    public const EWB_CANCELLED = 'cancelled';
    public const EWB_NOT_APPLICABLE = 'not_applicable';

    private const IRN_CANCEL_WINDOW_HOURS = 24;

    /** @var array<int, array> */
    private array $configCache = [];

    public function provider(): ComplianceProvider
    {
        return new ManualComplianceProvider();
    }

    public function defaults(): array
    {
        return [
            'enabled' => true,
            'provider' => 'manual',
            'irn' => [
                'enabled' => true,
                'b2b_only' => true,
                'turnover_threshold' => 50000000,
            ],
            'eway' => [
                'enabled' => true,
                'threshold_amount' => 50000,
                'default_distance_km' => 10,
            ],
        ];
    }

    /**
     * Effective compliance configuration for a store (defaults deep-merged).
     */
    public function configFor(?int $storeId): array
    {
        $key = (int) $storeId;
        if (isset($this->configCache[$key])) {
            return $this->configCache[$key];
        }

        $stored = [];
        if ($storeId) {
            $row = CompanySetting::where('store_id', $storeId)
                ->where('key', 'compliance')
                ->first();
            $stored = is_array($row?->value) ? $row->value : [];
        }

        $config = $this->mergeRecursive($this->defaults(), $stored);
        $this->configCache[$key] = $config;

        return $config;
    }

    public function invalidateConfig(?int $storeId = null): void
    {
        if ($storeId === null) {
            $this->configCache = [];
            return;
        }
        unset($this->configCache[(int) $storeId]);
    }

    public function saveConfig(int $storeId, array $config): array
    {
        $merged = $this->mergeRecursive($this->defaults(), $config);
        CompanySetting::updateOrCreate(
            ['store_id' => $storeId, 'key' => 'compliance'],
            ['value' => $merged, 'is_secret' => false]
        );
        $this->invalidateConfig($storeId);

        return $merged;
    }

    /**
     * Attach effective compliance status to an invoice for API serialization.
     */
    public function decorate(Invoice $invoice): Invoice
    {
        $config = $this->configFor((int) $invoice->store_id);
        $invoice->setAttribute('irn_status_effective', $this->irnStatus($invoice, $config));
        $invoice->setAttribute('ewb_status_effective', $this->ewbStatus($invoice, $config));
        $invoice->setAttribute('irn_applicable', $this->isIrnApplicable($invoice, $config));
        $invoice->setAttribute('ewb_applicable', $this->isEwbApplicable($invoice, $config));

        return $invoice;
    }

    public function normalizeGstin(?string $gstin): string
    {
        return strtoupper(preg_replace('/\s+/', '', (string) $gstin) ?? '');
    }

    public function hasValidGstin(?string $gstin): bool
    {
        $g = $this->normalizeGstin($gstin);

        return (bool) preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/', $g);
    }

    public function isIrnApplicable(Invoice $invoice, ?array $config = null): bool
    {
        $config = $config ?? $this->configFor((int) $invoice->store_id);
        if (empty($config['enabled']) || empty($config['irn']['enabled'])) {
            return false;
        }
        if (strtolower((string) $invoice->status) === 'cancelled') {
            return false;
        }
        $store = Store::find($invoice->store_id);
        if ($store && ($store->gst_type ?? 'regular') !== 'regular') {
            return false;
        }
        if (empty($config['irn']['b2b_only'])) {
            return true;
        }

        return $this->hasValidGstin($invoice->customer_gstin);
    }

    public function isEwbApplicable(Invoice $invoice, ?array $config = null): bool
    {
        $config = $config ?? $this->configFor((int) $invoice->store_id);
        if (empty($config['enabled']) || empty($config['eway']['enabled'])) {
            return false;
        }
        if (strtolower((string) $invoice->status) === 'cancelled') {
            return false;
        }
        $store = Store::find($invoice->store_id);
        if ($store && ($store->gst_type ?? 'regular') !== 'regular') {
            return false;
        }

        $threshold = (float) ($config['eway']['threshold_amount'] ?? 50000);

        return (float) $invoice->grand_total >= $threshold;
    }

    public function irnStatus(Invoice $invoice, ?array $config = null): string
    {
        if (!empty($invoice->irn)) {
            return ($invoice->irn_status === self::IRN_CANCELLED)
                ? self::IRN_CANCELLED
                : self::IRN_GENERATED;
        }
        if ($invoice->irn_status === self::IRN_FAILED) {
            return self::IRN_FAILED;
        }

        return $this->isIrnApplicable($invoice, $config) ? self::IRN_PENDING : self::IRN_NOT_APPLICABLE;
    }

    public function ewbStatus(Invoice $invoice, ?array $config = null): string
    {
        if (!empty($invoice->ewb_number)) {
            if ($invoice->ewb_status === self::EWB_CANCELLED) {
                return self::EWB_CANCELLED;
            }
            if ($invoice->ewb_valid_until && $invoice->ewb_valid_until->isPast()) {
                return self::EWB_EXPIRED;
            }

            return self::EWB_ACTIVE;
        }

        return $this->isEwbApplicable($invoice, $config) ? self::EWB_PENDING : self::EWB_NOT_APPLICABLE;
    }

    /**
     * Record an IRN generated on the government portal (manual driver).
     */
    public function recordIrn(Invoice $invoice, array $data, ?int $userId = null): Invoice
    {
        if (strtolower((string) $invoice->status) === 'cancelled') {
            $this->fail('Cannot record an IRN for a cancelled invoice.');
        }
        if (!empty($invoice->irn) && $invoice->irn_status !== self::IRN_CANCELLED) {
            $this->fail('An IRN is already recorded for this invoice.');
        }
        if (empty($data['force']) && !$this->isIrnApplicable($invoice)) {
            $this->fail('This invoice is not an applicable e-invoice document. Pass force=true to record a reference anyway.');
        }

        $irn = strtoupper(trim((string) ($data['irn'] ?? '')));
        if (!preg_match('/^[0-9A-F]{64}$/', $irn)) {
            $this->fail('IRN must be a 64-character hexadecimal value copied from the IRP portal.', 'irn');
        }

        $ackNo = trim((string) ($data['ack_no'] ?? ''));
        if (!preg_match('/^[0-9]{1,20}$/', $ackNo)) {
            $this->fail('Acknowledgement number must contain digits only.', 'ack_no');
        }

        $ackDateRaw = $data['ack_date'] ?? null;
        if (empty($ackDateRaw)) {
            $this->fail('Acknowledgement date is required.', 'ack_date');
        }
        try {
            $ackDate = Carbon::parse($ackDateRaw);
        } catch (\Throwable $e) {
            $this->fail('Acknowledgement date is not a valid date.', 'ack_date');
        }
        if ($ackDate->isAfter(Carbon::now()->addMinutes(10))) {
            $this->fail('Acknowledgement date cannot be in the future.', 'ack_date');
        }

        $qr = isset($data['qr']) ? trim((string) $data['qr']) : null;
        if ($qr !== null && strlen($qr) > 20000) {
            $this->fail('Signed QR payload is too large.', 'qr');
        }

        return DB::transaction(function () use ($invoice, $irn, $ackNo, $ackDate, $qr, $userId) {
            $invoice->forceFill([
                'irn' => $irn,
                'irn_ack_no' => $ackNo,
                'irn_ack_date' => $ackDate,
                'irn_qr' => $qr ?: null,
                'irn_status' => self::IRN_GENERATED,
                'irn_cancelled_at' => null,
                'irn_cancel_reason' => null,
                'irn_error' => null,
            ])->save();

            $this->logEvent($invoice->store_id, 'invoice', (string) $invoice->id, 'irn_recorded', self::IRN_GENERATED, [
                'invoice_number' => $invoice->invoice_number,
                'irn' => $irn,
                'ack_no' => $ackNo,
                'ack_date' => $ackDate->toIso8601String(),
            ], null, $userId);

            return $invoice->refresh();
        });
    }

    public function cancelIrn(Invoice $invoice, string $reason, ?int $userId = null): Invoice
    {
        if (empty($invoice->irn) || $invoice->irn_status === self::IRN_CANCELLED) {
            $this->fail('This invoice has no active IRN to cancel.');
        }
        $reason = trim($reason);
        if (strlen($reason) < 3) {
            $this->fail('A cancellation reason of at least 3 characters is required.', 'reason');
        }

        $windowStart = $invoice->irn_ack_date ?? $invoice->updated_at ?? Carbon::now();
        if ($windowStart->copy()->addHours(self::IRN_CANCEL_WINDOW_HOURS)->isPast()) {
            $this->fail('The 24-hour IRN cancellation window has closed.');
        }

        if (!empty($invoice->ewb_number) && $invoice->ewb_status !== self::EWB_CANCELLED) {
            $this->fail('Cancel the linked e-way bill before cancelling the IRN.');
        }

        return DB::transaction(function () use ($invoice, $reason, $userId) {
            $invoice->forceFill([
                'irn_status' => self::IRN_CANCELLED,
                'irn_cancelled_at' => Carbon::now(),
                'irn_cancel_reason' => $reason,
            ])->save();

            $this->logEvent($invoice->store_id, 'invoice', (string) $invoice->id, 'irn_cancelled', self::IRN_CANCELLED, [
                'invoice_number' => $invoice->invoice_number,
                'irn' => $invoice->irn,
                'reason' => $reason,
            ], $reason, $userId);

            return $invoice->refresh();
        });
    }

    public function recordEwb(Invoice $invoice, array $data, ?int $userId = null): Invoice
    {
        if (strtolower((string) $invoice->status) === 'cancelled') {
            $this->fail('Cannot record an e-way bill for a cancelled invoice.');
        }
        if (!empty($invoice->ewb_number) && $invoice->ewb_status !== self::EWB_CANCELLED) {
            $this->fail('This invoice already has an active e-way bill.');
        }
        if (empty($data['force']) && !$this->isEwbApplicable($invoice)) {
            $this->fail('This invoice is below the e-way bill threshold or e-way bills are disabled. Pass force=true to record one anyway.');
        }

        $number = preg_replace('/\s+/', '', (string) ($data['ewb_number'] ?? '')) ?? '';
        if (!preg_match('/^[0-9]{12}$/', $number)) {
            $this->fail('E-way bill number must be exactly 12 digits.', 'ewb_number');
        }

        $ewbDateRaw = $data['ewb_date'] ?? Carbon::today()->toDateString();
        try {
            $ewbDate = Carbon::parse($ewbDateRaw)->startOfDay();
        } catch (\Throwable $e) {
            $this->fail('E-way bill date is not a valid date.', 'ewb_date');
        }

        $partA = $this->normalizePartA($invoice, $data);
        $partB = $this->normalizePartB($data);

        return DB::transaction(function () use ($invoice, $number, $ewbDate, $partA, $partB, $data, $userId) {
            $validUntil = isset($data['valid_until'])
                ? Carbon::parse($data['valid_until'])
                : $this->computeValidity($ewbDate, (float) $partA['distance_km']);

            $invoice->forceFill([
                'ewb_number' => $number,
                'ewb_date' => $ewbDate,
                'ewb_valid_until' => $validUntil,
                'ewb_status' => $validUntil->isPast() ? self::EWB_EXPIRED : self::EWB_ACTIVE,
                'ewb_part_a' => $partA,
                'ewb_part_b' => $partB,
            ])->save();

            $this->logEvent($invoice->store_id, 'invoice', (string) $invoice->id, 'ewb_created', self::EWB_ACTIVE, [
                'invoice_number' => $invoice->invoice_number,
                'ewb_number' => $number,
                'ewb_date' => $ewbDate->toDateString(),
                'valid_until' => $validUntil->toIso8601String(),
                'part_a' => $partA,
                'part_b' => $partB,
            ], null, $userId);

            return $invoice->refresh();
        });
    }

    /**
     * Update Part-B details (vehicle/transporter) of an active e-way bill.
     */
    public function updateEwb(Invoice $invoice, array $data, ?int $userId = null): Invoice
    {
        if (empty($invoice->ewb_number) || $invoice->ewb_status === self::EWB_CANCELLED) {
            $this->fail('This invoice has no active e-way bill to update.');
        }
        if ($invoice->ewb_valid_until && $invoice->ewb_valid_until->isPast()) {
            $this->fail('The e-way bill has expired and can no longer be updated.');
        }

        $partB = $this->normalizePartB($data, is_array($invoice->ewb_part_b) ? $invoice->ewb_part_b : []);
        $partA = is_array($invoice->ewb_part_a) ? $invoice->ewb_part_a : [];

        return DB::transaction(function () use ($invoice, $partA, $partB, $userId) {
            $invoice->forceFill([
                'ewb_part_b' => $partB,
                'ewb_status' => self::EWB_ACTIVE,
            ])->save();

            $this->logEvent($invoice->store_id, 'invoice', (string) $invoice->id, 'ewb_updated', self::EWB_ACTIVE, [
                'invoice_number' => $invoice->invoice_number,
                'ewb_number' => $invoice->ewb_number,
                'part_a' => $partA,
                'part_b' => $partB,
            ], null, $userId);

            return $invoice->refresh();
        });
    }

    public function cancelEwb(Invoice $invoice, string $reason, ?int $userId = null): Invoice
    {
        if (empty($invoice->ewb_number) || $invoice->ewb_status === self::EWB_CANCELLED) {
            $this->fail('This invoice has no active e-way bill to cancel.');
        }
        $reason = trim($reason);
        if (strlen($reason) < 3) {
            $this->fail('A cancellation reason of at least 3 characters is required.', 'reason');
        }

        return DB::transaction(function () use ($invoice, $reason, $userId) {
            $invoice->forceFill([
                'ewb_status' => self::EWB_CANCELLED,
            ])->save();

            $this->logEvent($invoice->store_id, 'invoice', (string) $invoice->id, 'ewb_cancelled', self::EWB_CANCELLED, [
                'invoice_number' => $invoice->invoice_number,
                'ewb_number' => $invoice->ewb_number,
                'reason' => $reason,
            ], $reason, $userId);

            return $invoice->refresh();
        });
    }

    /**
     * Invoices that still need an IRN/e-way bill, shaped for offline portal entry.
     */
    public function exportPending(?int $storeId, array $filters = []): array
    {
        $query = Invoice::query()->orderBy('invoice_date')->orderBy('id');
        if ($storeId !== null) {
            $query->where('store_id', $storeId);
        }
        if (!empty($filters['from'])) {
            $query->where('invoice_date', '>=', $filters['from']);
        }
        if (!empty($filters['to'])) {
            $query->where('invoice_date', '<=', $filters['to']);
        }
        $query->where('status', '!=', 'cancelled')
            ->whereNotNull('customer_gstin')
            ->where('customer_gstin', '!=', '');

        $rows = [];
        foreach ($query->limit(5000)->get() as $invoice) {
            $config = $this->configFor((int) $invoice->store_id);
            $irnStatus = $this->irnStatus($invoice, $config);
            $ewbStatus = $this->ewbStatus($invoice, $config);
            if ($irnStatus !== self::IRN_PENDING && $ewbStatus !== self::EWB_PENDING) {
                continue;
            }
            $store = $invoice->store;
            $rows[] = [
                'invoice_number' => $invoice->invoice_number,
                'external_id' => $invoice->external_id,
                'invoice_date' => optional($invoice->invoice_date)->toDateString(),
                'customer_name' => $invoice->customer_name,
                'customer_gstin' => $this->normalizeGstin($invoice->customer_gstin),
                'place_of_supply' => $invoice->place_of_supply,
                'taxable_subtotal' => (float) $invoice->taxable_subtotal,
                'cgst_total' => (float) $invoice->cgst_total,
                'sgst_total' => (float) $invoice->sgst_total,
                'igst_total' => (float) $invoice->igst_total,
                'cess_total' => (float) $invoice->cess_total,
                'grand_total' => (float) $invoice->grand_total,
                'store_gstin' => $store?->gstin,
                'store_state_code' => $invoice->store_state_code,
                'irn_status' => $irnStatus,
                'ewb_status' => $ewbStatus,
            ];
        }

        return [
            'generated_at' => Carbon::now()->toIso8601String(),
            'store_id' => $storeId,
            'count' => count($rows),
            'invoices' => $rows,
        ];
    }

    /**
     * Apply IRN/e-way values captured from the government portal (also used
     * for historic backfill). Never aborts the whole batch on a bad row.
     */
    public function importRows(array $rows, ?int $storeId, ?int $userId = null): array
    {
        $results = [];
        $applied = 0;
        $failed = 0;

        foreach ($rows as $index => $row) {
            if (!is_array($row)) {
                $failed++;
                $results[] = ['row' => $index + 1, 'ok' => false, 'error' => 'Row must be an object.'];
                continue;
            }

            $invoiceNumber = trim((string) ($row['invoice_number'] ?? ''));
            $externalId = trim((string) ($row['external_id'] ?? ''));
            $query = Invoice::query();
            if ($storeId !== null) {
                $query->where('store_id', $storeId);
            }
            $invoice = $invoiceNumber !== ''
                ? $query->where('invoice_number', $invoiceNumber)->first()
                : ($externalId !== '' ? $query->where('external_id', $externalId)->first() : null);

            if (!$invoice) {
                $failed++;
                $results[] = [
                    'row' => $index + 1,
                    'invoice_number' => $invoiceNumber,
                    'ok' => false,
                    'error' => 'Invoice not found for the active store scope.',
                ];
                continue;
            }

            try {
                DB::transaction(function () use ($invoice, $row, $userId) {
                    if (!empty($row['irn'])) {
                        $this->recordIrn($invoice, [
                            'irn' => $row['irn'],
                            'ack_no' => $row['ack_no'] ?? null,
                            'ack_date' => $row['ack_date'] ?? null,
                            'qr' => $row['qr'] ?? $row['signed_qr'] ?? null,
                            'force' => (bool) ($row['force'] ?? false),
                        ], $userId);
                    }
                    $fresh = $invoice->refresh();
                    if (!empty($row['ewb_number'])) {
                        $this->recordEwb($fresh, [
                            'ewb_number' => $row['ewb_number'],
                            'ewb_date' => $row['ewb_date'] ?? null,
                            'valid_until' => $row['valid_until'] ?? null,
                            'transporter_name' => $row['transporter_name'] ?? null,
                            'transporter_id' => $row['transporter_id'] ?? null,
                            'transport_mode' => $row['transport_mode'] ?? 'road',
                            'vehicle_number' => $row['vehicle_number'] ?? null,
                            'distance_km' => $row['distance_km'] ?? null,
                            'transport_doc_no' => $row['transport_doc_no'] ?? null,
                            'transport_doc_date' => $row['transport_doc_date'] ?? null,
                            'force' => (bool) ($row['force'] ?? false),
                        ], $userId);
                    }
                });
                $applied++;
                $results[] = [
                    'row' => $index + 1,
                    'invoice_number' => $invoice->invoice_number,
                    'ok' => true,
                ];
            } catch (\Throwable $e) {
                $failed++;
                $message = $e->getMessage();
                if ($e instanceof ValidationException) {
                    $first = collect($e->errors())->flatten()->first();
                    $message = $first ?: $message;
                }
                $results[] = [
                    'row' => $index + 1,
                    'invoice_number' => $invoice->invoice_number,
                    'ok' => false,
                    'error' => $message,
                ];
            }
        }

        if ($storeId !== null) {
            $this->logEvent($storeId, 'batch', 'import', 'compliance_import', null, [
                'applied' => $applied,
                'failed' => $failed,
                'rows' => count($rows),
            ], null, $userId);
        }

        return [
            'applied' => $applied,
            'failed' => $failed,
            'results' => $results,
        ];
    }

    public function summary(?int $storeId): array
    {
        $storeIds = $storeId !== null
            ? [$storeId]
            : Store::pluck('id')->map(fn ($id) => (int) $id)->all();

        $totals = [
            'applicable_b2b' => 0,
            'irn_pending' => 0,
            'irn_generated' => 0,
            'irn_cancelled' => 0,
            'ewb_pending' => 0,
            'ewb_active' => 0,
            'ewb_expired' => 0,
            'ewb_cancelled' => 0,
        ];

        foreach ($storeIds as $id) {
            $config = $this->configFor($id);
            if (empty($config['enabled'])) {
                continue;
            }
            $base = Invoice::where('store_id', $id)
                ->where('status', '!=', 'cancelled')
                ->whereNotNull('customer_gstin')
                ->where('customer_gstin', '!=', '');

            if (!empty($config['irn']['enabled'])) {
                $totals['applicable_b2b'] += (clone $base)->count();
                $totals['irn_pending'] += (clone $base)->whereNull('irn')->count();
                $totals['irn_generated'] += (clone $base)
                    ->whereNotNull('irn')
                    ->where(function ($q) {
                        $q->whereNull('irn_status')->orWhere('irn_status', '!=', self::IRN_CANCELLED);
                    })->count();
                $totals['irn_cancelled'] += (clone $base)->where('irn_status', self::IRN_CANCELLED)->count();
            }

            if (!empty($config['eway']['enabled'])) {
                $totals['ewb_pending'] += (clone $base)
                    ->whereNull('ewb_number')
                    ->where('grand_total', '>=', (float) ($config['eway']['threshold_amount'] ?? 50000))
                    ->count();
                $totals['ewb_active'] += (clone $base)
                    ->whereNotNull('ewb_number')
                    ->where(function ($q) {
                        $q->whereNull('ewb_status')->orWhere('ewb_status', '!=', self::EWB_CANCELLED);
                    })
                    ->where('ewb_valid_until', '>=', Carbon::now())
                    ->count();
                $totals['ewb_expired'] += (clone $base)
                    ->whereNotNull('ewb_number')
                    ->where(function ($q) {
                        $q->whereNull('ewb_status')->orWhere('ewb_status', '!=', self::EWB_CANCELLED);
                    })
                    ->where('ewb_valid_until', '<', Carbon::now())
                    ->count();
                $totals['ewb_cancelled'] += (clone $base)->where('ewb_status', self::EWB_CANCELLED)->count();
            }
        }

        return $totals;
    }

    /**
     * Recent compliance audit trail for the dashboard.
     */
    public function recentEvents(?int $storeId, int $limit = 20): array
    {
        $query = ComplianceEvent::query()->orderByDesc('id')->limit(min(100, max(1, $limit)));
        if ($storeId !== null) {
            $query->where('store_id', $storeId);
        }

        return $query->get()->map(function (ComplianceEvent $event) {
            return [
                'id' => $event->id,
                'store_id' => $event->store_id,
                'entity_type' => $event->entity_type,
                'entity_id' => $event->entity_id,
                'event' => $event->event,
                'status' => $event->status,
                'message' => $event->message,
                'payload' => $event->payload,
                'created_by' => $event->created_by,
                'created_at' => optional($event->created_at)->toIso8601String(),
            ];
        })->all();
    }

    public function logEvent(
        ?int $storeId,
        string $entityType,
        string $entityId,
        string $event,
        ?string $status,
        ?array $payload,
        ?string $message,
        ?int $userId
    ): void {
        ComplianceEvent::create([
            'store_id' => $storeId,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'event' => $event,
            'status' => $status,
            'payload' => $payload,
            'message' => $message,
            'created_by' => $userId,
        ]);
    }

    private function normalizePartA(Invoice $invoice, array $data): array
    {
        $mode = strtolower(trim((string) ($data['transport_mode'] ?? 'road')));
        if (!in_array($mode, ['road', 'rail', 'air', 'ship'], true)) {
            $this->fail('Transport mode must be one of road, rail, air or ship.', 'transport_mode');
        }

        $distance = $data['distance_km'] ?? ($this->configFor((int) $invoice->store_id)['eway']['default_distance_km'] ?? 10);
        $distance = (float) $distance;
        if ($distance <= 0) {
            $this->fail('Distance must be greater than zero.', 'distance_km');
        }

        return [
            'transporter_name' => $this->nullableString($data['transporter_name'] ?? null, 150),
            'transporter_id' => $this->nullableString($data['transporter_id'] ?? null, 20),
            'transport_mode' => $mode,
            'distance_km' => round($distance, 2),
            'document_number' => $invoice->invoice_number,
            'document_date' => optional($invoice->invoice_date)->toDateString(),
        ];
    }

    private function normalizePartB(array $data, array $existing = []): array
    {
        $parts = [];
        foreach (['vehicle_number', 'transport_doc_no', 'transport_doc_date'] as $field) {
            if (array_key_exists($field, $data) && $data[$field] !== null && $data[$field] !== '') {
                $parts[$field] = trim((string) $data[$field]);
            } elseif (isset($existing[$field])) {
                $parts[$field] = $existing[$field];
            }
        }

        if (isset($parts['vehicle_number'])) {
            $parts['vehicle_number'] = strtoupper(preg_replace('/[\s\-]+/', '', $parts['vehicle_number']) ?? '');
            if (!preg_match('/^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/', $parts['vehicle_number'])) {
                $this->fail('Vehicle number does not look like a valid Indian registration number.', 'vehicle_number');
            }
        }

        return $parts;
    }

    private function computeValidity(Carbon $ewbDate, float $distanceKm): Carbon
    {
        $days = max(1, (int) ceil($distanceKm / 200));

        return $ewbDate->copy()->endOfDay()->addDays($days - 1);
    }

    private function nullableString($value, int $max): ?string
    {
        $value = trim((string) ($value ?? ''));

        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    private function mergeRecursive(array $base, array $override): array
    {
        foreach ($override as $key => $value) {
            if (is_array($value) && isset($base[$key]) && is_array($base[$key])) {
                $base[$key] = $this->mergeRecursive($base[$key], $value);
            } else {
                $base[$key] = $value;
            }
        }

        return $base;
    }

    private function fail(string $message, string $field = 'compliance'): void
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
