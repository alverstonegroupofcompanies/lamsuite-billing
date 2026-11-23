<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterPresenceSpan;
use App\Models\DeviceSession;
use App\Models\Invoice;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * CNT-01 — the admin counter list explains what each counter has been doing:
 * when it last issued a bill, who was operating it, what it still has to sync,
 * and when it was offline. The list is read from the store's own rows only.
 */
class CounterActivityListTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private Counter $front;
    private Counter $dock;
    private User $owner;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'Activity Store', 'code' => 'ACT-01', 'state_code' => '32', 'is_active' => true]);
        $this->otherStore = Store::create(['name' => 'Other Store', 'code' => 'OTH-01', 'state_code' => '32', 'is_active' => true]);

        $this->owner = User::create([
            'name' => 'Owner', 'email' => 'owner@activity-test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => $this->store->id,
        ]);
        $this->cashier = User::create([
            'name' => 'Rina', 'email' => 'rina@activity-test.in', 'password' => bcrypt('password123'),
            'role' => 'staff', 'store_id' => $this->store->id,
        ]);

        $this->front = Counter::create([
            'store_id' => $this->store->id, 'counter_code' => 'C01',
            'counter_name' => 'Front Counter', 'status' => 'active', 'device_uuid' => 'uuid-front',
        ]);
        $this->dock = Counter::create([
            'store_id' => $this->store->id, 'counter_code' => 'C02',
            'counter_name' => 'Dock Counter', 'status' => 'active',
        ]);
    }

    private function listCounters(?Store $store = null)
    {
        return $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) ($store ?? $this->store)->id])
            ->getJson('/api/admin/counters')
            ->assertOk();
    }

    private function row($response, string $code): array
    {
        $rows = collect($response->json('counters'))->keyBy('counter_code');

        return $rows[$code];
    }

    private function bill(Counter $counter, Store $store, Carbon $at, string $module = 'invoice', ?int $userId = null, ?string $salesperson = null): Invoice
    {
        $invoice = Invoice::create([
            'store_id' => $store->id,
            'counter_id' => $counter->id,
            'counter_code' => $counter->counter_code,
            'user_id' => $userId,
            'salesperson_id' => $salesperson ? 77 : null,
            'salesperson_name' => $salesperson,
            'module_key' => $module,
            'invoice_number' => strtoupper($module) . '-' . $counter->counter_code . '-' . $at->format('His'),
            'invoice_date' => $at->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'grand_total' => 100,
            'paid_amount' => 100,
            'status' => 'issued',
        ]);
        // created_at is not fillable; the moment of the bill is what the list reads.
        $invoice->forceFill(['created_at' => $at, 'updated_at' => $at])->save();

        return $invoice;
    }

    public function test_the_counter_list_reports_the_last_bill_each_counter_issued(): void
    {
        $this->bill($this->front, $this->store, now()->subMinutes(30));
        $later = $this->bill($this->front, $this->store, now()->subMinutes(10));
        $this->bill($this->dock, $this->store, now()->subMinutes(20));
        // A quotation is not a bill: it must not move the counter's last bill.
        $this->bill($this->front, $this->store, now()->subMinute(), 'quotation');

        $response = $this->listCounters();

        $this->assertSame(
            $later->created_at->toIso8601String(),
            $this->row($response, 'C01')['last_bill_at']
        );
        $this->assertSame($later->invoice_number, $this->row($response, 'C01')['last_bill_number']);
        $this->assertNotNull($this->row($response, 'C02')['last_bill_at']);
    }

    public function test_the_last_salesperson_is_the_one_stamped_on_the_counters_latest_bill(): void
    {
        $this->bill($this->front, $this->store, now()->subMinutes(30), 'invoice', null, 'Anil');
        $this->bill($this->front, $this->store, now()->subMinutes(10), 'invoice', null, 'Meera');
        // A later bill saved without a salesperson does not erase who sold last.
        $this->bill($this->front, $this->store, now()->subMinutes(5));

        // The signed-in operator is someone else entirely.
        DeviceSession::create([
            'store_id' => $this->store->id, 'user_id' => $this->cashier->id,
            'counter_id' => $this->front->id, 'device_uuid' => 'uuid-front',
            'session_id' => 'ds_sp_1', 'login_time' => now()->subHour(),
            'last_active_at' => now()->subMinute(), 'status' => 'active', 'is_active' => true,
        ]);

        $front = $this->row($this->listCounters(), 'C01');

        $this->assertSame('Meera', $front['last_salesperson_name']);
        $this->assertSame(77, $front['last_salesperson_id']);
        $this->assertSame('Rina', $front['last_operator_name']);

        $this->assertNull($this->row($this->listCounters(), 'C02')['last_salesperson_name']);
    }

    public function test_the_counter_list_reports_the_last_operator_and_the_sync_backlog(): void
    {
        DeviceSession::create([
            'store_id' => $this->store->id,
            'user_id' => $this->cashier->id,
            'counter_id' => $this->front->id,
            'device_uuid' => 'uuid-front',
            'session_id' => 'ds_activity_1',
            'device_name' => 'Till 01',
            'counter_name' => 'Front Counter',
            'counter_code' => 'C01',
            'login_time' => now()->subHours(2),
            'last_active_at' => now()->subMinute(),
            'status' => 'active',
            'is_active' => true,
            'unsynced_items_count' => 3,
        ]);
        // A stale beat from the same counter must not overwrite the fresh one.
        DeviceSession::create([
            'store_id' => $this->store->id,
            'user_id' => $this->owner->id,
            'counter_id' => $this->front->id,
            'device_uuid' => 'uuid-front',
            'session_id' => 'ds_activity_old',
            'login_time' => now()->subHours(5),
            'last_active_at' => now()->subHours(3),
            'status' => 'expired',
            'is_active' => false,
            'unsynced_items_count' => 9,
        ]);

        $front = $this->row($this->listCounters(), 'C01');

        $this->assertSame(3, $front['unsynced_items_count']);
        // The signed-in user is the operator; the salesperson comes from bills.
        $this->assertSame((int) $this->cashier->id, $front['last_operator_id']);
        $this->assertSame('Rina', $front['last_operator_name']);
        $this->assertNull($front['last_salesperson_name']);
        $this->assertNotNull($front['last_activity_at']);
        $this->assertTrue($front['is_online']);

        $dock = $this->row($this->listCounters(), 'C02');
        $this->assertSame(0, $dock['unsynced_items_count']);
        $this->assertNull($dock['last_operator_name']);
    }

    public function test_the_counter_list_reports_offline_periods_from_heartbeats(): void
    {
        // Span one ended 58 minutes ago; span two ended 20 minutes ago, so the
        // counter has been dark for 20 minutes and was away for 28 in between.
        CounterPresenceSpan::create([
            'store_id' => $this->store->id, 'counter_id' => $this->front->id,
            'started_at' => now()->subHour(), 'last_beat_at' => now()->subMinutes(58),
        ]);
        CounterPresenceSpan::create([
            'store_id' => $this->store->id, 'counter_id' => $this->front->id,
            'started_at' => now()->subMinutes(30), 'last_beat_at' => now()->subMinutes(20),
        ]);

        $front = $this->row($this->listCounters(), 'C01');

        $this->assertFalse($front['is_online']);
        $this->assertSame(now()->subMinutes(20)->toIso8601String(), $front['offline_since']);

        $periods = $front['offline_periods'];
        $this->assertCount(2, $periods);
        $this->assertSame(28, $periods[0]['minutes']);
        $this->assertNotNull($periods[0]['ended_at']);
        // The last one is still open: the counter never came back.
        $this->assertNull($periods[1]['ended_at']);
        $this->assertSame(20, $periods[1]['minutes']);

        // A counter that has never beaten has no known gaps, not a day of them.
        $dock = $this->row($this->listCounters(), 'C02');
        $this->assertSame([], $dock['offline_periods']);
        $this->assertNull($dock['offline_since']);
    }

    public function test_an_offline_counter_is_dark_only_since_its_latest_activity(): void
    {
        // The span stopped 20 minutes ago, but the till's session was heard 10
        // minutes ago: the counter has been dark for 10 minutes, not 20.
        CounterPresenceSpan::create([
            'store_id' => $this->store->id, 'counter_id' => $this->front->id,
            'started_at' => now()->subMinutes(40), 'last_beat_at' => now()->subMinutes(20),
        ]);
        DeviceSession::create([
            'store_id' => $this->store->id, 'counter_id' => $this->front->id,
            'device_uuid' => 'uuid-front', 'session_id' => 'ds_late_beat',
            'login_time' => now()->subHour(), 'last_active_at' => now()->subMinutes(10),
            'status' => 'active', 'is_active' => true,
        ]);

        $front = $this->row($this->listCounters(), 'C01');

        $this->assertFalse($front['is_online']);
        $this->assertSame(now()->subMinutes(10)->toIso8601String(), $front['last_activity_at']);
        $this->assertSame($front['last_activity_at'], $front['offline_since']);
        $open = collect($front['offline_periods'])->firstWhere('ended_at', null);
        $this->assertSame($front['last_activity_at'], $open['started_at']);
        $this->assertSame(10, $open['minutes']);
    }

    public function test_a_counter_that_kept_beating_is_online_with_no_open_gap(): void
    {
        CounterPresenceSpan::create([
            'store_id' => $this->store->id, 'counter_id' => $this->front->id,
            'started_at' => now()->subMinutes(40), 'last_beat_at' => now()->subMinute(),
        ]);

        $front = $this->row($this->listCounters(), 'C01');

        $this->assertTrue($front['is_online']);
        $this->assertNull($front['offline_since']);
        $this->assertSame([], $front['offline_periods']);
    }

    public function test_a_heartbeat_is_what_writes_the_counters_presence(): void
    {
        $this->actAsClaimedCounterOfRequestedStore();

        $beat = fn () => $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/device-sessions/heartbeat', [
                'device_uuid' => 'uuid-front',
                'device_name' => 'Till 01',
                'counter_code' => 'C01',
                'store_id' => $this->store->id,
                'unsynced_items_count' => 5,
            ]);

        $beat()->assertOk();

        $span = CounterPresenceSpan::where('counter_id', $this->front->id)->firstOrFail();
        $this->assertTrue($span->last_beat_at->gte(now()->subMinute()));

        // A second beat inside the quiet window extends the same span.
        $this->travel(1)->minutes();
        $beat()->assertOk();

        $this->assertSame(1, CounterPresenceSpan::where('counter_id', $this->front->id)->count());
        $this->assertTrue(
            CounterPresenceSpan::where('counter_id', $this->front->id)->first()->last_beat_at->gt($span->last_beat_at)
        );

        // A beat after the counter was dark opens a new span, and the gap
        // between the two is what the list reports as offline time.
        $this->travel(30)->minutes();
        $beat()->assertOk();

        $this->assertSame(2, CounterPresenceSpan::where('counter_id', $this->front->id)->count());

        $front = $this->row($this->listCounters(), 'C01');
        $this->assertCount(1, $front['offline_periods']);
        $this->assertNotNull($front['offline_periods'][0]['ended_at']);
        // The very first beat is also the login, and its backlog is kept.
        $this->assertSame(5, $front['unsynced_items_count']);
    }

    public function test_another_stores_activity_never_appears(): void
    {
        $foreign = Counter::create([
            'store_id' => $this->otherStore->id, 'counter_code' => 'C99',
            'counter_name' => 'Foreign Counter', 'status' => 'active',
        ]);
        $this->bill($foreign, $this->otherStore, now()->subMinute());

        $response = $this->listCounters();
        $codes = collect($response->json('counters'))->pluck('counter_code')->all();

        $this->assertNotContains('C99', $codes);
        $this->assertNull($this->row($response, 'C01')['last_bill_at']);
        $this->assertNull($this->row($response, 'C02')['last_bill_at']);
        $this->assertNull($this->row($response, 'C01')['last_bill_number']);
    }
}
