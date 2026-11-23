<?php

namespace Tests\Feature\Constitution;

use App\Models\Counter;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * P-IDENTITY-SCOPE constitution guard — see specs/constitution.md and
 * specs/cr/2026-11-19-counter-only-pos/spec-delta.md §5.
 * Fails CI when counter/approval/salesperson/pharmacist data drifts out of its store.
 */
class IdentityScopeSchemaTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);
    }

    /** IS1: every governed identity table carries store_id, and it is NOT NULL. */
    public function test_governed_tables_carry_a_mandatory_store_id(): void
    {
        foreach (['counters', 'activation_keys'] as $table) {
            $this->assertTrue(Schema::hasColumn($table, 'store_id'), "{$table} must carry store_id (IS1)");
        }

        $this->expectException(\Throwable::class);
        DB::table('counters')->insert([
            'counter_code' => 'C99',
            'counter_name' => 'Orphan Counter',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** CNT-001: the counter master carries profile, locking, lifecycle and device columns. */
    public function test_counter_master_has_profile_and_lifecycle_columns(): void
    {
        $columns = $this->columnMap('counters');

        foreach ([
            'permission_profile',
            'permission_profile_version',
            'idle_lock_minutes',
            'grace_hours',
            'unlock_pin_hash',
            'unlock_failed_attempts',
            'unlock_locked_until',
            'current_device_id',
            'last_salesperson_id',
            'last_salesperson_name',
            'retired_at',
            'created_by',
        ] as $column) {
            $this->assertArrayHasKey($column, $columns, "counters.{$column} is required by CNT-001");
        }
    }

    /** CNT-001: a new counter is unclaimed until the owner issues a code that binds a device. */
    public function test_new_counter_defaults_to_unclaimed(): void
    {
        $counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Counter',
        ]);

        $this->assertSame('unclaimed', $counter->fresh()->status);
        $this->assertSame(1, (int) $counter->fresh()->permission_profile_version);
        $this->assertNull($counter->fresh()->current_device_id);
    }

    /** CNT-001: counter codes are unique per store, but reusable across stores. */
    public function test_counter_code_is_unique_within_a_store_only(): void
    {
        Counter::create(['store_id' => $this->storeA->id, 'counter_code' => 'C01', 'counter_name' => 'A One']);
        Counter::create(['store_id' => $this->storeB->id, 'counter_code' => 'C01', 'counter_name' => 'B One']);

        $this->expectException(\Throwable::class);
        Counter::create(['store_id' => $this->storeA->id, 'counter_code' => 'C01', 'counter_name' => 'A One Again']);
    }

    /** IS5: no plaintext PIN column survives the rename to a hash. */
    public function test_no_plaintext_pin_column_on_counters(): void
    {
        $this->assertFalse(
            Schema::hasColumn('counters', 'manager_pin'),
            'counters.manager_pin must be renamed to unlock_pin_hash (hashed, never plaintext)'
        );
    }

    /** IS5: serialising a counter never leaks the unlock PIN hash or the device token hash. */
    public function test_counter_serialisation_hides_pin_and_token_material(): void
    {
        $counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C02',
            'counter_name' => 'Warehouse Counter',
            'unlock_pin_hash' => Hash::make('123456'),
            'device_token_hash' => str_repeat('a', 64),
        ]);

        $json = $counter->fresh()->toArray();

        foreach (['unlock_pin_hash', 'device_token_hash', 'device_token', 'pairing_code'] as $secret) {
            $this->assertArrayNotHasKey($secret, $json, "counters must not expose {$secret}");
        }
    }

    /** CNT-001: the active device pointer is a real FK onto devices. */
    public function test_current_device_id_is_an_foreign_key(): void
    {
        $device = DB::table('devices')->insertGetId([
            'store_id' => $this->storeA->id,
            'device_name' => 'Till A',
            'device_uuid' => 'uuid-till-a',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $counter = Counter::create([
            'store_id' => $this->storeA->id,
            'counter_code' => 'C03',
            'counter_name' => 'Binding Counter',
            'current_device_id' => $device,
        ]);

        $this->assertSame($device, $counter->fresh()->current_device_id);
    }

    private function columnMap(string $table): array
    {
        $map = [];
        foreach (Schema::getColumns($table) as $column) {
            $map[$column['name']] = $column;
        }
        return $map;
    }
}
