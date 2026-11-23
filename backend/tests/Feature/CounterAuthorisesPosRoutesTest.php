<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Coupon;
use App\Models\SalesOrder;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * CR 2026-11-19-counter-only-pos, decision 2 / plan-delta §1.1 — the counter is the
 * tenant principal, so it authorises the till routes that today need a person's
 * token. With no staff sign-in at the POS (B8), every one of these calls arrives
 * carrying only the workstation's device token; the counter's own store is the
 * scope and no request body or header can move it.
 *
 * Two stores exist and the OTHER one is created first on purpose: a route that
 * still guesses "the first store" when nothing names one will read or write the
 * wrong tenant, and these tests would see it.
 */
class CounterAuthorisesPosRoutesTest extends TestCase
{
    use RefreshDatabase;

    private Store $otherStore;
    private Store $store;
    private Counter $counter;
    private string $token;
    private User $owner;
    private User $headless;

    protected function setUp(): void
    {
        parent::setUp();

        $this->otherStore = Store::create([
            'name' => 'Other Branch',
            'code' => 'OTH',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->store = Store::create([
            'name' => 'Counter Store',
            'code' => 'CNT',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'counter-owner@test.in',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        // The panel's all-store admin: never allowed to land on a guessed store.
        $this->headless = User::create([
            'name' => 'Head Office',
            'email' => 'headless@test.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => null,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Counter',
        ]);

        $issued = ActivationKey::generateForCounter($this->counter);
        $this->token = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => 'dev-counter-principal',
        ])->assertOk()->json('device_token');

        Coupon::create([
            'store_id' => $this->store->id,
            'code' => 'SAVE10',
            'discount_type' => 'percent',
            'value' => 10,
            'min_bill_amount' => 500,
            'is_active' => true,
        ]);
    }

    private function counterHeaders(): array
    {
        return ['X-Device-Token' => $this->token];
    }

    /** The next request in a test carries only what it puts in its own headers. */
    private function signOut(): void
    {
        $this->app['auth']->forgetGuards();
    }

    private function orderPayload(): array
    {
        return [
            'customer_name' => 'Walk-in Order',
            'items' => [
                ['product_name' => 'Paracetamol 500mg', 'qty' => 2, 'unit_price' => 30, 'gst_percent' => 0],
            ],
        ];
    }

    public function test_the_counter_opens_a_till_route_with_no_person_signed_in(): void
    {
        $res = $this->withHeaders($this->counterHeaders())
            ->postJson('/api/coupons/validate', ['code' => 'SAVE10', 'bill_amount' => 1000])
            ->assertOk();

        $this->assertTrue($res->json('success'));
        $this->assertEquals(100, $res->json('discount_amount'));
    }

    public function test_the_counter_takes_a_sales_order_for_its_own_store(): void
    {
        $res = $this->withHeaders($this->counterHeaders())
            ->postJson('/api/sales-orders', $this->orderPayload())
            ->assertCreated();

        $this->assertSame($this->store->id, (int) $res->json('order.store_id'));
        $this->assertDatabaseHas('sales_orders', [
            'id' => $res->json('order.id'),
            'store_id' => $this->store->id,
        ]);
    }

    public function test_a_request_that_is_neither_a_person_nor_a_counter_is_refused(): void
    {
        $this->getJson('/api/sales-orders')->assertStatus(401);
        $this->withHeaders(['X-Device-Token' => 'not-a-device-token'])
            ->getJson('/api/sales-orders')
            ->assertStatus(401);
    }

    public function test_another_store_named_in_the_request_is_refused_not_followed(): void
    {
        $this->withHeaders(array_merge($this->counterHeaders(), ['X-Store-Id' => (string) $this->otherStore->id]))
            ->postJson('/api/sales-orders', $this->orderPayload())
            ->assertStatus(403);

        $this->withHeaders($this->counterHeaders())
            ->postJson('/api/sales-orders', $this->orderPayload() + ['store_id' => $this->otherStore->id])
            ->assertStatus(403);

        $this->assertSame(0, SalesOrder::where('store_id', $this->otherStore->id)->count());
    }

    public function test_a_local_registry_store_key_never_moves_the_counter(): void
    {
        $res = $this->withHeaders(array_merge($this->counterHeaders(), ['X-Store-Id' => 'store_main']))
            ->postJson('/api/sales-orders', $this->orderPayload())
            ->assertCreated();

        $this->assertSame($this->store->id, (int) $res->json('order.store_id'));
    }

    public function test_the_counter_never_reads_whichever_store_happens_to_be_first(): void
    {
        SalesOrder::create([
            'store_id' => $this->otherStore->id,
            'order_number' => 'SO-OTHER-01',
            'order_date' => now()->toDateString(),
            'status' => 'draft',
            'grand_total' => 100,
        ]);

        $res = $this->withHeaders($this->counterHeaders())->getJson('/api/sales-orders')->assertOk();

        $ids = collect($res->json('orders'))->pluck('id')->all();
        $this->assertNotContains(
            SalesOrder::where('store_id', $this->otherStore->id)->value('id'),
            $ids,
            'the counter read another tenant\'s orders'
        );
        $this->assertCount(0, $ids);
    }

    public function test_a_person_token_still_opens_the_same_routes(): void
    {
        Sanctum::actingAs($this->owner);

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/validate', ['code' => 'SAVE10', 'bill_amount' => 1000])
            ->assertOk();

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/sales-orders', $this->orderPayload())
            ->assertCreated();
    }

    public function test_an_admin_naming_no_store_is_refused_instead_of_being_pointed_at_the_first_store(): void
    {
        Sanctum::actingAs($this->headless);

        $this->getJson('/api/sales-orders')->assertStatus(404);
        $this->getJson('/api/loyalty/balance')->assertStatus(404);
    }

    public function test_the_store_profile_a_counter_reads_is_its_own(): void
    {
        $res = $this->withHeaders($this->counterHeaders())->getJson('/api/store')->assertOk();

        $this->assertSame($this->store->id, (int) $res->json('id'));
        $this->assertSame('Counter Store', $res->json('name'));
    }

    public function test_the_routes_that_need_a_person_stay_person_only(): void
    {
        // Preferences belong to a person; a counter has none, so the till keeps
        // its local defaults rather than inheriting somebody's setup.
        $this->withHeaders($this->counterHeaders())->getJson('/api/me/preferences')->assertStatus(401);

        Sanctum::actingAs($this->owner);
        $this->getJson('/api/me/preferences')->assertOk();
    }

    public function test_a_locked_counter_loses_the_till_routes_with_it(): void
    {
        Sanctum::actingAs($this->owner);
        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/counters/{$this->counter->id}/lock")
            ->assertOk();
        $this->signOut();

        $this->withHeaders($this->counterHeaders())
            ->getJson('/api/sales-orders')
            ->assertStatus(403);
    }
}
