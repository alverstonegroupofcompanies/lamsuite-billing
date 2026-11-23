<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * CNT-013 — the doors that let a workstation join a store by a shared key, an
 * owner password or a pairing code are closed, and they close the same way: a
 * retired path never answers with a token and never binds anything. A counter
 * activation code is the only way onto a till.
 *
 * A token minted before the retirement is not revoked by it: the workstation
 * keeps working until its next connection, which is when it learns to ask for a
 * code.
 */
class RetiredRegistrationPathsTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private Device $device;
    private string $rawToken = 'lsd_beforetheretirement';
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Retirement Test Store',
            'code' => 'RET01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@retire-test.com',
            'password' => bcrypt('StrongPassword123!'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
            'totp_enabled' => false,
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Counter',
            'status' => Counter::STATUS_UNCLAIMED,
        ]);

        $this->device = Device::create([
            'store_id' => $this->store->id,
            'device_name' => 'Desk PC',
            'device_uuid' => 'uuid-retired-device',
            'device_token_hash' => hash('sha256', $this->rawToken),
            'counter_id' => (string) $this->counter->id,
            'status' => 'active',
        ]);
    }

    /** @return array<string, callable> */
    private function retiredCalls(): array
    {
        return [
            'POST /api/devices/register' => fn () => $this->postJson('/api/devices/register', [
                'store_id' => $this->store->id,
                'activation_key' => 'LAM-STORE-SHARED-KEY',
                'device_uuid' => 'uuid-any',
                'device_name' => 'Any till',
            ]),
            'POST /api/devices/register-owner' => fn () => $this->postJson('/api/devices/register-owner', [
                'email' => $this->owner->email,
                'password' => 'StrongPassword123!',
                'device_uuid' => 'uuid-any',
                'device_name' => 'Any till',
                'store_id' => $this->store->id,
            ]),
            'POST /api/counters/enroll' => fn () => $this->postJson('/api/counters/enroll', [
                'store_id' => $this->store->id,
                'device_uuid' => 'uuid-any',
                'counter_name' => 'Any till',
                'counter_code' => 'C99',
            ]),
            'GET /api/counters/enrollment-status' => fn () => $this->getJson('/api/counters/enrollment-status/uuid-any'),
            'POST /api/counters/approve-pairing' => fn () => $this->postJson('/api/counters/approve-pairing', [
                'counter_id' => $this->counter->id,
                'pairing_code' => 'AB-1234',
            ]),
            'POST /api/admin/counters/approve-pairing' => fn () => $this->actingAs($this->owner)
                ->postJson('/api/admin/counters/approve-pairing', [
                    'counter_id' => $this->counter->id,
                    'pairing_code' => 'AB-1234',
                ]),
            "POST /api/counters/{$this->counter->id}/status" => fn () => $this->postJson("/api/counters/{$this->counter->id}/status", [
                'status' => 'active',
            ]),
        ];
    }

    public function test_every_retired_registration_path_refuses_the_same_way(): void
    {
        foreach ($this->retiredCalls() as $label => $call) {
            $response = $call();
            $payload = (array) $response->json();

            $this->assertSame(410, $response->getStatusCode(), "{$label} must answer 410");
            $this->assertSame('route_retired', $payload['error'] ?? null, $label);
            $this->assertStringContainsString('counter activation code', (string) ($payload['message'] ?? ''), $label);
            $this->assertArrayNotHasKey('device_token', $payload, "{$label}: a closed door hands out no key");
            $this->assertStringNotContainsString('lsd_', json_encode($payload), $label);
        }
    }

    public function test_a_retired_path_binds_and_consumes_nothing(): void
    {
        $devicesBefore = Device::count();
        $countersBefore = Counter::count();
        $keysBefore = ActivationKey::count();

        foreach ($this->retiredCalls() as $call) {
            $call();
        }

        $this->assertSame($devicesBefore, Device::count(), 'a retired path registers no workstation');
        $this->assertSame($countersBefore, Counter::count(), 'a retired path creates no counter');
        $this->assertSame($keysBefore, ActivationKey::count(), 'a retired path burns no code');

        $this->counter->refresh();
        $this->assertSame(Counter::STATUS_UNCLAIMED, $this->counter->status, 'a retired path claims no counter');
        $this->assertNull($this->counter->device_uuid);
        $this->assertSame(hash('sha256', $this->rawToken), $this->device->fresh()->device_token_hash);
    }

    public function test_a_token_minted_before_the_retirement_still_works(): void
    {
        $this->withHeaders(['X-Device-Token' => $this->rawToken])
            ->getJson('/api/counter/context')
            ->assertStatus(200)
            ->assertJsonPath('counter.counter_code', 'C01')
            ->assertJsonPath('store.id', $this->store->id);
    }

    public function test_an_owner_approving_a_counter_hands_out_no_token(): void
    {
        $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/counters/{$this->counter->id}/status", ['status' => 'active'])
            ->assertStatus(200);

        $this->assertSame(Counter::STATUS_ACTIVE, $this->counter->fresh()->status);
        $this->assertNull($this->counter->fresh()->device_token_hash);
        $this->assertStringNotContainsString('lsd_', (string) json_encode($this->counter->fresh()->toArray()));
    }

    public function test_the_claim_endpoint_is_still_the_way_in(): void
    {
        $this->postJson('/api/counters/claim', [
            'code' => 'LAM-C01-0000000000000000-0000000000000000',
            'device_uuid' => 'uuid-fresh',
        ])->assertStatus(401)->assertJson(['error' => 'claim_failed']);
    }

    public function test_the_till_no_longer_calls_a_retired_path(): void
    {
        foreach ($this->tillSources() as $path => $source) {
            foreach (['/api/devices/register', '/api/counters/enroll', 'enrollment-status', 'approve-pairing'] as $retired) {
                $this->assertStringNotContainsString(
                    $retired,
                    $source,
                    basename($path) . ' still calls the retired ' . $retired
                );
            }
        }
    }

    public function test_the_stores_table_holds_no_shared_key_or_approval_switch(): void
    {
        foreach (['activation_key', 'activation_key_hash', 'require_device_approval'] as $column) {
            $this->assertFalse(
                Schema::hasColumn('stores', $column),
                "stores.{$column} is the shared-key door CNT-013 closes"
            );
        }
    }

    public function test_creating_a_store_hands_out_no_shared_key(): void
    {
        $response = $this->actingAs($this->owner)
            ->postJson('/api/admin/stores', [
                'name' => 'Second Branch',
                'code' => 'RET02',
                'state_code' => '32',
            ]);

        $response->assertStatus(201);
        $this->assertArrayNotHasKey('activation_key', (array) $response->json());

        $newStore = Store::where('code', 'RET02')->sole();
        $this->assertSame(
            0,
            ActivationKey::where('store_id', $newStore->id)->whereNull('counter_id')->count(),
            'a store is not a credential; only a counter issues one'
        );
    }

    public function test_regenerating_a_store_key_is_a_retired_door(): void
    {
        foreach (["/api/stores/{$this->store->id}/regenerate-key", "/api/admin/stores/{$this->store->id}/regenerate-key"] as $path) {
            $response = $this->actingAs($this->owner)->postJson($path);
            $payload = (array) $response->json();

            $response->assertStatus(410);
            $this->assertSame('route_retired', $payload['error'] ?? null, $path);
            $this->assertStringContainsString('counter activation code', (string) ($payload['message'] ?? ''), $path);
            $this->assertArrayNotHasKey('activation_key', $payload, $path . ' hands out no key');
        }
    }

    public function test_a_store_scope_code_that_survives_from_the_old_world_opens_no_till(): void
    {
        $rawLegacyCode = 'LAM-RET01-7F3A9C82B14D6E05-1A4370E8';
        ActivationKey::create([
            'store_id' => $this->store->id,
            'key_hash' => ActivationKey::hashKey($rawLegacyCode),
            'key_prefix' => substr($rawLegacyCode, 0, 14) . '****',
            'max_devices' => 5,
            'expires_at' => now()->addYear(),
        ]);

        $this->postJson('/api/counters/claim', [
            'code' => $rawLegacyCode,
            'device_uuid' => 'uuid-legacy-attempt',
        ])->assertStatus(401)->assertJson(['error' => 'claim_failed']);

        $this->assertSame(0, Device::where('device_uuid', 'uuid-legacy-attempt')->count());
    }

    /** @return array<string, string> */
    private function tillSources(): array
    {
        $root = dirname(__DIR__, 3) . '/frontend/src';
        $files = [];

        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile() && preg_match('/\.(ts|tsx)$/', $file->getFilename())) {
                $files[$file->getPathname()] = (string) file_get_contents($file->getPathname());
            }
        }

        $this->assertNotEmpty($files, 'the till source tree must be readable for this scan');

        return $files;
    }
}
