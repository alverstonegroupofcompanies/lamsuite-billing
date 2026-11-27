<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A return lives in the same table as the bill it reverses, tagged by module_key, so the till's
 * return screens need the list split by family — and split without ever letting a query string
 * choose whose book is read.
 */
class TillReturnListTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        // B first so "the first store" is never the right answer.
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'STB', 'state_code' => '29', 'is_active' => true]);
        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'STA', 'state_code' => '32', 'is_active' => true]);

        $counter = Counter::create(['store_id' => $this->storeA->id, 'counter_code' => 'C01', 'counter_name' => 'A Front']);
        $issued = ActivationKey::generateForCounter($counter);
        $this->token = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => 'returns-probe-device',
        ])->assertOk()->json('device_token');
    }

    private function asCounter(): array
    {
        return ['X-Device-Token' => $this->token];
    }

    private function invoice(Store $store, string $number, array $over = []): Invoice
    {
        $invoice = Invoice::create(array_merge([
            'store_id' => $store->id,
            'module_key' => 'invoice',
            'invoice_number' => $number,
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'subtotal' => 100,
            'tax_total' => 10.71,
            'grand_total' => 100,
            'paid_amount' => 100,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ], $over));

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_name' => 'Paracetamol 500mg',
            'batch_no' => 'PA-1',
            'qty' => 1,
            'unit_price' => 100,
            'gst_percent' => 12,
            'taxable_amount' => 89.29,
            'total_amount' => 100,
        ]);

        return $invoice;
    }

    private function purchase(Store $store, string $number, array $over = []): Purchase
    {
        $purchase = Purchase::create(array_merge([
            'store_id' => $store->id,
            'module_key' => 'purchase',
            'invoice_number' => $number,
            'supplier_name' => 'ACME Distributors',
            'supplier_invoice_no' => "ACME-{$number}",
            'invoice_date' => now()->toDateString(),
            'subtotal' => 500,
            'tax_total' => 60,
            'grand_total' => 560,
            'status' => 'received',
        ], $over));

        PurchaseItem::create([
            'purchase_id' => $purchase->id,
            'product_name' => 'Amoxicillin 500mg',
            'batch_no' => 'AMX-1',
            'pack_qty' => 5,
            'units_per_pack' => 10,
            'qty' => 5,
            'purchase_rate' => 80,
            'gst_percent' => 12,
            'taxable_amount' => 500,
            'total_amount' => 560,
        ]);

        return $purchase;
    }

    private function numbers(array $rows): array
    {
        return collect($rows)->pluck('invoice_number')->all();
    }

    public function test_the_credit_note_filter_answers_only_the_stores_returns(): void
    {
        $this->invoice($this->storeA, 'STA-INV-1');
        $this->invoice($this->storeA, 'CN-1-0001', [
            'module_key' => 'credit_note',
            'grand_total' => -100,
            'original_invoice_number' => 'STA-INV-1',
        ]);
        // A return raised by an older till left the tag empty; the negative total is what says so.
        $this->invoice($this->storeA, 'CN-UNTYPED', ['module_key' => '', 'grand_total' => -250]);
        $this->invoice($this->storeB, 'STB-INV-1');
        $this->invoice($this->storeB, 'CN-STB', ['module_key' => 'credit_note', 'grand_total' => -50]);

        $notes = $this->withHeaders($this->asCounter())->getJson('/api/invoices?module=credit_notes')
            ->assertOk()->json('data');

        $this->assertEqualsCanonicalizing(['CN-1-0001', 'CN-UNTYPED'], $this->numbers($notes));
        $this->assertSame('Paracetamol 500mg', $notes[0]['items'][0]['product_name']);

        $sales = $this->withHeaders($this->asCounter())->getJson('/api/invoices?module=invoices')
            ->assertOk();
        $this->assertEqualsCanonicalizing(['STA-INV-1'], $this->numbers($sales->json('data')));

        // No filter keeps the whole book, which is what the Bills screen has always asked for.
        $all = $this->withHeaders($this->asCounter())->getJson('/api/invoices')->assertOk();
        $this->assertCount(3, $all->json('data'));
    }

    public function test_the_purchase_filter_separates_inward_bills_from_debit_notes(): void
    {
        $this->purchase($this->storeA, 'PUR-1');
        $this->purchase($this->storeA, 'PR-1', [
            'module_key' => 'purchase_return',
            'grand_total' => -560,
            'status' => 'completed',
        ]);
        $this->purchase($this->storeA, 'DN-1', ['module_key' => 'debit_note', 'grand_total' => -100]);
        $this->purchase($this->storeA, 'PO-1', ['module_key' => 'purchase_order', 'status' => 'draft']);
        // A bill whose tag was never filled in must still be offered as a bill to return against.
        $this->purchase($this->storeA, 'PUR-UNTYPED', ['module_key' => '']);
        $this->purchase($this->storeB, 'PUR-B');
        $this->purchase($this->storeB, 'PR-B', ['module_key' => 'purchase_return', 'grand_total' => -10]);

        $notes = $this->withHeaders($this->asCounter())->getJson('/api/purchases?module=purchase_returns')
            ->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['PR-1', 'DN-1'], $this->numbers($notes));

        $bills = $this->withHeaders($this->asCounter())->getJson('/api/purchases?module=purchases')
            ->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['PUR-1', 'PUR-UNTYPED'], $this->numbers($bills));
        $this->assertSame('Amoxicillin 500mg', $bills[0]['items'][0]['product_name']);

        $searchable = $this->withHeaders($this->asCounter())->getJson('/api/purchases?module=purchases&search=pur-1')
            ->assertOk();
        $this->assertEqualsCanonicalizing(['PUR-1'], $this->numbers($searchable->json('data')));

        $everything = $this->withHeaders($this->asCounter())->getJson('/api/purchases')->assertOk();
        $this->assertCount(5, $everything->json('data'));
    }

    public function test_a_query_string_cannot_point_the_purchase_list_at_another_store(): void
    {
        $this->purchase($this->storeA, 'PUR-A');
        $this->purchase($this->storeB, 'PUR-B');
        $this->purchase($this->storeB, 'PR-B', ['module_key' => 'purchase_return', 'grand_total' => -10]);

        // The counter middleware refuses a till that names another store, and even if it did not,
        // the list is built from the token's store rather than the query string.
        $this->withHeaders($this->asCounter())
            ->getJson('/api/purchases?store_id=' . $this->storeB->id)
            ->assertStatus(403);

        $list = $this->withHeaders($this->asCounter())->getJson('/api/purchases')->assertOk();
        $this->assertEqualsCanonicalizing(['PUR-A'], $this->numbers($list->json('data')));

        $notes = $this->withHeaders($this->asCounter())
            ->getJson('/api/purchases?module=purchase_returns')
            ->assertOk();
        $this->assertSame([], $notes->json('data'));
    }
}
