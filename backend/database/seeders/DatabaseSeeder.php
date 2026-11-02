<?php

namespace Database\Seeders;

use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\CustomerPayment;
use App\Models\Device;
use App\Models\Expense;
use App\Models\FinancialYear;
use App\Models\GstLockPeriod;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\MasterLookup;
use App\Models\Notification;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\Store;
use App\Models\SyncEvent;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // 1. Create Stores
        $store1 = Store::create([
            'name' => 'LamStone Healthcare Center',
            'code' => 'STORE-01',
            'phone' => '+91 484 2901234',
            'email' => 'support@lamstone.in',
            'address' => 'Main Healthcare Complex, Kerala - 682001',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5',
            'drug_license_numbers' => ['20B-KL-10293', '21B-KL-10294'],
            'fssai_no' => '10020041000123',
            'tax_mode' => 'inclusive',
            'invoice_prefix' => 'INV',
            'is_active' => true,
            'license_plan' => 'Enterprise Multi-Store',
            'license_expires_at' => Carbon::now()->addMonths(14),
            'enabled_menu_items' => ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings', 'expenses', 'returns'],
            'feature_flags' => [
                'allow_offline_billing' => true,
                'require_doctor_on_schedule_h' => true,
                'allow_custom_discounts' => true,
                'auto_print_thermal' => true,
                'enable_wallet_credit' => true,
                'enforce_mrp_capping' => true,
            ],
            'version' => 1,
        ]);

        $store2 = Store::create([
            'name' => 'LamStone Medicos & Superstore (Kochi Branch)',
            'code' => 'STORE-02',
            'phone' => '+91 98765 43211',
            'email' => 'kochi@lamstone.in',
            'address' => 'Ground Floor, Metro Pillar 421, MG Road, Ernakulam, Kochi - 682016',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A2Z4',
            'drug_license_numbers' => ['20B-KL-EKM-40291', '21B-KL-EKM-40292'],
            'fssai_no' => '10020041000456',
            'tax_mode' => 'inclusive',
            'invoice_prefix' => 'INV-KCH',
            'is_active' => true,
            'license_plan' => 'Professional Store',
            'license_expires_at' => Carbon::now()->addMonths(8),
            'enabled_menu_items' => ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings'],
            'feature_flags' => [
                'allow_offline_billing' => true,
                'require_doctor_on_schedule_h' => true,
                'allow_custom_discounts' => false,
            ],
            'version' => 1,
        ]);

        $store3 = Store::create([
            'name' => 'LamStone Regional Distribution Hub (Calicut)',
            'code' => 'STORE-03',
            'phone' => '+91 98765 43212',
            'email' => 'calicut@lamstone.in',
            'address' => 'Industrial Area Phase 2, Beypore Road, Calicut - 673015',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A3Z3',
            'drug_license_numbers' => ['20B-KL-CLT-70291', '21B-KL-CLT-70292'],
            'fssai_no' => '10020041000789',
            'tax_mode' => 'exclusive',
            'invoice_prefix' => 'INV-CLT',
            'is_active' => false, // Initially disabled to test desktop app disabled state!
            'license_plan' => 'Warehouse & B2B Hub',
            'license_expires_at' => Carbon::now()->addDays(5),
            'enabled_menu_items' => ['stock', 'purchases', 'settings'],
            'version' => 1,
        ]);

        // 2. Create Users with All Roles
        $superAdmin = User::create([
            'name' => 'Rajesh Sharma',
            'email' => 'admin@lamstone.in',
            'password' => Hash::make('password123'),
            'role' => 'super_admin',
            'store_id' => $store1->id,
            'allowed_store_ids' => [$store1->id, $store2->id, $store3->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => true,
            'idle_timeout_minutes' => 30,
        ]);

        $storeOwner = User::create([
            'name' => 'Dr. Anoop Menon',
            'email' => 'owner@lamstone.in',
            'password' => Hash::make('password123'),
            'role' => 'store_owner',
            'store_id' => $store1->id,
            'allowed_store_ids' => [$store1->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => true,
            'idle_timeout_minutes' => 20,
        ]);

        $manager = User::create([
            'name' => 'Suresh Kumar',
            'email' => 'manager@lamstone.in',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'store_id' => $store1->id,
            'allowed_store_ids' => [$store1->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => true,
            'idle_timeout_minutes' => 15,
        ]);

        $accountant = User::create([
            'name' => 'Priya Nair',
            'email' => 'accountant@lamstone.in',
            'password' => Hash::make('password123'),
            'role' => 'accountant', // reports only
            'store_id' => $store1->id,
            'allowed_store_ids' => [$store1->id, $store2->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => false,
            'idle_timeout_minutes' => 15,
        ]);

        $support = User::create([
            'name' => 'Deepak Varma',
            'email' => 'support@lamstone.in',
            'password' => Hash::make('password123'),
            'role' => 'support', // read only
            'store_id' => null,
            'allowed_store_ids' => [$store1->id, $store2->id, $store3->id],
            'totp_enabled' => false,
            'is_biometric_enabled' => false,
            'idle_timeout_minutes' => 10,
        ]);

        $kochiManager = User::create([
            'name' => 'Faisal Ali',
            'email' => 'kochi_manager@lamstone.in',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'store_id' => $store2->id,
            'allowed_store_ids' => [$store2->id],
            'totp_enabled' => false,
            'idle_timeout_minutes' => 15,
        ]);

        // 3. Devices
        Device::create([
            'store_id' => $store1->id,
            'device_name' => 'Counter Station 01 (Billing Desktop)',
            'device_uuid' => 'dev_tauri_pkd_01',
            'app_version' => '2.0.0',
            'status' => 'active',
            'ip_address' => '192.168.1.101',
            'last_seen_at' => now(),
            'last_sync_at' => now()->subMinutes(2),
        ]);

        Device::create([
            'store_id' => $store1->id,
            'device_name' => 'Counter Station 02 (Pharmacy Rx Desk)',
            'device_uuid' => 'dev_tauri_pkd_02',
            'app_version' => '2.0.0',
            'status' => 'active',
            'ip_address' => '192.168.1.102',
            'last_seen_at' => now()->subMinutes(5),
            'last_sync_at' => now()->subMinutes(7),
        ]);

        Device::create([
            'store_id' => $store1->id,
            'device_name' => 'Legacy POS Terminal (Decommissioned)',
            'device_uuid' => 'dev_tauri_pkd_old',
            'app_version' => '1.4.2',
            'status' => 'revoked',
            'ip_address' => '192.168.1.199',
            'revoke_reason' => 'Hardware upgraded to Station 02',
            'last_seen_at' => now()->subDays(45),
        ]);

        Device::create([
            'store_id' => $store2->id,
            'device_name' => 'Kochi Main Billing Terminal',
            'device_uuid' => 'dev_tauri_kch_01',
            'app_version' => '2.0.0',
            'status' => 'active',
            'ip_address' => '192.168.2.50',
            'last_seen_at' => now()->subMinutes(1),
            'last_sync_at' => now()->subMinutes(3),
        ]);

        // 4. Master Lookups
        $groups = ['Analgesics & Antipyretics', 'Antibiotics', 'Antacids & PPI', 'Vitamins & Supplements', 'Surgicals & First Aid'];
        foreach ($groups as $g) {
            MasterLookup::create(['store_id' => $store1->id, 'type' => 'group', 'name' => $g]);
        }
        $brands = ['Micro Labs', 'Cipla', 'Sun Pharma', 'Alkem', 'GlaxoSmithKline'];
        foreach ($brands as $b) {
            MasterLookup::create(['store_id' => $store1->id, 'type' => 'brand', 'name' => $b]);
        }

        // 5. Parties (Customers, Suppliers, Doctors, Patients)
        $custWalkIn = Party::create([
            'store_id' => $store1->id,
            'type' => 'customer',
            'name' => 'Walk-in Retail Customer',
            'phone' => '9999999999',
            'credit_limit' => 0,
            'opening_balance' => 0,
            'current_balance' => 0,
        ]);

        $custCredit = Party::create([
            'store_id' => $store1->id,
            'type' => 'customer',
            'name' => 'K. Ramanathan (Monthly Account)',
            'phone' => '9847012345',
            'email' => 'ramanathan@gmail.com',
            'address' => '14/320 Kalpathy Agraharam, Palakkad',
            'credit_limit' => 25000,
            'opening_balance' => 3500,
            'current_balance' => 8450,
        ]);

        $custB2B = Party::create([
            'store_id' => $store1->id,
            'type' => 'customer',
            'name' => 'Lotus Specialty Clinic & Nursing Home',
            'phone' => '9847098765',
            'email' => 'purchase@lotusclinic.org',
            'gstin' => '32ABCDE1234F1Z9',
            'address' => 'Court Road, Palakkad - 678001',
            'credit_limit' => 150000,
            'opening_balance' => 0,
            'current_balance' => 45200,
        ]);

        $supplier = Party::create([
            'store_id' => $store1->id,
            'type' => 'supplier',
            'name' => 'Southern Drug Distributors Pvt Ltd',
            'phone' => '9447123987',
            'email' => 'orders@southerndrug.in',
            'gstin' => '32AABCS4567M1Z1',
            'address' => 'Wholesale Market Yard, Palakkad',
            'credit_limit' => 500000,
            'current_balance' => 74500,
        ]);

        $doctor = Party::create([
            'store_id' => $store1->id,
            'type' => 'doctor',
            'name' => 'Dr. K. S. Namboodiri, MD',
            'phone' => '9447011223',
            'reg_no' => 'TCMC-48192',
            'address' => 'District Hospital & Apex Heart Institute',
        ]);

        // 6. Products & Batches
        $p1 = Product::create([
            'store_id' => $store1->id,
            'barcode' => '8901030010011',
            'name' => 'Dolo 650mg Tablet',
            'print_name' => 'Dolo 650mg (15 Tab)',
            'generic_name' => 'Paracetamol 650mg',
            'hsn_sac_code' => '30049099',
            'category_id' => 'Analgesics',
            'brand_id' => 'Micro Labs',
            'mrp' => 33.60,
            'sel_rate' => 30.00,
            'ptr' => 22.40,
            'pts' => 20.16,
            'gst_percent' => 12.00,
            'units_per_pack' => 15,
            'reorder_level' => 50,
            'current_stock' => 180,
            'version' => 1,
        ]);

        ProductBatch::create([
            'store_id' => $store1->id,
            'product_id' => $p1->id,
            'batch_no' => 'DL9812',
            'mfg_date' => Carbon::now()->subMonths(3),
            'expiry_date' => Carbon::now()->addMonths(21),
            'stock_qty' => 180,
            'mrp' => 33.60,
            'purchase_rate' => 22.40,
            'selling_rate' => 30.00,
            'version' => 1,
        ]);

        $p2 = Product::create([
            'store_id' => $store1->id,
            'barcode' => '8901030020022',
            'name' => 'Augmentin 625 Duo Tablet',
            'print_name' => 'Augmentin 625 (10 Tab)',
            'generic_name' => 'Amoxicillin + Clavulanic Acid',
            'hsn_sac_code' => '30041090',
            'category_id' => 'Antibiotics',
            'brand_id' => 'GlaxoSmithKline',
            'mrp' => 218.40,
            'sel_rate' => 195.00,
            'ptr' => 145.60,
            'pts' => 131.04,
            'gst_percent' => 12.00,
            'units_per_pack' => 10,
            'reorder_level' => 20,
            'current_stock' => 45,
            'version' => 1,
        ]);

        // Near-expiry batch for alerts!
        ProductBatch::create([
            'store_id' => $store1->id,
            'product_id' => $p2->id,
            'batch_no' => 'AUG2024',
            'mfg_date' => Carbon::now()->subMonths(18),
            'expiry_date' => Carbon::now()->addDays(20), // expires in 20 days!
            'stock_qty' => 15,
            'mrp' => 218.40,
            'purchase_rate' => 145.60,
            'selling_rate' => 195.00,
            'version' => 1,
        ]);

        ProductBatch::create([
            'store_id' => $store1->id,
            'product_id' => $p2->id,
            'batch_no' => 'AUG2025',
            'mfg_date' => Carbon::now()->subMonths(2),
            'expiry_date' => Carbon::now()->addMonths(14),
            'stock_qty' => 30,
            'mrp' => 218.40,
            'purchase_rate' => 145.60,
            'selling_rate' => 195.00,
            'version' => 1,
        ]);

        $p3 = Product::create([
            'store_id' => $store1->id,
            'barcode' => '8901030030033',
            'name' => 'Pan 40 Tablet',
            'print_name' => 'Pan 40 (15 Tab)',
            'generic_name' => 'Pantoprazole 40mg',
            'hsn_sac_code' => '30049099',
            'category_id' => 'Antacids & PPI',
            'brand_id' => 'Alkem',
            'mrp' => 155.00,
            'sel_rate' => 140.00,
            'ptr' => 103.00,
            'pts' => 92.70,
            'gst_percent' => 12.00,
            'units_per_pack' => 15,
            'reorder_level' => 30,
            'current_stock' => 8, // Below reorder level for low stock alert!
            'version' => 1,
        ]);

        ProductBatch::create([
            'store_id' => $store1->id,
            'product_id' => $p3->id,
            'batch_no' => 'PN4011',
            'mfg_date' => Carbon::now()->subMonths(6),
            'expiry_date' => Carbon::now()->addMonths(18),
            'stock_qty' => 8,
            'mrp' => 155.00,
            'purchase_rate' => 103.00,
            'selling_rate' => 140.00,
            'version' => 1,
        ]);

        // Product in Store 2 (Kochi) for multi-tenant isolation testing
        $pStore2 = Product::create([
            'store_id' => $store2->id,
            'barcode' => '8909999000011',
            'name' => 'Kochi Exclusive Wellness Tonic',
            'generic_name' => 'Herbal Extract',
            'hsn_sac_code' => '30049099',
            'mrp' => 450.00,
            'sel_rate' => 420.00,
            'gst_percent' => 18.00,
            'reorder_level' => 10,
            'current_stock' => 50,
            'version' => 1,
        ]);

        // 7. Invoices
        $inv1 = Invoice::create([
            'store_id' => $store1->id,
            'module_key' => 'invoice',
            'invoice_number' => 'INV-PKD-1001',
            'invoice_date' => Carbon::today()->toDateString(),
            'customer_id' => $custWalkIn->id,
            'customer_name' => $custWalkIn->name,
            'subtotal' => 200.89,
            'discount_total' => 0.00,
            'tax_total' => 24.11,
            'round_off' => 0.00,
            'grand_total' => 225.00,
            'paid_amount' => 225.00,
            'payment_mode' => 'UPI',
            'status' => 'issued',
            'patient_name' => 'Ramesh Babu',
            'doctor_name' => $doctor->name,
            'doctor_reg_no' => $doctor->reg_no,
            'version' => 1,
        ]);

        InvoiceItem::create([
            'invoice_id' => $inv1->id,
            'product_id' => $p1->id,
            'product_name' => $p1->name,
            'batch_no' => 'DL9812',
            'qty' => 1,
            'unit_price' => 30.00,
            'gst_percent' => 12.00,
            'tax_amount' => 3.21,
            'total_amount' => 30.00,
        ]);

        InvoiceItem::create([
            'invoice_id' => $inv1->id,
            'product_id' => $p2->id,
            'product_name' => $p2->name,
            'batch_no' => 'AUG2025',
            'qty' => 1,
            'unit_price' => 195.00,
            'gst_percent' => 12.00,
            'tax_amount' => 20.89,
            'total_amount' => 195.00,
        ]);

        $inv2 = Invoice::create([
            'store_id' => $store1->id,
            'module_key' => 'invoice',
            'invoice_number' => 'INV-PKD-1002',
            'invoice_date' => Carbon::yesterday()->toDateString(),
            'customer_id' => $custB2B->id,
            'customer_name' => $custB2B->name,
            'customer_gstin' => $custB2B->gstin,
            'subtotal' => 4500.00,
            'discount_total' => 200.00,
            'tax_total' => 516.00,
            'round_off' => 0.00,
            'grand_total' => 4816.00,
            'paid_amount' => 0.00,
            'payment_mode' => 'Credit',
            'status' => 'issued',
            'version' => 1,
        ]);

        // 8. Purchases
        $pur1 = Purchase::create([
            'store_id' => $store1->id,
            'supplier_id' => $supplier->id,
            'supplier_name' => $supplier->name,
            'supplier_gstin' => $supplier->gstin,
            'invoice_number' => 'SDD-9812',
            'invoice_date' => Carbon::now()->subDays(3)->toDateString(),
            'subtotal' => 24500.00,
            'tax_total' => 2940.00,
            'grand_total' => 27440.00,
            'paid_amount' => 27440.00,
            'status' => 'received',
            'version' => 1,
        ]);

        // 9. Financial Years & GST Locks
        FinancialYear::create([
            'store_id' => $store1->id,
            'year_code' => '2026-2027',
            'start_date' => '2026-04-01',
            'end_date' => '2027-03-31',
            'is_locked' => false,
        ]);

        FinancialYear::create([
            'store_id' => $store1->id,
            'year_code' => '2025-2026',
            'start_date' => '2025-04-01',
            'end_date' => '2026-03-31',
            'is_locked' => true,
            'locked_at' => Carbon::now()->subMonths(6),
            'locked_by' => $superAdmin->id,
        ]);

        GstLockPeriod::create([
            'store_id' => $store1->id,
            'period_month' => '2026-08',
            'is_locked' => true,
            'locked_at' => Carbon::now()->subDays(20),
            'locked_by' => $superAdmin->id,
        ]);

        GstLockPeriod::create([
            'store_id' => $store1->id,
            'period_month' => '2026-09',
            'is_locked' => false,
        ]);

        // 10. Sync Events & Conflicts
        SyncEvent::create([
            'store_id' => $store1->id,
            'device_id' => 1,
            'entity_type' => 'invoice',
            'entity_id' => 'INV-PKD-1001',
            'action' => 'create',
            'client_version' => 1,
            'server_version' => 1,
            'status' => 'resolved',
            'created_at' => now()->subMinutes(15),
        ]);

        // Realistic conflict event for the Sync Center testing
        SyncEvent::create([
            'store_id' => $store1->id,
            'device_id' => 1,
            'entity_type' => 'product',
            'entity_id' => (string)$p1->id,
            'action' => 'update',
            'client_version' => 1,
            'server_version' => 2,
            'client_data' => [
                'name' => 'Dolo 650mg Tablet',
                'sel_rate' => 28.50, // Offline cashier changed rate locally
                'mrp' => 33.60,
            ],
            'server_data' => [
                'name' => 'Dolo 650mg Tablet',
                'sel_rate' => 30.00, // Cloud admin updated rate centrally
                'mrp' => 33.60,
            ],
            'status' => 'conflict',
            'conflict_reason' => 'Concurrent edit detected: Offline workstation submitted price 28.50 while cloud was updated to 30.00.',
            'created_at' => now()->subHours(1),
        ]);

        // 11. Initial Audit Log & Notification
        AuditLog::create([
            'store_id' => $store1->id,
            'user_id' => $superAdmin->id,
            'action' => 'system_seed_init',
            'entity_type' => 'System',
            'entity_id' => '1',
            'new_values' => ['stores' => 3, 'users' => 6],
            'ip_address' => '127.0.0.1',
            'user_agent' => 'Seeder Script',
            'created_at' => now(),
        ]);

        Notification::create([
            'store_id' => $store1->id,
            'title' => 'Low Stock Alert: Pan 40 Tablet',
            'message' => 'Pan 40 Tablet current stock (8 units) has dropped below reorder level (30 units).',
            'type' => 'stock_low',
            'is_read' => false,
            'data' => ['product_id' => $p3->id, 'current_stock' => 8],
        ]);

        Notification::create([
            'store_id' => $store1->id,
            'title' => 'Near Expiry Alert: Augmentin 625 (Batch AUG2024)',
            'message' => 'Batch AUG2024 expires within 20 days. 15 packs remaining in stock.',
            'type' => 'expiry',
            'is_read' => false,
            'data' => ['batch_id' => 2],
        ]);

        // Automatically sync full enterprise catalog & transaction records
        \Illuminate\Support\Facades\Artisan::call('data:sync-actual');
    }
}
