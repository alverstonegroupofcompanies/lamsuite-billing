<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SalesReturnTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $user;
    private Product $product;
    private ProductBatch $batch;
    private Invoice $invoice;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Return Pharmacy',
            'code' => 'RET-01',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'is_active' => true,
        ]);

        $this->user = User::create([
            'name' => 'Counter Owner',
            'email' => 'owner@ret.in',
            'password' => bcrypt('owner-secret'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
            'hsn_sac_code' => '3004',
            'mrp' => 120,
            'sel_rate' => 100,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 0,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'B1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 0,
            'mrp' => 120,
            'selling_rate' => 100,
        ]);

        $this->invoice = Invoice::create([
            'store_id' => $this->store->id,
            'module_key' => 'invoice',
            'invoice_number' => 'INV-RET-100',
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'subtotal' => 300,
            'taxable_subtotal' => 300,
            'grand_total' => 336,
            'paid_amount' => 336,
            'status' => 'issued',
            'store_state_code' => '32',
        ]);

        InvoiceItem::create([
            'invoice_id' => $this->invoice->id,
            'product_id' => $this->product->id,
            'product_name' => $this->product->name,
            'batch_no' => 'B1',
            'expiry_date' => '2027-12-31',
            'qty' => 3,
            'loose_qty' => 0,
            'units_per_pack' => 10,
            'unit_price' => 100,
            'gst_percent' => 12,
            'taxable_amount' => 300,
            'total_amount' => 336,
        ]);
    }

    private function postReturn(array $overrides = [])
    {
        return $this->actingAs($this->user, 'sanctum')
            ->withHeader('X-Store-Id', (string) $this->store->id)
            ->postJson('/api/returns/sales', array_merge([
                'original_invoice_number' => $this->invoice->invoice_number,
                'items' => [[
                    'product_id' => $this->product->id,
                    'batch_no' => 'B1',
                    'qty' => 1,
                    'loose_qty' => 2,
                    'units_per_pack' => 10,
                ]],
            ], $overrides));
    }

    public function test_creates_credit_note_in_base_units_and_restocks_the_batch(): void
    {
        $res = $this->postReturn();

        $res->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('invoice.module_key', 'credit_note')
            ->assertJsonPath('invoice.original_invoice_number', 'INV-RET-100');

        $creditNote = Invoice::where('module_key', 'credit_note')->firstOrFail();
        $this->assertSame('CN-' . $this->store->id . '-0001', $creditNote->invoice_number);
        $this->assertSame((string) $this->invoice->id, $creditNote->original_invoice_id);

        $item = $creditNote->items()->firstOrFail();
        $this->assertSame(1.0, (float) $item->qty);
        $this->assertSame(2.0, (float) $item->loose_qty);
        $this->assertSame(10, (int) $item->units_per_pack);

        // 1 pack (10 units) + 2 loose units were returned.
        $this->assertSame(12.0, (float) $this->batch->fresh()->stock_qty);
        $this->assertSame(12.0, (float) $this->product->fresh()->current_stock);
    }

    public function test_requires_an_original_invoice(): void
    {
        $res = $this->postReturn([
            'original_invoice_number' => null,
            'items' => [[
                'product_id' => $this->product->id,
                'qty' => 1,
                'units_per_pack' => 10,
            ]],
        ]);

        $res->assertStatus(422)->assertJsonPath('error', 'ORIGINAL_INVOICE_REQUIRED');
        $this->assertSame(0, Invoice::where('module_key', 'credit_note')->count());
    }

    public function test_rejects_return_above_quantity_already_returned(): void
    {
        $this->postReturn([
            'items' => [[
                'product_id' => $this->product->id,
                'batch_no' => 'B1',
                'qty' => 2,
                'loose_qty' => 0,
                'units_per_pack' => 10,
            ]],
        ])->assertStatus(201);

        // 30 sold, 20 already returned, 15 more must be rejected with 10 remaining.
        $res = $this->postReturn([
            'items' => [[
                'product_id' => $this->product->id,
                'batch_no' => 'B1',
                'qty' => 1,
                'loose_qty' => 5,
                'units_per_pack' => 10,
            ]],
        ]);

        $res->assertStatus(422)
            ->assertJsonPath('error', 'RETURN_QTY_EXCEEDS')
            ->assertJsonPath('remaining', 10);

        $this->assertSame(20.0, (float) $this->batch->fresh()->stock_qty);
        $this->assertSame(1, Invoice::where('module_key', 'credit_note')->count());
    }

    public function test_rejects_returns_against_a_credit_note(): void
    {
        $this->postReturn()->assertStatus(201);
        $creditNote = Invoice::where('module_key', 'credit_note')->firstOrFail();

        $res = $this->postReturn([
            'original_invoice_number' => null,
            'original_invoice_id' => $creditNote->id,
        ]);

        $res->assertStatus(422)->assertJsonPath('error', 'ORIGINAL_INVOICE_NOT_RETURNABLE');
    }

    public function test_rejects_products_that_were_not_sold_on_the_invoice(): void
    {
        $other = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Unrelated Syrup',
            'sel_rate' => 50,
            'gst_percent' => 12,
            'units_per_pack' => 1,
            'current_stock' => 0,
            'is_active' => true,
        ]);

        $res = $this->postReturn([
            'items' => [[
                'product_id' => $other->id,
                'qty' => 1,
                'units_per_pack' => 1,
            ]],
        ]);

        $res->assertStatus(422)->assertJsonPath('error', 'LINE_NOT_ON_INVOICE');
    }
}
