<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GAP-02 / PHR-007 — the restricted-drug register.
 *
 * The QA run found `schedule_h1_register` returning the last 50 bills that
 * happened to name a doctor: every line, no schedule, cancelled bills included,
 * and no pharmacist. A Schedule H1 register is a statutory book — one entry per
 * restricted pack sold, in the order it was sold, with the batch, the schedule
 * it is listed under and the registered pharmacist who vouched for it. A line
 * nobody vouched for is the entry an owner most needs to see, so it stays in
 * the book and reads as unconfirmed rather than dropping out.
 *
 * A store that sells no medicines has no book at all (PHR-011): its rows are
 * empty and no pharmacist or schedule words reach its payload.
 */
class RestrictedDrugRegisterTest extends TestCase
{
    use RefreshDatabase;

    private Store $pharmacy;
    private Store $grocery;
    private User $owner;
    private Counter $c01;
    private Counter $c05;
    private Product $alprazolam;
    private Product $diazepam;
    private Product $paracetamol;
    private Product $rice;
    private ProductBatch $alpBatch;
    private ProductBatch $diaBatch;
    private ProductBatch $paraBatch;
    private ProductBatch $riceBatch;
    private Salesperson $firoza;

    private const PIN = '582913';

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->pharmacy = Store::create([
            'name' => 'LamStone Medicos',
            'code' => 'LMS',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);
        $this->grocery = Store::create([
            'name' => 'Fresh Mart',
            'code' => 'FRM',
            'state_code' => '32',
            'store_type' => 'kirana_general',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@drug-register.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->pharmacy->id,
        ]);

        $this->c01 = $this->counter($this->pharmacy, 'C01');
        $this->c05 = $this->counter($this->grocery, 'C05');

        $h1 = $this->schedule($this->pharmacy, 'H1', ['restricted' => true, 'prescription_required' => true]);
        $h = $this->schedule($this->pharmacy, 'H', ['restricted' => false, 'prescription_required' => true]);

        $this->alprazolam = $this->product($this->pharmacy, 'QA Alprazolam 0.25 Strip', 'REG-ALP', $h1->id);
        $this->diazepam = $this->product($this->pharmacy, 'Diazepam 5mg', 'REG-DIA', $h1->id);
        $this->paracetamol = $this->product($this->pharmacy, 'Paracetamol 650', 'REG-PAR', $h->id);
        $this->rice = $this->product($this->grocery, 'Sona Masoori Rice 5kg', 'REG-RICE', null);

        $this->alpBatch = $this->batch($this->alprazolam, 'BCH-ALP');
        $this->diaBatch = $this->batch($this->diazepam, 'BCH-DIA');
        $this->paraBatch = $this->batch($this->paracetamol, 'BCH-PAR');
        $this->riceBatch = $this->batch($this->rice, 'BCH-RICE');

        $this->firoza = Salesperson::create([
            'store_id' => $this->pharmacy->id,
            'name' => 'Dr. Firoza Ali',
            'code' => 'SP-01',
            'is_pharmacist' => true,
            'reg_no' => 'KPK-2019-45512',
            'reg_valid_from' => '2019-06-01',
            'reg_valid_until' => '2029-05-31',
            'pin' => self::PIN,
            'is_active' => true,
        ]);

        // SPR-006 answers about who sold the bill; this file reads who vouched.
        foreach ([$this->pharmacy->id, $this->grocery->id] as $storeId) {
            CompanySetting::updateOrCreate(
                ['store_id' => $storeId, 'key' => 'salesperson_on_bill'],
                ['value' => 'optional', 'is_secret' => false]
            );
        }
    }

    // --- fixtures ---------------------------------------------------------

    private function counter(Store $store, string $code): Counter
    {
        return Counter::create([
            'store_id' => $store->id,
            'counter_code' => $code,
            'counter_name' => "Counter {$code}",
            'status' => Counter::STATUS_ACTIVE,
        ]);
    }

    /** @param array<string,bool> $config */
    private function schedule(Store $store, string $code, array $config): MasterLookup
    {
        return MasterLookup::create([
            'store_id' => $store->id,
            'type' => 'drug_schedule',
            'code' => $code,
            'name' => "Schedule {$code}",
            'config' => $config,
            'is_active' => true,
        ]);
    }

