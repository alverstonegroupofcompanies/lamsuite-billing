<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\Device;
use App\Models\Store;
use App\Services\CounterSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CNT-012 — the one-time migration turns the workstations a store already
 * registered into counters the owner owns.
 *
 * Nothing a customer already holds in their hand may change: the name on the
 * screen, the number already printed on a bill and which counter issued it all
 * survive the move. Every write is journalled so --rollback can undo it, and a
 * second run has nothing left to do.
 */
class CounterMigrationTest extends TestCase
{
    use RefreshDatabase;

    private string $manifestPath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->manifestPath = storage_path('app/counters-migrate-from-devices.json');
        @unlink($this->manifestPath);
    }

    protected function tearDown(): void
    {
        @unlink($this->manifestPath);
        parent::tearDown();
    }

    private function store(string $code): Store
    {
        return Store::create([
            'name' => "Store {$code}",
            'code' => $code,
            'state_code' => '32',
            'is_active' => true,
        ]);
    }

    /** A workstation the old device-key flow registered. */
    private function device(Store $store, string $name, string $uuid, array $attributes = []): Device
    {
        $rawToken = 'lsd_' . $uuid;

        return Device::create(array_merge([
            'store_id' => $store->id,
            'device_name' => $name,
            'device_uuid' => $uuid,
            'device_token' => $rawToken,
            'device_token_hash' => hash('sha256', $rawToken),
            'status' => 'active',
            'app_version' => '2.1.1',
            'last_seen_at' => now(),
        ], $attributes));
    }

    private function invoice(Store $store, string $number, array $attributes = []): int
    {
        return DB::table('invoices')->insertGetId(array_merge([
            'store_id' => $store->id,
            'invoice_number' => $number,
            'invoice_date' => date('Y-m-d'),
            'grand_total' => 100,
            'status' => 'issued',
            'created_at' => now(),
            'updated_at' => now(),
        ], $attributes));
    }

    private function manifest(): array
    {
        $this->assertFileExists($this->manifestPath, 'CNT-012: a real run must leave a JSON manifest');

        $decoded = json_decode((string) file_get_contents($this->manifestPath), true);
        $this->assertIsArray($decoded, 'the manifest must be valid JSON');

        return $decoded;
    }

    private function sequence(Counter $counter, string $docType, string $fy, int $nextNumber): CounterSequence
    {
        return CounterSequence::create([
            'store_id' => $counter->store_id,
            'counter_id' => $counter->id,
            'doc_type' => $docType,
            'financial_year' => $fy,
            'prefix' => "{$counter->counter_code}-" . ['invoice' => 'INV', 'sales_return' => 'SR', 'receipt' => 'REC'][$docType],
            'next_number' => $nextNumber,
        ]);
    }

    private function currentFy(): string
    {
        return (new CounterSequenceService)->currentFinancialYear();
    }

    public function test_legacy_devices_become_counters_keeping_their_names(): void
    {
        $store = $this->store('MIGA');
        $front = $this->device($store, 'Front Till', 'uuid-front');
        $warehouse = $this->device($store, 'Warehouse Till', 'uuid-ware');

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $counters = Counter::where('store_id', $store->id)->orderBy('id')->get();
        $this->assertCount(2, $counters);
        $this->assertSame(['Front Till', 'Warehouse Till'], $counters->pluck('counter_name')->all(), 'CNT-012: the name on the till is the counter name');
        $this->assertSame(['C01', 'C02'], $counters->pluck('counter_code')->all());
        $this->assertSame([Counter::STATUS_ACTIVE, Counter::STATUS_ACTIVE], $counters->pluck('status')->all());
        $this->assertSame(['uuid-front', 'uuid-ware'], $counters->pluck('device_uuid')->all());
        $this->assertSame([(int) $front->id, (int) $warehouse->id], $counters->pluck('current_device_id')->all());

        // The device now points at its counter, so AuthenticateDevice resolves it.
        $this->assertSame(
            $counters->pluck('id')->map(fn ($id) => (string) $id)->all(),
            Device::where('store_id', $store->id)->orderBy('id')->pluck('counter_id')->all()
        );

        $manifest = $this->manifest();
        $this->assertSame(2, $manifest['counters_created']);
        $this->assertSame(0, $manifest['counters_linked']);
        $this->assertFalse($manifest['dry_run']);
    }

    public function test_a_token_issued_before_the_migration_keeps_working(): void
    {
        $store = $this->store('MIGB');
        $device = $this->device($store, 'Front Till', 'uuid-live');
        $rawToken = $device->device_token;

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $counter = Counter::where('store_id', $store->id)->first();

        // CNT-013: nothing is re-keyed under the operator's feet, and the migration
        // does not copy a token binding onto the counter it just made.
        $this->assertNull($counter->device_token);
        $this->assertNull($counter->device_token_hash);

        $this->withHeaders(['X-Device-Token' => $rawToken])
            ->getJson('/api/counter/context')
            ->assertStatus(200)
            ->assertJsonPath('counter.counter_name', 'Front Till')
            ->assertJsonPath('counter.counter_code', 'C01')
            ->assertJsonPath('store.id', $store->id);
    }

    public function test_dry_run_reports_without_writing_anything(): void
    {
        $store = $this->store('MIGC');
        $this->device($store, 'Front Till', 'uuid-dry');
        $this->invoice($store, 'C01-INV-1001');

        $this->artisan('counters:migrate-from-devices', ['--dry-run' => true])
            ->expectsOutputToContain('"counters_created": 1')
            ->assertExitCode(0);

        $this->assertSame(0, Counter::where('store_id', $store->id)->count(), 'dry-run must create nothing');
        $this->assertNull(Device::where('store_id', $store->id)->value('counter_id'));
        $this->assertNull(DB::table('invoices')->where('store_id', $store->id)->value('counter_id'));
        $this->assertSame(0, CounterSequence::where('store_id', $store->id)->count());
        $this->assertFileDoesNotExist($this->manifestPath, 'a dry run must not leave a manifest to roll back');
    }

    public function test_the_manifest_is_secret_free(): void
    {
        $store = $this->store('MIGD');
        $device = $this->device($store, 'Front Till', 'uuid-secret');

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $raw = (string) file_get_contents($this->manifestPath);
        $this->assertStringNotContainsString($device->device_token_hash, $raw, 'IS5: a token, even hashed, does not belong in an ops file');
        $this->assertStringNotContainsString($device->device_token, $raw);
        $this->assertStringNotContainsString('device_token', $raw);
        $this->assertStringNotContainsString('lsd_', $raw);

        $manifest = $this->manifest();
        $this->assertSame(
            [['store_id', 'name', 'code', 'devices_scanned', 'counters_created', 'counters_linked', 'series_seeded', 'history_attributed']],
            [array_keys($manifest['per_store'][0])]
        );
        $this->assertSame($store->id, $manifest['per_store'][0]['store_id']);
    }

    public function test_a_device_that_already_has_a_counter_is_linked_and_not_duplicated(): void
    {
        $store = $this->store('MIGE');
        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => 'C07',
            'counter_name' => 'Old Link',
            'status' => Counter::STATUS_UNCLAIMED,
        ]);
        $device = $this->device($store, 'Desk PC', 'uuid-linked', ['counter_id' => (string) $counter->id]);

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $this->assertSame(1, Counter::where('store_id', $store->id)->count());
        $fresh = $counter->fresh();
        $this->assertSame(Counter::STATUS_ACTIVE, $fresh->status);
        $this->assertSame('uuid-linked', $fresh->device_uuid);
        $this->assertSame((int) $device->id, (int) $fresh->current_device_id);
        $this->assertNull($fresh->device_token_hash, 'the token stays on the device row that carries it today');
        $this->assertSame('C07', $fresh->counter_code, 'a pre-created code is never renumbered');

        $manifest = $this->manifest();
        $this->assertSame(0, $manifest['counters_created']);
        $this->assertSame(1, $manifest['counters_linked']);

        // The linked counter gets the series a counter must have.
        $this->assertSame(
            ['invoice', 'receipt', 'sales_return'],
            CounterSequence::where('counter_id', $counter->id)->orderBy('doc_type')->pluck('doc_type')->all()
        );
    }

    public function test_revoked_and_pending_devices_are_not_promoted(): void
    {
        $store = $this->store('MIGF');
        $revoked = $this->device($store, 'Dead Till', 'uuid-revoked', ['status' => 'revoked', 'revoke_reason' => 'Stolen']);
        $pending = $this->device($store, 'New Till', 'uuid-pending', ['status' => 'pending']);

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $this->assertSame(0, Counter::where('store_id', $store->id)->count());
        $this->assertNull($revoked->fresh()->counter_id);
        $this->assertNull($pending->fresh()->counter_id);

        $manifest = $this->manifest();
        $this->assertSame(2, $manifest['devices_skipped']);
        $this->assertCount(2, $manifest['notes']);
    }

    public function test_two_devices_with_the_same_name_get_distinct_counter_names(): void
    {
        $store = $this->store('MIGG');
        $this->device($store, 'Main Counter', 'uuid-one');
        $this->device($store, 'Main Counter', 'uuid-two');

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $this->assertSame(
            ['Main Counter', 'Main Counter (2)'],
            Counter::where('store_id', $store->id)->orderBy('id')->pluck('counter_name')->all(),
            'the live-name index must not reject the migration'
        );
    }

    public function test_counter_numbering_starts_at_c01_in_every_store(): void
    {
        $a = $this->store('MIGH');
        $b = $this->store('MIGI');
        $this->device($a, 'Till A', 'uuid-a1');
        $this->device($b, 'Till B', 'uuid-b1');
        $this->device($b, 'Till B2', 'uuid-b2');

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $this->assertSame(['C01'], Counter::where('store_id', $a->id)->pluck('counter_code')->all());
        $this->assertSame(['C01', 'C02'], Counter::where('store_id', $b->id)->orderBy('id')->pluck('counter_code')->all());
    }

    public function test_issued_numbers_are_never_reused(): void
    {
        $store = $this->store('MIGJ');
        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Till',
            'status' => Counter::STATUS_ACTIVE,
            'device_uuid' => 'uuid-j',
        ]);
        $this->device($store, 'Front Till', 'uuid-j', ['counter_id' => (string) $counter->id]);

        // Bills already printed on this counter, in two financial years.
        $this->invoice($store, 'C01-INV-1001', ['counter_id' => (string) $counter->id]);
        $this->invoice($store, 'C01-INV-1002', ['counter_id' => (string) $counter->id]);
        $this->invoice($store, 'C01-INV-1004', ['counter_id' => (string) $counter->id]);
        $previousFy = $this->previousFy();
        $this->invoice($store, 'C01-INV-9001', [
            'counter_id' => (string) $counter->id,
            'invoice_date' => $this->midDateOf($previousFy),
        ]);

        // A stale series that would re-issue 1002 and 1004.
        $this->sequence($counter, 'invoice', $this->currentFy(), 1002);

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $current = CounterSequence::where('counter_id', $counter->id)
            ->where('doc_type', 'invoice')
            ->where('financial_year', $this->currentFy())
            ->first();
        $this->assertSame(1005, (int) $current->next_number, 'CNT-012: the next bill must be 1005, never a printed number');

        $prior = CounterSequence::where('counter_id', $counter->id)
            ->where('doc_type', 'invoice')
            ->where('financial_year', $previousFy)
            ->first();
        $this->assertSame(9002, (int) $prior->next_number);
        $this->assertSame('C01-INV', $prior->prefix);

        $manifest = $this->manifest();
        $this->assertSame(2, $manifest['series_adopted']);
    }

    public function test_old_bills_stay_attributable_to_a_counter(): void
    {
        $store = $this->store('MIGK');
        $this->device($store, 'Till One', 'uuid-k1');
        $this->device($store, 'Till Two', 'uuid-k2');
        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);
        $counters = Counter::where('store_id', $store->id)->orderBy('id')->get();

        // Numbered on C01, and labelled C02 on the bill itself.
        $byNumber = $this->invoice($store, 'C01-INV-1500');
        $byCode = $this->invoice($store, 'INV-2026-0007', ['counter_code' => 'C02']);
        // No counter number and no code: with two counters this is a guess, so it is reported.
        $ambiguous = $this->invoice($store, 'INV-2026-0008');

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $this->assertSame((string) $counters[0]->id, (string) DB::table('invoices')->where('id', $byNumber)->value('counter_id'));
        $this->assertSame((string) $counters[1]->id, (string) DB::table('invoices')->where('id', $byCode)->value('counter_id'));
        $this->assertNull(DB::table('invoices')->where('id', $ambiguous)->value('counter_id'));

        $manifest = $this->manifest();
        $this->assertSame(2, $manifest['history_attributed']);
        $this->assertNotEmpty(preg_grep('/ambiguous/i', $manifest['notes']), 'an unattributable bill is reported, never guessed');
    }

    public function test_a_single_counter_store_inherits_all_its_history(): void
    {
        $store = $this->store('MIGL');
        $this->device($store, 'Only Till', 'uuid-l');
        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);
        $counter = Counter::where('store_id', $store->id)->first();

        $bill = $this->invoice($store, 'INV-2026-0009');

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $this->assertSame((string) $counter->id, (string) DB::table('invoices')->where('id', $bill)->value('counter_id'));
        $this->assertSame(1001, (int) CounterSequence::where('counter_id', $counter->id)
            ->where('doc_type', 'invoice')
            ->where('financial_year', $this->currentFy())
            ->value('next_number'), 'CNT-012: a store-level number is not part of the counter series, so the series is not pushed past it');
    }

    public function test_rollback_restores_the_state_before_the_migration(): void
    {
        $store = $this->store('MIGM');
        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Old Series Counter',
            'status' => Counter::STATUS_UNCLAIMED,
        ]);
        $this->sequence($counter, 'invoice', $this->currentFy(), 1002);
        $linked = $this->device($store, 'Old Till', 'uuid-m1', ['counter_id' => (string) $counter->id]);
        $legacy = $this->device($store, 'New Till', 'uuid-m2');
        $bill = $this->invoice($store, 'INV-2026-0011', ['counter_code' => 'C01']);

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $this->assertSame(2, Counter::where('store_id', $store->id)->count());
        $this->assertNotNull($legacy->fresh()->counter_id);
        $this->assertSame(1002, (int) CounterSequence::where('counter_id', $counter->id)
            ->where('doc_type', 'invoice')
            ->where('financial_year', $this->currentFy())
            ->value('next_number'));

        $this->artisan('counters:migrate-from-devices', ['--rollback' => true])->assertExitCode(0);

        // The counter the migration created is gone, with the series under it.
        $this->assertSame(1, Counter::where('store_id', $store->id)->count());
        $this->assertSame('C01', Counter::where('store_id', $store->id)->value('counter_code'));

        // The pre-existing counter is back the way it was found.
        $this->assertSame(Counter::STATUS_UNCLAIMED, $counter->fresh()->status);
        $this->assertNull($counter->fresh()->device_uuid);
        $this->assertNull($counter->fresh()->device_token_hash);

        // Device links, history and the journaled series value are undone.
        $this->assertNull($legacy->fresh()->counter_id);
        $this->assertSame((string) $counter->id, (string) $linked->fresh()->counter_id);
        $this->assertNull(DB::table('invoices')->where('id', $bill)->value('counter_id'));
        $this->assertSame(
            ['invoice'],
            CounterSequence::where('counter_id', $counter->id)->pluck('doc_type')->all(),
            'series rows the migration seeded are removed, the row it found is kept'
        );
        $this->assertSame(1002, (int) CounterSequence::where('counter_id', $counter->id)
            ->where('doc_type', 'invoice')
            ->where('financial_year', $this->currentFy())
            ->value('next_number'));

        $this->assertSame([], $this->manifest()['changes'] ?? null, 'the journal is consumed by a rollback');
    }

    public function test_a_second_run_has_nothing_left_to_do(): void
    {
        $store = $this->store('MIGN');
        $front = $this->device($store, 'Front Till', 'uuid-n1');
        $this->invoice($store, 'C01-INV-1001');

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);
        $first = $this->manifest();

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);
        $second = $this->manifest();

        $this->assertSame(1, Counter::where('store_id', $store->id)->count());
        $this->assertSame(1, CounterSequence::where('store_id', $store->id)->where('doc_type', 'invoice')->count());
        $this->assertSame(0, $second['counters_created']);
        $this->assertSame(0, $second['counters_linked']);
        $this->assertSame(0, $second['series_seeded']);
        $this->assertSame(0, $second['history_attributed']);
        $this->assertSame(1002, (int) CounterSequence::where('store_id', $store->id)
            ->where('doc_type', 'invoice')
            ->value('next_number'), 'a second run must not advance a series that already covers its numbers');
        $this->assertSame([], $second['changes'], 'idempotence means an empty journal on the second run');
        $this->assertSame(1, $first['counters_created']);
        $this->assertSame((int) $front->id, (int) Counter::where('store_id', $store->id)->value('current_device_id'));
    }

    public function test_several_devices_on_one_counter_keep_working_and_are_reported(): void
    {
        $store = $this->store('MIGO');
        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Shared Counter',
            'status' => Counter::STATUS_ACTIVE,
        ]);
        $older = $this->device($store, 'Old Desk', 'uuid-o1', [
            'counter_id' => (string) $counter->id,
            'last_seen_at' => now()->subDays(4),
        ]);
        $newer = $this->device($store, 'New Desk', 'uuid-o2', [
            'counter_id' => (string) $counter->id,
            'last_seen_at' => now(),
        ]);

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        $fresh = $counter->fresh();
        $this->assertSame((int) $newer->id, (int) $fresh->current_device_id, 'the device actually in use holds the binding');
        $this->assertSame('uuid-o2', $fresh->device_uuid);
        $this->assertSame('active', $older->fresh()->status, 'the migration never revokes a workstation it did not need to');

        // CNT-013: both tokens still resolve, so nobody is cut off mid-shift.
        foreach ([$older, $newer] as $device) {
            $this->withHeaders(['X-Device-Token' => $device->device_token])
                ->getJson('/api/counter/context')
                ->assertStatus(200)
                ->assertJsonPath('counter.counter_code', 'C01');
        }

        $this->assertNotEmpty(preg_grep('/2 devices/i', $this->manifest()['notes']));
    }

    public function test_a_device_pointing_at_another_store_is_never_followed(): void
    {
        $mine = $this->store('MIGP');
        $theirs = $this->store('MIGQ');
        $foreign = Counter::create([
            'store_id' => $theirs->id,
            'counter_code' => 'C01',
            'counter_name' => 'Their Counter',
            'status' => Counter::STATUS_ACTIVE,
        ]);
        $device = $this->device($mine, 'My Till', 'uuid-p1', ['counter_id' => (string) $foreign->id]);

        $this->artisan('counters:migrate-from-devices')->assertExitCode(0);

        // P-TENANT: the foreign pointer is dropped, not adopted.
        $mine2 = Counter::where('store_id', $mine->id)->sole();
        $this->assertSame('C01', $mine2->counter_code);
        $this->assertSame('My Till', $mine2->counter_name);
        $this->assertSame((string) $mine2->id, (string) $device->fresh()->counter_id);
        $this->assertNotSame((string) $foreign->id, (string) $device->fresh()->counter_id);

        // The other store's counter is exactly as it was found.
        $this->assertSame('Their Counter', $foreign->fresh()->counter_name);
        $this->assertNull($foreign->fresh()->current_device_id);
        $this->assertSame(0, CounterSequence::where('counter_id', $foreign->id)->count());

        $this->assertNotEmpty(preg_grep('/another store/i', $this->manifest()['notes']));

        // Rollback restores the pointer it refused to follow, and removes the rest.
        $this->artisan('counters:migrate-from-devices', ['--rollback' => true])->assertExitCode(0);
        $this->assertSame((string) $foreign->id, (string) $device->fresh()->counter_id);
        $this->assertSame(0, Counter::where('store_id', $mine->id)->count());
    }

    private function previousFy(): string
    {
        $start = (int) substr($this->currentFy(), 0, 4) - 1;

        return $start . '-' . str_pad((string) (($start + 1) % 100), 2, '0', STR_PAD_LEFT);
    }

    /** Any date inside the given April-based financial year. */
    private function midDateOf(string $fy): string
    {
        return sprintf('%d-06-05', (int) substr($fy, 0, 4));
    }
}
