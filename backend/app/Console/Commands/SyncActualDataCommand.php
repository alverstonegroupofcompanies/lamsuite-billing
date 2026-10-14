<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\CustomerPayment;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseItem;
use App\Models\StockAdjustment;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use PDO;

class SyncActualDataCommand extends Command
{
    protected $signature = 'data:sync-actual';
    protected $description = 'Sync actual master catalog and transactions into backend database';

    public function handle(): int
    {
        $this->info('Starting sync of actual master data into backend database...');

        $store1 = Store::firstOrCreate(
            ['code' => 'STORE-01'],
            [
                'name' => 'LamStone Pharmacy & Retail (Palakkad Main)',
                'phone' => '+91 98765 43210',
                'email' => 'palakkad@lamstone.in',
                'address' => 'Shop 12-14, Municipal Stadium Complex, Main Road, Palakkad, Kerala - 678001',
                'state_code' => '32',
                'gstin' => '32AAAAA0000A1Z5',
                'drug_license_numbers' => ['20B-KL-PKD-10293', '21B-KL-PKD-10294'],
                'fssai_no' => '10020041000123',
                'tax_mode' => 'inclusive',
                'invoice_prefix' => 'INV-PKD',
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
            ]
        );

        $store2 = Store::firstOrCreate(
            ['code' => 'STORE-02'],
            [
                'name' => 'LamStone Medicos & Superstore (Kochi Branch)',
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
            ]
        );

        $adminUser = User::first();

        // 1. Path to desktop database
        $desktopPath = base_path('../lamsuite_desktop.sqlite');
        if (!file_exists($desktopPath)) {
            $desktopPath = dirname(base_path()) . '/lamsuite_desktop.sqlite';
        }

        $desktopDb = null;
        if (file_exists($desktopPath)) {
            $this->info("Found desktop database at: {$desktopPath}");
            $desktopDb = new PDO("sqlite:{$desktopPath}");
        } else {
            $this->warn("Desktop database not found at {$desktopPath}, generating standard 50-item catalog.");
        }

        // 2. Sync Products & Batches
        $productMap = []; // external_id => Product
        if ($desktopDb) {
            $stmt = $desktopDb->query("SELECT id, data FROM kv_store WHERE table_name = 'products'");
            $countProds = 0;
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $p = json_decode($row['data'], true);
                if (!$p || empty($p['name'])) continue;

                $barcode = $p['barcode'] ?? ('890' . str_pad($countProds + 1, 10, '0', STR_PAD_LEFT));
                $mrp = (float)($p['mrp'] ?? 100);
                $selRate = (float)($p['sel_rate'] ?? round($mrp * 0.9, 2));
                $ptr = (float)($p['ptr'] ?? round($selRate * 0.8, 2));
                $pts = (float)($p['pts'] ?? round($selRate * 0.72, 2));
                $gst = (float)($p['gst_percent'] ?? 12);
                $currentStock = (float)($p['current_stock'] ?? 100);
                $reorderLevel = (float)($p['reorder_level'] ?? 25);

                $product = Product::updateOrCreate(
                    [
                        'store_id' => $store1->id,
                        'name' => $p['name'],
                    ],
                    [
                        'barcode' => $barcode,
                        'print_name' => $p['print_name'] ?? $p['name'],
                        'generic_name' => $p['generic_name'] ?? null,
                        'hsn_sac_code' => $p['hsn_sac_code'] ?? '30049099',
                        'category_id' => $p['category_id'] ?? 'Pharmaceuticals',
                        'brand_id' => $p['brand_id'] ?? 'Standard',
                        'mrp' => $mrp,
                        'sel_rate' => $selRate,
                        'ptr' => $ptr,
                        'pts' => $pts,
                        'gst_percent' => $gst,
                        'units_per_pack' => (int)($p['units_per_pack'] ?? 1),
                        'rack_location' => $p['rack_location'] ?? 'R1',
                        'shelf_location' => $p['shelf_location'] ?? 'S1',
                        'reorder_level' => $reorderLevel,
                        'current_stock' => $currentStock,
                        'is_active' => true,
                        'external_id' => $p['id'] ?? $row['id'],
                        'version' => 1,
                    ]
                );

                $productMap[$p['id']] = $product;
                $productMap[$row['id']] = $product;
                $countProds++;
            }
            $this->info("Imported/Updated {$countProds} actual products for Store 01.");

            // Sync Batches
            $stmt = $desktopDb->query("SELECT id, data FROM kv_store WHERE table_name = 'product_batches'");
            $countBatches = 0;
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $b = json_decode($row['data'], true);
                if (!$b || empty($b['batch_no'])) continue;

                $prod = $productMap[$b['product_id'] ?? ''] ?? null;
                if (!$prod) {
                    // Try to find product by ID or external_id
                    $prod = Product::where('external_id', $b['product_id'] ?? '')->first();
                }

                if ($prod) {
                    $mrp = (float)($b['mrp'] ?? $prod->mrp);
                    $purRate = (float)($b['purchase_rate'] ?? $prod->ptr);
                    $sellRate = (float)($b['selling_rate'] ?? $prod->sel_rate);
                    $stockQty = (float)($b['stock_qty'] ?? 50);

                    // Normalize expiry_date format to YYYY-MM-DD
                    $expStr = $b['expiry_date'] ?? '2027-12-31';
                    if (strlen($expStr) === 7) {
                        $expStr .= '-01';
                    }

                    ProductBatch::updateOrCreate(
                        [
                            'store_id' => $store1->id,
                            'product_id' => $prod->id,
                            'batch_no' => $b['batch_no'],
                        ],
                        [
                            'expiry_date' => $expStr,
                            'mfg_date' => $b['mfg_date'] ?? null,
                            'stock_qty' => $stockQty,
                            'mrp' => $mrp,
                            'purchase_rate' => $purRate,
                            'selling_rate' => $sellRate,
                            'rack_location' => $b['rack_location'] ?? $prod->rack_location,
                            'shelf_location' => $b['shelf_location'] ?? $prod->shelf_location,
                            'external_id' => $b['id'] ?? $row['id'],
                            'version' => 1,
                        ]
                    );
                    $countBatches++;
                }
            }
            $this->info("Imported/Updated {$countBatches} actual batches for Store 01.");
        }

        // 3. Parties (Customers, Suppliers, Doctors, Patients)
        $partiesData = [
            [
                'type' => 'customer',
                'name' => 'Ravi Kumar',
                'phone' => '9876543210',
                'email' => 'ravi.kumar@gmail.com',
                'gstin' => '32AABCU9603R1ZM',
                'address' => '12/4 Cross Road, Palakkad',
                'state_code' => '32',
                'credit_limit' => 5000.00,
                'opening_balance' => 0.00,
                'current_balance' => 1250.00,
                'is_active' => true,
            ],
            [
                'type' => 'customer',
                'name' => 'Priya Menon',
                'phone' => '9847012345',
                'email' => 'priya.menon@outlook.com',
                'address' => 'Green Valley Apartments, Fort Road, Palakkad',
                'state_code' => '32',
                'credit_limit' => 2000.00,
                'opening_balance' => 0.00,
                'current_balance' => 0.00,
                'is_active' => true,
            ],
            [
                'type' => 'customer',
                'name' => 'Dr. Ananya Sharma',
                'phone' => '9447123456',
                'email' => 'clinic.ananya@gmail.com',
                'gstin' => '32AAAAA0000A1Z5',
                'address' => 'City Clinic, Main Junction, Palakkad',
                'state_code' => '32',
                'credit_limit' => 10000.00,
                'opening_balance' => 0.00,
                'current_balance' => 6200.00,
                'is_active' => true,
            ],
            [
                'type' => 'customer',
                'name' => 'Suresh Pillai',
                'phone' => '9745678901',
                'address' => 'Kallekkad, Palakkad',
                'state_code' => '32',
                'credit_limit' => 3000.00,
                'opening_balance' => 0.00,
                'current_balance' => 450.00,
                'is_active' => true,
            ],
            [
                'type' => 'customer',
                'name' => 'City Medicals & Healthcare',
                'phone' => '9895112233',
                'email' => 'orders@citymedicals.in',
                'gstin' => '32AAACB2212Q1ZX',
                'address' => 'Market Road, Palakkad',
                'state_code' => '32',
                'credit_limit' => 50000.00,
                'opening_balance' => 0.00,
                'current_balance' => 15400.00,
                'is_active' => true,
            ],
            [
                'type' => 'customer',
                'name' => 'Muhammad Anshad',
                'phone' => '9846123456',
                'email' => 'mhdanshadpm@gmail.com',
                'address' => 'LamStone Avenue, Palakkad',
                'state_code' => '32',
                'credit_limit' => 10000.00,
                'opening_balance' => 0.00,
                'current_balance' => 0.00,
                'is_active' => true,
            ],
            [
                'type' => 'supplier',
                'name' => 'Southern Drug Distributors Pvt Ltd',
                'phone' => '9447123987',
                'email' => 'sales@southerndrug.com',
                'gstin' => '32AAAAA0000A4Z2',
                'address' => 'Industrial Estate, Olavakkode, Palakkad',
                'state_code' => '32',
                'credit_limit' => 200000.00,
                'opening_balance' => 0.00,
                'current_balance' => 24500.00,
                'is_active' => true,
            ],
            [
                'type' => 'supplier',
                'name' => 'Alverstone Drug House Pvt Ltd.',
                'phone' => '9847128900',
                'email' => 'billing@alverstone.in',
                'gstin' => '32AABCA1234F1Z9',
                'address' => 'Pharma Logistics Park, Cochin',
                'state_code' => '32',
                'credit_limit' => 300000.00,
                'opening_balance' => 0.00,
                'current_balance' => 11200.00,
                'is_active' => true,
            ],
            [
                'type' => 'supplier',
                'name' => 'Apollo Pharma Distributors Pvt Ltd',
                'phone' => '9847012345',
                'email' => 'orders@apollopharma.com',
                'gstin' => '32AAACA1234B1Z2',
                'address' => 'Cochin Hub, Ernakulam',
                'state_code' => '32',
                'credit_limit' => 150000.00,
                'opening_balance' => 0.00,
                'current_balance' => 8400.00,
                'is_active' => true,
            ],
            [
                'type' => 'doctor',
                'name' => 'Dr. K. S. Namboodiri, MD',
                'phone' => '9447011223',
                'reg_no' => 'TCMC-48192',
                'address' => 'District Hospital & Apex Heart Institute',
                'state_code' => '32',
                'is_active' => true,
            ],
            [
                'type' => 'doctor',
                'name' => 'Dr. Suresh Babu, MBBS',
                'phone' => '9447556677',
                'reg_no' => 'KMC-31045',
                'address' => 'Palakkad Medical Center',
                'state_code' => '32',
                'is_active' => true,
            ],
            [
                'type' => 'patient',
                'name' => 'Ramesh Babu',
                'phone' => '9847111222',
                'address' => 'Civil Station Road, Palakkad',
                'state_code' => '32',
                'is_active' => true,
            ],
            [
                'type' => 'patient',
                'name' => 'Kavitha Nair',
                'phone' => '9847333444',
                'address' => 'Stadium Bypass, Palakkad',
                'state_code' => '32',
                'is_active' => true,
            ],
        ];

        foreach ($partiesData as $pData) {
            Party::updateOrCreate(
                [
                    'store_id' => $store1->id,
                    'name' => $pData['name'],
                    'type' => $pData['type'],
                ],
                $pData
            );
        }
        $this->info("Updated actual parties (Customers, Suppliers, Doctors, Patients).");

        // 4. Purchases & Purchase Items (e.g. Alverstone Drug House PB-487294)
        $alverstone = Party::where('store_id', $store1->id)->where('name', 'Alverstone Drug House Pvt Ltd.')->first();
        if ($alverstone) {
            $purBill = Purchase::updateOrCreate(
                [
                    'store_id' => $store1->id,
                    'invoice_number' => 'PB-487294',
                ],
                [
                    'supplier_id' => $alverstone->id,
                    'supplier_name' => $alverstone->name,
                    'supplier_gstin' => $alverstone->gstin,
                    'invoice_date' => '2026-10-08',
                    'subtotal' => 10000.00,
                    'tax_total' => 1200.00,
                    'grand_total' => 11200.00,
                    'paid_amount' => 0.00,
                    'status' => 'received',
                    'notes' => 'Inward Invoice: ADH-26-27-0001',
                    'version' => 1,
                ]
            );

            // Purchase Item for PB-487294
            $pDolo = Product::where('store_id', $store1->id)->where('name', 'like', '%Dolo%')->first();
            if ($pDolo) {
                PurchaseItem::updateOrCreate(
                    [
                        'purchase_id' => $purBill->id,
                        'product_id' => $pDolo->id,
                    ],
                    [
                        'product_name' => $pDolo->name,
                        'batch_no' => 'ABC123',
                        'expiry_date' => '2027-10-31',
                        'qty' => 100,
                        'free_qty' => 50,
                        'unit_price' => 100.00,
                        'tax_amount' => 1200.00,
                        'total_amount' => 11200.00,
                    ]
                );
            }
        }

        // 5. Realistic Invoices & Items
        $allProducts = Product::where('store_id', $store1->id)->with('batches')->get();
        if ($allProducts->count() >= 5) {
            $ravi = Party::where('store_id', $store1->id)->where('name', 'Ravi Kumar')->first();
            $cityMed = Party::where('store_id', $store1->id)->where('name', 'City Medicals & Healthcare')->first();
            $docNamboodiri = Party::where('store_id', $store1->id)->where('name', 'like', '%Namboodiri%')->first();

            $sampleInvoices = [
                [
                    'invoice_number' => 'INV-2026-101',
                    'date' => Carbon::now()->subHours(2)->toDateString(),
                    'customer' => $ravi,
                    'patient' => 'Ramesh Babu',
                    'doctor' => $docNamboodiri,
                    'payment_mode' => 'cash',
                    'items' => [
                        ['idx' => 0, 'qty' => 2],
                        ['idx' => 1, 'qty' => 1],
                    ],
                ],
                [
                    'invoice_number' => 'INV-2026-102',
                    'date' => Carbon::now()->subHours(5)->toDateString(),
                    'customer' => $cityMed,
                    'patient' => 'Self',
                    'doctor' => null,
                    'payment_mode' => 'upi',
                    'items' => [
                        ['idx' => 2, 'qty' => 5],
                        ['idx' => 3, 'qty' => 3],
                        ['idx' => 4, 'qty' => 2],
                    ],
                ],
                [
                    'invoice_number' => 'INV-2026-103',
                    'date' => Carbon::yesterday()->toDateString(),
                    'customer' => null,
                    'patient' => 'Walk-in Retail',
                    'doctor' => null,
                    'payment_mode' => 'cash',
                    'items' => [
                        ['idx' => 0, 'qty' => 1],
                        ['idx' => 4, 'qty' => 1],
                    ],
                ],
                [
                    'invoice_number' => 'INV-2026-104',
                    'date' => Carbon::now()->subDays(2)->toDateString(),
                    'customer' => $ravi,
                    'patient' => 'Ramesh Babu',
                    'doctor' => $docNamboodiri,
                    'payment_mode' => 'credit',
                    'items' => [
                        ['idx' => 1, 'qty' => 4],
                        ['idx' => 2, 'qty' => 2],
                    ],
                ],
            ];

            foreach ($sampleInvoices as $sInv) {
                $subtotal = 0;
                $taxTotal = 0;
                $itemsData = [];

                foreach ($sInv['items'] as $itemRef) {
                    $prod = $allProducts->get($itemRef['idx']);
                    if (!$prod) continue;
                    $batch = $prod->batches->first();
                    $batchNo = $batch ? $batch->batch_no : 'BAT-01';
                    $lineTotal = round($prod->sel_rate * $itemRef['qty'], 2);
                    $lineTax = round($lineTotal * ($prod->gst_percent / 100), 2);
                    $subtotal += $lineTotal;
                    $taxTotal += $lineTax;

                    $itemsData[] = [
                        'product_id' => $prod->id,
                        'product_name' => $prod->name,
                        'batch_no' => $batchNo,
                        'qty' => $itemRef['qty'],
                        'unit_price' => $prod->sel_rate,
                        'gst_percent' => $prod->gst_percent,
                        'tax_amount' => $lineTax,
                        'total_amount' => $lineTotal + $lineTax,
                    ];
                }

                $grandTotal = round($subtotal + $taxTotal, 2);
                $paid = $sInv['payment_mode'] === 'credit' ? 0 : $grandTotal;

                $inv = Invoice::updateOrCreate(
                    [
                        'store_id' => $store1->id,
                        'invoice_number' => $sInv['invoice_number'],
                    ],
                    [
                        'module_key' => 'invoice',
                        'invoice_date' => $sInv['date'],
                        'customer_id' => $sInv['customer'] ? $sInv['customer']->id : null,
                        'customer_name' => $sInv['customer'] ? $sInv['customer']->name : 'Walk-in Retail',
                        'customer_gstin' => $sInv['customer'] ? $sInv['customer']->gstin : null,
                        'subtotal' => $subtotal,
                        'discount_total' => 0.00,
                        'tax_total' => $taxTotal,
                        'round_off' => 0.00,
                        'grand_total' => $grandTotal,
                        'paid_amount' => $paid,
                        'payment_mode' => $sInv['payment_mode'],
                        'status' => 'issued',
                        'patient_name' => $sInv['patient'],
                        'doctor_name' => $sInv['doctor'] ? $sInv['doctor']->name : null,
                        'doctor_reg_no' => $sInv['doctor'] ? $sInv['doctor']->reg_no : null,
                        'version' => 1,
                    ]
                );

                InvoiceItem::where('invoice_id', $inv->id)->delete();
                foreach ($itemsData as $itData) {
                    InvoiceItem::create(array_merge($itData, ['invoice_id' => $inv->id]));
                }
            }
            $this->info("Created realistic invoices with line items.");
        }

        // 6. Stock Transfers & Adjustments
        if ($allProducts->count() > 2) {
            $pFirst = $allProducts->first();
            StockAdjustment::firstOrCreate(
                [
                    'store_id' => $store1->id,
                    'product_id' => $pFirst->id,
                    'batch_no' => $pFirst->batches->first()?->batch_no ?? 'BAT-01',
                    'reason' => 'Cycle Count Physical Audit Variance',
                ],
                [
                    'user_id' => $adminUser ? $adminUser->id : 1,
                    'adjustment_type' => 'audit',
                    'qty' => 5,
                ]
            );

            // Stock Transfer between Store 1 and Store 2
            $stkTransfer = StockTransfer::firstOrCreate(
                [
                    'transfer_number' => 'TRF-2026-001',
                ],
                [
                    'from_store_id' => $store1->id,
                    'to_store_id' => $store2->id,
                    'status' => 'dispatched',
                    'created_by' => $adminUser ? $adminUser->id : 1,
                    'notes' => 'Urgent branch stock replenishment request',
                ]
            );

            StockTransferItem::updateOrCreate(
                [
                    'stock_transfer_id' => $stkTransfer->id,
                    'product_id' => $pFirst->id,
                ],
                [
                    'batch_no' => $pFirst->batches->first()?->batch_no ?? 'BAT-01',
                    'qty' => 10,
                ]
            );
        }

        // 7. Expenses & Customer Payments
        Expense::firstOrCreate(
            ['reference_no' => 'EXP-2026-001'],
            [
                'store_id' => $store1->id,
                'expense_head' => 'Utilities & Power',
                'amount' => 3450.00,
                'payment_mode' => 'Bank Transfer',
                'expense_date' => Carbon::now()->subDays(1)->toDateString(),
                'notes' => 'KSEB Electricity Bill for Palakkad Main Store',
                'created_by' => $adminUser ? $adminUser->id : 1,
            ]
        );

        Expense::firstOrCreate(
            ['reference_no' => 'EXP-2026-002'],
            [
                'store_id' => $store1->id,
                'expense_head' => 'Packaging Materials',
                'amount' => 1200.00,
                'payment_mode' => 'Cash',
                'expense_date' => Carbon::now()->toDateString(),
                'notes' => 'Medicine Carry Bags & Pill Pouches',
                'created_by' => $adminUser ? $adminUser->id : 1,
            ]
        );

        $raviCust = Party::where('store_id', $store1->id)->where('name', 'Ravi Kumar')->first();
        if ($raviCust) {
            CustomerPayment::firstOrCreate(
                ['reference_no' => 'RCPT-2026-001'],
                [
                    'store_id' => $store1->id,
                    'customer_id' => $raviCust->id,
                    'amount' => 1000.00,
                    'payment_mode' => 'GPay UPI',
                    'payment_date' => Carbon::now()->toDateString(),
                    'notes' => 'Partial ledger payment towards monthly medicine dues',
                    'created_by' => $adminUser ? $adminUser->id : 1,
                ]
            );
        }

        // 8. Audit Log
        AuditLog::log('sync_actual_data', 'System', 'all', null, ['status' => 'completed', 'total_products' => Product::count()], $store1->id, $adminUser ? $adminUser->id : 1);

        $this->info('Successfully populated actual live enterprise data into backend database!');
        return Command::SUCCESS;
    }
}
