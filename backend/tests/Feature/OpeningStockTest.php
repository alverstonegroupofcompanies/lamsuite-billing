<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STK-01 / PRD-01 — opening stock is a ledger event, and an absent batch is
 * absent. Creating a product must never invent "B1" or an expiry date, and the
 * batch it does create must move products.current_stock through the ledger.
 */
class OpeningStockTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Opening Stock Store',
            'code' => 'OPEN01',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Opening Owner',
            'email' => 'owner@opening.in',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);
    }

    private function productPayload(array $overrides = []): array
    {
        return array_merge([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 650mg',
            'barcode' => '8901111000011',
            'hsn_sac_code' => '30049099',
            'mrp' => 35,
            'sel_rate' => 30,
            'ptr' => 22,
            'gst_percent' => 12,
            'units_per_pack' => 10,
        ], $overrides);
    }

    public function test_product_create_with_initial_batch_ledgers_and_syncs_stock(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/products', $this->productPayload([
            'initial_batch' => [
                'batch_no' => 'OPEN-01',
                'expiry_date' => '2028-12-31',
                'stock_qty' => 40,
            ],
        ]));

        $response->assertCreated();

        $product = Product::findOrFail($response->json('id'));
        $this->assertEquals(40, (float) $product->current_stock, 'Opening stock must reach the product row');

        $batch = ProductBatch::where('product_id', $product->id)->first();
        $this->assertNotNull($batch);
        $this->assertSame('OPEN-01', $batch->batch_no);
        $this->assertEquals(40, (float) $batch->stock_qty);

        $ledger = StockLedgerEntry::where('product_id', $product->id)
            ->where('event_type', 'OPENING_STOCK')
            ->get();
        $this->assertCount(1, $ledger, 'Opening stock must leave exactly one ledger row');
        $this->assertEquals(40, (float) $ledger->sum('qty_delta'));
    }

    public function test_product_create_without_initial_batch_creates_no_batch(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/products', $this->productPayload());

        $response->assertCreated();

        $productId = $response->json('id');
        $this->assertSame(0, ProductBatch::where('product_id', $productId)->count(), 'No phantom batch may be created');
        $this->assertSame(0, StockLedgerEntry::where('product_id', $productId)->count());
        $this->assertEquals(0, (float) Product::find($productId)->current_stock);
    }

    public function test_zero_quantity_initial_batch_creates_no_batch(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/products', $this->productPayload([
            'barcode' => '8901111000028',
            'initial_batch' => [
                'batch_no' => '',
                'expiry_date' => '',
                'stock_qty' => 0,
            ],
        ]));

        $response->assertCreated();
        $this->assertSame(0, ProductBatch::where('product_id', $response->json('id'))->count());
    }

    public function test_positive_initial_stock_requires_batch_number_and_expiry(): void
    {
        $missingBatch = $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/products', $this->productPayload([
            'barcode' => '8901111000035',
            'initial_batch' => ['stock_qty' => 10],
        ]));
        $missingBatch->assertStatus(422);

        $missingExpiry = $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/products', $this->productPayload([
            'barcode' => '8901111000042',
            'initial_batch' => ['batch_no' => 'OPEN-02', 'stock_qty' => 10],
        ]));
        $missingExpiry->assertStatus(422);
    }

    public function test_product_update_cannot_overwrite_stock(): void
    {
        $created = $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/products', $this->productPayload([
            'barcode' => '8901111000059',
            'initial_batch' => [
                'batch_no' => 'OPEN-03',
                'expiry_date' => '2028-12-31',
                'stock_qty' => 40,
            ],
        ]))->assertCreated();

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/admin/products/{$created->json('id')}", [
                'name' => 'Paracetamol 650mg Tabs',
                'current_stock' => 999,
            ])
            ->assertOk();

        $product = Product::findOrFail($created->json('id'));
        $this->assertSame('Paracetamol 650mg Tabs', $product->name);
        $this->assertEquals(40, (float) $product->current_stock, 'An ordinary product edit must not rewrite stock');
    }

    private function createWithOpening(float $qty = 40): array
    {
        $created = $this->actingAs($this->admin, 'sanctum')->postJson('/api/admin/products', $this->productPayload([
            'initial_batch' => ['batch_no' => 'OPEN-01', 'expiry_date' => '2028-12-31', 'stock_qty' => $qty],
        ]))->assertCreated();

        $product = Product::findOrFail($created->json('id'));

        return [$product, ProductBatch::where('product_id', $product->id)->firstOrFail()];
    }

    private function assertLedgerMatchesBatches(Product $product): void
    {
        $this->assertEqualsWithDelta(
            (float) ProductBatch::where('product_id', $product->id)->sum('stock_qty'),
            (float) StockLedgerEntry::where('product_id', $product->id)->sum('qty_delta'),
            0.0005,
            'Ledger total must equal what the batches hold'
        );
        $this->assertEqualsWithDelta(
            (float) ProductBatch::where('product_id', $product->id)->sum('stock_qty'),
            (float) $product->fresh()->current_stock,
            0.0005
        );
    }

    public function test_opening_row_records_the_batch_balance(): void
    {
        [, $batch] = $this->createWithOpening(40);

        $entry = StockLedgerEntry::where('batch_id', $batch->id)->firstOrFail();
        $this->assertEquals(40, (float) $entry->balance_after);
    }

    public function test_editing_a_batch_quantity_books_the_difference(): void
    {
        [$product, $batch] = $this->createWithOpening(40);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/batches/{$batch->id}", ['stock_qty' => 30])
            ->assertOk();

        $correction = StockLedgerEntry::where('batch_id', $batch->id)->where('event_type', 'ADMIN_CORRECTION')->firstOrFail();
        $this->assertEquals(-10, (float) $correction->qty_delta);
        $this->assertEquals(30, (float) $correction->balance_after);
        $this->assertLedgerMatchesBatches($product);

        // An edit that leaves the quantity alone books nothing.
        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->putJson("/api/admin/batches/{$batch->id}", ['rack_location' => 'R2'])
            ->assertOk();
        $this->assertSame(1, StockLedgerEntry::where('batch_id', $batch->id)->where('event_type', 'ADMIN_CORRECTION')->count());
    }

    public function test_deleting_a_batch_with_stock_books_it_out(): void
    {
        [$product, $batch] = $this->createWithOpening(40);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->deleteJson("/api/admin/batches/{$batch->id}")
            ->assertOk();

        $this->assertNull(ProductBatch::find($batch->id));
        $this->assertEquals(-40, (float) StockLedgerEntry::where('product_id', $product->id)->where('event_type', 'ADMIN_CORRECTION')->sum('qty_delta'));
        $this->assertLedgerMatchesBatches($product);
    }

    public function test_adding_a_batch_posts_opening_stock(): void
    {
        [$product] = $this->createWithOpening(40);

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson("/api/admin/products/{$product->id}/batches", [
                'batch_no' => 'OPEN-02', 'expiry_date' => '2029-03-31', 'stock_qty' => 15,
                'mrp' => 35, 'selling_rate' => 30,
            ])->assertCreated();

        $this->assertEquals(55, (float) $product->fresh()->current_stock);
        $this->assertLedgerMatchesBatches($product);
    }
}
