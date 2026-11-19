<?php

namespace Tests\Feature\Constitution;

use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * P-STORE-SCOPE constitution — consolidated reports.
 * Products are per-store, so the All-Stores consolidated item report groups
 * lines by an admin-chosen matching key per run (barcode / item code
 * (external_id) / name+unit) and lists unmatched lines separately.
 * No merges are stored — the aggregation is computed per run.
 */
class ConsolidatedReportMatchingTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Store A', 'code' => 'SA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Store B', 'code' => 'SB', 'state_code' => '32', 'is_active' => true]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin', 'email' => 'super@test.in', 'password' => bcrypt('password123'),
            'role' => 'super_admin', 'store_id' => null, 'allowed_store_ids' => null,
        ]);
    }

    private function sell(Product $product, Store $store, string $number, float $qty, float $revenue): void
    {
        $inv = Invoice::create([
            'store_id' => $store->id,
            'invoice_number' => $number,
            'invoice_date' => Carbon::today(),
            'customer_name' => 'Walk-in',
            'subtotal' => $revenue,
            'tax_total' => 0,
            'grand_total' => $revenue,
            'paid_amount' => $revenue,
            'payment_mode' => 'Cash',
            'status' => 'issued',
            'module_key' => 'invoice',
        ]);

        InvoiceItem::create([
            'invoice_id' => $inv->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'qty' => $qty,
            'unit_price' => $qty > 0 ? round($revenue / $qty, 4) : $revenue,
            'gst_percent' => 0,
            'taxable_amount' => $revenue,
            'tax_amount' => 0,
            'total_amount' => $revenue,
        ]);
    }

    private function product(Store $store, string $name, ?string $barcode, ?string $externalId): Product
    {
        return Product::create([
            'store_id' => $store->id,
            'name' => $name,
            'barcode' => $barcode,
            'external_id' => $externalId,
            'mrp' => 100,
            'sel_rate' => 90,
            'gst_percent' => 12,
        ]);
    }

    public function test_barcode_key_merges_the_same_physical_item_across_stores(): void
    {
        // Same physical medicine: shared barcode in both stores.
        $a = $this->product($this->storeA, 'Crocin 500 Store A', 'SHARED-BARCODE', 'EXT-A1');
        $b = $this->product($this->storeB, 'Crocin 500 Store B', 'SHARED-BARCODE', 'EXT-B2');
        // No barcode in either store — cannot join on the barcode key.
        $c1 = $this->product($this->storeA, 'Loose Pills A', null, 'EXT-C1');
        $c2 = $this->product($this->storeB, 'Loose Pills B', null, 'EXT-C2');

        $this->sell($a, $this->storeA, 'INV-A1', 4, 400);
        $this->sell($b, $this->storeB, 'INV-B1', 6, 660);
        $this->sell($c1, $this->storeA, 'INV-A2', 2, 200);
        $this->sell($c2, $this->storeB, 'INV-B2', 3, 300);

        $res = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/reports/consolidated-sales?match_by=barcode')
            ->assertOk()
            ->json();

        $this->assertSame('barcode', $res['match_by']);

        $crocin = collect($res['groups'])->firstWhere('key', 'SHARED-BARCODE');
        $this->assertNotNull($crocin, 'Same barcode must merge into one group');
        $this->assertEquals(10, (float) $crocin['qty_sold']);
        $this->assertEquals(1060.0, (float) $crocin['revenue']);
        $this->assertCount(2, $crocin['stores'], 'Group must show both contributing stores');

        $unmatchedNames = array_column($res['unmatched'], 'product_name');
        $this->assertContains('Loose Pills A', $unmatchedNames, 'Lines without the chosen key are listed unmatched');
        $this->assertContains('Loose Pills B', $unmatchedNames);
        $this->assertNotContains('Crocin 500 Store A', $unmatchedNames);

        $this->assertEquals(1060.0, (float) $res['totals']['matched_revenue']);
        $this->assertEquals(500.0, (float) $res['totals']['unmatched_revenue']);
    }

    public function test_item_code_key_uses_external_id_per_line(): void
    {
        $a = $this->product($this->storeA, 'Same Item A', 'BAR-A1', 'ITEM-777');
        $b = $this->product($this->storeB, 'Same Item B', 'BAR-B2', 'ITEM-777');
        $c = $this->product($this->storeA, 'No Ext A', 'BAR-A2', null);

        $this->sell($a, $this->storeA, 'INV-A1', 1, 100);
        $this->sell($b, $this->storeB, 'INV-B1', 2, 200);
        $this->sell($c, $this->storeA, 'INV-A2', 1, 50);

        $res = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/reports/consolidated-sales?match_by=external_id')
            ->assertOk()
            ->json();

        $merged = collect($res['groups'])->firstWhere('key', 'ITEM-777');
        $this->assertNotNull($merged, 'Same external_id (item code) merges across stores');
        $this->assertEquals(3, (float) $merged['qty_sold']);

        $unmatched = array_column($res['unmatched'], 'product_name');
        $this->assertContains('No Ext A', $unmatched);
        $this->assertNotContains('Same Item A', $unmatched);
    }

    public function test_name_unit_key_groups_by_name_and_pack(): void
    {
        $a = $this->product($this->storeA, 'Generic Tonic', 'BAR-A1', 'EXT-A1');
        $b = $this->product($this->storeB, 'Generic Tonic', 'BAR-B2', 'EXT-B2');

        $this->sell($a, $this->storeA, 'INV-A1', 5, 500);
        $this->sell($b, $this->storeB, 'INV-B1', 7, 700);

        $res = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/reports/consolidated-sales?match_by=name_unit')
            ->assertOk()
            ->json();

        $generic = collect($res['groups'])->first(fn ($g) => str_contains($g['key'], 'generic tonic'));
        $this->assertNotNull($generic, 'Same name+unit merges under the name_unit key');
        $this->assertEquals(12, (float) $generic['qty_sold']);
        $this->assertEmpty($res['unmatched'], 'Both lines carried the key');
    }

    public function test_single_store_scope_behaves_as_a_normal_store_report(): void
    {
        $a = $this->product($this->storeA, 'Only In A', 'BAR-A1', 'EXT-A1');
        $b = $this->product($this->storeB, 'Only In B', 'BAR-B1', 'EXT-B1');

        $this->sell($a, $this->storeA, 'INV-A1', 2, 200);
        $this->sell($b, $this->storeB, 'INV-B1', 5, 500);

        $res = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->storeA->id])
            ->getJson('/api/admin/reports/consolidated-sales?match_by=barcode')
            ->assertOk()
            ->json();

        $keys = array_column($res['groups'], 'key');
        $this->assertContains('BAR-A1', $keys);
        $this->assertNotContains('BAR-B1', $keys);
        $this->assertEmpty($res['unmatched']);
    }

    public function test_invalid_match_by_is_rejected(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/reports/consolidated-sales?match_by=hunch')
            ->assertStatus(422);
    }

    public function test_no_merges_are_stored(): void
    {
        $a = $this->product($this->storeA, 'A', 'BAR-A', 'EXT-A');
        $b = $this->product($this->storeB, 'B', 'BAR-A', 'EXT-B');
        $this->sell($a, $this->storeA, 'INV-A1', 1, 100);
        $this->sell($b, $this->storeB, 'INV-B1', 1, 100);

        $before = [
            'invoice_items' => InvoiceItem::count(),
            'products' => Product::count(),
        ];

        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->getJson('/api/admin/reports/consolidated-sales?match_by=barcode')
            ->assertOk();

        $this->assertSame($before['invoice_items'], InvoiceItem::count(), 'Aggregation must not write lines');
        $this->assertSame($before['products'], Product::count(), 'Aggregation must not create catalog rows');
    }
}
