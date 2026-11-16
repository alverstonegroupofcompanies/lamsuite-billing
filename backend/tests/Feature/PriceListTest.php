<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PriceListTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $admin;
    private Product $productA;
    private Product $productB;
    private Party $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'Pricing Store', 'code' => 'PRC01', 'is_active' => true]);
        $this->otherStore = Store::create(['name' => 'Other Store', 'code' => 'PRC02', 'is_active' => true]);

        $this->admin = User::create([
            'name' => 'Pricing Admin',
            'email' => 'pricing@test.local',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->productA = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Dolo 650',
            'barcode' => '8900000000101',
            'current_stock' => 50,
            'mrp' => 30,
            'sel_rate' => 28,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->productB = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Cetirizine',
            'barcode' => '8900000000102',
            'current_stock' => 40,
            'mrp' => 20,
            'sel_rate' => 18,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Wholesale Customer',
            'phone' => '9000000001',
            'is_active' => true,
        ]);
    }

    private function createList(array $overrides = []): PriceList
    {
        $res = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/admin/price-lists', array_merge([
                'name' => 'Wholesale',
                'description' => 'Bulk buyer pricing',
                'priority' => 10,
            ], $overrides));

        $res->assertStatus(201);

        return PriceList::findOrFail($res->json('list.id'));
    }

    public function test_create_list_with_items_and_assign_customer(): void
    {
        $list = $this->createList();

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/price-lists/{$list->id}/items", [
                'items' => [
                    ['product_id' => $this->productA->id, 'rate' => 25.50, 'discount_percent' => 2, 'min_qty' => 10],
                    ['product_id' => $this->productB->id, 'rate' => 16, 'min_qty' => 1],
                ],
            ])
            ->assertOk()
            ->assertJsonPath('list.items_count', 2);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/price-lists/{$list->id}/assign", [
                'customer_ids' => [$this->customer->id],
            ])
            ->assertOk()
            ->assertJsonPath('assigned_customers', 1);

        $this->assertSame($list->id, $this->customer->refresh()->price_list_id);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson("/api/admin/price-lists/{$list->id}")
            ->assertOk()
            ->assertJsonPath('list.items.0.product_name', 'Dolo 650')
            ->assertJsonPath('list.items.0.rate', 25.5)
            ->assertJsonPath('customers.0.id', $this->customer->id);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/admin/price-lists')
            ->assertOk()
            ->assertJsonPath('lists.0.assigned_customers', 1)
            ->assertJsonPath('lists.0.items_count', 2);
    }

    public function test_item_save_replaces_removed_products(): void
    {
        $list = $this->createList();
        PriceListItem::create(['price_list_id' => $list->id, 'product_id' => $this->productA->id, 'rate' => 24]);
        PriceListItem::create(['price_list_id' => $list->id, 'product_id' => $this->productB->id, 'rate' => 15]);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/price-lists/{$list->id}/items", [
                'items' => [['product_id' => $this->productA->id, 'rate' => 23]],
            ])
            ->assertOk()
            ->assertJsonPath('list.items_count', 1);

        $this->assertSame(1, PriceListItem::where('price_list_id', $list->id)->count());
        $this->assertEquals(23, (float) PriceListItem::where('price_list_id', $list->id)->first()->rate);
    }

    public function test_cross_store_products_are_rejected(): void
    {
        $foreign = Product::create([
            'store_id' => $this->otherStore->id,
            'name' => 'Foreign Product',
            'barcode' => '8900000000199',
            'current_stock' => 1,
            'mrp' => 5,
            'sel_rate' => 5,
            'gst_percent' => 0,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $list = $this->createList();

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/price-lists/{$list->id}/items", [
                'items' => [['product_id' => $foreign->id, 'rate' => 4]],
            ])
            ->assertStatus(422)
            ->assertJsonPath('success', false);
    }

    public function test_duplicate_name_is_rejected_and_delete_clears_assignments(): void
    {
        $list = $this->createList(['name' => 'Institutional']);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/admin/price-lists', ['name' => 'Institutional'])
            ->assertStatus(422);

        $this->customer->update(['price_list_id' => $list->id]);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->deleteJson("/api/admin/price-lists/{$list->id}")
            ->assertOk();

        $this->assertNull($this->customer->refresh()->price_list_id);
        $this->assertSame(0, PriceList::where('store_id', $this->store->id)->count());
    }

    public function test_resolve_returns_active_list_rates_for_assigned_customer(): void
    {
        $list = $this->createList(['valid_from' => now()->subDay()->toDateString(), 'valid_to' => now()->addMonth()->toDateString()]);
        PriceListItem::create(['price_list_id' => $list->id, 'product_id' => $this->productA->id, 'rate' => 22.75, 'min_qty' => 5]);
        $this->customer->update(['price_list_id' => $list->id]);

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/price-lists/resolve?customer_id=' . $this->customer->id)
            ->assertOk()
            ->assertJsonPath('list.name', 'Wholesale')
            ->assertJsonPath('items.0.product_id', $this->productA->id)
            ->assertJsonPath('items.0.rate', 22.75)
            ->assertJsonPath('items.0.min_qty', 5);
    }

    public function test_resolve_returns_null_when_list_inactive_or_expired(): void
    {
        $inactive = $this->createList(['name' => 'Inactive', 'is_active' => false]);
        PriceListItem::create(['price_list_id' => $inactive->id, 'product_id' => $this->productA->id, 'rate' => 10]);
        $this->customer->update(['price_list_id' => $inactive->id]);

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/price-lists/resolve?customer_id=' . $this->customer->id)
            ->assertOk()
            ->assertJsonPath('list', null)
            ->assertJsonPath('items', []);

        $expired = $this->createList([
            'name' => 'Expired',
            'valid_from' => now()->subMonths(2)->toDateString(),
            'valid_to' => now()->subMonth()->toDateString(),
        ]);
        PriceListItem::create(['price_list_id' => $expired->id, 'product_id' => $this->productA->id, 'rate' => 10]);
        $this->customer->update(['price_list_id' => $expired->id]);

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/price-lists/resolve?customer_id=' . $this->customer->id)
            ->assertOk()
            ->assertJsonPath('list', null);
    }

    public function test_resolve_returns_null_for_unassigned_customer(): void
    {
        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/price-lists/resolve?customer_id=' . $this->customer->id)
            ->assertOk()
            ->assertJsonPath('list', null);
    }

    public function test_rbac_and_store_scope_are_enforced(): void
    {
        $list = $this->createList();

        $cashier = User::create([
            'name' => 'Cashier',
            'email' => 'cashier@pricing.test',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->actingAs($cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson('/api/admin/price-lists')
            ->assertStatus(403);

        $otherAdmin = User::create([
            'name' => 'Other Admin',
            'email' => 'other@pricing.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->otherStore->id,
        ]);

        $this->actingAs($otherAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->otherStore->id])
            ->getJson('/api/admin/price-lists')
            ->assertOk()
            ->assertJsonCount(0, 'lists');

        $this->actingAs($otherAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->otherStore->id])
            ->getJson("/api/admin/price-lists/{$list->id}")
            ->assertStatus(404);
    }
}
