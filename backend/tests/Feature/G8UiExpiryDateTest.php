<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * UI-03 (G8-UI): an expiry is a calendar date, never an instant.
 *
 * A plain `date` cast serialised 31-03-2027 as "2027-03-30T18:30:00.000000Z"
 * (midnight IST in UTC). The till sent that string back with a return, and the
 * cast stored it as "2027-03-30 18:30:00", so each round trip lost a day.
 */
class G8UiExpiryDateTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $user;
    private Product $product;
    private Invoice $invoice;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Expiry Pharmacy',
            'code' => 'EXP-01',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'is_active' => true,
        ]);

        $this->user = User::create([
            'name' => 'Expiry Owner',
            'email' => 'owner@exp.test',
            'password' => bcrypt('owner-secret'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 250mg',
            'hsn_sac_code' => '3004',
            'mrp' => 120,
            'sel_rate' => 100,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 0,
            'is_active' => true,
        ]);

        ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'EX1',
            'expiry_date' => '2027-03-31',
            'stock_qty' => 0,
            'mrp' => 120,
            'selling_rate' => 100,
        ]);

        $this->invoice = Invoice::create([
            'store_id' => $this->store->id,
            'module_key' => 'invoice',
            'invoice_number' => 'INV-EXP-100',
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
            'batch_no' => 'EX1',
            'expiry_date' => '2027-03-31',
            'qty' => 3,
            'loose_qty' => 0,
            'units_per_pack' => 10,
            'unit_price' => 100,
            'gst_percent' => 12,
            'taxable_amount' => 300,
            'total_amount' => 336,
        ]);
    }

    public function test_invoice_item_expiry_serialises_as_a_calendar_date(): void
    {
        $item = InvoiceItem::where('invoice_id', $this->invoice->id)->firstOrFail();

        $this->assertSame('2027-03-31', $item->toArray()['expiry_date']);
        $this->assertSame('2027-03-31', $item->expiry_date->toDateString());
    }

    public function test_purchase_item_dates_serialise_as_calendar_dates(): void
    {
        $item = new PurchaseItem(['expiry_date' => '2027-03-31', 'mfg_date' => '2025-04-01']);

        $this->assertSame('2027-03-31', $item->toArray()['expiry_date']);
        $this->assertSame('2025-04-01', $item->toArray()['mfg_date']);
    }

    public function test_an_iso_timestamp_is_stored_as_the_store_calendar_day(): void
    {
        $item = new InvoiceItem(['expiry_date' => '2027-03-30T18:30:00.000000Z']);

        $this->assertSame('2027-03-31', $item->getAttributes()['expiry_date']);
        $this->assertSame('2027-03-31', $item->toArray()['expiry_date']);
    }

    public function test_return_posted_with_the_serialised_expiry_keeps_the_batch_day(): void
    {
        // Exactly what the till sends back: the expiry it was given for the sale line.
        $sold = $this->actingAs($this->user, 'sanctum')
            ->withHeader('X-Store-Id', (string) $this->store->id)
            ->getJson('/api/invoices/' . $this->invoice->id);
        $echoed = data_get($sold->json(), 'items.0.expiry_date', '2027-03-30T18:30:00.000000Z');

        $res = $this->actingAs($this->user, 'sanctum')
            ->withHeader('X-Store-Id', (string) $this->store->id)
            ->postJson('/api/returns/sales', [
                'original_invoice_number' => $this->invoice->invoice_number,
                'items' => [[
                    'product_id' => $this->product->id,
                    'batch_no' => 'EX1',
                    'expiry_date' => $echoed,
                    'qty' => 1,
                    'loose_qty' => 0,
                    'units_per_pack' => 10,
                ]],
            ]);
        $res->assertStatus(201);

        $creditNoteId = $res->json('invoice.id');
        $raw = DB::table('invoice_items')->where('invoice_id', $creditNoteId)->value('expiry_date');

        $this->assertSame('2027-03-31', substr((string) $raw, 0, 10));
        $this->assertStringNotContainsString('18:30', (string) $raw);
    }
}
