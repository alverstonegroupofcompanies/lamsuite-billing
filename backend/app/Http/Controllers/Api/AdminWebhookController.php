<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Store;
use App\Models\WebhookOutbox;
use App\Services\Webhook\WebhookOutboxService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AdminWebhookController
{
    public function __construct(private readonly WebhookOutboxService $outbox)
    {
    }

    public function resolveStore(Request $request): ?Store
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->header('Store-Id')
            ?? $request->input('store_id')
            ?? $request->query('store_id')
            ?? ($request->user() ? $request->user()->store_id : null);

        if ($candidate !== null && $candidate !== '') {
            if ($candidate === 'all') {
                return null;
            }
            return Store::find((int) $candidate);
        }

        return Store::query()->orderBy('id')->first();
    }

    /**
     * Delivery log + summary counts for the active store.
     */
    public function index(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        $storeId = $store?->id;

        $query = WebhookOutbox::query()
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->when($request->query('event'), fn ($q, $event) => $q->where('event', $event))
            ->orderByDesc('id');

        $rows = $query->limit(min(200, max(1, (int) $request->query('limit', 50))))->get();

        $summary = WebhookOutbox::query()
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->selectRaw("status, COUNT(*) as total")
            ->groupBy('status')
            ->pluck('total', 'status');

        return response()->json([
            'enabled' => $storeId ? $this->outbox->configFor($storeId) !== null : false,
            'summary' => [
                'pending' => (int) ($summary[WebhookOutbox::STATUS_PENDING] ?? 0),
                'delivered' => (int) ($summary[WebhookOutbox::STATUS_DELIVERED] ?? 0),
                'failed' => (int) ($summary[WebhookOutbox::STATUS_FAILED] ?? 0),
            ],
            'deliveries' => $rows->map(fn (WebhookOutbox $row) => $this->present($row))->values(),
        ]);
    }

    /**
     * Requeue a failed/pending delivery and attempt it immediately.
     */
    public function retry(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $row = WebhookOutbox::when($store, fn ($q) => $q->where('store_id', $store->id))->find($id);

        if (!$row) {
            return response()->json(['success' => false, 'error' => 'Delivery not found for this store.'], 404);
        }

        $row->forceFill([
            'status' => WebhookOutbox::STATUS_PENDING,
            'attempts' => 0,
            'next_attempt_at' => Carbon::now(),
            'last_error' => null,
        ])->save();

        $this->outbox->send($row);
        $row->refresh();

        AuditLog::log('webhook_retry', 'WebhookOutbox', (string) $row->id, null, ['event' => $row->event], $row->store_id);

        return response()->json(['success' => true, 'delivery' => $this->present($row)]);
    }

    /**
     * Send a signed test event to the configured endpoint.
     */
    public function test(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $result = $this->outbox->sendTest($store->id);
        AuditLog::log('webhook_test', 'WebhookOutbox', (string) ($result['outbox_id'] ?? ''), null, ['success' => $result['success']], $store->id);

        return response()->json($result, $result['success'] ? 200 : 422);
    }

    private function present(WebhookOutbox $row): array
    {
        return [
            'id' => $row->id,
            'event' => $row->event,
            'object_type' => $row->object_type,
            'object_id' => $row->object_id,
            'status' => $row->status,
            'attempts' => $row->attempts,
            'response_status' => $row->response_status,
            'last_error' => $row->last_error,
            'next_attempt_at' => $row->next_attempt_at?->toIso8601String(),
            'delivered_at' => $row->delivered_at?->toIso8601String(),
            'created_at' => $row->created_at?->toIso8601String(),
        ];
    }
}
