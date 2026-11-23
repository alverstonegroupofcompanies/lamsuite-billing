<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\User;
use App\Services\Gst\GstWorkingPaperService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * G3-PURCHASE-SYNC: the refusals and postings a purchase must guarantee.
 *
 * PUR-01 a charge the till labels by its own state spelling is still judged by the bill's
 *        place of supply; PUR-05 a bill entered on the server creates the batch, moves the
 *        shelf and raises the payable; PUR-06 one supplier bill number is filed once;
 *        PUR-07 a return can only send back units the store actually holds, and its tax
 *        reduces the input credit its inward bill claimed.
 */
class PurchasePostingGuardsTest extends TestCase
{
    use RefreshDatabase;

    private Store $pharmacy;
    private Party $supplier;
    private Product $tablets;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->pharmacy = Store::create([
            'name' => 'Guard Pharmacy',
            'code' => 'GRD01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Guard Owner',
            'email' => 'owner@guard.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->pharmacy->id,
        ]);

        Sanctum::actingAs($this->owner);

        $this->supplier = Party::create([
            'store_id' => $this->pharmacy->id,
            'type' => 'supplier',
            'name' => 'Guard Distributors',
            'gstin' => '32AAAAA3333DD3Z9',
            'is_active' => true,
        ]);

        $this->tablets = Product::create([
            'store_id' => $this->pharmacy->id,
            'name' => 'Guard Tablets',
            'current_stock' => 0,
            'mrp' => 30.00,
            'sel_rate' => 25.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 5,
            'is_active' => true,
        ]);
    }

    private function line(array $overrides = []): array
    {
        return array_merge([
            'product_id' => $this->tablets->id,
            'product_name' => $this->tablets->name,
            'batch_no' => 'B-GUARD-1',
            'expiry_date' => '2028-12-31',
            'pack_qty' => 1,
            'units_per_pack' => 5,
            'purchase_rate' => 100,
            'mrp' => 30,
            'gst_percent' => 12,
        ], $overrides);
    }

    private function bill(array $overrides = [], array $lineOverrides = []): array
    {
        return array_merge([
            'store_id' => $this->pharmacy->id,
            'supplier_id' => $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'invoice_number' => 'GUARD-1001',
            'invoice_date' => '2026-11-19',
            'lines' => [$this->line($lineOverrides)],
        ], $overrides);
    }

    private function pushedBill(array $overrides = [], array $itemOverrides = []): array
    {
        return array_merge([
            'id' => 'pur_guard_1',
            'purchase_number' => 'QA-PUR-GUARD-1',
            'supplier_invoice_no' => 'SUP-GUARD-1',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'purchase_date' => '2026-11-19',
            'store_id' => (string) $this->pharmacy->id,
            'module_key' => 'purchase',
            'status' => 'received',
            'grand_total' => 448,
            'subtotal' => 400,
            'tax_total' => 48,
            'items' => [array_merge([
                'product_id' => (string) $this->tablets->id,
                'product_name' => $this->tablets->name,
                'batch_no' => 'B-GUARD-1',
                'expiry_date' => '2028-12-31',
                'pack_qty' => 4,
                'units_per_pack' => 1,
                'purchase_rate' => 100,
                'mrp' => 30,
                'gst_percent' => 12,
                'taxable_amount' => 400,
                'tax_amount' => 48,
                'total_amount' => 448,
            ], $itemOverrides)],
        ], $overrides);
    }

    private function pushBill(array $overrides = [], array $itemOverrides = []): \Illuminate\Testing\TestResponse
    {
        return $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/sync/push/purchases', ['purchases' => [$this->pushedBill($overrides, $itemOverrides)]]);
    }

    private function pushReturn(array $overrides = [], array $lineOverrides = []): \Illuminate\Testing\TestResponse
    {
        $payload = array_merge([
            'id' => 'pr_guard_1',
            'return_number' => 'PR-GUARD-1',
            'return_date' => '2026-11-20',
            'original_purchase_id' => 'pur_guard_1',
            'original_purchase_number' => 'QA-PUR-GUARD-1',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'supplier_invoice_no' => 'SUP-GUARD-1',
            'store_id' => (string) $this->pharmacy->id,
            'module_key' => 'purchase_return',
            'status' => 'completed',
            'grand_total' => 224,
            'subtotal' => 200,
            'tax_total' => 24,
            'settlement_type' => 'credit_adjust',
            'lines' => [array_merge([
                'product_id' => (string) $this->tablets->id,
                'product_name' => $this->tablets->name,
                'batch_no' => 'B-GUARD-1',
                'expiry_date' => '2028-12-31',
                'purchased_qty' => 4,
                'return_qty' => 2,
                'purchase_rate' => 100,
                'gst_percent' => 12,
                'taxable_amount' => 200,
                'cgst_amount' => 12,
                'sgst_amount' => 12,
                'tax_amount' => 24,
                'total_amount' => 224,
            ], $lineOverrides)],
        ], $overrides);

        return $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/sync/push/purchases', ['purchases' => [$payload]]);
    }

    private function batch(): ProductBatch
    {
        return ProductBatch::where('store_id', $this->pharmacy->id)
            ->where('product_id', $this->tablets->id)
            ->where('batch_no', 'B-GUARD-1')
            ->firstOrFail();
    }

    // ── PUR-01 ────────────────────────────────────────────────────────────────
    public function test_a_charge_labelled_with_the_tills_state_name_is_not_refused(): void
    {
        // The offline screen prints the state as "32-Kerala" while the charge grid keeps "32".
        $this->pushBill([
            'place_of_supply' => '32-Kerala',
            'charges' => [[
                'head_code' => 'FREIGHT',
                'amount' => 5,
                'gst_percent' => 12,
                'place_of_supply' => '32',
            ]],
        ])->assertStatus(200)->assertJson(['ingested_count' => 1]);

        $charge = PurchaseCharge::where('head_code', 'FREIGHT')->firstOrFail();
        $this->assertSame('32', $charge->place_of_supply);
        $this->assertSame(1, Purchase::where('store_id', $this->pharmacy->id)->count());
    }

    // ── PUR-05 ────────────────────────────────────────────────────────────────
    public function test_a_bill_entered_on_the_server_creates_the_batch_and_raises_the_payable(): void
    {
        $this->postJson('/api/purchases', $this->bill([], ['pack_qty' => 2]))
            ->assertCreated();

        $purchase = Purchase::where('store_id', $this->pharmacy->id)
            ->where('invoice_number', 'GUARD-1001')
            ->firstOrFail();
        $item = $purchase->items()->firstOrFail();

        $this->assertEqualsWithDelta(2.0, (float) $item->qty, 0.001, 'the billed quantity is packs, not the ten units they hold');
        $this->assertEqualsWithDelta(200.0, (float) $purchase->subtotal, 0.001);
        $this->assertEqualsWithDelta(224.0, (float) $purchase->grand_total, 0.001);

        $this->assertEqualsWithDelta(10.0, (float) $this->batch()->stock_qty, 0.001, 'two packs of five is ten tablets on the shelf');
        $this->assertEqualsWithDelta(10.0, (float) $this->tablets->fresh()->current_stock, 0.001);

        $entry = StockLedgerEntry::where('store_id', $this->pharmacy->id)
            ->where('reference_type', 'PURCHASE')
            ->where('reference_id', (string) $purchase->id)
            ->where('event_type', 'PURCHASE_RECEIPT')
            ->first();
        $this->assertNotNull($entry, 'a saved inward has to leave a stock ledger row');
        $this->assertEqualsWithDelta(10.0, (float) $entry->qty_delta, 0.001);

        $this->assertEqualsWithDelta(224.0, (float) $this->supplier->fresh()->current_balance, 0.001, 'the supplier is owed the bill');
    }

    // ── PUR-06 ────────────────────────────────────────────────────────────────
    public function test_the_same_supplier_bill_is_refused_a_second_time(): void
    {
        $this->postJson('/api/purchases', $this->bill())->assertCreated();

        $this->postJson('/api/purchases', $this->bill())
            ->assertStatus(422)
            ->assertJsonValidationErrors(['invoice_number']);

        $this->assertSame(1, Purchase::where('store_id', $this->pharmacy->id)->count());
        $this->assertEqualsWithDelta(5.0, (float) $this->tablets->fresh()->current_stock, 0.001, 'the refused bill must not add stock');
    }

    public function test_a_till_push_with_a_new_id_but_the_same_supplier_bill_is_failed_not_duplicated(): void
    {
        $this->postJson('/api/sync/push/batch', ['items' => [[
            'id' => 'queue-1',
            'entity_type' => 'purchase',
            'action' => 'create',
            'payload' => $this->pushedBill(),
        ]]])->assertStatus(200)->assertJson(['results' => ['processed' => 1, 'failed' => 0]]);

        $second = $this->postJson('/api/sync/push/batch', ['items' => [[
            'id' => 'queue-2',
            'entity_type' => 'purchase',
            'action' => 'create',
            'payload' => $this->pushedBill(['id' => 'pur_guard_2', 'external_id' => 'pur_guard_2']),
        ]]]);

        $second->assertStatus(200)->assertJson(['results' => ['processed' => 0, 'failed' => 1]]);
        $this->assertSame('queue-2', $second->json('results.errors.0.id'));
        $this->assertStringContainsString('already recorded', (string) $second->json('results.errors.0.error'));

        $this->assertSame(1, Purchase::where('store_id', $this->pharmacy->id)->count());
        $this->assertEqualsWithDelta(4.0, (float) $this->tablets->fresh()->current_stock, 0.001);
    }

    // ── PUR-07 ────────────────────────────────────────────────────────────────
    public function test_a_return_larger_than_the_batch_on_hand_is_refused_and_changes_nothing(): void
    {
        $this->pushBill(['grand_total' => 448])->assertStatus(200);
        $this->assertEqualsWithDelta(4.0, (float) $this->batch()->stock_qty, 0.001);

        $this->pushReturn([], ['return_qty' => 5, 'taxable_amount' => 500, 'tax_amount' => 60])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['items']);

        $this->assertEqualsWithDelta(4.0, (float) $this->batch()->stock_qty, 0.001, 'a refused note must not move stock');
        $this->assertEqualsWithDelta(4.0, (float) $this->tablets->fresh()->current_stock, 0.001);
        $this->assertSame(0, Purchase::where('store_id', $this->pharmacy->id)->where('module_key', 'purchase_return')->count());
        $this->assertEqualsWithDelta(448.0, (float) $this->supplier->fresh()->current_balance, 0.001);
    }

    public function test_a_valid_return_takes_stock_back_and_credits_the_supplier(): void
    {
        $this->pushBill()->assertStatus(200);
        $this->pushReturn()->assertStatus(200)->assertJson(['ingested_count' => 1]);

        $this->assertEqualsWithDelta(2.0, (float) $this->batch()->stock_qty, 0.001);
        $this->assertEqualsWithDelta(2.0, (float) $this->tablets->fresh()->current_stock, 0.001);

        $entry = StockLedgerEntry::where('store_id', $this->pharmacy->id)
            ->where('reference_type', 'PURCHASE_RETURN')
            ->where('event_type', 'PURCHASE_RETURN')
            ->first();
        $this->assertNotNull($entry, 'a debit note has to leave a stock ledger row');
        $this->assertEqualsWithDelta(-2.0, (float) $entry->qty_delta, 0.001);

        $this->assertEqualsWithDelta(224.0, (float) $this->supplier->fresh()->current_balance, 0.001, 'the inward is reduced by the debit note');
    }

    public function test_a_second_return_beyond_what_is_left_is_refused(): void
    {
        $this->pushBill()->assertStatus(200);
        $this->pushReturn()->assertStatus(200);

        $this->pushReturn([
            'id' => 'pr_guard_2',
            'return_number' => 'PR-GUARD-2',
        ], ['return_qty' => 3, 'taxable_amount' => 300, 'tax_amount' => 36])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['items']);

        $this->assertEqualsWithDelta(2.0, (float) $this->batch()->stock_qty, 0.001, 'only the two units still on hand could go back');
        $this->assertSame(1, Purchase::where('store_id', $this->pharmacy->id)->where('module_key', 'purchase_return')->count());
    }

    public function test_the_debit_note_reduces_input_tax_in_the_working_paper(): void
    {
        $this->pushBill()->assertStatus(200);
        $this->pushReturn()->assertStatus(200);

        $gstr9 = app(GstWorkingPaperService::class)->gstr9(
            [$this->pharmacy->id],
            '2026-11-01',
            '2026-11-30'
        );

        // 400 + 48 inward, less 200 + 24 returned: the note cancels the credit it claimed.
        $this->assertEqualsWithDelta(200.0, (float) $gstr9['itc']['total_taxable'], 0.01);
        $this->assertEqualsWithDelta(24.0, (float) $gstr9['itc']['total_itc'], 0.01);
    }
}
