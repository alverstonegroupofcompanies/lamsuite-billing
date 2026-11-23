<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Services\Purchase\PurchaseChargeNormaliser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * CR-C data model (Task 4.7): a charge and its per-line allocations are store-scoped
 * rows of the purchase aggregate. Historic bills keep the totals they were posted with —
 * the legacy freight scalar is normalised into a Freight head, never restated.
 */
class PurchaseChargeSchemaTest extends TestCase
{
    use RefreshDatabase;

    private Store $storeA;
    private Store $storeB;
    private Purchase $purchase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->storeA = Store::create(['name' => 'Charge Store A', 'code' => 'CSA', 'state_code' => '32', 'is_active' => true]);
        $this->storeB = Store::create(['name' => 'Charge Store B', 'code' => 'CSB', 'state_code' => '32', 'is_active' => true]);

        $this->purchase = Purchase::create([
            'store_id' => $this->storeA->id,
            'supplier_name' => 'Charge Distributors',
            'invoice_number' => 'CHG-1',
            'invoice_date' => '2026-11-01',
            'subtotal' => 200,
            'tax_total' => 24,
            'grand_total' => 224,
        ]);

        foreach ([100, 100] as $i => $amount) {
            PurchaseItem::create([
                'purchase_id' => $this->purchase->id,
                'product_name' => 'Item ' . ($i + 1),
                'batch_no' => 'B-' . ($i + 1),
                'expiry_date' => '2027-12-31',
                'qty' => 1,
                'purchase_rate' => $amount,
                'taxable_amount' => $amount,
                'gst_percent' => 12,
                'tax_amount' => $amount * 0.12,
                'total_amount' => $amount * 1.12,
            ]);
        }
    }

    public function test_purchase_charges_declares_the_contract_columns(): void
    {
        foreach ([
            'store_id', 'purchase_id', 'external_id', 'seq', 'head_code', 'head_name', 'note',
            'treatment', 'spread_method', 'spread_basis_used', 'itc_eligibility', 'is_rcm',
            'paid_separately', 'in_payable', 'paid_to_label', 'place_of_supply', 'sac_code', 'amount', 'gst_percent',
            'taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'cess_amount', 'total_amount',
            'allocated_amount', 'source', 'expense_id', 'reversed_amount', 'created_by',
        ] as $column) {
            $this->assertTrue(
                Schema::hasColumn('purchase_charges', $column),
                "purchase_charges.{$column} is missing (specs/02-plan.md 6.2.1)"
            );
        }

        $this->assertArrayHasKey(
            'purchase_charges_store_id_external_id_unique',
            $this->indexMap('purchase_charges'),
            'CR-C: charges must be idempotent on (store_id, external_id)'
        );
    }

    public function test_charge_membership_is_a_stored_fact_not_a_default_to_re_derive(): void
    {
        // CR-C-11 / PUR-016: the column exists to be read, so it must hold the answer the bill was
        // posted with rather than a value a report would have to guess.
        $inside = $this->insertCharge('chg-membership-inside');
        $this->assertTrue((bool) DB::table('purchase_charges')->where('id', $inside)->value('in_payable'));

        $apart = $this->insertCharge('chg-membership-apart', ['paid_separately' => true, 'in_payable' => false]);
        $this->assertTrue((bool) DB::table('purchase_charges')->where('id', $apart)->value('paid_separately'));
        $this->assertFalse((bool) DB::table('purchase_charges')->where('id', $apart)->value('in_payable'));
    }

    public function test_allocations_declare_the_contract_columns(): void
    {
        foreach ([
            'store_id', 'purchase_charge_id', 'purchase_item_id', 'batch_id',
            'basis_amount', 'basis_share', 'allocated_amount', 'is_remainder_paisa',
        ] as $column) {
            $this->assertTrue(
                Schema::hasColumn('purchase_charge_allocations', $column),
                "purchase_charge_allocations.{$column} is missing (specs/02-plan.md 6.2.2)"
            );
        }

        $this->assertArrayHasKey(
            'purchase_charge_alloc_charge_line_unique',
            $this->indexMap('purchase_charge_allocations'),
            'CR-C: one allocation per charge per line'
        );
    }

    public function test_charge_cannot_belong_to_another_stores_purchase(): void
    {
        $foreignPurchase = Purchase::create([
            'store_id' => $this->storeB->id,
            'supplier_name' => 'Other Store Supplier',
            'invoice_number' => 'CHG-FOREIGN',
            'invoice_date' => '2026-11-01',
            'grand_total' => 0,
        ]);

        $this->expectException(\Throwable::class);
        DB::table('purchase_charges')->insert($this->chargeRow([
            'store_id' => $this->storeA->id,
            'purchase_id' => $foreignPurchase->id,
            'external_id' => 'chg-cross-store',
        ]));
    }

    public function test_allocation_cannot_cross_stores(): void
    {
        $charge = $this->insertCharge('chg-for-allocation');
        $otherStorePurchase = Purchase::create([
            'store_id' => $this->storeB->id,
            'supplier_name' => 'Other Store Supplier',
            'invoice_number' => 'CHG-ITEMS',
            'invoice_date' => '2026-11-01',
            'grand_total' => 0,
        ]);
        $otherItem = PurchaseItem::create([
            'purchase_id' => $otherStorePurchase->id,
            'product_name' => 'Foreign Item',
            'batch_no' => 'FB-1',
            'expiry_date' => '2027-12-31',
            'qty' => 1,
            'purchase_rate' => 50,
            'total_amount' => 50,
        ]);

        $this->expectException(\Throwable::class);
        DB::table('purchase_charge_allocations')->insert([
            'store_id' => $this->storeA->id,
            'purchase_charge_id' => $charge,
            'purchase_item_id' => $otherItem->id,
            'basis_amount' => 50,
            'basis_share' => 1,
            'allocated_amount' => 50,
            'is_remainder_paisa' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_external_id_is_unique_within_a_store_only(): void
    {
        $this->insertCharge('chg-shared', ['store_id' => $this->storeA->id]);
        $otherStorePurchase = Purchase::create([
            'store_id' => $this->storeB->id,
            'supplier_name' => 'Other Store Supplier',
            'invoice_number' => 'CHG-B',
            'invoice_date' => '2026-11-01',
            'grand_total' => 0,
        ]);
        $this->insertCharge('chg-shared', ['store_id' => $this->storeB->id, 'purchase_id' => $otherStorePurchase->id]);

        $this->expectException(\Throwable::class);
        $this->insertCharge('chg-shared', ['store_id' => $this->storeA->id]);
    }

    public function test_goods_and_ledger_tables_gained_the_charge_columns(): void
    {
        foreach ([
            'gross_weight_kg', 'charge_allocation', 'landed_unit_cost', 'original_purchase_item_id',
        ] as $column) {
            $this->assertTrue(Schema::hasColumn('purchase_items', $column), "purchase_items.{$column} is missing");
        }

        $this->assertTrue(Schema::hasColumn('product_batches', 'landed_cost_rate'), 'PUR-011: batches must carry landed cost');
        $this->assertTrue(Schema::hasColumn('purchases', 'place_of_supply'), 'PUR-009: the bill must remember whose state decided intra vs inter');

        foreach ([
            'purchase_id', 'purchase_charge_id', 'gst_percent', 'cgst_amount', 'sgst_amount',
            'igst_amount', 'itc_eligibility', 'paid_separately',
        ] as $column) {
            $this->assertTrue(Schema::hasColumn('expenses', $column), "expenses.{$column} is missing (PUR-012)");
        }
    }

    public function test_charge_head_lookup_row_must_belong_to_a_store(): void
    {
        // R12: unlike the legacy shared lookups, a charge head is never store-less.
        $this->expectException(\Throwable::class);
        DB::table('master_lookups')->insert([
            'store_id' => null,
            'type' => 'charge_head',
            'name' => 'Shared Freight',
            'code' => 'FREIGHT',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_legacy_freight_normalises_into_one_freight_charge_without_rewriting_history(): void
    {
        $product = Product::create([
            'store_id' => $this->storeA->id,
            'name' => 'Paracetamol 500',
            'mrp' => 20,
            'sel_rate' => 18,
            'gst_percent' => 12,
        ]);

        DB::table('purchase_items')->where('purchase_id', $this->purchase->id)
            ->update(['product_id' => $product->id, 'units_per_pack' => 1]);

        $before = $this->postedMoney();

        DB::table('purchases')->where('id', $this->purchase->id)->update(['freight_charges' => 50]);

        $charges = app(PurchaseChargeNormaliser::class)->forPurchase(
            Purchase::with('items')->findOrFail($this->purchase->id)
        );

        $this->assertCount(1, $charges);
        $this->assertSame('FREIGHT', $charges[0]['head_code']);
        $this->assertSame(50.0, (float) $charges[0]['amount']);
        $this->assertSame(0.0, (float) $charges[0]['gst_percent']);
        $this->assertSame('add_to_cost', $charges[0]['treatment']);
        $this->assertSame('legacy_freight', $charges[0]['source']);

        // PUR-017: historic totals and payables are never changed by this CR.
        $this->assertSame($before, $this->postedMoney(), 'Normalising legacy freight must not restate the posted bill');

        // A bill that already has charge rows is presented as-is, never doubled.
        $this->insertCharge('chg-real-freight');
        $this->assertSame([], app(PurchaseChargeNormaliser::class)->forPurchase(
            Purchase::with('items')->findOrFail($this->purchase->id)
        ));
    }

    /**
     * The money a posted bill is carried at. The legacy freight scalar is excluded
     * because the test itself writes it; everything else must not move.
     */
    private function postedMoney(): array
    {
        $header = (array) DB::table('purchases')
            ->where('id', $this->purchase->id)
            ->first([
                'subtotal', 'tax_total', 'cgst_total', 'sgst_total', 'igst_total',
                'cess_total', 'bill_discount', 'round_off', 'grand_total', 'paid_amount',
            ]);

        $header['items_total'] = round((float) DB::table('purchase_items')
            ->where('purchase_id', $this->purchase->id)
            ->sum('total_amount'), 2);

        return $header;
    }

    private function chargeRow(array $overrides = []): array
    {
        return array_merge([
            'store_id' => $this->storeA->id,
            'purchase_id' => $this->purchase->id,
            'external_id' => 'chg-' . uniqid(),
            'seq' => 1,
            'head_code' => 'FREIGHT',
            'head_name' => 'Freight',
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'spread_basis_used' => 'value',
            'itc_eligibility' => 'eligible',
            'is_rcm' => false,
            'paid_separately' => false,
            'amount' => 50,
            'gst_percent' => 12,
            'taxable_amount' => 50,
            'cgst_amount' => 3,
            'sgst_amount' => 3,
            'igst_amount' => 0,
            'cess_amount' => 0,
            'total_amount' => 56,
            'allocated_amount' => 50,
            'source' => 'manual',
            'reversed_amount' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);
    }

    private function insertCharge(string $externalId, array $overrides = []): int
    {
        return DB::table('purchase_charges')->insertGetId($this->chargeRow(array_merge([
            'external_id' => $externalId,
        ], $overrides)));
    }

    private function indexMap(string $table): array
    {
        return collect(Schema::getIndexes($table))
            ->mapWithKeys(fn ($index) => [$index['name'] => $index])
            ->all();
    }
}
