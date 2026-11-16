<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SecurityAuditSyncTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Audit Store',
            'code' => 'AUDIT-01',
            'is_active' => true,
        ]);

        $this->user = User::create([
            'store_id' => $this->store->id,
            'name' => 'Offline Cashier',
            'username' => 'offline_cashier',
            'email' => 'offline@audit.test',
            'password' => bcrypt('OfflinePass@2026'),
            'role' => 'cashier',
            'is_active' => true,
        ]);
    }

    private function events(): array
    {
        return [
            [
                'id' => 'evt-local-0001',
                'event_type' => 'staff_offline_login_success',
                'user_id' => (string)$this->user->id,
                'user_name' => 'Offline Cashier',
                'counter_id' => 'cntr_01',
                'details' => 'Verified with cached bcrypt PIN hash.',
                'ip_address' => '127.0.0.1',
                'created_at' => now()->getTimestampMs(),
            ],
            [
                'id' => 'evt-local-0002',
                'event_type' => 'staff_offline_login_failed',
                'user_id' => (string)$this->user->id,
                'user_name' => 'Offline Cashier',
                'details' => 'Wrong PIN (attempt 1 of 5).',
                'created_at' => now()->getTimestampMs(),
            ],
        ];
    }

    public function test_offline_security_events_are_ingested_into_the_audit_log(): void
    {
        $res = $this->postJson('/api/sync/push/security-audit', [
            'store_id' => (string)$this->store->id,
            'device_uuid' => 'uuid_offline_terminal',
            'events' => $this->events(),
        ]);

        $res->assertStatus(200);
        $res->assertJson(['success' => true, 'ingested_count' => 2]);

        $login = AuditLog::where('action', 'staff_offline_login_success')->firstOrFail();
        $this->assertEquals('SecurityEvent', $login->entity_type);
        $this->assertEquals('evt-local-0001', $login->entity_id);
        $this->assertEquals($this->store->id, $login->store_id);
        $this->assertEquals($this->user->id, $login->user_id);
        $this->assertEquals('offline', $login->new_values['source']);
        $this->assertEquals('uuid_offline_terminal', $login->new_values['device_uuid']);
        $this->assertEquals('cntr_01', $login->new_values['counter_id']);

        $this->assertTrue(AuditLog::where('action', 'staff_offline_login_failed')->exists());
    }

    public function test_replaying_the_same_queued_events_is_idempotent(): void
    {
        $payload = [
            'store_id' => (string)$this->store->id,
            'device_uuid' => 'uuid_offline_terminal',
            'events' => $this->events(),
        ];

        $this->postJson('/api/sync/push/security-audit', $payload)
            ->assertStatus(200)
            ->assertJson(['ingested_count' => 2]);

        $before = AuditLog::where('entity_type', 'SecurityEvent')->count();

        $this->postJson('/api/sync/push/security-audit', $payload)
            ->assertStatus(200)
            ->assertJson(['ingested_count' => 0]);

        $this->assertEquals($before, AuditLog::where('entity_type', 'SecurityEvent')->count());
    }

    public function test_events_without_client_ids_are_still_recorded(): void
    {
        $res = $this->postJson('/api/sync/push/security-audit', [
            'store_id' => (string)$this->store->id,
            'events' => [[
                'event_type' => 'staff_local_lockout',
                'user_name' => 'Unknown',
                'details' => 'No client id supplied.',
            ]],
        ]);

        $res->assertStatus(200);
        $res->assertJson(['ingested_count' => 1]);
        $this->assertTrue(AuditLog::where('action', 'staff_local_lockout')->exists());
    }

    public function test_batch_size_over_limit_is_rejected(): void
    {
        $events = [];
        for ($i = 0; $i < 201; $i++) {
            $events[] = ['event_type' => 'staff_offline_event', 'id' => "evt-{$i}"];
        }

        $this->postJson('/api/sync/push/security-audit', [
            'store_id' => (string)$this->store->id,
            'events' => $events,
        ])->assertStatus(422);
    }
}
