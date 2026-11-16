<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\CustomerPayment;
use App\Models\Expense;
use App\Models\HeldBill;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\Store;
use App\Models\SupplierPayment;
use App\Models\SyncEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminStoreResetTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Metro Supermarket',
            'code' => 'METRO-01',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'admin@metro.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    public function test_reset_store_requires_exact_confirmation_phrase(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/stores/{$this->store->id}/reset", [
                'confirmation_phrase' => 'WRONG PHRASE',
                'reason' => 'Resetting demo test data',
                'options' => [
                    'reset_invoices' => true,
                ],
            ]);

        $response->assertStatus(422);
        $response->assertJsonFragment([
            'message' => "Confirmation phrase mismatch. You must type exactly: 'RESET STORE METRO SUPERMARKET'",
        ]);
    }

    public function test_reset_store_granular_options_wipes_selected_data_and_zeros_stock(): void
    {
        // 1. Create items & batches
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 650',
            'hsn_sac_code' => '3004',
            'mrp' => 30,
            'sel_rate' => 25,
            'gst_percent' => 12,
            'current_stock' => -50, // Negative stock before reset
        ]);

        $batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'BAT-99',
            'expiry_date' => '2028-01-01',
            'stock_qty' => -50,
            'mrp' => 30,
            'selling_rate' => 25,
        ]);

        // 2. Create customer, invoice, purchase, expense, held bill
        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'John Doe',
            'current_balance' => 100,
        ]);

        $supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Pharma Wholesalers',
        ]);

        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'invoice_number' => 'INV-001',
            'invoice_date' => date('Y-m-d'),
            'grand_total' => 100,
            'status' => 'issued',
        ]);

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'batch_no' => 'BAT-99',
            'qty' => 50,
            'unit_price' => 25,
            'gst_percent' => 12,
            'total_amount' => 100,
        ]);

        $purchase = Purchase::create([
            'store_id' => $this->store->id,
            'supplier_id' => $supplier->id,
            'supplier_name' => $supplier->name,
            'invoice_number' => 'PINV-001',
            'invoice_date' => date('Y-m-d'),
            'purchase_number' => 'PUR-001',
            'purchase_date' => date('Y-m-d'),
            'total_amount' => 500,
            'status' => 'received',
        ]);

        Expense::create([
            'store_id' => $this->store->id,
            'expense_head' => 'Office Expense',
            'amount' => 150,
            'expense_date' => date('Y-m-d'),
        ]);

        HeldBill::create([
            'id' => 'hb-test-101',
            'store_id' => $this->store->id,
            'held_by_counter_id' => 'CTR-1',
            'customer_name' => 'John',
            'items_count' => 1,
            'grand_total' => 50,
            'held_at' => time(),
            'cart_payload' => ['items' => []],
        ]);

        // 3. Reset with selective options: reset invoices, reset stock, reset expenses, reset held bills (preserve purchases and customers)
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/stores/{$this->store->id}/reset", [
                'confirmation_phrase' => 'RESET STORE METRO SUPERMARKET',
                'reason' => 'Clear test transactions and zero stock',
                'options' => [
                    'reset_invoices' => true,
                    'reset_stock' => true,
                    'reset_purchases' => false,
                    'reset_customers' => false,
                    'reset_expenses' => true,
                    'reset_held_bills' => true,
                ],
            ]);

        $response->assertStatus(200);
        $response->assertJson([
            'success' => true,
        ]);

        // Assert Invoices, items, expenses, held bills wiped
        $this->assertDatabaseMissing('invoices', ['id' => $invoice->id]);
        $this->assertDatabaseCount('invoices', 0);
        $this->assertDatabaseCount('invoice_items', 0);
        $this->assertDatabaseCount('expenses', 0);
        $this->assertDatabaseCount('held_bills', 0);

        // Assert Purchases preserved
        $this->assertDatabaseHas('purchases', ['id' => $purchase->id]);

        // Assert Customer preserved
        $this->assertDatabaseHas('parties', ['id' => $customer->id]);

        // Assert Stock zeroed
        $product->refresh();
        $batch->refresh();
        $this->assertEquals(0, $product->current_stock);
        $this->assertEquals(0, $batch->stock_qty);

        // Assert SyncEvent emitted for store_reset
        $this->assertDatabaseHas('sync_events', [
            'store_id' => $this->store->id,
            'entity_type' => 'store_reset',
        ]);

        // Assert AuditLog created
        $this->assertDatabaseHas('audit_logs', [
            'store_id' => $this->store->id,
            'action' => 'remote_store_reset',
        ]);
    }

    public function test_reset_store_with_reset_products_wipes_catalog(): void
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500mg',
            'hsn_sac_code' => '3004',
            'mrp' => 50,
            'sel_rate' => 45,
            'gst_percent' => 12,
        ]);

        ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'AMX-01',
            'expiry_date' => '2028-05-01',
            'stock_qty' => 10,
            'mrp' => 50,
            'selling_rate' => 45,
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/stores/{$this->store->id}/reset", [
                'confirmation_phrase' => 'RESET STORE METRO SUPERMARKET',
                'reason' => 'Wipe catalog completely for clean store import',
                'options' => [
                    'reset_products' => true,
                    'reset_stock' => true,
                ],
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseMissing('products', ['id' => $product->id]);
        $this->assertDatabaseCount('products', 0);
        $this->assertDatabaseCount('product_batches', 0);
    }

    public function test_reset_store_with_reset_customers_deletes_party_masters(): void
    {
        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Jane Doe',
            'current_balance' => 250,
        ]);

        $supplier = Party::create([
            'store_id' => $this->store->id,
            'type' => 'supplier',
            'name' => 'Metro Wholesale',
        ]);

        Party::create([
            'store_id' => $this->store->id,
            'type' => 'doctor',
            'name' => 'Dr. Rao',
            'reg_no' => 'REG-100',
        ]);

        CustomerPayment::create([
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'amount' => 100,
            'payment_mode' => 'Cash',
            'payment_date' => date('Y-m-d'),
        ]);

        SupplierPayment::create([
            'store_id' => $this->store->id,
            'supplier_id' => $supplier->id,
            'amount' => 50,
            'payment_mode' => 'Cash',
            'payment_date' => date('Y-m-d'),
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/stores/{$this->store->id}/reset", [
                'confirmation_phrase' => 'RESET STORE METRO SUPERMARKET',
                'reason' => 'Full party master purge for clean onboarding',
                'options' => [
                    'reset_invoices' => false,
                    'reset_stock' => false,
                    'reset_products' => false,
                    'reset_purchases' => false,
                    'reset_customers' => true,
                    'reset_expenses' => false,
                    'reset_held_bills' => false,
                ],
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseCount('parties', 0);
        $this->assertDatabaseCount('customer_payments', 0);
        $this->assertDatabaseCount('supplier_payments', 0);
        $this->assertEquals(3, $response->json('wiped_modules.parties_wiped'));
    }

    public function test_reset_store_without_reset_customers_preserves_party_masters(): void
    {
        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Jane Doe',
            'current_balance' => 250,
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/stores/{$this->store->id}/reset", [
                'confirmation_phrase' => 'RESET STORE METRO SUPERMARKET',
                'reason' => 'Keep party masters during invoice purge',
                'options' => [
                    'reset_invoices' => true,
                    'reset_customers' => false,
                ],
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('parties', ['id' => $customer->id]);
    }

    public function test_disabled_store_rejects_invoice_creation(): void
    {
        $this->store->update(['is_active' => false]);

        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Walk In',
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store->id])
            ->postJson('/api/invoices', [
                'store_id' => $this->store->id,
                'customer_id' => $customer->id,
                'invoice_date' => date('Y-m-d'),
                'items' => [],
            ]);

        $response->assertStatus(403);
        $response->assertJson([
            'error' => 'STORE_DISABLED',
        ]);
    }
}
