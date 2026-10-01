<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\GstLockPeriod;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\SyncEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminKeyFlowsTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Apex Healthcare',
            'code' => 'APEX-01',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'admin@apex.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    public function test_flow_create_store(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/stores', [
                'name' => 'New Branch Kozhikode',
                'code' => 'KZK-01',
                'state_code' => '32',
                'gstin' => '32ABCDE9999Z1Z5',
                'tax_mode' => 'inclusive',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('stores', ['code' => 'KZK-01', 'is_active' => true]);
    }

    public function test_flow_disable_store_and_desktop_api_reflection(): void
    {
        // 1. Disable store in admin panel
        $res = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/stores/{$this->store->id}/toggle-status", [
                'reason' => 'Annual license renewal pending',
            ]);

        $res->assertStatus(200);
        $this->assertFalse($res->json('is_active'));

        // 2. Desktop app queries store status endpoint
        $desktopRes = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => $this->store->id])
            ->getJson('/api/store');

        $desktopRes->assertStatus(200);
        $this->assertFalse($desktopRes->json('is_active'));
    }

    public function test_flow_edit_item_with_optimistic_locking_conflict(): void
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
            'hsn_sac_code' => '3004',
            'mrp' => 20.00,
            'sel_rate' => 18.00,
            'gst_percent' => 12.00,
            'version' => 3, // Server version is 3
        ]);

        // Client attempts to submit edit with stale version 2
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/products/{$product->id}", [
                'name' => 'Paracetamol 500mg New',
                'mrp' => 22.00,
                'sel_rate' => 20.00,
                'version' => 2, // Stale!
            ]);

        $response->assertStatus(409);
        $response->assertJsonFragment([
            'current_version' => 3,
            'client_version' => 2,
        ]);
    }

    public function test_flow_cancel_invoice_restores_stock_and_updates_ledger_and_creates_audit(): void
    {
        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Augmentin 625',
            'hsn_sac_code' => '3004',
            'mrp' => 200,
            'sel_rate' => 180,
            'gst_percent' => 12,
            'current_stock' => 10,
        ]);

        $batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'B-101',
            'expiry_date' => date('Y-m-d', strtotime('+1 year')),
            'stock_qty' => 10,
            'mrp' => 200,
            'selling_rate' => 180,
        ]);

        $customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Credit Customer',
            'current_balance' => 500,
        ]);

        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'customer_id' => $customer->id,
            'invoice_number' => 'INV-TEST-001',
            'invoice_date' => date('Y-m-d'),
            'subtotal' => 160.71,
            'tax_total' => 19.29,
            'grand_total' => 180.00,
            'paid_amount' => 0.00,
            'status' => 'issued',
        ]);

        InvoiceItem::create([
            'invoice_id' => $invoice->id,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'batch_no' => 'B-101',
            'qty' => 2,
            'unit_price' => 90,
            'gst_percent' => 12,
            'tax_amount' => 19.29,
            'total_amount' => 180,
        ]);

        // Cancel the invoice
        $cancelRes = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/invoices/{$invoice->id}/cancel", [
                'reason' => 'Customer returned medicines within 15 minutes',
            ]);

        $cancelRes->assertStatus(200);

        // 1. Stock restored
        $product->refresh();
        $batch->refresh();
        $this->assertEquals(12, $product->current_stock);
        $this->assertEquals(12, $batch->stock_qty);

        // 2. Customer ledger updated (500 - 180 = 320)
        $customer->refresh();
        $this->assertEquals(320, $customer->current_balance);

        // 3. Invoice status cancelled
        $invoice->refresh();
        $this->assertEquals('cancelled', $invoice->status);

        // 4. Audit entry written
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'cancel_invoice',
            'entity_id' => (string)$invoice->id,
        ]);
    }

    public function test_flow_cancel_invoice_blocked_if_gst_period_locked(): void
    {
        // Lock GST period for 2026-08
        GstLockPeriod::create([
            'store_id' => $this->store->id,
            'period_month' => '2026-08',
            'is_locked' => true,
        ]);

        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => 'INV-AUG-001',
            'invoice_date' => '2026-08-15',
            'grand_total' => 100,
            'status' => 'issued',
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/invoices/{$invoice->id}/cancel", ['reason' => 'Attempt cancel locked period invoice']);

        $response->assertStatus(422);
        $response->assertJsonFragment([
            'period_month' => '2026-08',
        ]);
    }

    public function test_flow_resolve_sync_conflict(): void
    {
        $event = SyncEvent::create([
            'store_id' => $this->store->id,
            'entity_type' => 'product',
            'entity_id' => '1',
            'action' => 'update',
            'client_data' => ['name' => 'Item Client'],
            'server_data' => ['name' => 'Item Cloud'],
            'status' => 'conflict',
            'conflict_reason' => 'Simultaneous edit',
        ]);

        // Resolve by keep_cloud
        $res = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/sync/events/{$event->id}/resolve", [
                'resolution' => 'keep_cloud',
            ]);

        $res->assertStatus(200);
        $event->refresh();
        $this->assertEquals('resolved', $event->status);
        $this->assertEquals('keep_cloud', $event->resolution);
    }
}
