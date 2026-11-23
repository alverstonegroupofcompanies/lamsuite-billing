<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\User;
use App\Services\Parties\SupplierBalanceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PAY-01: a purchase bill is money the store owes, so posting one has to move the
 * supplier's balance by exactly what the ledger screen prints — once per bill, no
 * matter how often the till retries it, and back to zero when the bill is cancelled.
 */
class SupplierBalanceFromPurchasesTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Party $supplier;
    private Product $product;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Ledger Store',
            'code' => 'LEDG01',
            'tax_mode' => 'exclusive',
            'gst_type' => 'regular',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'store_id' => $this->store->id,
            'name' => 'Ledger Owner',
            'email' => 'ledger-owner@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Malabar Distributors',
            'gstin' => '32AAAAA2222CC1Z7',
            'opening_balance' => 0,
            'current_balance' => 0,
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Coconut Oil 500ml',
            'current_stock' => 0,
            'mrp' => 215.00,
            'sel_rate' => 200.00,
            'gst_percent' => 5.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);
    }

    private function inward(array $overrides = []): array
    {
        return array_merge([
            'id' => 'pur_ledger_1',
            'external_id' => 'pur_ledger_1',
            'purchase_number' => 'C01-PUR-2001',
            'supplier_invoice_no' => 'SUP-LEDGER-1',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'supplier_gstin' => $this->supplier->gstin,
            'purchase_date' => '2026-11-21',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'subtotal' => 11200,
            'tax_total' => 0,
            'round_off' => 0,
            'grand_total' => 11200,
            'status' => 'received',
            'items' => [[
                'product_id' => (string) $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'CO-01',
                'expiry_date' => '2027-12-31',
                'pack_qty' => 56,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'purchase_rate' => 200,
                'mrp' => 215,
                'gst_percent' => 5,
                'taxable_amount' => 11200,
                'tax_amount' => 0,
                'total_amount' => 11200,
            ]],
        ], $overrides);
    }

    private function push(array $document): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/sync/push/purchases', ['purchases' => [$document]])
            ->assertStatus(200);
    }

    private function assertBalanceIs(float $expected): void
    {
        $this->assertSame($expected, (float) $this->supplier->fresh()->current_balance);
        $this->assertSame(
            $expected,
            app(SupplierBalanceService::class)->expectedBalance($this->supplier->fresh()),
            'stored balance and ledger-derived balance must agree'
        );
    }

    public function test_posting_a_purchase_raises_the_supplier_balance_once(): void
    {
        $this->push($this->inward());
        $this->assertBalanceIs(11200.0);

        $purchase = Purchase::where('external_id', 'pur_ledger_1')->firstOrFail();

        $ledger = $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/admin/suppliers/{$this->supplier->id}/ledger")
            ->assertOk();

        $this->assertSame(11200.0, (float) $ledger->json('current_balance'));
        $this->assertCount(1, $ledger->json('transactions'));
        $this->assertSame('Purchase Inward', $ledger->json('transactions.0.type'));
        $this->assertSame(11200.0, (float) $ledger->json('transactions.0.running_balance'));

        // A queue retry must not double the debt.
        $this->push($this->inward());
        $this->assertBalanceIs(11200.0);
        $this->assertSame(1, Purchase::where('external_id', 'pur_ledger_1')->count());
        $this->assertSame($purchase->id, Purchase::where('external_id', 'pur_ledger_1')->value('id'));
    }

    public function test_editing_a_bill_moves_the_balance_by_the_difference(): void
    {
        $this->push($this->inward());

        $edit = $this->inward([
            'subtotal' => 10000,
            'grand_total' => 10000,
            'items' => [[
                'product_id' => (string) $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'CO-01',
                'expiry_date' => '2027-12-31',
                'pack_qty' => 50,
                'loose_qty' => 0,
                'units_per_pack' => 1,
                'purchase_rate' => 200,
                'mrp' => 215,
                'gst_percent' => 5,
                'taxable_amount' => 10000,
                'tax_amount' => 0,
                'total_amount' => 10000,
            ]],
        ]);

        $this->push($edit);
        $this->assertBalanceIs(10000.0);
        $this->assertSame(1, Purchase::where('external_id', 'pur_ledger_1')->count());
    }

    public function test_a_return_reduces_the_balance_and_the_ledger_shows_a_debit_note(): void
    {
        $this->push($this->inward());

        $this->push([
            'id' => 'pur_ledger_ret_1',
            'external_id' => 'pur_ledger_ret_1',
            'return_number' => 'C01-PRT-2001',
            'supplier_invoice_no' => 'SUP-LEDGER-1',
            'original_purchase_number' => 'SUP-LEDGER-1',
            'supplier_id' => (string) $this->supplier->id,
            'supplier_name' => $this->supplier->name,
            'return_date' => '2026-11-22',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase_return',
            'subtotal' => 1200,
            'tax_total' => 0,
            'round_off' => 0,
            'grand_total' => 1200,
            'status' => 'completed',
            'lines' => [[
                'product_id' => (string) $this->product->id,
                'product_name' => $this->product->name,
                'batch_no' => 'CO-01',
                'qty' => 6,
                'purchase_rate' => 200,
                'taxable_amount' => 1200,
                'tax_amount' => 0,
                'total_amount' => 1200,
            ]],
        ]);

        $this->assertBalanceIs(10000.0);

        $ledger = $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/admin/suppliers/{$this->supplier->id}/ledger")
            ->assertOk();

        $types = array_column($ledger->json('transactions'), 'type');
        $this->assertContains('Debit Note', $types);
        $this->assertSame(10000.0, (float) $ledger->json('current_balance'));
    }

    public function test_cancelling_a_bill_clears_its_payable_without_erasing_the_bill(): void
    {
        $this->push($this->inward());
        $this->assertBalanceIs(11200.0);

        // A cancellation is a header-only push: no date, no supplier, no totals, no lines.
        $this->push([
            'external_id' => 'pur_ledger_1',
            'purchase_number' => 'C01-PUR-2001',
            'supplier_invoice_no' => 'SUP-LEDGER-1',
            'store_id' => (string) $this->store->id,
            'module_key' => 'purchase',
            'status' => 'cancelled',
            'cancel_reason' => 'Wrong bill received',
        ]);

        $this->assertBalanceIs(0.0);

        $purchase = Purchase::where('external_id', 'pur_ledger_1')->firstOrFail();
        $this->assertSame('cancelled', $purchase->status);
        $this->assertSame(11200.0, (float) $purchase->grand_total, 'a cancel must not zero the bill');
        $this->assertSame('2026-11-21', $purchase->invoice_date->toDateString(), 'a cancel must not restamp the date');
        $this->assertSame($this->supplier->id, $purchase->supplier_id, 'a cancel must not drop the supplier');
        $this->assertSame('SUP-LEDGER-1', $purchase->supplier_invoice_no);

        // The stock the bill brought in goes back.
        $this->assertSame(0.0, (float) $this->product->fresh()->current_stock);
    }
}
