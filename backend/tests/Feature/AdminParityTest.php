<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CounterShift;
use App\Models\HeldBill;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\Store;
use App\Models\SupplierPayment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminParityTest extends TestCase
{
    use RefreshDatabase;

    protected Store $pharmacyStore;
    protected Store $groceryStore;
    protected User $adminUser;

    protected function setUp(): void
    {
        parent::setUp();

        $this->pharmacyStore = Store::create([
            'name' => 'City Meds Pharmacy',
            'code' => 'MED01',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'gstin' => '32AAAAA0000A1Z5',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->groceryStore = Store::create([
            'name' => 'Fresh Supermarket',
            'code' => 'GRO01',
            'store_type' => 'general_kirana',
            'gst_type' => 'regular',
            'gstin' => '32BBBBB0000B1Z5',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->adminUser = User::create([
            'store_id' => $this->pharmacyStore->id,
            'name' => 'Super Administrator',
            'email' => 'superadmin@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);
    }

    public function test_invoices_returns_and_quotations_isolation_and_parity(): void
    {
        $customer = Party::create([
            'store_id' => $this->pharmacyStore->id,
            'type' => 'customer',
            'name' => 'Rahul Sharma',
            'phone' => '9988776655',
            'opening_balance' => 0,
            'current_balance' => 0,
        ]);

        // 1. Regular Invoice
        Invoice::create([
            'store_id' => $this->pharmacyStore->id,
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'module_key' => 'invoice',
            'invoice_number' => 'INV-001',
            'invoice_date' => now()->toDateString(),
            'subtotal' => 100,
            'tax_total' => 18,
            'grand_total' => 118,
            'paid_amount' => 118,
            'payment_mode' => 'Cash',
            'status' => 'paid',
        ]);

        // 2. Sales Return (Credit Note)
        Invoice::create([
            'store_id' => $this->pharmacyStore->id,
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'module_key' => 'credit_note',
            'invoice_number' => 'CN-001',
            'invoice_date' => now()->toDateString(),
            'subtotal' => 50,
            'tax_total' => 9,
            'grand_total' => 59,
            'paid_amount' => 59,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ]);

        // 3. Quotation
        Invoice::create([
            'store_id' => $this->pharmacyStore->id,
            'customer_id' => $customer->id,
            'customer_name' => $customer->name,
            'module_key' => 'quotation',
            'invoice_number' => 'QUO-001',
            'invoice_date' => now()->toDateString(),
            'subtotal' => 200,
            'tax_total' => 36,
            'grand_total' => 236,
            'paid_amount' => 0,
            'payment_mode' => 'Unpaid',
            'status' => 'draft',
        ]);

        // Invoices endpoint: regular invoices only
        $resInvoices = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/invoices?active_store_id={$this->pharmacyStore->id}");
        $resInvoices->assertStatus(200);
        $this->assertCount(1, $resInvoices->json('data'));
        $this->assertEquals('INV-001', $resInvoices->json('data.0.invoice_number'));

        // Returns endpoint: returns only
        $resReturns = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/returns?active_store_id={$this->pharmacyStore->id}");
        $resReturns->assertStatus(200);
        $this->assertCount(1, $resReturns->json('data'));
        $this->assertEquals('CN-001', $resReturns->json('data.0.invoice_number'));

        // Quotations endpoint: quotations only
        $resQuotations = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/quotations?active_store_id={$this->pharmacyStore->id}");
        $resQuotations->assertStatus(200);
        $this->assertCount(1, $resQuotations->json('data'));
        $this->assertEquals('QUO-001', $resQuotations->json('data.0.invoice_number'));
    }

    public function test_clinical_fields_stripped_for_non_pharmacy_stores(): void
    {
        // Pharmacy store invoice preserves doctor & patient
        $pharmacyInv = Invoice::create([
            'store_id' => $this->pharmacyStore->id,
            'module_key' => 'invoice',
            'invoice_number' => 'MED-001',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 100,
            'paid_amount' => 100,
            'patient_name' => 'Alice Patient',
            'doctor_name' => 'Dr. Robert Smith',
            'doctor_reg_no' => 'DOC12345',
            'status' => 'paid',
        ]);

        $resPharma = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/invoices?active_store_id={$this->pharmacyStore->id}");
        $resPharma->assertStatus(200);
        $this->assertEquals('Alice Patient', $resPharma->json('data.0.patient_name'));
        $this->assertEquals('Dr. Robert Smith', $resPharma->json('data.0.doctor_name'));

        // Grocery store invoice has doctor & patient stripped
        $groceryInv = Invoice::create([
            'store_id' => $this->groceryStore->id,
            'module_key' => 'invoice',
            'invoice_number' => 'GRO-001',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 150,
            'paid_amount' => 150,
            'patient_name' => 'Should Not Appear',
            'doctor_name' => 'Dr. Hidden',
            'doctor_reg_no' => 'HIDDEN99',
            'status' => 'paid',
        ]);

        $resGrocery = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/invoices?active_store_id={$this->groceryStore->id}");
        $resGrocery->assertStatus(200);
        $this->assertNull($resGrocery->json('data.0.patient_name'));
        $this->assertNull($resGrocery->json('data.0.doctor_name'));
        $this->assertNull($resGrocery->json('data.0.doctor_reg_no'));
    }

    public function test_party_restrictions_for_non_pharmacy_store(): void
    {
        // Grocery store cannot create doctor or patient
        $res = $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/parties', [
                'store_id' => $this->groceryStore->id,
                'type' => 'doctor',
                'name' => 'Dr. Unauthorized',
                'phone' => '9888877777',
            ]);
        $res->assertStatus(422);

        // Fetching doctor parties for grocery store returns empty
        $resList = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/parties?active_store_id={$this->groceryStore->id}&type=doctor");
        $resList->assertStatus(200);
        $this->assertCount(0, $resList->json('data'));
    }

    public function test_supplier_payment_and_ledger(): void
    {
        $supplier = Party::create([
            'store_id' => $this->pharmacyStore->id,
            'type' => 'supplier',
            'name' => 'Apollo Pharma Wholesale',
            'phone' => '9111223344',
            'opening_balance' => 10000,
            'current_balance' => 10000,
        ]);

        $resPay = $this->actingAs($this->adminUser, 'sanctum')
            ->postJson('/api/admin/supplier-payments', [
                'store_id' => $this->pharmacyStore->id,
                'supplier_id' => $supplier->id,
                'amount' => 2500,
                'payment_mode' => 'Bank Transfer',
                'reference_no' => 'NEFT-889900',
                'notes' => 'Settlement against Inward bill',
            ]);
        $resPay->assertStatus(201);
        $this->assertEquals(7500, (float)$supplier->fresh()->current_balance);

        // Check Supplier Ledger
        $resLedger = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/suppliers/{$supplier->id}/ledger");
        $resLedger->assertStatus(200);
        $this->assertEquals(10000, (float)$resLedger->json('opening_balance'));
        $this->assertEquals(7500, (float)$resLedger->json('current_balance'));
        $this->assertCount(1, $resLedger->json('transactions'));
        $this->assertEquals('Disbursement', $resLedger->json('transactions.0.type'));
        $this->assertEquals(2500, (float)$resLedger->json('transactions.0.debit'));
    }

    public function test_held_bills_and_counter_shifts(): void
    {
        $counter = Counter::create([
            'store_id' => $this->pharmacyStore->id,
            'counter_code' => 'C1',
            'counter_name' => 'Counter 1',
            'device_name' => 'Main Counter POS',
            'status' => 'approved',
        ]);

        CounterShift::create([
            'store_id' => $this->pharmacyStore->id,
            'counter_id' => $counter->id,
            'opened_by_user_id' => $this->adminUser->id,
            'opening_float' => 1500,
            'cash_sales' => 3200,
            'status' => 'open',
            'opened_at' => now(),
        ]);

        HeldBill::create([
            'id' => 'hb_test_999',
            'store_id' => $this->pharmacyStore->id,
            'held_by_counter_name' => 'C1',
            'customer_name' => 'Held Customer',
            'items_count' => 3,
            'grand_total' => 450,
            'held_at' => now()->timestamp,
            'cart_payload' => ['items' => []],
            'status' => 'held',
        ]);

        $resShifts = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/shifts?active_store_id={$this->pharmacyStore->id}");
        $resShifts->assertStatus(200);
        $this->assertCount(1, $resShifts->json('data'));
        $this->assertEquals('open', $resShifts->json('data.0.status'));

        $resHeld = $this->actingAs($this->adminUser, 'sanctum')
            ->getJson("/api/admin/held-bills?active_store_id={$this->pharmacyStore->id}");
        $resHeld->assertStatus(200);
        $this->assertCount(1, $resHeld->json('data'));
        $this->assertEquals('hb_test_999', $resHeld->json('data.0.id'));
    }
}
