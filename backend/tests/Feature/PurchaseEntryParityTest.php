<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Purchase entry parity: optional batch/expiry, extended line fields,
 * bill-level discount, freight and round-off must be stored exactly as
 * the desktop client and MCP tool send them.
 */
class PurchaseEntryParityTest extends TestCase
{
    use RefreshDatabase;

    private Store $pharmacy;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateDevice::class);

        $this->pharmacy = Store::create([
            'name' => 'Parity Pharmacy',
            'code' => 'PPH01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Parity Owner',
            'email' => 'owner@parity.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->pharmacy->id,
        ]);

        Sanctum::actingAs($this->owner);
    }

    private function line(array $overrides = []): array
    {
        return array_merge([
            'product_name' => 'Paracetamol 500mg',
            'batch_no' => 'B-101',
            'expiry_date' => '2027-12-31',
            'pack_qty' => 1,
            'loose_qty' => 0,
            'units_per_pack' => 10,
            'purchase_rate' => 100,
            'gst_percent' => 12,
        ], $overrides);
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'store_id' => $this->pharmacy->id,
            'supplier_name' => 'Parity Distributors',
            'invoice_number' => 'SUP-1001',
            'invoice_date' => '2026-11-10',
            'lines' => [$this->line()],
        ], $overrides);
    }

    private function retailStore(): Store
    {
        return Store::create([
            'name' => 'Parity Retail',
            'code' => 'PRT01',
            'store_type' => 'retail',
            'state_code' => '32',
            'is_active' => true,
        ]);
    }

    public function test_pharmacy_requires_batch_and_expiry(): void
    {
        $this->postJson('/api/purchases', $this->payload([
            'lines' => [$this->line(['batch_no' => null, 'expiry_date' => null])],
        ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['lines.0.batch_no', 'lines.0.expiry_date']);
    }

    public function test_retail_store_allows_batchless_inward_and_persists_extended_fields(): void
    {
        $retail = $this->retailStore();

        $response = $this->postJson('/api/purchases', $this->payload([
            'store_id' => $retail->id,
            'invoice_number' => 'RET-2001',
            'lines' => [$this->line([
                'batch_no' => null,
                'expiry_date' => null,
                'mfg_date' => '2026-01-15',
                'hsn_code' => '30049099',
                'free_qty' => 1,
                'free_loose_qty' => 3,
                'discount_type' => 'amount',
                'discount_percent' => 0,
                'discount_amount' => 5,
                'ptr' => 98,
                'pts' => 95,
                'ptss' => 93,
                'selling_rate' => 140,
            ])],
        ]))->assertCreated();

        $purchase = Purchase::findOrFail($response->json('purchase.id'));
        $item = PurchaseItem::where('purchase_id', $purchase->id)->firstOrFail();

        $this->assertNull($item->batch_no);
        $this->assertNull($item->expiry_date);
        $this->assertSame('2026-01-15', $item->mfg_date->toDateString());
        $this->assertSame('30049099', $item->hsn_code);
        $this->assertEquals(1, (float) $item->free_qty);
        $this->assertEquals(3, (float) $item->free_loose_qty);
        $this->assertSame('amount', $item->discount_type);
        $this->assertEquals(5, (float) $item->discount_amount);
        $this->assertEquals(98, (float) $item->ptr);
        $this->assertEquals(95, (float) $item->pts);
        $this->assertEquals(93, (float) $item->ptss);
        $this->assertEquals(140, (float) $item->selling_rate);
    }

    public function test_store_setting_overrides_pharmacy_default_for_batch_requirement(): void
    {
        CompanySetting::create([
            'store_id' => $this->pharmacy->id,
            'key' => 'batch_required',
            'value' => false,
        ]);

        $this->postJson('/api/purchases', $this->payload([
            'lines' => [$this->line(['batch_no' => null, 'expiry_date' => null])],
        ]))->assertCreated();

        $this->assertNull(PurchaseItem::firstOrFail()->batch_no);
    }

    public function test_retail_store_can_opt_in_to_batch_requirement(): void
    {
        $retail = $this->retailStore();
        CompanySetting::create([
            'store_id' => $retail->id,
            'key' => 'batch_required',
            'value' => true,
        ]);

        $this->postJson('/api/purchases', $this->payload([
            'store_id' => $retail->id,
            'lines' => [$this->line(['batch_no' => null, 'expiry_date' => null])],
        ]))->assertStatus(422);
    }

    public function test_bill_discount_freight_and_round_off_follow_statutory_order(): void
    {
        $response = $this->postJson('/api/purchases', $this->payload([
            'lines' => [$this->line([
                'discount_percent' => 10,
                'discount_type' => 'percent',
            ])],
            'bill_discount_type' => 'percent',
            'bill_discount' => 10,
            'freight_charges' => 5,
        ]))->assertCreated();

        $purchase = Purchase::findOrFail($response->json('purchase.id'));

        // Gross 100 → line discount 10 → net base 90 → bill discount 9
        // → taxable 81 → GST 12% = 9.72 → freight 5 → 95.72 → round-off +0.28.
        // The saved bill discount is the operator-entered value (10%).
        $this->assertEquals(10, (float) $purchase->bill_discount);
        $this->assertEquals(5, (float) $purchase->freight_charges);
        $this->assertEquals(0.28, (float) $purchase->round_off);
        $this->assertEquals(96, (float) $purchase->grand_total);
        $this->assertEquals(100, (float) $purchase->subtotal);
        $this->assertEquals(9.72, (float) $purchase->tax_total);
        $this->assertEquals(4.86, (float) $purchase->cgst_total);
        $this->assertEquals(4.86, (float) $purchase->sgst_total);
    }

    public function test_manual_round_off_is_respected(): void
    {
        $response = $this->postJson('/api/purchases', $this->payload([
            'round_off' => 0.28,
            'invoice_number' => 'SUP-MANUAL-ROUND',
        ]))->assertCreated();

        $purchase = Purchase::findOrFail($response->json('purchase.id'));

        // 100 + 12 GST = 112; manual round-off 0.28 → 112.28.
        $this->assertEquals(0.28, (float) $purchase->round_off);
        $this->assertEquals(112.28, (float) $purchase->grand_total);
    }

    public function test_sync_purchase_upsert_persists_new_fields_and_nulls_missing_batch(): void
    {
        $this->postJson('/api/sync/push/purchases', [
            'store_id' => $this->pharmacy->id,
            'purchases' => [[
                'external_id' => 'ext-pur-1',
                'supplier_invoice_no' => 'SYNC-INV-1',
                'purchase_date' => '2026-11-11',
                'supplier_name' => 'Synced Supplier',
                'freight_charges' => 4,
                'bill_discount_type' => 'amount',
                'bill_discount' => 6,
                'grand_total' => 110,
                'items' => [[
                    'product_name' => 'Synced Item',
                    'batch_no' => '',
                    'expiry_date' => '',
                    'qty' => 2,
                    'purchase_rate' => 50,
                    'gst_percent' => 12,
                    'hsn_code' => '30049099',
                    'free_loose_qty' => 2,
                    'discount_type' => 'amount',
                    'discount_amount' => 3,
                    'ptr' => 49,
                    'pts' => 47,
                    'ptss' => 45,
                ]],
            ]],
        ])->assertOk()->assertJson(['success' => true, 'ingested_count' => 1]);

        $purchase = Purchase::where('invoice_number', 'SYNC-INV-1')->firstOrFail();
        $this->assertSame('2026-11-11', $purchase->invoice_date->toDateString());
        $this->assertEquals(4, (float) $purchase->freight_charges);
        $this->assertEquals(6, (float) $purchase->bill_discount);

        $item = PurchaseItem::where('purchase_id', $purchase->id)->firstOrFail();
        $this->assertNull($item->batch_no);
        $this->assertNull($item->expiry_date);
        $this->assertSame('30049099', $item->hsn_code);
        $this->assertEquals(2, (float) $item->free_loose_qty);
        $this->assertSame('amount', $item->discount_type);
        $this->assertEquals(3, (float) $item->discount_amount);
        $this->assertEquals(49, (float) $item->ptr);
        $this->assertEquals(47, (float) $item->pts);
        $this->assertEquals(45, (float) $item->ptss);
    }
}
