<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockAdjustmentDocument;
use App\Models\Store;
use App\Services\StockAdjustmentPolicy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ADJ-01 — the daily adjustment guard belongs to the principal doing the
 * posting. At a till that principal is the counter, not a signed-in person.
 */
class CounterStockAdjustmentLimitTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Counter Policy Store',
            'code' => 'CP01',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Policy Paracetamol',
            'barcode' => '8902222000011',
            'hsn_sac_code' => '30049099',
            'mrp' => 35,
            'sel_rate' => 32,
            'gst_percent' => 12,
            'current_stock' => 500,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'CP-B1',
            'expiry_date' => '2029-12-31',
            'stock_qty' => 500,
            'mrp' => 35,
            'selling_rate' => 32,
            'purchase_rate' => 24,
            'version' => 1,
        ]);
    }

    private function setPolicy(array $policy): void
    {
        app(StockAdjustmentPolicy::class)->save($this->store->id, $policy);
    }

    private function postAdjustment(float $qty, string $counterCode = 'C01', ?string $documentId = null): \Illuminate\Testing\TestResponse
    {
        return $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/stock/adjustments', [
                'store_id' => $this->store->id,
                'counter_code' => $counterCode,
                'document_id' => $documentId ?? ('cp_adj_' . uniqid()),
                'mode' => 'adjustment',
                'notes' => 'Counter audit',
                'document_date' => now()->toDateString(),
                'lines' => [[
                    'product_id' => $this->product->id,
                    'batch_id' => $this->batch->id,
                    'adjustment_qty' => $qty,
                    'reason' => 'Found Stock',
                ]],
            ]);
    }

    public function test_counter_is_limited_by_daily_document_count(): void
    {
        $this->setPolicy(['max_documents_per_day' => 3]);

        for ($i = 1; $i <= 3; $i++) {
            $this->postAdjustment(1)->assertCreated();
        }

        $fourth = $this->postAdjustment(1)->assertStatus(422);
        $this->assertStringContainsString('Daily stock adjustment limit', json_encode($fourth->json()));

        $this->assertSame(3, StockAdjustmentDocument::where('store_id', $this->store->id)->count());
    }

    public function test_limit_is_per_counter_not_per_store(): void
    {
        $this->setPolicy(['max_documents_per_day' => 2]);

        $this->postAdjustment(1, 'C01')->assertCreated();
        $this->postAdjustment(1, 'C01')->assertCreated();
        $this->postAdjustment(1, 'C01')->assertStatus(422);

        // A second counter in the same store has its own allowance.
        $this->postAdjustment(1, 'C02')->assertCreated();
        $this->postAdjustment(1, 'C02')->assertCreated();
        $this->postAdjustment(1, 'C02')->assertStatus(422);

        $this->assertSame(2, Counter::where('store_id', $this->store->id)->count());
        $this->assertSame(4, StockAdjustmentDocument::where('store_id', $this->store->id)->count());
    }

    public function test_daily_units_cap_is_cumulative(): void
    {
        $this->setPolicy(['max_units_per_day' => 10]);

        $this->postAdjustment(6)->assertCreated();

        $second = $this->postAdjustment(6)->assertStatus(422);
        $this->assertStringContainsString('units', strtolower(json_encode($second->json())));
    }

    public function test_an_adjustment_queued_while_offline_counts_against_the_same_counter(): void
    {
        $this->setPolicy(['max_documents_per_day' => 2]);

        $this->postAdjustment(1, 'C01')->assertCreated();

        $sync = fn (string $documentId) => $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/sync/push/batch', [
                'store_id' => $this->store->id,
                'items' => [[
                    'id' => 'queue_' . $documentId,
                    'entity_type' => 'stock_adjustment',
                    'action' => 'create',
                    'payload' => [
                        'id' => 'queue_' . $documentId,
                        'document_id' => $documentId,
                        'mode' => 'adjustment',
                        'notes' => 'Queued while offline',
                        'store_id' => $this->store->id,
                        'counter_code' => 'C01',
                        'lines' => [[
                            'product_id' => $this->product->id,
                            'batch_id' => $this->batch->id,
                            'adjustment_qty' => 1,
                            'reason' => 'Found Stock',
                        ]],
                    ],
                ]],
            ]);

        $sync('cp_offline_1')->assertOk()->assertJsonPath('results.processed', 1);

        $liveCounter = StockAdjustmentDocument::where('store_id', $this->store->id)->orderBy('id')->value('counter_id');
        $syncedCounter = StockAdjustmentDocument::where('document_id', 'cp_offline_1')->value('counter_id');
        $this->assertNotNull($syncedCounter, 'A synced adjustment must remember the counter that posted it');
        $this->assertSame($liveCounter, $syncedCounter);

        $refused = $sync('cp_offline_2')->assertOk()->json('results.errors.0.error');
        $this->assertStringContainsString('Daily stock adjustment limit', (string) $refused);
        $this->assertDatabaseMissing('stock_adjustment_documents', ['document_id' => 'cp_offline_2']);
    }

    public function test_rejected_documents_do_not_count_against_the_limit(): void
    {
        $this->setPolicy(['max_documents_per_day' => 1]);

        $doc = StockAdjustmentDocument::create([
            'document_id' => 'cp_rejected_1',
            'store_id' => $this->store->id,
            'mode' => 'adjustment',
            'document_date' => now()->toDateString(),
            'status' => 'rejected',
            'lines_count' => 1,
            'total_qty' => 5,
            'total_value' => 100,
            'counter_id' => Counter::create([
                'store_id' => $this->store->id,
                'counter_code' => 'C01',
                'counter_name' => 'Counter C01',
            ])->id,
        ]);

        $this->assertNotNull($doc);

        $this->postAdjustment(1)->assertCreated();
    }

    public function test_ledger_row_names_the_counter_that_posted(): void
    {
        $documentId = 'cp_ledger_counter';
        $this->postAdjustment(2, 'C01', $documentId)->assertCreated();

        $document = StockAdjustmentDocument::where('document_id', $documentId)->firstOrFail();
        $this->assertNotNull($document->counter_id, 'A till document remembers its counter');

        $entry = \App\Models\StockLedgerEntry::where('reference_id', $documentId)->firstOrFail();
        $this->assertSame((int) $document->counter_id, (int) $entry->counter_id);
        $this->assertSame(Counter::find($document->counter_id)->counter_code, $entry->counter_code);
    }

    public function test_a_post_with_no_person_and_no_counter_is_still_limited(): void
    {
        $this->setPolicy(['max_documents_per_day' => 1]);

        StockAdjustmentDocument::create([
            'document_id' => 'cp_anonymous_1',
            'store_id' => $this->store->id,
            'mode' => 'adjustment',
            'document_date' => now()->toDateString(),
            'status' => 'posted',
            'lines_count' => 1,
            'total_qty' => 1,
            'total_value' => 24,
        ]);

        $check = app(StockAdjustmentPolicy::class)->validate(
            $this->store->id,
            null,
            [['product_id' => $this->product->id, 'system_qty' => 500, 'adjustment_qty' => 1, 'unit_cost' => 24]],
            'adjustment',
            'Counter audit',
            now()->toDateString(),
            null
        );

        $this->assertNotEmpty($check['errors']);
        $this->assertStringContainsString('Daily stock adjustment limit', $check['blocker']);
    }
}
