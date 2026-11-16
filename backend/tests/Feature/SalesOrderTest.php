<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Product;
use App\Models\SalesOrder;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SalesOrderTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $admin;
    private User $cashier;
    private Product $productA;
    private Product $productB;
    private Party $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'Order Store', 'code' => 'ORD01', 'is_active' => true, 'state_code' => '32']);
        $this->otherStore = Store::create(['name' => 'Other Order Store', 'code' => 'ORD02', 'is_active' => true]);

        $this->admin = User::create([
            'name' => 'Order Admin',
            'email' => 'orders@test.local',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->cashier = User::create([
            'name' => 'Order Cashier',
            'email' => 'orders-cashier@test.local',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->productA = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500',
            'barcode' => '8900000000201',
            'current_stock' => 100,
            'mrp' => 120,
            'sel_rate' => 100,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'is_active' => true,
        ]);

        $this->productB = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Pantoprazole 40',
            'barcode' => '8900000000202',
            'current_stock' => 100,
            'mrp' => 90,
            'sel_rate' => 80,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'is_active' => true,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'City Hospital',
            'phone' => '9000000002',
            'gstin' => '32AABCU9603R1ZM',
            'is_active' => true,
        ]);
    }

    private function auth(User $user = null)
    {
        return $this->actingAs($user ?? $this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function createOrder(array $overrides = [], ?User $user = null): SalesOrder
    {
        $res = $this->auth($user)->postJson('/api/admin/sales-orders', array_merge([
            'customer_id' => $this->customer->id,
            'expected_delivery_date' => date('Y-m-d', strtotime('+3 days')),
            'items' => [
                ['product_id' => $this->productA->id, 'qty' => 5, 'unit_price' => 100],
                ['product_id' => $this->productB->id, 'qty' => 3, 'unit_price' => 80],
            ],
        ], $overrides));

        $res->assertStatus(201);
        return SalesOrder::findOrFail($res->json('order.id'));
    }

    public function test_creates_draft_order_with_server_side_totals(): void
    {
        $order = $this->createOrder();

        $this->assertSame('draft', $order->status);
        $this->assertStringStartsWith('SO-', $order->order_number);
        $this->assertSame(2, $order->items()->count());
        $this->assertSame($this->customer->name, $order->customer_name);

        $gross = (5 * 100) + (3 * 80);
        $this->assertEqualsWithDelta($gross, (float) $order->subtotal, 0.01);
        // inclusive GST: grand total ~= gross (rounded), taxable = gross / 1.12
        $this->assertEqualsWithDelta($gross, (float) $order->grand_total - (float) $order->round_off, 0.02);
        $this->assertEqualsWithDelta($gross - ($gross / 1.12), (float) $order->tax_total, 0.02);
    }

    public function test_rejects_products_from_another_store(): void
    {
        $foreign = Product::create([
            'store_id' => $this->otherStore->id,
            'name' => 'Foreign Product',
            'current_stock' => 5,
            'mrp' => 10,
            'sel_rate' => 9,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->auth()->postJson('/api/admin/sales-orders', [
            'items' => [['product_id' => $foreign->id, 'qty' => 1, 'unit_price' => 9]],
        ])->assertStatus(422);
    }

    public function test_confirm_requires_reason_to_cancel_and_locks_draft_edits(): void
    {
        $order = $this->createOrder();

        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/status", ['status' => 'confirmed'])
            ->assertOk()
            ->assertJsonPath('order.status', 'confirmed');

        $this->auth()->putJson("/api/admin/sales-orders/{$order->id}", [
            'notes' => 'should fail',
        ])->assertStatus(422);

        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/status", ['status' => 'cancelled'])
            ->assertStatus(422);

        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/status", [
            'status' => 'cancelled',
            'reason' => 'Customer withdrew order',
        ])->assertOk()->assertJsonPath('order.status', 'cancelled');
    }

    public function test_partial_then_full_challan_fulfilment_updates_order_status(): void
    {
        $order = $this->createOrder();
        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/status", ['status' => 'confirmed'])->assertOk();

        $itemA = $order->items()->where('product_id', $this->productA->id)->firstOrFail();

        // Dispatch 3 of 5 packs -> partially fulfilled
        $res = $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/challans", [
            'transporter_name' => 'BlueDart',
            'vehicle_no' => 'KL-07-AB-1234',
            'items' => [['sales_order_item_id' => $itemA->id, 'qty' => 3]],
        ]);
        $res->assertStatus(201)->assertJsonPath('order.status', 'partially_fulfilled');
        $this->assertStringStartsWith('DC-', $res->json('challan.challan_number'));
        $this->assertEquals(30, (float) $res->json('challan.items.0.qty') * 10, 0.001);

        // Over-dispatch is rejected
        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/challans", [
            'items' => [['sales_order_item_id' => $itemA->id, 'qty' => 3]],
        ])->assertStatus(422);

        // Dispatch the rest of A and all of B -> fulfilled
        $itemB = $order->items()->where('product_id', $this->productB->id)->firstOrFail();
        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/challans", [
            'items' => [
                ['sales_order_item_id' => $itemA->id, 'qty' => 2],
                ['sales_order_item_id' => $itemB->id, 'qty' => 3],
            ],
        ])->assertStatus(201)->assertJsonPath('order.status', 'fulfilled');

        $itemA->refresh();
        $this->assertEquals(50, (float) $itemA->fulfilled_base_units, 0.001);
    }

    public function test_cancelling_challan_reverses_fulfilment_and_blocks_when_invoiced(): void
    {
        $order = $this->createOrder();
        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/status", ['status' => 'confirmed'])->assertOk();
        $itemA = $order->items()->where('product_id', $this->productA->id)->firstOrFail();

        $challanId = $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/challans", [
            'items' => [['sales_order_item_id' => $itemA->id, 'qty' => 5]],
        ])->assertStatus(201)->json('challan.id');

        $this->auth()->postJson("/api/admin/delivery-challans/{$challanId}/status", ['status' => 'cancelled'])
            ->assertOk();

        $itemA->refresh();
        $this->assertEquals(0, (float) $itemA->fulfilled_base_units, 0.001);
        $this->assertSame('confirmed', $order->refresh()->status);

        // Delivered challans can no longer be cancelled
        $secondId = $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/challans", [
            'items' => [['sales_order_item_id' => $itemA->id, 'qty' => 5]],
        ])->assertStatus(201)->json('challan.id');

        $this->auth()->postJson("/api/admin/delivery-challans/{$secondId}/status", ['status' => 'delivered'])
            ->assertOk()->assertJsonPath('challan.status', 'delivered');

        $this->auth()->postJson("/api/admin/delivery-challans/{$secondId}/status", ['status' => 'cancelled'])
            ->assertStatus(422);
    }

    public function test_order_and_challans_are_listed_and_store_scoped(): void
    {
        $order = $this->createOrder();
        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/status", ['status' => 'confirmed'])->assertOk();
        $itemA = $order->items()->firstOrFail();
        $this->auth()->postJson("/api/admin/sales-orders/{$order->id}/challans", [
            'items' => [['sales_order_item_id' => $itemA->id, 'qty' => 1]],
        ])->assertStatus(201);

        $this->auth()->getJson('/api/admin/sales-orders?status=partially_fulfilled')
            ->assertOk()
            ->assertJsonCount(1, 'orders')
            ->assertJsonPath('orders.0.items_count', 2)
            ->assertJsonPath('orders.0.challans_count', 1);

        $this->auth()->getJson('/api/admin/delivery-challans')
            ->assertOk()
            ->assertJsonCount(1, 'challans');

        // A user scoped to another store cannot see or fetch these documents
        $foreignAdmin = User::create([
            'name' => 'Other Store Admin',
            'email' => 'other-orders@test.local',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'store_id' => $this->otherStore->id,
        ]);

        $otherStoreOrder = SalesOrder::where('store_id', $this->store->id)->firstOrFail();
        $this->actingAs($foreignAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->otherStore->id])
            ->getJson("/api/admin/sales-orders/{$otherStoreOrder->id}")
            ->assertStatus(404);
    }

    public function test_cashier_is_denied_access(): void
    {
        $this->auth($this->cashier)->getJson('/api/admin/sales-orders')->assertStatus(403);
        $this->auth($this->cashier)->postJson('/api/admin/sales-orders', [
            'items' => [['product_id' => $this->productA->id, 'qty' => 1, 'unit_price' => 100]],
        ])->assertStatus(403);
    }

    public function test_counter_staff_can_save_order_from_pos(): void
    {
        $res = $this->actingAs($this->cashier, 'sanctum')->postJson('/api/sales-orders', [
            'customer_name' => 'Phone Order Customer',
            'customer_phone' => '9000000099',
            'items' => [
                ['product_id' => $this->productA->id, 'qty' => 2, 'unit_price' => 100],
            ],
        ]);

        $res->assertStatus(201)->assertJsonPath('order.status', 'draft');
        $order = SalesOrder::findOrFail($res->json('order.id'));
        $this->assertSame($this->store->id, $order->store_id);
        $this->assertSame($this->cashier->id, $order->created_by);

        $this->actingAs($this->cashier, 'sanctum')
            ->getJson('/api/sales-orders')
            ->assertOk()
            ->assertJsonCount(1, 'orders');
    }

    public function test_draft_order_can_be_edited_and_deleted(): void
    {
        $order = $this->createOrder();

        $this->auth()->putJson("/api/admin/sales-orders/{$order->id}", [
            'notes' => 'Deliver after 5pm',
            'items' => [
                ['product_id' => $this->productA->id, 'qty' => 10, 'unit_price' => 95, 'discount_percent' => 5],
            ],
        ])->assertOk()->assertJsonPath('order.notes', 'Deliver after 5pm');

        $order->refresh();
        $this->assertSame(1, $order->items()->count());
        $this->assertEqualsWithDelta(10 * 95, (float) $order->subtotal, 0.01);
        $this->assertEqualsWithDelta(10 * 95 * 0.05, (float) $order->discount_total, 0.01);

        $this->auth()->deleteJson("/api/admin/sales-orders/{$order->id}")->assertOk();
        $this->assertDatabaseMissing('sales_orders', ['id' => $order->id]);
        $this->assertDatabaseMissing('sales_order_items', ['sales_order_id' => $order->id]);
    }
}
