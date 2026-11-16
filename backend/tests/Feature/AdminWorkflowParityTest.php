<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Party;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminWorkflowParityTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;
    private Party $customer;
    private Party $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateDevice::class);

        $this->store = Store::create([
            'name' => 'Workflow Store',
            'code' => 'WF-01',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'invoice_prefix' => 'WF',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'store_id' => $this->store->id,
            'name' => 'Workflow Admin',
            'email' => 'workflow.admin@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Anand Traders',
            'phone' => '9847011122',
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Sunrise Distributors',
            'phone' => '9847033344',
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);
    }

    private function admin()
    {
        return $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    public function test_quotation_crud_and_conversion_to_credit_invoice(): void
    {
        $payload = [
            'customer_id' => $this->customer->id,
            'invoice_date' => now()->toDateString(),
            'items' => [
                ['product_name' => 'Basmati Rice 5kg', 'qty' => 1, 'unit_price' => 100, 'gst_percent' => 18],
                ['product_name' => 'Sunflower Oil 1L', 'qty' => 2, 'unit_price' => 50, 'gst_percent' => 12],
            ],
        ];

        $res = $this->admin()->postJson('/api/admin/quotations', $payload);
        $res->assertCreated();
        $quotation = $res->json('quotation');

        $this->assertStringStartsWith('QUO-' . now()->format('Ym') . '-', $quotation['invoice_number']);
        $this->assertEquals('quotation', $quotation['module_key']);
        $this->assertEquals(200, (float) $quotation['subtotal']);
        $this->assertEquals(30, (float) $quotation['tax_total']);
        $this->assertEquals(15, (float) $quotation['cgst_total']);
        $this->assertEquals(15, (float) $quotation['sgst_total']);
        $this->assertEquals(230, (float) $quotation['grand_total']);
        $this->assertCount(2, $quotation['items']);

        $list = $this->admin()->getJson('/api/admin/quotations?active_store_id=' . $this->store->id);
        $list->assertOk();
        $this->assertCount(1, $list->json('data'));

        // Update recalculates lines
        $update = $this->admin()->putJson('/api/admin/quotations/' . $quotation['id'], array_merge($payload, [
            'items' => [['product_name' => 'Basmati Rice 5kg', 'qty' => 2, 'unit_price' => 100, 'gst_percent' => 18]],
        ]));
        $update->assertOk();
        $this->assertEquals(236, (float) $update->json('quotation.grand_total'));

        $convert = $this->admin()->postJson('/api/admin/quotations/' . $quotation['id'] . '/convert');
        $convert->assertCreated();
        $invoice = $convert->json('invoice');
        $this->assertEquals('invoice', $invoice['module_key']);
        $this->assertEquals('Credit', $invoice['payment_mode']);
        $this->assertEquals(236, (float) $invoice['grand_total']);

        $this->assertEquals(236, (float) $this->customer->fresh()->current_balance);
        $this->assertEquals('converted', Invoice::where('module_key', 'quotation')->find($quotation['id'])->status);

        $this->admin()->postJson('/api/admin/quotations/' . $quotation['id'] . '/convert')->assertStatus(422);
        $this->admin()->deleteJson('/api/admin/quotations/' . $quotation['id'])->assertStatus(422);
    }

    public function test_quotation_requires_registered_customer_before_conversion(): void
    {
        $res = $this->admin()->postJson('/api/admin/quotations', [
            'invoice_date' => now()->toDateString(),
            'items' => [['product_name' => 'Mixed Nuts 250g', 'qty' => 1, 'unit_price' => 200, 'gst_percent' => 5]],
        ]);
        $res->assertCreated();

        $this->admin()->postJson('/api/admin/quotations/' . $res->json('quotation.id') . '/convert')
            ->assertStatus(422);

        // Draft quotations without a customer can be removed
        $this->admin()->deleteJson('/api/admin/quotations/' . $res->json('quotation.id'))->assertOk();
        $this->assertNull(Invoice::where('module_key', 'quotation')->find($res->json('quotation.id')));
    }

    public function test_purchase_order_crud_and_goods_receipt(): void
    {
        $payload = [
            'supplier_id' => $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'invoice_date' => now()->toDateString(),
            'expected_delivery_date' => now()->addDays(5)->toDateString(),
            'items' => [
                ['product_name' => 'Toor Dal 1kg', 'qty' => 10, 'purchase_rate' => 90, 'gst_percent' => 5],
                ['product_name' => 'Wheat Flour 10kg', 'qty' => 4, 'purchase_rate' => 400, 'gst_percent' => 0],
            ],
        ];

        $res = $this->admin()->postJson('/api/admin/purchase-orders', $payload);
        $res->assertCreated();
        $order = $res->json('purchase_order');

        $this->assertStringStartsWith('PO-', $order['invoice_number']);
        $this->assertEquals('purchase_order', $order['module_key']);
        $this->assertEquals('pending', $order['status']);
        $this->assertEquals(2545, (float) $order['grand_total']);

        $list = $this->admin()->getJson('/api/admin/purchase-orders?active_store_id=' . $this->store->id);
        $this->assertCount(1, $list->json('data'));
        $this->assertEquals(10, (float) $list->json('data.0.items.0.qty'));

        $receive = $this->admin()->postJson('/api/admin/purchase-orders/' . $order['id'] . '/receive', [
            'supplier_invoice_no' => 'SUN-778',
        ]);
        $receive->assertCreated();
        $this->assertEquals('SUN-778', $receive->json('purchase.invoice_number'));
        $this->assertEquals('purchase', $receive->json('purchase.module_key'));
        $this->assertCount(2, $receive->json('purchase.items'));

        $this->assertEquals('completed', Purchase::find($order['id'])->status);

        // Purchase register: goods receipt appears, the order itself does not
        $purchases = $this->admin()->getJson('/api/admin/purchases?active_store_id=' . $this->store->id . '&export=true');
        $numbers = array_column($purchases->json('data'), 'invoice_number');
        $this->assertContains('SUN-778', $numbers);
        $this->assertNotContains($order['invoice_number'], $numbers);

        $this->admin()->postJson('/api/admin/purchase-orders/' . $order['id'] . '/receive')->assertStatus(422);
        $this->admin()->putJson('/api/admin/purchase-orders/' . $order['id'], $payload)->assertStatus(422);
        $this->admin()->deleteJson('/api/admin/purchase-orders/' . $order['id'])->assertStatus(422);
    }

    public function test_desktop_purchase_order_sync_lands_in_admin_list(): void
    {
        $res = $this->postJson('/api/sync/push/batch', [
            'store_id' => $this->store->id,
            'items' => [[
                'entity_type' => 'purchase_order',
                'action' => 'create',
                'entity_id' => 'po_test_1',
                'payload' => [
                    'id' => 'po_test_1',
                    'po_number' => 'PO-26-27-0001',
                    'module_key' => 'po',
                    'supplier_id' => 'sup_external_9',
                    'supplier_name' => 'Kerala Wholesale Depot',
                    'po_date' => now()->toDateString(),
                    'expected_delivery_date' => now()->addDays(3)->toDateString(),
                    'items' => [[
                        'product_id' => 'prod_external_5',
                        'product_name' => 'Coconut Oil 500ml',
                        'hsn_code' => '1513',
                        'ordered_qty' => 12,
                        'purchase_rate' => 85,
                        'gst_percent' => 5,
                        'total_amount' => 1071,
                    ]],
                    'total_amount' => 1071,
                    'status' => 'pending',
                    'notes' => 'Deliver to back gate',
                ],
            ]],
        ]);

        $res->assertOk();
        $this->assertSame(1, $res->json('results.processed'));

        $order = Purchase::where('invoice_number', 'PO-26-27-0001')->first();
        $this->assertNotNull($order);
        $this->assertEquals('purchase_order', $order->module_key);
        $this->assertEquals('pending', $order->status);
        $this->assertEquals(1071, (float) $order->grand_total);
        $this->assertEquals('Deliver to back gate', $order->notes);
        $this->assertNotNull($order->expected_delivery_date);

        $item = $order->items()->first();
        $this->assertEquals(12, (float) $item->qty);
        $this->assertEquals(0, (float) $item->received_qty);
        $this->assertEquals(85, (float) $item->purchase_rate);
        $this->assertEquals(5, (float) $item->gst_percent);

        $list = $this->admin()->getJson('/api/admin/purchase-orders?active_store_id=' . $this->store->id);
        $this->assertCount(1, $list->json('data'));

        // Re-push updates instead of duplicating
        $this->postJson('/api/sync/push/batch', [
            'store_id' => $this->store->id,
            'items' => [[
                'entity_type' => 'purchase_order',
                'action' => 'create',
                'payload' => [
                    'po_number' => 'PO-26-27-0001',
                    'module_key' => 'po',
                    'supplier_name' => 'Kerala Wholesale Depot',
                    'po_date' => now()->toDateString(),
                    'items' => [['product_name' => 'Coconut Oil 500ml', 'ordered_qty' => 15, 'purchase_rate' => 85, 'gst_percent' => 5]],
                    'total_amount' => 1338.75,
                    'status' => 'partially_received',
                ],
            ]],
        ])->assertOk();

        $this->assertEquals(1, Purchase::where('invoice_number', 'PO-26-27-0001')->count());
        $this->assertEquals('partially_received', Purchase::where('invoice_number', 'PO-26-27-0001')->value('status'));
        $this->assertEquals(15, (float) Purchase::where('invoice_number', 'PO-26-27-0001')->first()->items()->value('qty'));
    }

    public function test_admin_customer_receipt_clears_balance(): void
    {
        $this->customer->update(['current_balance' => 500]);

        $res = $this->admin()->postJson('/api/admin/payments/customer', [
            'store_id' => $this->store->id,
            'customer_id' => $this->customer->id,
            'amount' => 200,
            'payment_mode' => 'UPI',
            'reference_no' => 'UPI-88219',
        ]);

        $res->assertCreated();
        $this->assertEquals(300, (float) $res->json('new_balance'));
        $this->assertEquals(300, (float) $this->customer->fresh()->current_balance);
    }
}
