<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * One quantity contract for every sales path: packs, loose units, units_per_pack
 * and the resulting base units. The server owns the rule; the till only sends
 * what the operator typed.
 */
class InvoiceQuantityContractTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;

    protected function setUp(): void
    {
        parent::setUp();
        // G1-SEC: till routes need a claimed counter; this stands one in for the store each request names.
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Contract Store',
            'code' => 'CTS01',
            'is_active' => true,
        ]);

        Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Billing Counter 01',
            'location_name' => 'Ground Floor',
            'status' => 'active',
            'device_uuid' => 'uuid_counter_c01',
        ]);
    }

    private function productWithStock(int $unitsPerPack, int $stock, bool $allowLoose = true): array
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin ' . $unitsPerPack,
            'barcode' => '8900000000' . $unitsPerPack,
            'current_stock' => $stock,
            'mrp' => 20.00,
            'sel_rate' => 18.00,
            'gst_percent' => 12.00,
            'units_per_pack' => $unitsPerPack,
            'allow_loose_sale' => $allowLoose,
            'is_active' => true,
        ]);

        $batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'BCH-' . $unitsPerPack,
            'expiry_date' => '2027-12-31',
            'stock_qty' => $stock,
            'mrp' => 20.00,
            'selling_rate' => 18.00,
        ]);

        return [$product, $batch];
    }

    private function sell(Product $product, ProductBatch $batch, array $line): \Illuminate\Testing\TestResponse
    {
        return $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in Customer',
                'items' => [
                    array_merge([
                        'product_id' => $product->id,
                        'batch_id' => $batch->id,
                        'unit_price' => 18.00,
                    ], $line),
                ],
            ]);
    }

    public function test_loose_only_line_is_accepted_and_deducts_base_units(): void
    {
        [$product, $batch] = $this->productWithStock(unitsPerPack: 10, stock: 30);

        $res = $this->sell($product, $batch, [
            'qty' => 0,
            'loose_qty' => 3,
            'units_per_pack' => 10,
        ]);

        $res->assertStatus(201)->assertJson(['success' => true]);

        $this->assertEquals(27, $batch->fresh()->stock_qty);
        $this->assertEquals(27, $product->fresh()->current_stock);

        $item = Invoice::latest('id')->firstOrFail()->items()->firstOrFail();
        $this->assertEquals(0, (float) $item->qty);
        $this->assertEquals(3, (float) $item->loose_qty);
        $this->assertEquals(10, (int) $item->units_per_pack);
    }

    public function test_packs_plus_loose_deducts_combined_base_units(): void
    {
        [$product, $batch] = $this->productWithStock(unitsPerPack: 10, stock: 30);

        $res = $this->sell($product, $batch, [
            'qty' => 2,
            'loose_qty' => 5,
            'units_per_pack' => 10,
        ]);

        $res->assertStatus(201);
        $this->assertEquals(5, $batch->fresh()->stock_qty);
    }

    public function test_zero_quantity_is_rejected_with_structured_error(): void
    {
        [$product, $batch] = $this->productWithStock(unitsPerPack: 10, stock: 30);

        $res = $this->sell($product, $batch, [
            'qty' => 0,
            'loose_qty' => 0,
            'units_per_pack' => 10,
        ]);

        $res->assertStatus(422)
            ->assertJson([
                'success' => false,
                'code' => 'QUANTITY_REQUIRED',
                'rule' => 'quantity_positive',
                'line' => 1,
                'field' => 'qty',
            ]);

        $this->assertNotEmpty($res->json('error'));
        $this->assertNotEmpty($res->json('fix'));
    }

    public function test_fractional_packs_are_rejected_when_pack_holds_several_units(): void
    {
        [$product, $batch] = $this->productWithStock(unitsPerPack: 15, stock: 30);

        $res = $this->sell($product, $batch, [
            'qty' => 1.2,
            'loose_qty' => 0,
            'units_per_pack' => 15,
        ]);

        $res->assertStatus(422)
            ->assertJson([
                'success' => false,
                'code' => 'PACKS_MUST_BE_WHOLE',
                'rule' => 'whole_packs',
                'line' => 1,
                'field' => 'qty',
            ]);
    }

    public function test_loose_units_are_rejected_when_product_disallows_them(): void
    {
        [$product, $batch] = $this->productWithStock(unitsPerPack: 10, stock: 30, allowLoose: false);

        $res = $this->sell($product, $batch, [
            'qty' => 1,
            'loose_qty' => 1,
            'units_per_pack' => 10,
        ]);

        $res->assertStatus(422)
            ->assertJson([
                'success' => false,
                'code' => 'LOOSE_NOT_ALLOWED',
                'rule' => 'loose_permission',
                'line' => 1,
                'field' => 'loose_qty',
            ]);
    }

    public function test_insufficient_stock_is_reported_in_base_units(): void
    {
        [$product, $batch] = $this->productWithStock(unitsPerPack: 10, stock: 15);

        \App\Models\CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'inventory_settings',
            'value' => ['allow_negative_stock' => false],
        ]);

        // 2 packs = 20 base units, but only 15 are in the batch.
        $res = $this->sell($product, $batch, [
            'qty' => 2,
            'loose_qty' => 0,
            'units_per_pack' => 10,
        ]);

        $res->assertStatus(422)
            ->assertJson([
                'success' => false,
                'code' => 'INSUFFICIENT_STOCK',
                'rule' => 'stock_available',
                'line' => 1,
                'field' => 'batch_id',
            ]);

        $fix = (string) $res->json('fix');
        $this->assertStringContainsString('Available: 15', $fix);
        $this->assertStringContainsString('requested: 20', $fix);

        // Failed sale must not touch stock.
        $this->assertEquals(15, $batch->fresh()->stock_qty);
    }
}
