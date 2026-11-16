<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\CompanySetting;
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
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class QaDatabaseSetupTest extends TestCase
{
    public function test_setup_separate_qa_test_database(): void
    {
        $dbPath = database_path('test_qa.sqlite');
        if (file_exists($dbPath)) {
            unlink($dbPath);
        }
        touch($dbPath);

        // Configure connection to use test_qa.sqlite
        Config::set('database.connections.qa_test', [
            'driver' => 'sqlite',
            'database' => $dbPath,
            'prefix' => '',
            'foreign_key_constraints' => true,
        ]);
        Config::set('database.default', 'qa_test');
        DB::purge('qa_test');
        DB::reconnect('qa_test');

        // Run migrations
        Artisan::call('migrate:fresh', [
            '--database' => 'qa_test',
            '--force' => true,
        ]);

        $this->assertTrue(Schema::connection('qa_test')->hasTable('stores'));
        $this->assertTrue(Schema::connection('qa_test')->hasTable('products'));

        // 1. Create Two Stores: Pharmacy and Non-Pharmacy
        $pharmacyStore = Store::on('qa_test')->create([
            'name' => 'Apollo Pharmacy Palakkad',
            'code' => 'PHARM-01',
            'phone' => '+91 491 2501234',
            'email' => 'palakkad@apollopharmacy.qa',
            'address' => 'Ground Floor, City Centre, Palakkad - 678001',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'tax_mode' => 'inclusive',
            'drug_license_numbers' => ['20B-KL-10293', '21B-KL-10294'],
            'fssai_no' => '10020041000123',
            'invoice_prefix' => 'INV-PHM',
            'is_active' => true,
            'license_plan' => 'Enterprise Multi-Store',
            'license_expires_at' => Carbon::now()->addYear(),
            'enabled_menu_items' => ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings', 'expenses', 'returns'],
            'feature_flags' => [
                'allow_offline_billing' => true,
                'require_doctor_on_schedule_h' => true,
                'allow_custom_discounts' => true,
                'auto_print_thermal' => true,
                'allow_negative_stock' => false,
            ],
            'version' => 1,
        ]);

        $retailStore = Store::on('qa_test')->create([
            'name' => 'Metro Supermarket & Mart',
            'code' => 'MART-02',
            'phone' => '+91 484 2809876',
            'email' => 'contact@metromart.qa',
            'address' => 'Highway Plaza, NH 544, Kochi - 682024',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A2Z4',
            'store_type' => 'retail',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'drug_license_numbers' => [],
            'fssai_no' => '10020041000456',
            'invoice_prefix' => 'INV-MRT',
            'is_active' => true,
            'license_plan' => 'Retail Supermarket Pro',
            'license_expires_at' => Carbon::now()->addMonths(10),
            'enabled_menu_items' => ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings', 'expenses', 'returns'],
            'feature_flags' => [
                'allow_offline_billing' => true,
                'require_doctor_on_schedule_h' => false,
                'allow_custom_discounts' => true,
                'allow_negative_stock' => false,
            ],
            'version' => 1,
        ]);

        // 2. Create Staff for Every Role
        $superAdmin = User::on('qa_test')->create([
            'name' => 'Super Administrator',
            'email' => 'admin@lamsuite.com',
            'password' => Hash::make('admin123'),
            'role' => 'super_admin',
            'store_id' => $pharmacyStore->id,
            'allowed_store_ids' => [$pharmacyStore->id, $retailStore->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => true,
            'idle_timeout_minutes' => 30,
        ]);

        $storeOwner = User::on('qa_test')->create([
            'name' => 'Dr. Anoop Menon (Store Owner)',
            'email' => 'owner@lamsuite.com',
            'password' => Hash::make('owner123'),
            'role' => 'store_owner',
            'store_id' => $pharmacyStore->id,
            'allowed_store_ids' => [$pharmacyStore->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => true,
            'idle_timeout_minutes' => 20,
        ]);

        $manager = User::on('qa_test')->create([
            'name' => 'Suresh Kumar (Manager)',
            'email' => 'manager@lamsuite.com',
            'password' => Hash::make('manager123'),
            'role' => 'manager',
            'store_id' => $pharmacyStore->id,
            'allowed_store_ids' => [$pharmacyStore->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => true,
            'idle_timeout_minutes' => 15,
        ]);

        $accountant = User::on('qa_test')->create([
            'name' => 'Priya Nair (Accountant)',
            'email' => 'accountant@lamsuite.com',
            'password' => Hash::make('accountant123'),
            'role' => 'accountant',
            'store_id' => $pharmacyStore->id,
            'allowed_store_ids' => [$pharmacyStore->id, $retailStore->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => false,
            'idle_timeout_minutes' => 15,
        ]);

        $support = User::on('qa_test')->create([
            'name' => 'Deepak Varma (Support)',
            'email' => 'support@lamsuite.com',
            'password' => Hash::make('support123'),
            'role' => 'support',
            'store_id' => null,
            'allowed_store_ids' => [$pharmacyStore->id, $retailStore->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => false,
            'idle_timeout_minutes' => 10,
        ]);

        $martManager = User::on('qa_test')->create([
            'name' => 'Faisal Ali (Mart Manager)',
            'email' => 'kochi_manager@lamsuite.com',
            'password' => Hash::make('manager123'),
            'role' => 'manager',
            'store_id' => $retailStore->id,
            'allowed_store_ids' => [$retailStore->id],
            'totp_enabled' => false,
            'idle_timeout_minutes' => 15,
        ]);

        // Cashiers with PIN codes
        $cashierPharma = User::on('qa_test')->create([
            'name' => 'Rahul Pillai (Pharma Cashier)',
            'email' => 'cashier@qa.local',
            'password' => Hash::make('password123'),
            'role' => 'cashier',
            'pin_code' => Hash::make('1234'),
            'store_id' => $pharmacyStore->id,
            'allowed_store_ids' => [$pharmacyStore->id],
            'is_active' => true,
        ]);

        $cashierMart = User::on('qa_test')->create([
            'name' => 'Divya K (Mart Cashier)',
            'email' => 'mart_cashier@qa.local',
            'password' => Hash::make('password123'),
            'role' => 'cashier',
            'pin_code' => Hash::make('5678'),
            'store_id' => $retailStore->id,
            'allowed_store_ids' => [$retailStore->id],
            'is_active' => true,
        ]);

        // 3. Lookups
        MasterLookup::on('qa_test')->create(['store_id' => $pharmacyStore->id, 'type' => 'group', 'name' => 'Analgesics']);
        MasterLookup::on('qa_test')->create(['store_id' => $pharmacyStore->id, 'type' => 'group', 'name' => 'Antibiotics']);
        MasterLookup::on('qa_test')->create(['store_id' => $pharmacyStore->id, 'type' => 'brand', 'name' => 'Micro Labs']);
        MasterLookup::on('qa_test')->create(['store_id' => $pharmacyStore->id, 'type' => 'brand', 'name' => 'GlaxoSmithKline']);

        MasterLookup::on('qa_test')->create(['store_id' => $retailStore->id, 'type' => 'group', 'name' => 'Groceries']);
        MasterLookup::on('qa_test')->create(['store_id' => $retailStore->id, 'type' => 'group', 'name' => 'Edible Oils']);
        MasterLookup::on('qa_test')->create(['store_id' => $retailStore->id, 'type' => 'brand', 'name' => 'India Gate']);
        MasterLookup::on('qa_test')->create(['store_id' => $retailStore->id, 'type' => 'brand', 'name' => 'Fortune']);

        // 4. Parties (Customers & Suppliers)
        $custWalkIn = Party::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'type' => 'customer',
            'name' => 'Walk-in Retail Customer',
            'phone' => '9999999999',
            'credit_limit' => 0,
            'opening_balance' => 0,
            'current_balance' => 0,
        ]);

        $custCredit = Party::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'type' => 'customer',
            'name' => 'K. Ramanathan (Monthly Account)',
            'phone' => '9847012345',
            'email' => 'ramanathan@gmail.com',
            'address' => '14/320 Kalpathy Agraharam, Palakkad',
            'credit_limit' => 10000,
            'opening_balance' => 1500,
            'current_balance' => 2500,
        ]);

        $custB2B = Party::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'type' => 'customer',
            'name' => 'City Care Clinic & Hospital',
            'phone' => '9847099999',
            'gstin' => '32AABCC1234D1Z2',
            'address' => 'TB Road, Palakkad - 678014',
            'credit_limit' => 50000,
            'current_balance' => 0,
        ]);

        $suppPharma = Party::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'type' => 'supplier',
            'name' => 'National Pharma Wholesale Distributors',
            'phone' => '9447012345',
            'gstin' => '32AABCN9999P1Z1',
            'address' => 'Wholesale Drug Market, Palakkad',
            'credit_limit' => 100000,
            'current_balance' => 15000,
        ]);

        $suppFmcg = Party::on('qa_test')->create([
            'store_id' => $retailStore->id,
            'type' => 'supplier',
            'name' => 'Kerala FMCG Provisions Wholesale',
            'phone' => '9447054321',
            'gstin' => '32AABCK8888Q1Z9',
            'address' => 'Broadway, Kochi',
            'credit_limit' => 50000,
            'current_balance' => 8000,
        ]);

        // 5. Products & Batches
        // Pharmacy Products
        $pDolo = Product::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'name' => 'Dolo 650mg Tablet',
            'barcode' => '8901082000018',
            'secondary_barcodes' => ['DOLO650', '8901082000025'],
            'hsn_code' => '30049099',
            'gst_percent' => 12.00,
            'cess_percent' => 0.00,
            'mrp' => 33.60,
            'sel_rate' => 30.00,
            'unit' => 'STRIP',
            'category' => 'Analgesics & Antipyretics',
            'manufacturer' => 'Micro Labs Ltd',
            'rack_location' => 'A1-RACK',
            'shelf_location' => 'S-02',
            'units_per_pack' => 15,
            'is_schedule_h' => false,
            'is_active' => true,
            'version' => 1,
        ]);

        $b1 = ProductBatch::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'product_id' => $pDolo->id,
            'batch_no' => 'DL24A01',
            'mfg_date' => Carbon::now()->subMonths(6)->toDateString(),
            'expiry_date' => Carbon::now()->addMonths(18)->toDateString(),
            'purchase_rate' => 22.50,
            'mrp' => 33.60,
            'selling_rate' => 30.00,
            'stock_qty' => 120,
            'rack_location' => 'A1-RACK',
        ]);

        $b2NearExp = ProductBatch::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'product_id' => $pDolo->id,
            'batch_no' => 'DL23X99',
            'mfg_date' => Carbon::now()->subMonths(20)->toDateString(),
            'expiry_date' => Carbon::now()->addDays(25)->toDateString(), // Near expiry (<30 days)
            'purchase_rate' => 20.00,
            'mrp' => 33.60,
            'selling_rate' => 28.00,
            'stock_qty' => 30,
            'rack_location' => 'A1-RACK',
        ]);

        $pAug = Product::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'name' => 'Augmentin 625 Duo Tablet',
            'barcode' => '8901082000032',
            'hsn_code' => '30042010',
            'gst_percent' => 12.00,
            'mrp' => 204.00,
            'sel_rate' => 180.00,
            'unit' => 'STRIP',
            'category' => 'Antibiotics',
            'manufacturer' => 'GlaxoSmithKline',
            'rack_location' => 'B2-RACK',
            'shelf_location' => 'S-01',
            'units_per_pack' => 10,
            'is_schedule_h' => true, // Schedule H prescription required
            'is_active' => true,
            'version' => 1,
        ]);

        ProductBatch::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'product_id' => $pAug->id,
            'batch_no' => 'AUG2025',
            'mfg_date' => Carbon::now()->subMonths(3)->toDateString(),
            'expiry_date' => Carbon::now()->addMonths(12)->toDateString(),
            'purchase_rate' => 140.00,
            'mrp' => 204.00,
            'selling_rate' => 180.00,
            'stock_qty' => 45,
            'rack_location' => 'B2-RACK',
        ]);

        ProductBatch::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'product_id' => $pAug->id,
            'batch_no' => 'AUG_EXPIRED',
            'mfg_date' => Carbon::now()->subMonths(24)->toDateString(),
            'expiry_date' => Carbon::now()->subDays(10)->toDateString(), // Expired
            'purchase_rate' => 135.00,
            'mrp' => 200.00,
            'selling_rate' => 175.00,
            'stock_qty' => 15,
            'rack_location' => 'EXP-RACK',
        ]);

        // Non-Pharmacy Retail Products (Store 2)
        $pRice = Product::on('qa_test')->create([
            'store_id' => $retailStore->id,
            'name' => 'India Gate Basmati Rice 5kg',
            'barcode' => '8901234567890',
            'hsn_code' => '10063020',
            'gst_percent' => 5.00,
            'mrp' => 520.00,
            'sel_rate' => 450.00,
            'unit' => 'BAG',
            'category' => 'Groceries',
            'manufacturer' => 'KRBL Limited',
            'units_per_pack' => 1,
            'is_schedule_h' => false,
            'is_active' => true,
            'version' => 1,
        ]);

        ProductBatch::on('qa_test')->create([
            'store_id' => $retailStore->id,
            'product_id' => $pRice->id,
            'batch_no' => 'BAS26-01',
            'mfg_date' => Carbon::now()->subMonths(2)->toDateString(),
            'expiry_date' => Carbon::now()->addMonths(22)->toDateString(),
            'purchase_rate' => 380.00,
            'mrp' => 520.00,
            'selling_rate' => 450.00,
            'stock_qty' => 60,
        ]);

        $pOil = Product::on('qa_test')->create([
            'store_id' => $retailStore->id,
            'name' => 'Fortune Sunlite Sunflower Oil 1L',
            'barcode' => '8901234567891',
            'hsn_code' => '15121910',
            'gst_percent' => 5.00,
            'mrp' => 165.00,
            'sel_rate' => 140.00,
            'unit' => 'POUCH',
            'category' => 'Edible Oils',
            'manufacturer' => 'Adani Wilmar',
            'units_per_pack' => 1,
            'is_schedule_h' => false,
            'is_active' => true,
            'version' => 1,
        ]);

        ProductBatch::on('qa_test')->create([
            'store_id' => $retailStore->id,
            'product_id' => $pOil->id,
            'batch_no' => 'OIL-042',
            'mfg_date' => Carbon::now()->subMonths(1)->toDateString(),
            'expiry_date' => Carbon::now()->addMonths(8)->toDateString(),
            'purchase_rate' => 115.00,
            'mrp' => 165.00,
            'selling_rate' => 140.00,
            'stock_qty' => 120,
        ]);

        // 6. Financial Years & GST Locks
        FinancialYear::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'year_code' => '2026-2027',
            'start_date' => '2026-04-01',
            'end_date' => '2027-03-31',
            'is_locked' => false,
        ]);

        FinancialYear::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'year_code' => '2025-2026',
            'start_date' => '2025-04-01',
            'end_date' => '2026-03-31',
            'is_locked' => true,
            'locked_at' => Carbon::now()->subMonths(6),
            'locked_by' => $superAdmin->id,
        ]);

        GstLockPeriod::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'period_month' => '2026-08',
            'is_locked' => true, // Locked GST period
            'locked_at' => Carbon::now()->subDays(20),
            'locked_by' => $superAdmin->id,
        ]);

        GstLockPeriod::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'period_month' => '2026-09',
            'is_locked' => false, // Open GST period
        ]);

        GstLockPeriod::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'period_month' => '2026-10',
            'is_locked' => false, // Open GST period
        ]);

        // 7. Devices
        Device::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'device_name' => 'Counter Station 01 (Billing Desktop)',
            'device_uuid' => 'dev_tauri_pkd_01',
            'app_version' => '2.0.36',
            'status' => 'active',
            'ip_address' => '192.168.1.101',
            'last_seen_at' => now(),
            'last_sync_at' => now()->subMinutes(2),
        ]);

        Device::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'device_name' => 'Legacy Terminal (Revoked)',
            'device_uuid' => 'dev_tauri_pkd_old',
            'app_version' => '1.4.2',
            'status' => 'revoked',
            'ip_address' => '192.168.1.199',
            'revoke_reason' => 'Unauthorized device hardware decommissioned',
            'last_seen_at' => now()->subDays(45),
        ]);

        Device::on('qa_test')->create([
            'store_id' => $retailStore->id,
            'device_name' => 'Mart Billing Terminal 01',
            'device_uuid' => 'dev_tauri_mart_01',
            'app_version' => '2.0.36',
            'status' => 'active',
            'ip_address' => '192.168.2.50',
            'last_seen_at' => now()->subMinutes(1),
            'last_sync_at' => now()->subMinutes(3),
        ]);

        // 8. Sample Transactions (Invoice in locked period, invoice in open period)
        $invLocked = Invoice::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'customer_id' => $custWalkIn->id,
            'customer_name' => 'Walk-in Retail Customer',
            'invoice_number' => 'INV-PHM-1001',
            'invoice_date' => '2026-08-15', // Falls into locked period 2026-08
            'subtotal' => 30.00,
            'taxable_subtotal' => 26.79,
            'cgst_total' => 1.61,
            'sgst_total' => 1.61,
            'tax_total' => 3.22,
            'round_off' => -0.01,
            'grand_total' => 30.00,
            'paid_amount' => 30.00,
            'status' => 'issued',
            'payment_mode' => 'cash',
            'external_id' => 'uuid-inv-lock-001',
            'user_id' => $superAdmin->id,
            'version' => 1,
        ]);

        InvoiceItem::on('qa_test')->create([
            'invoice_id' => $invLocked->id,
            'product_id' => $pDolo->id,
            'product_name' => 'Dolo 650mg Tablet',
            'batch_no' => 'DL24A01',
            'qty' => 1,
            'unit_price' => 30.00,
            'mrp' => 33.60,
            'taxable_amount' => 26.79,
            'gst_percent' => 12.00,
            'cgst_amount' => 1.61,
            'sgst_amount' => 1.61,
            'tax_amount' => 3.22,
            'total_amount' => 30.00,
        ]);

        $invOpen = Invoice::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'customer_id' => $custCredit->id,
            'customer_name' => 'K. Ramanathan (Monthly Account)',
            'invoice_number' => 'INV-PHM-1002',
            'invoice_date' => '2026-09-10', // Open period
            'subtotal' => 60.00,
            'taxable_subtotal' => 53.57,
            'cgst_total' => 3.21,
            'sgst_total' => 3.21,
            'tax_total' => 6.42,
            'round_off' => 0.01,
            'grand_total' => 60.00,
            'paid_amount' => 0.00,
            'status' => 'issued',
            'payment_mode' => 'credit',
            'external_id' => 'uuid-inv-open-002',
            'user_id' => $superAdmin->id,
            'version' => 1,
        ]);

        InvoiceItem::on('qa_test')->create([
            'invoice_id' => $invOpen->id,
            'product_id' => $pDolo->id,
            'product_name' => 'Dolo 650mg Tablet',
            'batch_no' => 'DL24A01',
            'qty' => 2,
            'unit_price' => 30.00,
            'mrp' => 33.60,
            'taxable_amount' => 53.57,
            'gst_percent' => 12.00,
            'cgst_amount' => 3.21,
            'sgst_amount' => 3.21,
            'tax_amount' => 6.42,
            'total_amount' => 60.00,
        ]);

        // Audit log entry
        AuditLog::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'user_id' => $superAdmin->id,
            'action' => 'qa_seed_initialized',
            'entity_type' => 'Store',
            'entity_id' => (string)$pharmacyStore->id,
            'old_values' => null,
            'new_values' => ['setup' => 'QA Separate Test Database Completed'],
            'ip_address' => '127.0.0.1',
            'user_agent' => 'QA Test Setup Script',
            'created_at' => now(),
        ]);

        // Sync Conflict event for testing Sync Center
        SyncEvent::on('qa_test')->create([
            'store_id' => $pharmacyStore->id,
            'device_id' => 1,
            'entity_type' => 'product',
            'entity_id' => (string)$pDolo->id,
            'action' => 'update',
            'client_version' => 1,
            'server_version' => 2,
            'client_data' => [
                'name' => 'Dolo 650mg Tablet',
                'sel_rate' => 29.00,
                'mrp' => 33.60,
            ],
            'server_data' => [
                'name' => 'Dolo 650mg Tablet',
                'sel_rate' => 30.00,
                'mrp' => 33.60,
            ],
            'status' => 'conflict',
            'conflict_reason' => 'Concurrent edit detected: Offline workstation submitted price 29.00 while cloud is 30.00',
            'created_at' => now()->subMinutes(30),
        ]);

        $this->assertEquals(2, Store::on('qa_test')->count());
        $this->assertEquals(8, User::on('qa_test')->count());
        $this->assertEquals(4, Product::on('qa_test')->count());
        $this->assertEquals(6, ProductBatch::on('qa_test')->count());
    }
}
