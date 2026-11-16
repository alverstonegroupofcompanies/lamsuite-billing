<?php

namespace App\Services\Webhook;

use App\Models\CompanySetting;
use App\Models\WebhookOutbox;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Durable, signed webhook delivery.
 *
 * Every event is persisted to the webhook_outbox table first, then delivered
 * synchronously (best effort) and retried with exponential backoff by the
 * webhooks:dispatch command. Receivers verify the HMAC-SHA256 signature of
 * "{timestamp}.{raw_body}" using the per-store webhook secret.
 */
class WebhookOutboxService
{
    public const MAX_ATTEMPTS = 5;

    /** Minutes to wait before the next attempt, indexed by attempt number. */
    private const BACKOFF_MINUTES = [1 => 1, 2 => 5, 3 => 15, 4 => 60, 5 => 360];

    public const DEFAULT_EVENTS = [
        'invoice.created',
        'invoice.cancelled',
        'payment.received',
        'purchase.created',
    ];

    /**
     * Persist an event and attempt immediate delivery.
     * Returns null when webhooks are disabled/not configured for the store.
     */
    public function enqueue(
        string $event,
        array $data,
        ?int $storeId,
        ?string $objectType = null,
        ?string $objectId = null,
        bool $deliverNow = true
    ): ?WebhookOutbox {
        try {
            $config = $this->configFor($storeId);
            if ($config === null || !$this->eventEnabled($config, $event)) {
                return null;
            }

            $outbox = WebhookOutbox::create([
                'store_id' => $storeId,
                'event' => $event,
                'object_type' => $objectType,
                'object_id' => $objectId,
                'payload' => $data,
                'status' => WebhookOutbox::STATUS_PENDING,
                'attempts' => 0,
                'next_attempt_at' => Carbon::now(),
            ]);

            if ($deliverNow) {
                try {
                    $this->send($outbox);
                } catch (\Throwable $e) {
                    Log::warning('[Webhook] Immediate delivery failed', [
                        'outbox_id' => $outbox->id,
                        'event' => $event,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            return $outbox->refresh();
        } catch (\Throwable $e) {
            // Webhooks must never break the billing operation that raised them.
            Log::warning('[Webhook] Failed to enqueue event', [
                'event' => $event,
                'store_id' => $storeId,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Deliver one outbox row. Successful sends mark it delivered; failures are
     * rescheduled with exponential backoff until MAX_ATTEMPTS is exhausted.
     */
    public function send(WebhookOutbox $outbox): bool
    {
        $config = $this->configFor($outbox->store_id);
        if ($config === null) {
            $outbox->forceFill([
                'status' => WebhookOutbox::STATUS_FAILED,
                'last_error' => 'Webhook endpoint is not configured',
            ])->save();
            return false;
        }

        $deliveryId = (string) Str::uuid();
        $timestamp = time();
        $body = json_encode([
            'id' => $deliveryId,
            'event' => $outbox->event,
            'store_id' => $outbox->store_id,
            'object_type' => $outbox->object_type,
            'object_id' => $outbox->object_id,
            'occurred_at' => $outbox->created_at?->toIso8601String() ?? Carbon::now()->toIso8601String(),
            'data' => $outbox->payload ?? [],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $signature = hash_hmac('sha256', $timestamp . '.' . $body, (string) $config['secret']);
        $attempts = $outbox->attempts + 1;

        try {
            $response = Http::timeout((int) ($config['timeout'] ?? 10))
                ->connectTimeout(3)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'User-Agent' => 'LamSuite-Webhooks/1.0',
                    'X-LamSuite-Event' => $outbox->event,
                    'X-LamSuite-Delivery' => $deliveryId,
                    'X-LamSuite-Timestamp' => (string) $timestamp,
                    'X-LamSuite-Signature' => 'sha256=' . $signature,
                ])
                ->withBody($body, 'application/json')
                ->post((string) $config['url']);

            if ($response->successful()) {
                $outbox->forceFill([
                    'status' => WebhookOutbox::STATUS_DELIVERED,
                    'attempts' => $attempts,
                    'delivered_at' => Carbon::now(),
                    'next_attempt_at' => null,
                    'response_status' => $response->status(),
                    'last_error' => null,
                ])->save();
                return true;
            }

            $this->scheduleRetry($outbox, $attempts, 'HTTP ' . $response->status() . ': ' . Str::limit($response->body(), 500), $response->status());
            return false;
        } catch (\Throwable $e) {
            $this->scheduleRetry($outbox, $attempts, Str::limit($e->getMessage(), 500), null);
            return false;
        }
    }

    /**
     * Deliver all due pending events. Returns counts for logging/CLI output.
     */
    public function dispatchPending(int $limit = 50): array
    {
        $rows = WebhookOutbox::query()
            ->where('status', WebhookOutbox::STATUS_PENDING)
            ->where(function ($q) {
                $q->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', Carbon::now());
            })
            ->orderBy('id')
            ->limit($limit)
            ->get();

        $delivered = 0;
        $failed = 0;

        foreach ($rows as $row) {
            $this->send($row) ? $delivered++ : $failed++;
        }

        return ['processed' => $rows->count(), 'delivered' => $delivered, 'failed' => $failed];
    }

    /**
     * Send a signed ping event so operators can verify connectivity and signatures.
     */
    public function sendTest(?int $storeId): array
    {
        $config = $this->configFor($storeId);
        if ($config === null) {
            return ['success' => false, 'message' => 'Webhook endpoint is not configured or disabled.'];
        }

        $outbox = WebhookOutbox::create([
            'store_id' => $storeId,
            'event' => 'webhook.test',
            'object_type' => null,
            'object_id' => null,
            'payload' => ['message' => 'LamSuite webhook test delivery', 'sent_at' => Carbon::now()->toIso8601String()],
            'status' => WebhookOutbox::STATUS_PENDING,
            'attempts' => 0,
            'next_attempt_at' => Carbon::now(),
        ]);

        $ok = $this->send($outbox);
        $outbox->refresh();

        return [
            'success' => $ok,
            'outbox_id' => $outbox->id,
            'status' => $outbox->status,
            'response_status' => $outbox->response_status,
            'error' => $outbox->last_error,
        ];
    }

    public function configFor(?int $storeId): ?array
    {
        if (!$storeId) {
            return null;
        }

        $setting = CompanySetting::where('store_id', $storeId)->where('key', 'webhook')->first();
        $config = $setting?->value;
        if (!is_array($config)) {
            return null;
        }

        $url = trim((string) ($config['url'] ?? ''));
        $secret = (string) ($config['secret'] ?? '');
        if (empty($config['enabled']) || $url === '' || $secret === '') {
            return null;
        }

        // Guard against script schemes; only HTTP(S) endpoints are allowed.
        if (!preg_match('#^https?://#i', $url)) {
            return null;
        }

        return [
            'url' => $url,
            'secret' => $secret,
            'events' => is_array($config['events'] ?? null) ? array_values($config['events']) : [],
            'timeout' => max(2, min(30, (int) ($config['timeout'] ?? 10))),
        ];
    }

    private function eventEnabled(array $config, string $event): bool
    {
        $events = $config['events'] ?? [];
        if (empty($events)) {
            return true;
        }
        return in_array($event, $events, true) || in_array('*', $events, true);
    }

    private function scheduleRetry(WebhookOutbox $outbox, int $attempts, string $error, ?int $status): void
    {
        $exhausted = $attempts >= self::MAX_ATTEMPTS;
        $delayMinutes = self::BACKOFF_MINUTES[min($attempts, self::MAX_ATTEMPTS)] ?? 360;

        $outbox->forceFill([
            'status' => $exhausted ? WebhookOutbox::STATUS_FAILED : WebhookOutbox::STATUS_PENDING,
            'attempts' => $attempts,
            'response_status' => $status,
            'last_error' => $error,
            'next_attempt_at' => $exhausted ? null : Carbon::now()->addMinutes($delayMinutes),
        ])->save();
    }
}