    private function product(Store $store, string $name, string $barcode, ?int $scheduleId): Product
    {
        return Product::create([
            'store_id' => $store->id,
            'name' => $name,
            'barcode' => $barcode,
            'hsn_sac_code' => '3004',
            'current_stock' => 40,
            'mrp' => 200.00,
            'sel_rate' => 100.00,
            'ptr' => 100.00,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'drug_schedule_id' => $scheduleId,
            'schedule_code' => $scheduleId === null ? null : MasterLookup::find($scheduleId)->code,
            'is_active' => true,
        ]);
    }

    private function batch(Product $product, string $batchNo): ProductBatch
    {
        return ProductBatch::create([
            'store_id' => $product->store_id,
            'product_id' => $product->id,
            'batch_no' => $batchNo,
            'expiry_date' => '2028-12-31',
            'stock_qty' => 40,
            'mrp' => 200.00,
            'selling_rate' => 100.00,
        ]);
    }

    /**
     * A bill through the till's own door, so the register reads what a real
     * save wrote — including the pharmacist the gate stamped on it.
     *
     * @param  array<int,array<string,mixed>>  $lines
     * @param  array<string,mixed>  $overrides
     */
    private function sell(array $lines, array $overrides = []): Invoice
    {
        $externalId = 'ext_rg_' . uniqid();

        $saved = $this->withHeader('X-Store-Id', $this->pharmacy->id)->postJson('/api/invoices', array_merge([
            'counter_code' => 'C01',
            'store_id' => $this->pharmacy->id,
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'invoice_date' => '2026-11-10',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
            'items' => $lines,
        ], $overrides))->assertStatus(201);

        return Invoice::findOrFail($saved->json('invoice.id'));
    }

    /** @param array<string,mixed> $overrides */
    private function line(Product $product, ProductBatch $batch, array $overrides = []): array
    {
        return array_merge([
            'product_id' => $product->id,
            'product_name' => $product->name,
            'batch_id' => $batch->id,
            'batch_no' => $batch->batch_no,
            'qty' => 1,
            'unit_price' => 100.00,
            'gst_percent' => 0.00,
        ], $overrides);
    }

    /**
     * A bill written before the gate existed — or filed from a till that never
     * asked. No pharmacist is named anywhere on it.
     *
     * @param array<int,array<string,mixed>> $lines
     * @param array<string,mixed> $overrides
     */
    private function legacyBill(array $lines, array $overrides = []): Invoice
    {
        $data = array_merge([
            'store_id' => $this->pharmacy->id,
            'counter_id' => $this->c01->id,
            'counter_code' => 'C01',
            'module_key' => 'invoice',
            'invoice_number' => 'LEG-' . uniqid(),
            'invoice_date' => '2026-11-10',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'status' => 'completed',
        ], $overrides);

        $invoice = Invoice::create($data);

        foreach ($lines as $line) {
            $product = Product::find($line['product_id']);
            $net = round(((float) $line['qty'] * (float) $line['unit_price']), 2);

            InvoiceItem::create([
                'invoice_id' => $invoice->id,
                'product_id' => $line['product_id'],
                'product_name' => $product?->name ?? 'Unknown item',
                'batch_no' => $line['batch_no'],
                'qty' => $line['qty'],
                'unit_price' => $line['unit_price'],
                'taxable_amount' => $net,
                'gst_percent' => 0.00,
                'cgst_amount' => 0.00,
                'sgst_amount' => 0.00,
                'igst_amount' => 0.00,
                'cess_amount' => 0.00,
                'tax_amount' => 0.00,
                'total_amount' => $net,
            ]);
        }

        $invoice->update(['grand_total' => $invoice->items->sum('total_amount')]);

        return $invoice->fresh(['items']);
    }

    /** @return array<string,mixed> */
    private function register(?Store $store = null, string $scope = '', string $window = '2026-11-01&end_date=2026-11-30'): array
    {
        $headers = $scope === 'all'
            ? ['X-Store-Scope' => 'all']
            : ['X-Store-Id' => (string) ($store ?? $this->pharmacy)->id];

        return (array) $this->actingAs($this->owner, 'sanctum')
            ->withHeaders($headers)
            ->getJson("/api/admin/reports/pharmacy?start_date={$window}")
            ->assertOk()
            ->json();
    }

    /** @return array<string,mixed> */
    private function book(array $json, string $productName): array
    {
        $rows = (array) $json['restricted_drug_register']['rows'];

        foreach ($rows as $row) {
            if (($row['product_name'] ?? null) === $productName) {
                return $row;
            }
        }

        $this->fail("no register entry for {$productName} in " . json_encode(array_column($rows, 'product_name')));
    }

    // --- the book itself --------------------------------------------------

