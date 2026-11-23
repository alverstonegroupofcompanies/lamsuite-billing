<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\CounterProfileException;
use App\Models\Device;
use App\Models\Invoice;
use App\Models\Store;
use App\Services\CounterClaimService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * SYNC-02 / CR Q1 — a till re-issued while it was offline still holds bills it
 * genuinely sold before the owner retired it. Those bills are accepted through
 * one narrow door, flagged for the owner, and nothing else gets through it.
 */
class SyncStrandedDocumentsTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private Counter $counter;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Stranded Store', 'code' => 'STR1', 'state_code' => '32',
            'tax_mode' => 'inclusive', 'gst_type' => 'regular', 'is_active' => true,
        ]);
        $this->otherStore = Store::create([
            'name' => 'Other Store', 'code' => 'STR2', 'state_code' => '32', 'is_active' => true,
        ]);
        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C02',
            'counter_name' => 'Second Counter',
        ]);
    }

    private function claim(Counter $counter, string $uuid): string
    {
        $raw = ActivationKey::generateForCounter($counter)['raw_key'];

        return $this->postJson('/api/counters/claim', ['code' => $raw, 'device_uuid' => $uuid])
            ->assertOk()
            ->json('device_token');
    }

    private function bill(string $externalId, int $savedAtMs, array $overrides = []): array
    {
        return [
            'id' => 'sync_' . $externalId,
            'entity_type' => 'invoice',
            'action' => 'create',
            'payload' => array_merge([
                'external_id' => $externalId,
                'invoice_number' => 'C02-INV-' . substr(md5($externalId), 0, 6),
                'store_id' => $this->store->id,
                'counter_code' => 'C02',
                'invoice_date' => now()->toDateString(),
                'customer_name' => 'Walk-in Customer',
                'grand_total' => 115,
                'taxable_subtotal' => 102.68,
                'tax_total' => 12.32,
                'round_off' => 0,
                'paid_amount' => 115,
                'payment_mode' => 'Cash',
                'payments' => [['mode' => 'Cash', 'amount' => 115]],
                'items' => [],
                'client_timestamp' => $savedAtMs,
            ], $overrides),
        ];
    }

    private function pushStranded(string $token, array $items)
    {
        return $this->withHeaders(['X-Device-Token' => $token])
            ->postJson('/api/sync/push/stranded', ['items' => $items]);
    }

    public function test_reissue_stamps_when_the_device_was_revoked(): void
    {
        $this->claim($this->counter, 'uuid-c02-a');
        Carbon::setTestNow('2026-11-21 21:50:00');

        app(CounterClaimService::class)->reissue($this->counter->fresh());

        $device = Device::firstWhere('device_uuid', 'uuid-c02-a');
        $this->assertSame('revoked', $device->status);
        $this->assertSame('2026-11-21 21:50:00', $device->revoked_at?->format('Y-m-d H:i:s'));
        Carbon::setTestNow();
    }

    public function test_a_bill_sold_before_the_reissue_is_filed_and_flagged_once(): void
    {
        $token = $this->claim($this->counter, 'uuid-c02-a');
        $soldAt = now()->subMinutes(5)->getTimestampMs();
        app(CounterClaimService::class)->reissue($this->counter->fresh());

        $item = $this->bill('ext_offline_1052', $soldAt);

        $this->pushStranded($token, [$item])
            ->assertOk()
            ->assertJsonPath('results.processed', 1)
            ->assertJsonPath('results.failed', 0);

        $invoice = Invoice::where('store_id', $this->store->id)->where('external_id', 'ext_offline_1052')->firstOrFail();
        $this->assertSame((string) $item['payload']['invoice_number'], (string) $invoice->invoice_number);

        $flag = CounterProfileException::where('counter_id', $this->counter->id)
            ->where('document_type', 'invoice')
            ->where('document_id', (string) $invoice->id)
            ->firstOrFail();
        $this->assertSame(CounterProfileException::STATUS_OPEN, $flag->status);
        $this->assertContains('filed_by_retired_device', array_column($flag->violations, 'code'));

        // A retry after a dropped response neither duplicates the bill nor the flag.
        $this->pushStranded($token, [$item])->assertOk();
        $this->assertSame(1, Invoice::where('external_id', 'ext_offline_1052')->count());
        $this->assertSame(1, CounterProfileException::where('document_id', (string) $invoice->id)->count());
    }

    public function test_a_bill_written_after_the_reissue_is_refused(): void
    {
        $token = $this->claim($this->counter, 'uuid-c02-a');
        app(CounterClaimService::class)->reissue($this->counter->fresh());

        $item = $this->bill('ext_after_revoke', now()->addMinute()->getTimestampMs());

        $this->pushStranded($token, [$item])
            ->assertOk()
            ->assertJsonPath('results.processed', 0)
            ->assertJsonPath('results.failed', 1)
            ->assertJsonPath('results.errors.0.id', $item['id']);

        $this->assertSame(0, Invoice::where('external_id', 'ext_after_revoke')->count());
    }

    public function test_only_documents_go_through_the_door(): void
    {
        $token = $this->claim($this->counter, 'uuid-c02-a');
        $soldAt = now()->subMinutes(5)->getTimestampMs();
        app(CounterClaimService::class)->reissue($this->counter->fresh());

        $settings = [
            'id' => 'sync_settings', 'entity_type' => 'settings', 'action' => 'update',
            'payload' => ['client_timestamp' => $soldAt, 'store_name' => 'Hijacked'],
        ];
        $edit = $this->bill('ext_edit', $soldAt);
        $edit['action'] = 'update';

        $this->pushStranded($token, [$settings, $edit])
            ->assertOk()
            ->assertJsonPath('results.processed', 0)
            ->assertJsonPath('results.failed', 2);

        $this->assertSame('Stranded Store', $this->store->fresh()->name);
    }

    public function test_a_bill_without_a_save_time_is_refused(): void
    {
        $token = $this->claim($this->counter, 'uuid-c02-a');
        app(CounterClaimService::class)->reissue($this->counter->fresh());

        $item = $this->bill('ext_no_time', 0);
        unset($item['payload']['client_timestamp']);

        $this->pushStranded($token, [$item])->assertOk()->assertJsonPath('results.failed', 1);
        $this->assertSame(0, Invoice::where('external_id', 'ext_no_time')->count());
    }

    public function test_an_active_token_cannot_use_the_door(): void
    {
        $token = $this->claim($this->counter, 'uuid-c02-a');

        $this->pushStranded($token, [$this->bill('ext_live', now()->getTimestampMs())])->assertStatus(401);
        $this->assertSame(0, Invoice::where('external_id', 'ext_live')->count());
    }

    public function test_an_unknown_token_cannot_use_the_door(): void
    {
        $this->pushStranded('lsd_not_a_token', [$this->bill('ext_unknown', now()->getTimestampMs())])
            ->assertStatus(401);
    }

    public function test_the_door_closes_after_the_window(): void
    {
        $token = $this->claim($this->counter, 'uuid-c02-a');
        $soldAt = now()->subMinutes(5)->getTimestampMs();
        app(CounterClaimService::class)->reissue($this->counter->fresh());

        Carbon::setTestNow(now()->addDays(8));
        $this->pushStranded($token, [$this->bill('ext_late', $soldAt)])->assertStatus(401);
        Carbon::setTestNow();

        $this->assertSame(0, Invoice::where('external_id', 'ext_late')->count());
    }

    public function test_a_retired_device_files_only_into_its_own_store(): void
    {
        $token = $this->claim($this->counter, 'uuid-c02-a');
        $soldAt = now()->subMinutes(5)->getTimestampMs();
        app(CounterClaimService::class)->reissue($this->counter->fresh());

        $this->withHeaders(['X-Device-Token' => $token, 'X-Store-Id' => (string) $this->otherStore->id])
            ->postJson('/api/sync/push/stranded', [
                'store_id' => $this->otherStore->id,
                'items' => [$this->bill('ext_cross', $soldAt, ['store_id' => $this->otherStore->id])],
            ])
            ->assertStatus(403);

        $this->assertSame(0, Invoice::where('external_id', 'ext_cross')->count());
    }
}
