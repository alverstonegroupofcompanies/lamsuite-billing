<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\DeviceSession;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CounterNameUniquenessTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Counter Name Store',
            'code' => 'NAME-01',
            'is_active' => true,
        ]);
    }

    private function makeCounter(string $name, string $code, string $status = 'active', ?string $uuid = null): Counter
    {
        return Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => $code,
            'counter_name' => $name,
            'device_name' => $name . ' Device',
            'device_uuid' => $uuid ?? ('uuid_' . strtolower($code)),
            'status' => $status,
        ]);
    }

    public function test_enroll_rejects_duplicate_counter_name_with_holder_details(): void
    {
        $holder = $this->makeCounter('Front Counter', 'C01');

        $res = $this->postJson('/api/counters/enroll', [
            'store_id' => $this->store->id,
            'device_uuid' => 'uuid_new_till',
            'counter_name' => 'Front Counter',
            'counter_code' => 'C02',
        ]);

        $res->assertStatus(422);
        $res->assertJson([
            'success' => false,
            'error' => 'COUNTER_NAME_TAKEN',
            'conflict' => [
                'counter_name' => 'Front Counter',
                'counter_code' => 'C01',
                'device_uuid' => $holder->device_uuid,
            ],
        ]);
        $this->assertFalse(Counter::where('counter_code', 'C02')->exists());
    }

    public function test_duplicate_detection_is_case_and_whitespace_insensitive(): void
    {
        $this->makeCounter('Front Counter', 'C01');

        $res = $this->postJson('/api/counters/enroll', [
            'store_id' => $this->store->id,
            'device_uuid' => 'uuid_case_dup',
            'counter_name' => '  front COUNTER  ',
            'counter_code' => 'C03',
        ]);

        $res->assertStatus(422);
        $res->assertJson(['error' => 'COUNTER_NAME_TAKEN']);
    }

    public function test_device_can_re_enroll_with_its_own_existing_name(): void
    {
        $existing = $this->makeCounter('Front Counter', 'C01', 'pending_approval', 'uuid_same_device');

        $res = $this->postJson('/api/counters/enroll', [
            'store_id' => $this->store->id,
            'device_uuid' => 'uuid_same_device',
            'counter_name' => 'Front Counter',
            'counter_code' => 'C01',
        ]);

        $res->assertStatus(200);
        $this->assertEquals($existing->id, $res->json('counter.id'));
    }

    public function test_revoked_counter_name_becomes_available_again(): void
    {
        $this->makeCounter('Retired Counter', 'C90', 'revoked');

        $res = $this->postJson('/api/counters/enroll', [
            'store_id' => $this->store->id,
            'device_uuid' => 'uuid_take_over',
            'counter_name' => 'Retired Counter',
            'counter_code' => 'C91',
        ]);

        $res->assertStatus(201);
    }

    public function test_same_name_is_allowed_in_a_different_store(): void
    {
        $this->makeCounter('Front Counter', 'C01');

        $otherStore = Store::create([
            'name' => 'Second Branch',
            'code' => 'NAME-02',
            'is_active' => true,
        ]);

        $res = $this->postJson('/api/counters/enroll', [
            'store_id' => $otherStore->id,
            'device_uuid' => 'uuid_other_store',
            'counter_name' => 'Front Counter',
            'counter_code' => 'C01',
        ]);

        $res->assertStatus(201);
    }

    public function test_rename_endpoint_rejects_duplicate_and_allows_free_name(): void
    {
        $this->makeCounter('Front Counter', 'C01');
        $this->makeCounter('Back Counter', 'C02');

        $session = DeviceSession::recordLogin(
            $this->store->id,
            'uuid_rename_target',
            'Back Counter Device',
            null,
            'Back Counter',
            'C02'
        );

        $conflict = $this->postJson("/api/device-sessions/{$session->id}/rename", [
            'counter_name' => 'front counter',
        ]);
        $conflict->assertStatus(422);
        $conflict->assertJson(['error' => 'COUNTER_NAME_TAKEN']);

        $ok = $this->postJson("/api/device-sessions/{$session->id}/rename", [
            'counter_name' => 'Express Counter',
        ]);
        $ok->assertStatus(200);
        $this->assertEquals('Express Counter', $session->fresh()->counter_name);
    }

    public function test_auto_naming_suffixes_when_name_is_taken(): void
    {
        $this->makeCounter('Counter Alpha', 'C01');

        $unique = Counter::uniqueNameForStore($this->store->id, 'Counter Alpha');

        $this->assertEquals('Counter Alpha (2)', $unique);
        $this->assertNull(Counter::nameConflict($this->store->id, $unique));
    }
}
