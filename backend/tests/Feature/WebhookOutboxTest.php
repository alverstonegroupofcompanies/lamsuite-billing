<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Store;
use App\Models\User;
use App\Models\WebhookOutbox;
use App\Services\Webhook\WebhookOutboxService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class WebhookOutboxTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $adminUser;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'id' => 'store_main',
            'name' => 'Alverstone Pharmacy',
            'code' => 'ALV-01',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->adminUser = User::create([
            'name' => 'Admin User',
            'email' => 'admin@alverstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    private function configureWebhook(array $overrides = []): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'webhook',
            'value' => array_merge([
                'enabled' => true,
                'url' => 'https://hooks.example.test/lamsuite',
                'secret' => 'whsec_test_secret',
                'events' => WebhookOutboxService::DEFAULT_EVENTS,
                'timeout' => 5,
            ], $overrides),
            'is_secret' => true,
        ]);
    }

    public function test_enqueue_signs_and_delivers_event(): void
    {
        $this->configureWebhook();
        Http::fake(['*' => Http::response(['ok' => true], 200)]);

        $outbox = app(WebhookOutboxService::class)->enqueue(
            'invoice.created',
            ['invoice_number' => 'INV-2001', 'grand_total' => 499.5],
            (int) $this->store->id,
            'invoice',
            '42'
        );

        $this->assertNotNull($outbox);
        $this->assertSame(WebhookOutbox::STATUS_DELIVERED, $outbox->status);
        $this->assertSame(1, $outbox->attempts);

        Http::assertSent(function ($request) {
            $timestamp = $request->header('X-LamSuite-Timestamp')[0];
            $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $request->body(), 'whsec_test_secret');

            return $request->url() === 'https://hooks.example.test/lamsuite'
                && $request->header('X-LamSuite-Event')[0] === 'invoice.created'
                && $request->header('X-LamSuite-Signature')[0] === $expected
                && $request['event'] === 'invoice.created'
                && $request['object_id'] === '42'
                && $request['data']['invoice_number'] === 'INV-2001';
        });
    }

    public function test_disabled_webhook_does_not_enqueue(): void
    {
        $this->configureWebhook(['enabled' => false]);
        Http::fake();

        $outbox = app(WebhookOutboxService::class)->enqueue('invoice.created', [], (int) $this->store->id);

        $this->assertNull($outbox);
        $this->assertSame(0, WebhookOutbox::count());
        Http::assertNothingSent();
    }

    public function test_event_not_in_subscription_is_skipped(): void
    {
        $this->configureWebhook(['events' => ['invoice.created']]);
        Http::fake();

        $outbox = app(WebhookOutboxService::class)->enqueue('payment.received', [], (int) $this->store->id);

        $this->assertNull($outbox);
        $this->assertSame(0, WebhookOutbox::count());
    }

    public function test_failed_delivery_is_retried_with_backoff(): void
    {
        $this->configureWebhook();
        $calls = 0;
        Http::fake(function () use (&$calls) {
            $calls++;
            return $calls === 1
                ? Http::response('upstream error', 500)
                : Http::response(['ok' => true], 200);
        });

        $service = app(WebhookOutboxService::class);
        $outbox = $service->enqueue('invoice.created', ['invoice_number' => 'INV-2002'], (int) $this->store->id);

        $this->assertSame(WebhookOutbox::STATUS_PENDING, $outbox->status);
        $this->assertSame(1, $outbox->attempts);
        $this->assertNotNull($outbox->next_attempt_at);

        // Not yet due, so the dispatcher leaves it alone.
        $result = $service->dispatchPending();
        $this->assertSame(0, $result['processed']);

        $this->travel(2)->minutes();
        $result = $service->dispatchPending();
        $this->assertSame(1, $result['processed']);
        $this->assertSame(1, $result['delivered']);

        $outbox->refresh();
        $this->assertSame(WebhookOutbox::STATUS_DELIVERED, $outbox->status);
        $this->assertSame(2, $outbox->attempts);
    }

    public function test_webhook_secret_is_masked_and_preserved_on_save(): void
    {
        $this->configureWebhook(['secret' => 'real_secret_value']);

        $payload = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson('/api/admin/settings?active_store_id=' . $this->store->id)
            ->assertStatus(200)
            ->json();

        $this->assertSame('••••••••••••', $payload['webhook']['secret']);
        $this->assertTrue($payload['webhook']['has_secret']);
        $this->assertTrue($payload['webhook']['enabled']);

        // Saving back the masked value must keep the stored secret intact.
        $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/settings', [
                'active_store_id' => $this->store->id,
                'webhook' => [
                    'enabled' => true,
                    'url' => 'https://hooks.example.test/updated',
                    'secret' => '••••••••••••',
                    'events' => ['invoice.created', 'invoice.cancelled'],
                    'timeout' => 8,
                ],
            ])
            ->assertStatus(200)
            ->assertJson(['success' => true]);

        $saved = CompanySetting::where('store_id', $this->store->id)->where('key', 'webhook')->first();
        $this->assertSame('real_secret_value', $saved->value['secret']);
        $this->assertSame('https://hooks.example.test/updated', $saved->value['url']);
        $this->assertSame(8, $saved->value['timeout']);
    }

    public function test_rotate_webhook_secret_writes_new_value(): void
    {
        $this->configureWebhook(['secret' => 'old_secret']);

        $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/settings/rotate-secret', [
                'active_store_id' => $this->store->id,
                'secret_type' => 'webhook_secret',
                'new_value' => 'new_webhook_secret_123',
            ])
            ->assertStatus(200)
            ->assertJson(['success' => true]);

        $saved = CompanySetting::where('store_id', $this->store->id)->where('key', 'webhook')->first();
        $this->assertSame('new_webhook_secret_123', $saved->value['secret']);
    }

    public function test_admin_can_list_and_retry_deliveries(): void
    {
        $this->configureWebhook();
        $calls = 0;
        Http::fake(function () use (&$calls) {
            $calls++;
            return $calls === 1
                ? Http::response('bad gateway', 502)
                : Http::response(['ok' => true], 200);
        });

        $service = app(WebhookOutboxService::class);
        $outbox = $service->enqueue('invoice.created', ['invoice_number' => 'INV-2003'], (int) $this->store->id);
        $this->assertSame(WebhookOutbox::STATUS_PENDING, $outbox->status);

        $list = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson('/api/admin/webhooks?active_store_id=' . $this->store->id)
            ->assertStatus(200)
            ->json();

        $this->assertTrue($list['enabled']);
        $this->assertSame(1, $list['summary']['pending']);
        $this->assertCount(1, $list['deliveries']);
        $this->assertSame('invoice.created', $list['deliveries'][0]['event']);

        $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/webhooks/' . $outbox->id . '/retry?active_store_id=' . $this->store->id)
            ->assertStatus(200)
            ->assertJson(['success' => true]);

        $this->assertSame(WebhookOutbox::STATUS_DELIVERED, $outbox->fresh()->status);
    }

    public function test_test_endpoint_reports_connection_result(): void
    {
        $this->configureWebhook();
        $calls = 0;
        Http::fake(function () use (&$calls) {
            $calls++;
            return $calls === 1
                ? Http::response(['ok' => true], 200)
                : Http::response('nope', 500);
        });

        $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/webhooks/test?active_store_id=' . $this->store->id)
            ->assertStatus(200)
            ->assertJson(['success' => true]);

        $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/webhooks/test?active_store_id=' . $this->store->id)
            ->assertStatus(422)
            ->assertJson(['success' => false]);
    }
}