    public function test_the_register_holds_the_restricted_lines_and_nothing_else(): void
    {
        $this->sell([
            $this->line($this->alprazolam, $this->alpBatch),
            $this->line($this->paracetamol, $this->paraBatch),
        ]);

        $rows = (array) $this->register()['restricted_drug_register']['rows'];

        $this->assertCount(1, $rows, 'a non-restricted schedule joined the H1 book');
        $this->assertSame('QA Alprazolam 0.25 Strip', $rows[0]['product_name']);
        $this->assertSame('BCH-ALP', $rows[0]['batch_no']);
        $this->assertSame('H1', $rows[0]['schedule_code']);
    }

    public function test_an_entry_names_the_bill_and_the_pharmacist_who_confirmed_it(): void
    {
        $invoice = $this->sell([$this->line($this->alprazolam, $this->alpBatch, ['qty' => 3])]);

        $entry = $this->book($this->register(), 'QA Alprazolam 0.25 Strip');

        $this->assertSame($invoice->invoice_number, $entry['invoice_number']);
        $this->assertSame('2026-11-10', substr((string) $entry['invoice_date'], 0, 10));
        $this->assertSame('C01', $entry['counter_code']);
        $this->assertSame(3.0, (float) $entry['qty']);
        $this->assertSame(300.00, (float) $entry['total_amount']);
        $this->assertFalse((bool) $entry['is_return']);

        $this->assertSame($this->firoza->id, (int) $entry['pharmacist_id']);
        $this->assertSame('Dr. Firoza Ali', $entry['pharmacist_name']);
        $this->assertSame('KPK-2019-45512', $entry['pharmacist_reg_no']);
        $this->assertNotNull($entry['pharmacist_confirmed_at']);
    }

    /**
     * PHR-007: the entry an owner needs most is the one nobody signed. A line
     * sold without a confirmation stays in the book and reads as unconfirmed.
     */
    public function test_a_restricted_line_with_no_pharmacist_reads_as_unconfirmed(): void
    {
        $this->sell([$this->line($this->alprazolam, $this->alpBatch)]);
        $this->legacyBill([
            ['product_id' => $this->diazepam->id, 'batch_no' => 'BCH-DIA', 'qty' => 2, 'unit_price' => 50.00],
        ]);

        $json = $this->register();
        $entry = $this->book($json, 'Diazepam 5mg');

        $this->assertNull($entry['pharmacist_name']);
        $this->assertNull($entry['pharmacist_confirmed_at']);
        $this->assertSame(1, (int) $json['restricted_drug_register']['totals']['unconfirmed']);
        $this->assertSame(2, (int) $json['restricted_drug_register']['totals']['lines']);
    }

    /** A cancelled bill is not a sale and does not reach a statutory book. */
    public function test_a_cancelled_bill_leaves_the_register(): void
    {
        $this->sell([$this->line($this->alprazolam, $this->alpBatch)]);
        $this->legacyBill(
            [['product_id' => $this->diazepam->id, 'batch_no' => 'BCH-DIA', 'qty' => 1, 'unit_price' => 50.00]],
            ['status' => 'cancelled']
        );

        $rows = (array) $this->register()['restricted_drug_register']['rows'];

        $this->assertSame(['QA Alprazolam 0.25 Strip'], array_column($rows, 'product_name'));
    }

    /** A return is the reverse entry in the same book, and it counts against it. */
    public function test_a_return_of_a_restricted_pack_is_entry_and_subtracts(): void
    {
        $sale = $this->sell([$this->line($this->alprazolam, $this->alpBatch, ['qty' => 2])]);

        // The pack comes back over the same registration that let it out.
        $this->withHeader('X-Store-Id', $this->pharmacy->id)->postJson('/api/returns/sales', [
            'original_invoice_id' => $sale->id,
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
            'items' => [$this->line($this->alprazolam, $this->alpBatch)],
        ])->assertStatus(201);

        $json = $this->register(null, '', '2020-01-01&end_date=2030-12-31');
        $rows = (array) $json['restricted_drug_register']['rows'];

        $this->assertCount(2, $rows);
        $this->assertTrue((bool) $rows[1]['is_return'], 'the book is read in the order the entries happened');
        $this->assertSame(-1.0, (float) $rows[1]['qty']);
        $this->assertSame('Dr. Firoza Ali', $rows[1]['pharmacist_name']);

        $totals = (array) $json['restricted_drug_register']['totals'];
        $this->assertSame(2, (int) $totals['lines']);
        $this->assertSame(1.0, (float) $totals['quantity']);
        $this->assertSame(100.00, (float) $totals['value']);
        $this->assertSame(0, (int) $totals['unconfirmed']);
    }

