<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\CounterProfileException;
use App\Models\Device;
use App\Models\Invoice;
use App\Support\Counter\CounterProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * SYNC-02 / CR Q1 — offline bills from a workstation the owner retired while it
 * was dark. They were sold before the owner acted, so the store keeps them; the
 * owner is told, because the device that wrote them is no longer trusted.
 *
 * Only new documents saved before the revocation get through. They are filed
 * through the ordinary batch ingest, so numbering, stock, tax and idempotency
 * are exactly what a live till gets, and each one is flagged in the counter's
 * exceptions register for review.
 */
class StrandedSyncController extends Controller
{
    /** What a till creates while offline; masters, settings and edits are refused. */
    public const DOCUMENT_TYPES = ['invoice', 'purchase', 'payment', 'expense'];

    public const VIOLATION_CODE = 'filed_by_retired_device';

    public function push(Request $request, SyncController $sync): JsonResponse
    {
        /** @var Device $device */
        $device = $request->attributes->get('retired_device');
        $revokedAtMs = $device->revoked_at->getTimestampMs();

        $items = array_values(array_filter((array) $request->input('items', []), 'is_array'));
        $accepted = [];
        $refused = [];

        foreach ($items as $item) {
            $reason = $this->refusal($item, $revokedAtMs);
            if ($reason === null) {
                $accepted[] = $item;
            } else {
                $refused[] = [
                    'id' => $item['id'] ?? null,
                    'entity_type' => $item['entity_type'] ?? null,
                    'error' => $reason,
                ];
            }
        }

        $results = ['processed' => 0, 'failed' => 0, 'processed_ids' => [], 'errors' => []];
        $renumbered = [];

        if ($accepted !== []) {
            $request->merge(['items' => $accepted]);
            $response = $sync->pushBatch($request);

            if ($response->getStatusCode() >= 400) {
                return $response;
            }

            $body = $response->getData(true);
            $results = array_merge($results, $body['results'] ?? []);
            $renumbered = $body['renumbered'] ?? [];
        }

        $filed = $this->flagFiledDocuments($device, $accepted, (array) ($results['processed_ids'] ?? []));

        AuditLog::log(
            'stranded_documents_filed',
            'Device',
            (string) $device->id,
            null,
            [
                'device_uuid' => $device->device_uuid,
                'counter_id' => $device->counter_id,
                'revoked_at' => $device->revoked_at->toIso8601String(),
                'filed' => $filed,
                'refused' => count($refused),
            ],
            $device->store_id
        );

        $failed = (int) ($results['failed'] ?? 0) + count($refused);

        return response()->json([
            'success' => $failed === 0,
            'results' => [
                'total' => count($items),
                'processed' => (int) ($results['processed'] ?? 0),
                'failed' => $failed,
                'processed_ids' => array_values((array) ($results['processed_ids'] ?? [])),
                'errors' => array_merge((array) ($results['errors'] ?? []), $refused),
            ],
            'renumbered' => $renumbered,
        ]);
    }

    /** Why this item may not come through the door, or null when it may. */
    private function refusal(array $item, int $revokedAtMs): ?string
    {
        $type = (string) ($item['entity_type'] ?? '');
        $action = (string) ($item['action'] ?? 'create');

        if (!in_array($type, self::DOCUMENT_TYPES, true) || $action !== 'create') {
            return 'A retired workstation may only send new bills and documents it saved offline.';
        }

        $payload = $item['payload'] ?? [];
        if (is_string($payload)) {
            $payload = json_decode($payload, true) ?: [];
        }

        $savedAt = $payload['client_timestamp'] ?? null;
        if (!is_numeric($savedAt) || (int) $savedAt <= 0) {
            return 'This document carries no save time, so it cannot be shown to predate the retirement.';
        }

        if ((int) $savedAt > $revokedAtMs) {
            return 'Saved after this workstation was retired by the store owner.';
        }

        return null;
    }

    /** @return int how many documents were flagged */
    private function flagFiledDocuments(Device $device, array $accepted, array $processedIds): int
    {
        $counter = $device->counter_id ? Counter::find($device->counter_id) : null;
        if (!$counter) {
            return 0;
        }

        $taken = array_map('strval', $processedIds);
        $flagged = 0;

        foreach ($accepted as $item) {
            if (!in_array((string) ($item['id'] ?? ''), $taken, true)) {
                continue;
            }

            $payload = is_string($item['payload'] ?? null)
                ? (json_decode($item['payload'], true) ?: [])
                : (array) ($item['payload'] ?? []);
            $type = (string) $item['entity_type'];
            $externalId = $payload['external_id'] ?? $payload['id'] ?? $payload['idempotency_key'] ?? null;

            [$documentId, $reference] = $this->documentIdentity($counter, $type, $payload, $externalId);

            $this->fileException($counter, $device, $type, $documentId, $reference, $payload);
            $flagged++;
        }

        return $flagged;
    }

    /** @return array{0:?string,1:?string} */
    private function documentIdentity(Counter $counter, string $type, array $payload, mixed $externalId): array
    {
        if ($type === 'invoice' && $externalId) {
            $invoice = Invoice::where('store_id', $counter->store_id)
                ->where('external_id', (string) $externalId)
                ->first();
            if ($invoice) {
                return [(string) $invoice->id, (string) $invoice->invoice_number];
            }
        }

        $reference = $payload['invoice_number'] ?? $payload['bill_no'] ?? $payload['reference_no'] ?? $externalId;

        return [$externalId !== null ? (string) $externalId : null, $reference !== null ? (string) $reference : null];
    }

    private function fileException(
        Counter $counter,
        Device $device,
        string $type,
        ?string $documentId,
        ?string $reference,
        array $payload
    ): void {
        $row = CounterProfileException::where('counter_id', $counter->id)
            ->where('document_type', $type)
            ->where('document_id', $documentId)
            ->latest('id')
            ->first();

        $violations = (array) ($row?->violations ?? []);
        if (in_array(self::VIOLATION_CODE, array_column($violations, 'code'), true)) {
            return;
        }

        $violations[] = [
            'action' => 'sync.stranded',
            'control' => null,
            'code' => self::VIOLATION_CODE,
            'message' => sprintf(
                'Sent by a workstation the owner retired on %s. Saved offline before that; check it before relying on it.',
                $device->revoked_at->toDayDateTimeString()
            ),
            'needs_grant' => false,
            'inferred' => false,
        ];

        $row = $row ?? new CounterProfileException([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'document_type' => $type,
            'document_id' => $documentId,
        ]);

        $stamped = $payload['permission_profile_version'] ?? null;

        $row->fill([
            'document_reference' => $reference ?? $row->document_reference,
            'profile_version' => is_numeric($stamped) ? (int) $stamped : $row->profile_version,
            'profile_version_at_review' => (int) ($counter->permission_profile_version ?? CounterProfile::VERSION),
            'violations' => $violations,
            'status' => CounterProfileException::STATUS_OPEN,
            'detected_at' => now(),
        ]);
        $row->save();
    }
}
