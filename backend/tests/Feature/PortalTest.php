<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\LoyaltyLedger;
use App\Models\Party;
use App\Models\PortalAccessToken;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\SalesOrder;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PortalTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $admin;
    private User $cashier;
    private Party $customer;
    private Party $otherCustomer;
    private Product $product;
    private PriceList $priceList;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Portal Store',
            'code' => 'POR01',
            'state_code' => '32',
            'gstin' => '32AAAAA1111A1Z1',
            'is_active' => true,
        ]);
        $this->otherStore = Store::create(['name' => 'Portal Other Store', 'code' => 'POR02', 'is_active' => true]);

        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'tax_settings',
            'value' => ['tax_mode' => 'exclusive'],
        ]);

        $this->admin = User::create([
            'name' => 'Portal Admin',
            'email' => 'portal-admin@test.local',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->cashier = User::create([
            'name' => 'Portal Cashier',
            'email' => 'portal-cashier@test.local',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->priceList = PriceList::create([
            'store_id' => $this->store->id,
            'name' => 'Wholesale',
            'is_active' => true,
            'priority' => 10,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Portal Traders',
            'phone' => '9000000001',
            'gstin' => '32BBBBB2222B1Z2',
            'state_code' => '32',
            'opening_balance' => 50,
            'price_list_id' => $this->priceList->id,
            'is_active' => true,
        ]);

        $this->otherCustomer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Other Portal Customer',
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Cough Syrup 100ml',
            'hsn_sac_code' => '30049011',
            'sel_rate' => 100,
            'mrp' => 120,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 200,
            'is_active' => true,
        ]);

        PriceListItem::create([
            'price_list_id' => $this->priceList->id,
            'product_id' => $this->product->id,
            'rate' => 90,
            'discount_percent' => 0,
            'min_qty' => 2,
        ]);
    }

    private function authAdmin()
    {
        return $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function issueToken(?Party $party = null): string
    {
        $res = $this->authAdmin()->postJson('/api/admin/parties/' . ($party?->id ?? $this->customer->id) . '/portal-link', [
            'days' => 30,
            'portal_base_url' => 'http://localhost:5174',
        ]);
        $res->assertOk();

        return $res->json('token');
    }

    private function portal(string $token)
    {
        return $this->withHeaders(['Authorization' => 'Bearer ' . $token, 'Accept' => 'application/json']);
    }

    private function makeInvoice(array $overrides = [], ?Party $customer = null): Invoice
    {
        $invoice = Invoice::create(array_merge([
            'store_id' => $this->store->id,
            'customer_id' => ($customer ?? $this->customer)->id,
            'customer_name' => ($customer ?? $this->customer)->name,
            'invoice_number' => 'INV-POR-001',
            'invoice_date' => '2026-03-10',
            'module_key' => 'invoice',
            'subtotal' => 1000,
            'taxable_subtotal' => 1000,
            'cgst_total' => 60,
            'sgst_total' => 60,
            'tax_total' => 120,
            'grand_total' => 1120,
            'paid_amount' => 620,
            'payment_mode' => 'Credit',
            'payment_status' => 'partial',
            'status' => 'issued',
        ], $overrides));

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $this->product->id,
            'product_name' => $this->product->name,
            'qty' => 10,
            'units_per_pack' => 10,
            'unit_price' => 100,
            'taxable_amount' => 1000,
            'gst_percent' => 12,
            'cgst_amount' => 60,
            'sgst_amount' => 60,
            'tax_amount' => 120,
            'total_amount' => 1120,
        ]);

        return $invoice;
    }

    public function test_admin_can_issue_and_revoke_a_portal_link(): void
    {
        $res = $this->authAdmin()->postJson('/api/admin/parties/' . $this->customer->id . '/portal-link', [
            'portal_base_url' => 'http://localhost:5174',
        ]);
        $res->assertOk();
        $res->assertJsonPath('party.id', $this->customer->id);
        $this->assertStringStartsWith('lmp_', $res->json('token'));
        $this->assertSame('http://localhost:5174/portal?token=' . urlencode($res->json('token')), $res->json('portal_url'));
        $this->assertDatabaseCount('portal_access_tokens', 1);

        $status = $this->authAdmin()->getJson('/api/admin/parties/' . $this->customer->id . '/portal-status');
        $status->assertOk()->assertJsonPath('active', true);

        $this->authAdmin()->deleteJson('/api/admin/parties/' . $this->customer->id . '/portal-link')
            ->assertOk()
            ->assertJsonPath('revoked', 1);

        $this->portal($res->json('token'))->getJson('/api/portal/me')->assertStatus(401);
    }

    public function test_portal_link_generation_is_scoped_and_permission_guarded(): void
    {
        $foreign = Party::create([
            'store_id' => $this->otherStore->id,
            'type' => 'customer',
            'name' => 'Foreign Portal Customer',
            'is_active' => true,
        ]);

        $this->authAdmin()->postJson('/api/admin/parties/' . $foreign->id . '/portal-link')->assertStatus(404);

        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/admin/parties/' . $this->customer->id . '/portal-link')
            ->assertStatus(403);
    }

    public function test_portal_requires_a_valid_token(): void
    {
        $this->getJson('/api/portal/me')->assertStatus(401);
        $this->portal('bogus-token')->getJson('/api/portal/me')->assertStatus(401);

        $token = $this->issueToken();
        PortalAccessToken::query()->update(['expires_at' => now()->subDay()]);

        $this->portal($token)->getJson('/api/portal/me')->assertStatus(401);
    }

    public function test_me_returns_party_store_and_summary(): void
    {
        $this->makeInvoice();
        LoyaltyLedger::create([
            'store_id' => $this->store->id,
            'customer_id' => $this->customer->id,
            'type' => 'adjust',
            'points_delta' => 25,
            'balance_after' => 25,
        ]);

        $res = $this->portal($this->issueToken())->getJson('/api/portal/me');
        $res->assertOk();
        $res->assertJsonPath('party.name', 'Portal Traders');
        $res->assertJsonPath('store.name', 'Portal Store');
        $res->assertJsonPath('summary.outstanding_balance', 500);
        $res->assertJsonPath('summary.loyalty_points', 25);
    }

    public function test_invoice_list_and_detail_are_scoped_to_the_portal_customer(): void
    {
        $own = $this->makeInvoice();
        $this->makeInvoice(['invoice_number' => 'INV-POR-CANCELLED', 'status' => 'cancelled']);
        $foreignInvoice = $this->makeInvoice(['invoice_number' => 'INV-OTHER-CUST'], $this->otherCustomer);

        $token = $this->issueToken();

        $list = $this->portal($token)->getJson('/api/portal/invoices');
        $list->assertOk();
        $numbers = collect($list->json('data'))->pluck('invoice_number');
        $this->assertTrue($numbers->contains('INV-POR-001'));
        $this->assertFalse($numbers->contains('INV-POR-CANCELLED'));
        $this->assertFalse($numbers->contains('INV-OTHER-CUST'));

        $this->portal($token)->getJson('/api/portal/invoices/' . $own->id)
            ->assertOk()
            ->assertJsonPath('invoice.invoice_number', 'INV-POR-001')
            ->assertJsonPath('invoice.balance', 500)
            ->assertJsonPath('invoice.items.0.product_name', 'Cough Syrup 100ml');

        $this->portal($token)->getJson('/api/portal/invoices/' . $foreignInvoice->id)->assertStatus(404);
    }

    public function test_statement_tracks_opening_and_closing_balance(): void
    {
        $this->makeInvoice();

        $res = $this->portal($this->issueToken())
            ->getJson('/api/portal/statement?from=2026-03-01&to=2026-03-31');

        $res->assertOk();
        $res->assertJsonPath('opening_balance', 50);
        $res->assertJsonPath('closing_balance', 550);
        $res->assertJsonPath('rows.0.number', 'INV-POR-001');
        $res->assertJsonPath('rows.0.running_balance', 550);
    }

    public function test_catalog_applies_customer_price_list(): void
    {
        $res = $this->portal($this->issueToken())->getJson('/api/portal/catalog?search=Cough');
        $res->assertOk();
        $res->assertJsonPath('price_list.name', 'Wholesale');
        $res->assertJsonPath('products.0.rate', 90);
        $res->assertJsonPath('products.0.min_qty', 2);
        $res->assertJsonPath('products.0.sel_rate', 100);
    }

    public function test_portal_order_uses_server_prices_and_appears_in_orders(): void
    {
        $token = $this->issueToken();

        $res = $this->portal($token)->postJson('/api/portal/sales-orders', [
            'items' => [['product_id' => $this->product->id, 'qty' => 5]],
            'notes' => 'Monthly restock',
        ]);

        $res->assertCreated();
        $res->assertJsonPath('order.status', 'draft');
        $res->assertJsonPath('order.items_count', 1);

        $order = SalesOrder::with('items')->firstOrFail();
        $this->assertSame($this->customer->id, $order->customer_id);
        $this->assertSame('draft', $order->status);
        $this->assertSame('Monthly restock', $order->notes);
        $this->assertSame(90.0, (float) $order->items[0]->unit_price, 'Wholesale rate must be applied');
        $this->assertSame(5.0, (float) $order->items[0]->qty);
        $this->assertSame(10, (int) $order->items[0]->units_per_pack);
        $this->assertEqualsWithDelta(504.0, (float) $order->grand_total, 0.01);

        $list = $this->portal($token)->getJson('/api/portal/sales-orders');
        $list->assertOk()->assertJsonPath('orders.0.order_number', $order->order_number);

        $otherCustomerOrder = SalesOrder::create([
            'store_id' => $this->store->id,
            'order_number' => 'SO-OTHER-1',
            'order_date' => '2026-03-01',
            'customer_id' => $this->otherCustomer->id,
            'customer_name' => $this->otherCustomer->name,
            'status' => 'draft',
            'grand_total' => 100,
        ]);

        $numbers = collect($this->portal($token)->getJson('/api/portal/sales-orders')->json('orders'))->pluck('order_number');
        $this->assertFalse($numbers->contains($otherCustomerOrder->order_number));
    }

    public function test_portal_order_rejects_products_from_another_store(): void
    {
        $foreignProduct = Product::create([
            'store_id' => $this->otherStore->id,
            'name' => 'Foreign Product',
            'sel_rate' => 10,
            'gst_percent' => 12,
            'is_active' => true,
        ]);

        $this->portal($this->issueToken())->postJson('/api/portal/sales-orders', [
            'items' => [['product_id' => $foreignProduct->id, 'qty' => 1]],
        ])->assertStatus(422);

        $this->assertSame(0, SalesOrder::count());
    }

    public function test_portal_logout_revokes_the_token(): void
    {
        $token = $this->issueToken();

        $this->portal($token)->postJson('/api/portal/logout')->assertOk();
        $this->portal($token)->getJson('/api/portal/me')->assertStatus(401);
    }
}