    /** The window is read inclusive of both its days. */
    public function test_the_window_is_inclusive_at_both_edges(): void
    {
        $this->legacyBill(
            [['product_id' => $this->alprazolam->id, 'batch_no' => 'BCH-ALP', 'qty' => 1, 'unit_price' => 100.00]],
            ['invoice_date' => '2026-11-01']
        );
        $this->legacyBill(
            [['product_id' => $this->diazepam->id, 'batch_no' => 'BCH-DIA', 'qty' => 1, 'unit_price' => 100.00]],
            ['invoice_date' => '2026-11-30']
        );
        $this->legacyBill(
            [['product_id' => $this->diazepam->id, 'batch_no' => 'BCH-DIA', 'qty' => 1, 'unit_price' => 100.00]],
            ['invoice_date' => '2026-12-01']
        );

        $rows = (array) $this->register()['restricted_drug_register']['rows'];

        $this->assertCount(2, $rows);
    }

    /**
     * PHR-001: a schedule is per store, so a second pharmacy's H1 list is its
     * own. One store's restricted pack is another's ordinary shelf line.
     */
    public function test_another_pharmacies_restricted_lines_do_not_join_the_book(): void
    {
        $other = Store::create([
            'name' => 'Second Chemist',
            'code' => 'SCC',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);
        $otherCounter = $this->counter($other, 'C09');
        $h1Other = $this->schedule($other, 'H1', ['restricted' => true, 'prescription_required' => true]);
        $theirProduct = $this->product($other, 'Their Diazepam', 'REG-OTH', $h1Other->id);

        $this->legacyBill([
            ['product_id' => $this->diazepam->id, 'batch_no' => 'BCH-DIA', 'qty' => 1, 'unit_price' => 100.00],
        ]);
        // The same product row billed by the other store: it is not on *their*
        // restricted list, and it is not in this store's book either.
        $this->legacyBill(
            [['product_id' => $this->diazepam->id, 'batch_no' => 'BCH-DIA', 'qty' => 1, 'unit_price' => 100.00]],
            ['store_id' => $other->id, 'counter_id' => $otherCounter->id, 'counter_code' => 'C09']
        );
        $this->legacyBill(
            [['product_id' => $theirProduct->id, 'batch_no' => 'BCH-OTH', 'qty' => 1, 'unit_price' => 100.00]],
            ['store_id' => $other->id, 'counter_id' => $otherCounter->id, 'counter_code' => 'C09']
        );

        $rows = (array) $this->register($this->pharmacy)['restricted_drug_register']['rows'];

        $this->assertSame(['Diazepam 5mg'], array_column($rows, 'product_name'));

        // All-stores scope reads every pharmacy's book, each under its store.
        $global = (array) $this->register(null, 'all')['restricted_drug_register']['rows'];
        $labels = array_map(fn (array $row): string => ($row['store_name'] ?? '') . '/' . $row['product_name'], $global);

        $this->assertContains('Second Chemist/Their Diazepam', $labels);
        $this->assertContains('LamStone Medicos/Diazepam 5mg', $labels);
        $this->assertCount(2, $global);
    }

    /** PHR-011: a store that sells no medicines has no drug book and no words. */
    public function test_a_grocery_shows_no_restricted_lines_and_no_pharmacist_surface(): void
    {
        $this->legacyBill(
            [['product_id' => $this->rice->id, 'batch_no' => 'BCH-RICE', 'qty' => 1, 'unit_price' => 100.00]],
            ['store_id' => $this->grocery->id, 'counter_id' => $this->c05->id, 'counter_code' => 'C05']
        );

        $json = $this->register($this->grocery);
        $book = (array) $json['restricted_drug_register']['rows'];

        $this->assertSame([], $book);
        $this->assertStringNotContainsString('pharmacist', strtolower(json_encode($json['restricted_drug_register']) ?: ''));
    }

    /** The old placeholder read a doctor's name; the book reads the schedule. */
    public function test_a_bill_with_a_doctor_named_is_not_an_entry_by_itself(): void
    {
        $this->legacyBill(
            [['product_id' => $this->paracetamol->id, 'batch_no' => 'BCH-PAR', 'qty' => 1, 'unit_price' => 100.00]],
            ['doctor_name' => 'Dr. Moothedka', 'doctor_reg_no' => 'KDM-771']
        );

        $this->assertSame([], (array) $this->register()['restricted_drug_register']['rows']);
    }
}
