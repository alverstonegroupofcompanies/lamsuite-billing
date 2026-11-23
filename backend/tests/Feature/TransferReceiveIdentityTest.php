<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockLedgerEntry;
use App\Models\StockTransfer;
use App\Models\Store;
use App\Models\TransferProductMapping;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STK-02 — a barcode is a lookup key, not an identity. When the destination
 * store's barcode twin disagrees about HSN/SAC, GST slab or pack size, receive
 * must refuse to guess: the receiver picks the product or asks for a copy.
 */
class TransferReceiveIdentityTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'QA Pharmacy', 'code' => 'QA-PH', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'QA Cosmetics', 'code' => 'QA-CS', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'super@g2.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => null,
        ]);
    }

    private function seedSource(int $qty = 30): Product
    {
        $product = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'QA Paracetamol 500mg',
            'barcode' => '8909000000011',
            'hsn_sac_code' => '30049099',
            'mrp' => 35,
            'sel_rate' => 30,
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => $qty,
        ]);

        ProductBatch::create([
            'store_id' => $this->storeA->id,
            'product_id' => $product->id,
            'batch_no' => 'QA-B1',
            'expiry_date' => '2030-06-30',
            'stock_qty' => $qty,
            'mrp' => 35,
            'selling_rate' => 30,
            'purchase_rate' => 24,
        ]);

        return $product;
    }

    private function seedConflictingTwin(): Product
    {
        return Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'QA Glow Face Cream 50g',
            'barcode' => '8909000000011',
            'hsn_sac_code' => '33049910',
            'mrp' => 499,
            'sel_rate' => 449,
            'gst_percent' => 18,
            'units_per_pack' => 1,
            'current_stock' => 0,
        ]);
    }

    private function dispatch(Product $source, string $transferNo): StockTransfer
    {
        $qty = (float) ProductBatch::where('product_id', $source->id)->where('batch_no', 'QA-B1')->value('stock_qty');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson('/api/stock/transfers', [
                'to_store_id' => $this->storeB->id,
                'transfer_no' => $transferNo,
                'lines' => [['product_id' => $source->id, 'batch_no' => 'QA-B1', 'qty' => $qty]],
            ])
            ->assertCreated();

        return StockTransfer::where('transfer_number', $transferNo)->firstOrFail();
    }

    private function receive(StockTransfer $transfer, array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeB->id])
            ->postJson("/api/stock/transfers/{$transfer->id}/receive", $body);
    }

    public function test_receive_rejects_barcode_match_when_identity_conflicts(): void
    {
        $source = $this->seedSource();
        $twin = $this->seedConflictingTwin();
        $transfer = $this->dispatch($source, 'TRF-G2-CONFLICT');

        $response = $this->receive($transfer);

        $response->assertStatus(422);
        $message = json_encode($response->json());
        $this->assertStringContainsString('QA Paracetamol 500mg', $message);
        $this->assertStringContainsString('QA Glow Face Cream 50g', $message);

        $twin->refresh();
        $this->assertEquals(0, (float) $twin->current_stock, 'A conflicting twin must not be credited');
        $this->assertSame(0, TransferProductMapping::count(), 'A rejected match must never be remembered');
        $this->assertSame(0, StockLedgerEntry::where('store_id', $this->storeB->id)->count());
        $this->assertSame('dispatched', $transfer->fresh()->status);
    }

    public function test_explicit_dest_product_resolves_a_conflict(): void
    {
        $source = $this->seedSource(10);
        $twin = $this->seedConflictingTwin();
        $transfer = $this->dispatch($source, 'TRF-G2-EXPLICIT');

        $item = $transfer->items()->firstOrFail();

        $this->receive($transfer, [
            'lines' => [
                ['item_id' => $item->id, 'dest_product_id' => $twin->id, 'received_qty' => 10],
            ],
        ])->assertOk();

        $twin->refresh();
        $this->assertEquals(10, (float) $twin->current_stock);
        $this->assertSame(
            $twin->id,
            TransferProductMapping::where('source_product_id', $source->id)->value('dest_product_id')
        );
    }

    public function test_auto_create_makes_a_separate_copy_when_the_barcode_twin_conflicts(): void
    {
        $source = $this->seedSource(10);
        $twin = $this->seedConflictingTwin();
        $transfer = $this->dispatch($source, 'TRF-G2-AUTOCREATE');

        $before = Product::where('store_id', $this->storeB->id)->count();

        $response = $this->receive($transfer, ['auto_create' => true])->assertOk();

        $this->assertSame($before + 1, Product::where('store_id', $this->storeB->id)->count());
        $copy = Product::where('store_id', $this->storeB->id)->where('name', 'QA Paracetamol 500mg')->firstOrFail();
        $this->assertNull($copy->barcode, 'The barcode belongs to the face cream in this store, so the copy has none');
        $this->assertSame('30049099', $copy->hsn_sac_code);
        $this->assertEquals(10, (float) $copy->current_stock);
        $this->assertSame($copy->id, $response->json('resolutions.0.dest_product_id'));

        $this->assertEquals(0, (float) $twin->fresh()->current_stock, 'The face cream is never credited');
        $this->assertSame('auto_create', TransferProductMapping::where('source_product_id', $source->id)->value('matched_by'));
    }

    public function test_conflict_returns_structured_unresolved_lines(): void
    {
        $source = $this->seedSource(10);
        $twin = $this->seedConflictingTwin();
        $transfer = $this->dispatch($source, 'TRF-G2-UNRESOLVED');
        $item = $transfer->items()->firstOrFail();

        $response = $this->receive($transfer)->assertStatus(422);

        $response->assertJsonPath('unresolved.0.item_id', $item->id);
        $response->assertJsonPath('unresolved.0.reason', 'attributes_differ');
        $response->assertJsonPath('unresolved.0.candidate.id', $twin->id);
        $this->assertNotEmpty($response->json('unresolved.0.differences'));
    }

    public function test_line_with_no_match_is_reported_as_unresolved(): void
    {
        $source = $this->seedSource(10);
        $transfer = $this->dispatch($source, 'TRF-G2-NOMATCH');

        $response = $this->receive($transfer)->assertStatus(422);

        $response->assertJsonPath('unresolved.0.reason', 'no_match');
        $response->assertJsonPath('unresolved.0.candidate', null);
        $this->assertStringContainsString('QA Paracetamol 500mg', $response->json('unresolved.0.message'));
        $this->assertSame('dispatched', $transfer->fresh()->status);
    }

    public function test_admin_receive_is_refused_outside_the_destination_store(): void
    {
        $source = $this->seedSource(10);
        $this->seedConflictingTwin();
        $transfer = $this->dispatch($source, 'TRF-G2-WRONGSTORE');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->postJson("/api/admin/inventory/transfers/{$transfer->id}/receive", ['auto_create' => true])
            ->assertNotFound();

        $this->assertSame('dispatched', $transfer->fresh()->status);
    }

    public function test_clean_barcode_match_still_auto_matches(): void
    {
        $source = $this->seedSource(10);

        // A sparse twin: same barcode, no HSN/GST/pack facts to disagree about.
        $twin = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'Store B Paracetamol',
            'barcode' => '8909000000011',
            'current_stock' => 0,
        ]);

        $transfer = $this->dispatch($source, 'TRF-G2-CLEAN');

        $this->receive($transfer)->assertOk();

        $twin->refresh();
        $this->assertEquals(10, (float) $twin->current_stock);
    }

    public function test_a_barcode_mapping_saved_before_the_fix_is_not_honoured(): void
    {
        $source = $this->seedSource(10);
        $twin = $this->seedConflictingTwin();

        TransferProductMapping::create([
            'from_store_id' => $this->storeA->id,
            'to_store_id' => $this->storeB->id,
            'source_product_id' => $source->id,
            'dest_product_id' => $twin->id,
            'matched_by' => 'barcode',
        ]);

        $transfer = $this->dispatch($source, 'TRF-G2-STALE');

        $this->receive($transfer)->assertStatus(422);

        $twin->refresh();
        $this->assertEquals(0, (float) $twin->current_stock, 'A stale machine mapping must stop crediting');
        // A refused receipt rolls back, so the stale row survives but keeps losing its
        // vote; stock:audit-transfer-mappings --apply removes it for good.
        $this->receive($transfer)->assertStatus(422);
        $this->assertEquals(0, (float) $twin->fresh()->current_stock);
    }

    public function test_a_mapping_a_person_chose_is_still_honoured(): void
    {
        $source = $this->seedSource(10);
        $twin = $this->seedConflictingTwin();

        TransferProductMapping::create([
            'from_store_id' => $this->storeA->id,
            'to_store_id' => $this->storeB->id,
            'source_product_id' => $source->id,
            'dest_product_id' => $twin->id,
            'matched_by' => 'manual',
        ]);

        $transfer = $this->dispatch($source, 'TRF-G2-REMEMBERED');

        $this->receive($transfer)->assertOk();
        $this->assertEquals(10, (float) $twin->fresh()->current_stock);
    }

    public function test_a_person_choice_replaces_a_stale_barcode_mapping(): void
    {
        $source = $this->seedSource(10);
        $twin = $this->seedConflictingTwin();
        $right = Product::create([
            'store_id' => $this->storeB->id,
            'name' => 'QA Paracetamol 500mg (branch)',
            'hsn_sac_code' => '30049099',
            'gst_percent' => 12,
            'units_per_pack' => 10,
            'current_stock' => 0,
        ]);

        TransferProductMapping::create([
            'from_store_id' => $this->storeA->id,
            'to_store_id' => $this->storeB->id,
            'source_product_id' => $source->id,
            'dest_product_id' => $twin->id,
            'matched_by' => 'barcode',
        ]);

        $transfer = $this->dispatch($source, 'TRF-G2-REPLACE');
        $this->receive($transfer)->assertStatus(422);

        $item = $transfer->items()->firstOrFail();
        $this->receive($transfer, ['lines' => [['item_id' => $item->id, 'dest_product_id' => $right->id]]])->assertOk();

        $mapping = TransferProductMapping::where('source_product_id', $source->id)->sole();
        $this->assertSame($right->id, (int) $mapping->dest_product_id);
        $this->assertSame('manual', $mapping->matched_by);
        $this->assertEquals(0, (float) $twin->fresh()->current_stock);
    }
}
