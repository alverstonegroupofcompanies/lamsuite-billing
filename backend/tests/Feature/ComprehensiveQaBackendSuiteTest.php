<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\CustomerPayment;
use App\Models\Device;
use App\Models\FinancialYear;
use App\Models\GstLockPeriod;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\MasterLookup;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransaction;
use App\Models\Store;
use App\Models\SyncEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ComprehensiveQaBackendSuiteTest extends TestCase
{
    use RefreshDatabase;

    protected Store $storePharma;
    protected Store $storeMart;
    protected User $superAdmin;
    protected User $storeOwner;
    protected User $manager;
    protected User $accountant;
    protected User $support;
    protected User $martManager;
    protected Product $dolo;
    protected ProductBatch $doloBatch;
    protected Party $customer;
    protected Party $supplier;

    protected function setUp(): void
    {
        parent::setUp();

        // 1. Pharmacy Store
        $this->storePharma = Store::create([
            'name' => 'QA Apollo Pharmacy',
            'code' => 'STORE-01',
            'phone' => '+91 9876543210',
            'email' => 'pharma@testqa.com',
            'address' => 'Palakkad Main Road',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'tax_mode' => 'inclusive',
            'invoice_prefix' => 'INV-PHM',
            'is_active' => true,
            'license_plan' => 'Enterprise',
            'license_expires_at' => Carbon::now()->addYear(),
            'version' => 1,
        ]);

        // 2. Retail Store
        $this->storeMart = Store::create([
            'name' => 'QA Metro Mart',
            'code' => 'STORE-02',
            'phone' => '+91 9876543211',
            'email' => 'mart@testqa.com',
            'address' => 'Kochi Highway',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A2Z4',
            'store_type' => 'retail',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'invoice_prefix' => 'INV-MRT',
            'is_active' => true,
            'license_plan' => 'Standard',
            'license_expires_at' => Carbon::now()->addYear(),
            'version' => 1,
        ]);

        // Users
        $this->superAdmin = User::create([
            'name' => 'QA SuperAdmin',
            'email' => 'admin@qa.suite',
            'password' => Hash::make('secret123'),
            'role' => 'super_admin',
            'store_id' => $this->storePharma->id,
            'allowed_store_ids' => [$this->storePharma->id, $this->storeMart->id],
        ]);

        $this->storeOwner = User::create([
            'name' => 'QA StoreOwner',
            'email' => 'owner@qa.suite',
            'password' => Hash::make('secret123'),
            'role' => 'store_owner',
            'store_id' => $this->storePharma->id,
            'allowed_store_ids' => [$this->storePharma->id],
        ]);

        $this->manager = User::create([
            'name' => 'QA Manager',
            'email' => 'manager@qa.suite',
            'password' => Hash::make('secret123'),
            'role' => 'manager',
            'store_id' => $this->storePharma->id,
            'allowed_store_ids' => [$this->storePharma->id],
        ]);

        $this->accountant = User::create([
            'name' => 'QA Accountant',
            'email' => 'accountant@qa.suite',
            'password' => Hash::make('secret123'),
            'role' => 'accountant',
            'store_id' => $this->storePharma->id,
            'allowed_store_ids' => [$this->storePharma->id],
        ]);

        $this->support = User::create([
            'name' => 'QA Support',
            'email' => 'support@qa.suite',
            'password' => Hash::make('secret123'),
            'role' => 'support',
            'store_id' => null,
            'allowed_store_ids' => [$this->storePharma->id, $this->storeMart->id],
        ]);

        $this->martManager = User::create([
            'name' => 'QA MartManager',
            'email' => 'mart_mgr@qa.suite',
            'password' => Hash::make('secret123'),
            'role' => 'manager',
            'store_id' => $this->storeMart->id,
            'allowed_store_ids' => [$this->storeMart->id],
        ]);

        // Catalog & Party
        $this->dolo = Product::create([
            'store_id' => $this->storePharma->id,
            'name' => 'Dolo 650mg Tablet',
            'barcode' => '8901082000018',
            'hsn_code' => '30049099',
            'gst_percent' => 12.00,
            'mrp' => 33.60,
            'sel_rate' => 30.00,
            'current_stock' => 100,
            'unit' => 'STRIP',
            'units_per_pack' => 15,
            'is_active' => true,
            'version' => 1,
        ]);

        $this->doloBatch = ProductBatch::create([
            'store_id' => $this->storePharma->id,
            'product_id' => $this->dolo->id,
            'batch_no' => 'QA-B01',
            'mfg_date' => Carbon::now()->subMonths(2)->toDateString(),
            'expiry_date' => Carbon::now()->addMonths(12)->toDateString(),
            'purchase_rate' => 22.00,
            'mrp' => 33.60,
            'selling_rate' => 30.00,
            'stock_qty' => 100,
            'version' => 1,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->storePharma->id,
            'type' => 'customer',
            'name' => 'Test Customer Ramanathan',
            'phone' => '9847012345',
            'credit_limit' => 5000,
            'current_balance' => 1000,
        ]);

        $this->supplier = Party::create([
            'store_id' => $this->storePharma->id,
            'type' => 'supplier',
            'name' => 'National Wholesaler',
            'phone' => '9447012345',
            'gstin' => '32AABCN9999P1Z1',
            'current_balance' => 5000,
        ]);
    }

    // ==========================================
    // 1. AUTHENTICATION & TOKEN REVOCATION
    // ==========================================
    public function test_auth_login_with_valid_credentials(): void
    {
        $response = $this->postJson('/api/login', [
            'email' => 'admin@qa.suite',
            'password' => 'secret123',
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'token',
                'user' => ['id', 'name', 'email', 'role'],
                'store' => ['id', 'name', 'code'],
            ]);
    }

    public function test_auth_login_with_invalid_password_returns_401(): void
    {
        $response = $this->postJson('/api/login', [
            'email' => 'admin@qa.suite',
            'password' => 'wrongpassword',
        ]);

        $response->assertStatus(401);
    }

    public function test_auth_me_endpoint_returns_authenticated_user(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson('/api/admin/me');

        $response->assertStatus(200)
            ->assertJsonPath('user.email', 'admin@qa.suite')
            ->assertJsonPath('user.role', 'super_admin');
    }

    // ==========================================
    // 2. ACTIVATION KEYS & DEVICE MANAGEMENT
    // ==========================================
    public function test_device_registration_with_activation_key(): void
    {
        $keyResult = ActivationKey::generateKey($this->storePharma);

        $regResponse = $this->postJson('/api/devices/register', [
            'activation_key' => $keyResult['raw_key'],
            'device_name' => 'QA Desk Counter 01',
            'device_uuid' => 'qa_uuid_desk_999',
            'app_version' => '2.0.36',
        ]);

        $regResponse->assertStatus(200)
            ->assertJsonStructure(['device_token', 'store_id', 'store_code']);

        $this->assertDatabaseHas('devices', [
            'store_id' => $this->storePharma->id,
            'device_uuid' => 'qa_uuid_desk_999',
            'status' => 'active',
        ]);
    }

    public function test_revoked_device_is_rejected_on_invalid_activation_key(): void
    {
        $response = $this->postJson('/api/devices/register', [
            'activation_key' => 'INVALID-KEY-NOT-FOUND-999',
            'device_uuid' => 'qa_revoked_terminal_123',
            'device_name' => 'Bad Station',
        ]);

        $response->assertStatus(422)
            ->assertJson(['message' => 'Invalid, expired, or revoked activation key.']);
    }

    // ==========================================
    // 3. ROLES AND PERMISSIONS (RBAC)
    // ==========================================
    public function test_support_user_is_forbidden_from_mutating_data(): void
    {
        $response = $this->actingAs($this->support, 'sanctum')
            ->postJson('/api/admin/parties', [
                'type' => 'customer',
                'name' => 'Hacker Injected Party',
                'phone' => '9998887776',
            ]);

        $response->assertStatus(403);
    }

    public function test_accountant_is_forbidden_from_modifying_store_settings(): void
    {
        $response = $this->actingAs($this->accountant, 'sanctum')
            ->postJson('/api/admin/settings', [
                'name' => 'Illegally Renamed Store',
            ]);

        $response->assertStatus(403);
    }

    public function test_manager_cannot_perform_remote_store_reset(): void
    {
        $response = $this->actingAs($this->manager, 'sanctum')
            ->postJson("/api/admin/stores/{$this->storePharma->id}/reset", [
                'confirmation_phrase' => "RESET {$this->storePharma->name}",
                'reason' => 'Testing unauthorized reset',
            ]);

        $response->assertStatus(403);
    }

    // ==========================================
    // 4. TENANT ISOLATION
    // ==========================================
    public function test_cross_store_data_access_is_strictly_blocked(): void
    {
        // Mart manager attempts to view Pharma's customers
        $response = $this->actingAs($this->martManager, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string)$this->storePharma->id])
            ->getJson("/api/admin/parties?store_id={$this->storePharma->id}");

        $response->assertStatus(403);
    }

    public function test_super_admin_has_enterprise_cross_store_scope(): void
    {
        $responsePharma = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string)$this->storePharma->id])
            ->getJson('/api/admin/dashboard');

        $responsePharma->assertStatus(200);

        $responseMart = $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string)$this->storeMart->id])
            ->getJson('/api/admin/dashboard');

        $responseMart->assertStatus(200);
    }

    // ==========================================
    // 5. INVOICES, CANCELLATION & GST LOCKS
    // ==========================================
    public function test_invoice_creation_records_stock_deduction(): void
    {
        $initialStock = $this->doloBatch->fresh()->stock_qty; // 100

        $response = $this->actingAs($this->storeOwner, 'sanctum')
            ->postJson('/api/invoices', [
                'store_id' => $this->storePharma->id,
                'customer_id' => $this->customer->id,
                'customer_name' => $this->customer->name,
                'invoice_date' => Carbon::now()->toDateString(),
                'tax_mode' => 'inclusive',
                'payment_mode' => 'cash',
                'items' => [
                    [
                        'product_id' => $this->dolo->id,
                        'product_name' => $this->dolo->name,
                        'batch_id' => $this->doloBatch->id,
                        'batch_no' => $this->doloBatch->batch_no,
                        'qty' => 5, // 5 packs of 15 = 75 base units
                        'unit_price' => 30.00,
                        'mrp' => 33.60,
                        'gst_percent' => 12.00,
                    ],
                ],
                'external_id' => 'uuid-test-inv-001',
            ]);

        $this->assertTrue(in_array($response->status(), [200, 201]));

        // Stock deduction: 100 - (5 * 15) = 25
        $updatedStock = (float)$this->doloBatch->fresh()->stock_qty;
        $this->assertEquals(25.0, $updatedStock);
    }

    public function test_invoice_cancellation_restores_stock_in_open_period(): void
    {
        // Create an invoice first
        $inv = Invoice::create([
            'store_id' => $this->storePharma->id,
            'customer_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'invoice_number' => 'INV-TEST-CANCEL-01',
            'invoice_date' => Carbon::now()->toDateString(),
            'subtotal' => 60.00,
            'taxable_subtotal' => 53.57,
            'grand_total' => 60.00,
            'paid_amount' => 60.00,
            'status' => 'issued',
            'payment_mode' => 'cash',
            'user_id' => $this->manager->id,
            'version' => 1,
        ]);

        InvoiceItem::create([
            'invoice_id' => $inv->id,
            'product_id' => $this->dolo->id,
            'product_name' => $this->dolo->name,
            'batch_no' => $this->doloBatch->batch_no,
            'qty' => 2,
            'unit_price' => 30.00,
            'mrp' => 33.60,
            'taxable_amount' => 53.57,
            'gst_percent' => 12.00,
            'total_amount' => 60.00,
        ]);

        // Stock before cancel
        $this->doloBatch->decrement('stock_qty', 2);
        $stockBefore = (float)$this->doloBatch->fresh()->stock_qty;

        // Cancel with reason
        $response = $this->actingAs($this->manager, 'sanctum')
            ->postJson("/api/admin/invoices/{$inv->id}/cancel", [
                'reason' => 'Customer changed mind and returned immediately',
            ]);

        $response->assertStatus(200);
        $this->assertEquals('cancelled', $inv->fresh()->status);

        // Stock restored
        $stockAfter = (float)$this->doloBatch->fresh()->stock_qty;
        $this->assertEquals($stockBefore + 2.0, $stockAfter);
    }

    public function test_invoice_cancellation_is_rejected_in_locked_gst_period(): void
    {
        // Create locked GST month
        GstLockPeriod::create([
            'store_id' => $this->storePharma->id,
            'period_month' => '2026-07',
            'is_locked' => true,
            'locked_at' => now(),
            'locked_by' => $this->superAdmin->id,
        ]);

        $inv = Invoice::create([
            'store_id' => $this->storePharma->id,
            'customer_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'invoice_number' => 'INV-HISTORIC-LOCKED',
            'invoice_date' => '2026-07-20', // Month 2026-07 is locked!
            'subtotal' => 30.00,
            'taxable_subtotal' => 26.79,
            'grand_total' => 30.00,
            'paid_amount' => 30.00,
            'status' => 'issued',
            'payment_mode' => 'cash',
            'user_id' => $this->manager->id,
            'version' => 1,
        ]);

        $response = $this->actingAs($this->manager, 'sanctum')
            ->postJson("/api/admin/invoices/{$inv->id}/cancel", [
                'reason' => 'Attempting to cancel locked period bill',
            ]);

        // Must reject with 422 HTTP Unprocessable Entity
        $response->assertStatus(422)
            ->assertJsonFragment(['period_month' => '2026-07']);
    }

    // ==========================================
    // 6. PURCHASES & INWARD GOODS
    // ==========================================
    public function test_purchase_entry_creates_records_with_tax_and_free_goods(): void
    {
        $response = $this->actingAs($this->storeOwner, 'sanctum')
            ->postJson('/api/purchases', [
                'store_id' => $this->storePharma->id,
                'supplier_id' => $this->supplier->id,
                'supplier_name' => $this->supplier->name,
                'invoice_number' => 'SUPP-INV-9901',
                'invoice_date' => Carbon::now()->toDateString(),
                'lines' => [
                    [
                        'product_id' => $this->dolo->id,
                        'product_name' => $this->dolo->name,
                        'batch_no' => 'QA-PUR-NEW',
                        'mfg_date' => Carbon::now()->subMonth()->toDateString(),
                        'expiry_date' => Carbon::now()->addMonths(24)->toDateString(),
                        'qty' => 50,
                        'free_qty' => 5, // Free goods bonus scheme!
                        'purchase_rate' => 20.00,
                        'selling_rate' => 30.00,
                        'mrp' => 33.60,
                        'gst_percent' => 12.00,
                    ],
                ],
                'external_id' => 'uuid-pur-001',
            ]);

        $this->assertTrue(in_array($response->status(), [200, 201]));

        $item = PurchaseItem::where('batch_no', 'QA-PUR-NEW')->first();
        $this->assertNotNull($item);
        $this->assertEquals(5, $item->free_qty);
        $this->assertEquals(50, $item->pack_qty);
    }

    // ==========================================
    // 7. STOCK LEDGER & RECONCILIATION
    // ==========================================
    public function test_stock_reconciliation_adjusts_physical_count_and_logs_audit(): void
    {
        $response = $this->actingAs($this->manager, 'sanctum')
            ->postJson('/api/admin/inventory/reconcile', [
                'store_id' => $this->storePharma->id,
                'product_id' => $this->dolo->id,
                'batch_no' => $this->doloBatch->batch_no,
                'physical_qty' => 85,
                'reason' => 'Physical stock audit count discrepancy',
            ]);

        $response->assertStatus(200)
            ->assertJsonPath('success', true);

        $this->assertEquals(85, $this->doloBatch->fresh()->stock_qty);

        // Audit log created
        $this->assertDatabaseHas('audit_logs', [
            'store_id' => $this->storePharma->id,
            'action' => 'reconcile_stock',
        ]);
    }

    // ==========================================
    // 8. TAX CALCULATION & AUTO ROUND-OFF
    // ==========================================
    public function test_statutory_tax_calculation_formulas(): void
    {
        // 1. Inclusive tax formula: Taxable = Gross / (1 + rate)
        $gross = 105.00;
        $gstRate = 0.05;
        $taxableInclusive = round($gross / (1 + $gstRate), 2);
        $taxInclusive = round($gross - $taxableInclusive, 2);

        $this->assertEquals(100.00, $taxableInclusive);
        $this->assertEquals(5.00, $taxInclusive);

        // Intra-state split
        $cgst = round($taxInclusive / 2, 2);
        $sgst = round($taxInclusive / 2, 2);
        $this->assertEquals(2.50, $cgst);
        $this->assertEquals(2.50, $sgst);

        // 2. Indian statutory round-off:
        // 142.40 -> Grand Total 142.00, Round-off -0.40
        $preRound1 = 142.40;
        $rounded1 = round($preRound1);
        $roundOff1 = round($rounded1 - $preRound1, 2);
        $this->assertEquals(142.00, $rounded1);
        $this->assertEquals(-0.40, $roundOff1);

        // 142.50 -> Grand Total 143.00, Round-off +0.50
        $preRound2 = 142.50;
        $rounded2 = round($preRound2);
        $roundOff2 = round($rounded2 - $preRound2, 2);
        $this->assertEquals(143.00, $rounded2);
        $this->assertEquals(0.50, $roundOff2);
    }

    // ==========================================
    // 9. SUPPLIER PAYMENT VOUCHERS
    // ==========================================
    public function test_supplier_payment_voucher_creation(): void
    {
        $response = $this->actingAs($this->manager, 'sanctum')
            ->postJson('/api/payments/supplier', [
                'store_id' => $this->storePharma->id,
                'supplier_id' => $this->supplier->id,
                'amount' => 1500.00,
                'payment_mode' => 'bank_transfer',
                'reference_number' => 'NEFT-88990011',
                'payment_date' => Carbon::now()->toDateString(),
            ]);

        $this->assertTrue(in_array($response->status(), [200, 201]));
    }

    // ==========================================
    // 10. SYNC PUSH IDEMPOTENCY
    // ==========================================
    public function test_sync_push_invoice_is_strictly_idempotent(): void
    {
        $externalId = 'uuid-offline-idemp-001';

        $payload = [
            'store_id' => $this->storePharma->id,
            'customer_id' => $this->customer->id,
            'customer_name' => $this->customer->name,
            'invoice_date' => Carbon::now()->toDateString(),
            'tax_mode' => 'inclusive',
            'payment_mode' => 'cash',
            'items' => [
                [
                    'product_id' => $this->dolo->id,
                    'product_name' => $this->dolo->name,
                    'batch_id' => $this->doloBatch->id,
                    'batch_no' => $this->doloBatch->batch_no,
                    'qty' => 1,
                    'unit_price' => 30.00,
                    'mrp' => 33.60,
                    'gst_percent' => 12.00,
                ],
            ],
            'external_id' => $externalId,
        ];

        // First push
        $res1 = $this->actingAs($this->storeOwner, 'sanctum')
            ->postJson('/api/invoices', $payload);
        $this->assertTrue(in_array($res1->status(), [200, 201]));

        $countBefore = Invoice::where('external_id', $externalId)->count();
        $this->assertEquals(1, $countBefore);

        // Second push with same external_id
        $res2 = $this->actingAs($this->storeOwner, 'sanctum')
            ->postJson('/api/invoices', $payload);
        $this->assertTrue(in_array($res2->status(), [200, 201]));

        // Must still be 1 row, never duplicate!
        $countAfter = Invoice::where('external_id', $externalId)->count();
        $this->assertEquals(1, $countAfter);
    }

    // ==========================================
    // 11. TAMPER-EVIDENT AUDIT TRAIL IMMUTABILITY
    // ==========================================
    public function test_audit_log_has_no_delete_endpoint(): void
    {
        $audit = AuditLog::create([
            'store_id' => $this->storePharma->id,
            'user_id' => $this->superAdmin->id,
            'action' => 'price_override',
            'entity_type' => 'Product',
            'entity_id' => (string)$this->dolo->id,
            'ip_address' => '127.0.0.1',
        ]);

        // Attempt DELETE on audit log
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->deleteJson("/api/admin/audit-logs/{$audit->id}");

        // Must return 404 or 405 Method Not Allowed - no delete route exists!
        $this->assertTrue(in_array($response->status(), [404, 405]));
    }
}
