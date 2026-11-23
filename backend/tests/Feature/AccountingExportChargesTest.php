<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\PurchaseCharge;
use App\Models\PurchaseItem;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CR-C Task 4.13 / REP-009 — what a charged bill looks like once it leaves the app.
 *
 * An accountant never sees the tax engine; they see a Tally voucher, a Busy file, a CSV and an
 * export of the raw document. Those have to add up the same way the bill did: the goods and the
 * charges apart, the charge GST inside the header tax it was posted under, money that left
 * through its own till as its own voucher, and a pre-CR-C freight scalar as the one Freight head
 * the normaliser already shows everywhere else (PUR-017). Every voucher asserted here is
 * balanced to the paisa, because an unbalanced export is a bookkeeping error the store inherits.
 */
class AccountingExportChargesTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;

    /** The ₹11,554 worked example: goods 10,000@12 + freight 200@18 + packing 100@18. */
    private Purchase $charged;

    /** Same goods, but the head was already paid to a courier outside the bill. */
    private Purchase $separate;

    /** A bill posted before CR-C: one `freight_charges` scalar, no charge rows. */
    private Purchase $legacy;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Export Charges Store',
            'code' => 'EXPC01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Export Charges Admin',
            'email' => 'admin@export-charges.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500mg',
            'hsn_sac_code' => '30041090',
            'mrp' => 40,
            'sel_rate' => 30,
            'gst_percent' => 12,
        ]);

        ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $product->id,
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 0,
            'mrp' => 40,
            'purchase_rate' => 100,
            'selling_rate' => 30,
        ]);

        $this->charged = $this->postBill([
            $this->charge('FREIGHT', 200),
            $this->charge('PACKING', 100, ['treatment' => 'expense']),
        ]);

        $this->separate = $this->postBill([
            $this->charge('OTHER', 500, [
                'treatment' => 'expense',
                'paid_separately' => true,
                'paid_to_label' => 'Ganga Courier',
            ]),
        ]);

        $this->legacy = $this->makeLegacyBill();

        Expense::create([
            'store_id' => $this->store->id,
            'expense_number' => 'EXP-MANUAL-1',
            'expense_head' => 'Electricity',
            'amount' => 350,
            'payment_mode' => 'Cash',
            'expense_date' => '2026-11-10',
        ]);
    }

    private function line(array $overrides = []): array
    {
        return array_merge([
            'product_name' => 'Amoxicillin 500mg',
            'batch_no' => 'B-1',
            'expiry_date' => '2027-12-31',
            'pack_qty' => 100,
            'loose_qty' => 0,
            'free_qty' => 0,
            'units_per_pack' => 1,
            'purchase_rate' => 100,
            'gst_percent' => 12,
            'hsn_code' => '30041090',
        ], $overrides);
    }

    private function charge(string $headCode, float $amount, array $overrides = []): array
    {
        return array_merge([
            'head_code' => $headCode,
            'amount' => $amount,
            'gst_percent' => 18,
            'treatment' => 'add_to_cost',
            'spread_method' => 'value',
            'itc_eligibility' => 'eligible',
        ], $overrides);
    }

    private function postBill(array $charges): Purchase
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/purchases', [
                'store_id' => $this->store->id,
                'supplier_name' => 'Export Charge Distributors',
                'supplier_gstin' => '32EEEEE0000A1Z5',
                'invoice_number' => 'EXP-' . substr(md5(uniqid('', true)), 0, 8),
                'invoice_date' => '2026-11-15',
                'lines' => [$this->line()],
                'charges' => $charges,
            ]);

        $response->assertCreated();

        return Purchase::with(['items', 'charges'])
            ->findOrFail($response->json('purchase.id'));
    }

    /**
     * A pre-CR-C receipt: the freight lived in one scalar and nothing else remembered it.
     */
    private function makeLegacyBill(): Purchase
    {
        $purchase = Purchase::create([
            'store_id' => $this->store->id,
            'supplier_name' => 'Legacy Distributors',
            'supplier_gstin' => '32LLLLL0000A1Z5',
            'invoice_number' => 'LEG-1',
            'invoice_date' => '2026-11-15',
            'module_key' => 'purchase',
            'subtotal' => 1000,
            'tax_total' => 120,
            'cgst_total' => 60,
            'sgst_total' => 60,
            'igst_total' => 0,
            'cess_total' => 0,
            'freight_charges' => 500,
            'round_off' => 0,
            'grand_total' => 1620,
            'paid_amount' => 0,
            'status' => 'received',
        ]);

        PurchaseItem::create([
            'purchase_id' => $purchase->id,
            'product_name' => 'Amoxicillin 500mg',
            'hsn_code' => '30041090',
            'batch_no' => 'B-1',
            'qty' => 100,
            'purchase_rate' => 10,
            'gst_percent' => 12,
            'taxable_amount' => 1000,
            'cgst_amount' => 60,
            'sgst_amount' => 60,
            'tax_amount' => 120,
            'total_amount' => 1120,
        ]);

        return $purchase->load(['items', 'charges']);
    }

    private function auth()
    {
        return $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function url(string $type, string $format, string $extra = ''): string
    {
        return "/api/admin/accounting/exports/{$type}/{$format}?from=2026-11-01&to=2026-11-30{$extra}";
    }

    /**
     * @return array<int, array<string, string|null>>
     */
    private function csvRows(string $content): array
    {
        $handle = fopen('php://temp', 'r+');
        // The exports open with a UTF-8 BOM for Excel; it would otherwise stick to the first header.
        fwrite($handle, preg_replace('/^\xEF\xBB\xBF/', '', $content));
        rewind($handle);

        $headers = fgetcsv($handle);
        $rows = [];
        while (($row = fgetcsv($handle)) !== false) {
            if ($row === [null] || $row === [false]) {
                continue;
            }
            $rows[] = array_combine($headers, array_pad($row, count($headers), null));
        }
        fclose($handle);

        return $rows;
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     */
    private function rowBy(array $rows, string $column, string $value): array
    {
        foreach ($rows as $row) {
            if ((string) $row[$column] === $value) {
                return $row;
            }
        }

        $this->fail("No export row with {$column} = {$value}");
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, array<string, mixed>>
     */
    private function where(array $rows, string $column, string $value): array
    {
        return array_values(array_filter($rows, fn (array $row) => (string) $row[$column] === $value));
    }

    /* ------------------------------------------------------------------ purchases CSV */

    public function test_purchases_csv_keeps_the_goods_and_the_charges_apart(): void
    {
        $res = $this->auth()->get($this->url('purchases', 'csv'));
        $res->assertOk();

        $row = $this->rowBy($this->csvRows($res->getContent()), 'Supplier Bill No', $this->charged->invoice_number);

        $this->assertSame('10000.00', $row['Subtotal'], 'The header subtotal stays the goods alone (PUR-001)');
        $this->assertSame('1254.00', $row['Tax'], 'The header tax carries the charge GST');
        $this->assertSame('300.00', $row['Charge Taxable']);
        $this->assertSame('54.00', $row['Charge Tax']);
        $this->assertSame('354.00', $row['Charge Total']);
        $this->assertSame('236.00', $row['Add To Cost'], 'Freight 200 plus the GST that joins the cost');
        $this->assertSame('118.00', $row['Expensed']);
        $this->assertSame('0.00', $row['Paid Separately']);
        $this->assertSame('10200.00', $row['Landed Value'], 'PUR-011: the freight joined the cost, the packing did not');
        $this->assertSame('11554.00', $row['Payable']);
        $this->assertSame('11554.00', $row['Grand Total']);
        $this->assertSame('FREIGHT 200.00@18% in bill; PACKING 100.00@18% in bill', $row['Charge Heads']);
    }

    public function test_purchases_csv_places_money_paid_outside_the_bill_separately(): void
    {
        $res = $this->auth()->get($this->url('purchases', 'csv'));
        $res->assertOk();

        $row = $this->rowBy($this->csvRows($res->getContent()), 'Supplier Bill No', $this->separate->invoice_number);

        // PUR-013: never in the payable, so the in-bill charge columns stay at zero while the
        // separately-paid column carries the full 500 + 90 that left through its own till.
        $this->assertSame('10000.00', $row['Subtotal']);
        $this->assertSame('1200.00', $row['Tax']);
        $this->assertSame('11200.00', $row['Grand Total']);
        $this->assertSame('0.00', $row['Charge Taxable']);
        $this->assertSame('0.00', $row['Charge Total']);
        $this->assertSame('590.00', $row['Paid Separately']);
        $this->assertSame('OTHER 500.00@18% paid separately', $row['Charge Heads']);
    }

    public function test_purchases_csv_shows_a_pre_cr_c_bill_s_freight_as_one_head(): void
    {
        $res = $this->auth()->get($this->url('purchases', 'csv'));
        $res->assertOk();

        $row = $this->rowBy($this->csvRows($res->getContent()), 'Supplier Bill No', 'LEG-1');

        // PUR-017: the scalar is the same rupee seen the new way, so it appears once, as Freight.
        $this->assertSame('500.00', $row['Freight']);
        $this->assertSame('500.00', $row['Charge Taxable']);
        $this->assertSame('0.00', $row['Charge Tax']);
        $this->assertSame('500.00', $row['Add To Cost']);
        $this->assertSame('FREIGHT 500.00@0% in bill', $row['Charge Heads']);
        $this->assertSame('1000.00', $row['Landed Value'], 'Nothing was re-costed under the old path');
        $this->assertSame('1620.00', $row['Grand Total']);
    }

    /* ------------------------------------------------------------------ Tally */

    /**
     * @return array<int, array{number: string, type: string, sum: float, ledgers: array<string, float>}>
     */
    private function tallyVouchers(string $xml): array
    {
        $parsed = simplexml_load_string($xml);
        $this->assertNotFalse($parsed, 'Export must be well-formed XML');

        $out = [];
        foreach ($parsed->BODY->IMPORTDATA->REQUESTDATA->TALLYMESSAGE as $message) {
            $voucher = $message->VOUCHER;
            $ledgers = [];
            $sum = 0.0;
            foreach ($voucher->{'ALLLEDGERENTRIES.LIST'} as $entry) {
                $name = (string) $entry->LEDGERNAME;
                $amount = (float) $entry->AMOUNT;
                $ledgers[$name] = round(($ledgers[$name] ?? 0.0) + $amount, 2);
                $sum += $amount;
            }

            $out[] = [
                'number' => (string) $voucher->VOUCHERNUMBER,
                'type' => (string) $voucher->VOUCHERTYPENAME,
                'sum' => round($sum, 2),
                'ledgers' => $ledgers,
            ];
        }

        return $out;
    }

    public function test_tally_purchase_voucher_debits_each_charge_head(): void
    {
        $res = $this->auth()->get($this->url('purchases', 'tally'));
        $res->assertOk();

        $byNumber = collect($this->tallyVouchers($res->getContent()))->keyBy('number');
        $voucher = $byNumber[$this->charged->invoice_number];

        $this->assertSame('Purchase', $voucher['type']);
        // The header tax totals already hold the charge GST (PUR-001); only its taxable half
        // was missing, and without that half the voucher cannot balance.
        $this->assertSame(-10000.0, $voucher['ledgers']['Purchase']);
        $this->assertSame(-627.0, $voucher['ledgers']['CGST (Input)']);
        $this->assertSame(-627.0, $voucher['ledgers']['SGST (Input)']);
        $this->assertSame(-200.0, $voucher['ledgers']['Freight']);
        $this->assertSame(-100.0, $voucher['ledgers']['Packing']);
        $this->assertSame(11554.0, $voucher['ledgers']['Export Charge Distributors']);
        $this->assertEqualsWithDelta(0.0, $voucher['sum'], 0.005, 'A charged bill must still balance in Tally');
    }

    public function test_a_separately_paid_charge_leaves_tally_as_its_own_payment_voucher(): void
    {
        $res = $this->auth()->get($this->url('purchases', 'tally'));
        $res->assertOk();

        $vouchers = collect($this->tallyVouchers($res->getContent()))->keyBy('number');

        $this->assertSame('Purchase', $vouchers[$this->separate->invoice_number]['type']);
        $this->assertArrayNotHasKey('Other', $vouchers[$this->separate->invoice_number]['ledgers'],
            'A charge outside the payable is not a line of the bill voucher');

        $payment = $vouchers[$this->separate->invoice_number . '-C1'];
        $this->assertSame('Payment', $payment['type']);
        // Dr the head and its input tax, Cr the courier it was paid to.
        $this->assertSame(-500.0, $payment['ledgers']['Other']);
        $this->assertSame(-45.0, $payment['ledgers']['CGST (Input)']);
        $this->assertSame(-45.0, $payment['ledgers']['SGST (Input)']);
        $this->assertSame(590.0, $payment['ledgers']['Ganga Courier']);
        $this->assertEqualsWithDelta(0.0, $payment['sum'], 0.005);
    }

    public function test_tally_balances_every_purchase_voucher_it_emits(): void
    {
        $res = $this->auth()->get($this->url('purchases', 'tally'));
        $res->assertOk();

        $vouchers = $this->tallyVouchers($res->getContent());
        $this->assertNotEmpty($vouchers);

        foreach ($vouchers as $voucher) {
            $this->assertEqualsWithDelta(
                0.0,
                $voucher['sum'],
                0.005,
                "Tally voucher {$voucher['number']} ({$voucher['type']}) does not balance"
            );
        }

        // PUR-017: a legacy bill's freight arrives as a Freight ledger, the old scalar line gone.
        $legacy = collect($vouchers)->firstWhere('number', 'LEG-1');
        $this->assertNotNull($legacy);
        $this->assertSame(-500.0, $legacy['ledgers']['Freight']);
        $this->assertArrayNotHasKey('Freight Charges', $legacy['ledgers']);
    }

    /* ------------------------------------------------------------------ Busy */

    public function test_busy_purchase_voucher_splits_charge_value_from_the_goods(): void
    {
        $res = $this->auth()->get($this->url('purchases', 'busy'));
        $res->assertOk();

        $xml = simplexml_load_string($res->getContent());
        $this->assertNotFalse($xml);

        $byNumber = [];
        foreach ($xml->Vouchers->Voucher as $voucher) {
            $byNumber[(string) $voucher->VchNo] = $voucher;
        }

        $voucher = $byNumber[$this->charged->invoice_number];
        $totals = $voucher->Totals;
        $this->assertSame('10300.00', (string) $totals['Taxable'], 'Goods 10,000 + the 300 the charges cost');
        $this->assertSame('1254.00', (string) $totals['Tax']);
        $this->assertSame('354.00', (string) $totals['Charges']);
        $this->assertSame('11554.00', (string) $totals['GrandTotal']);

        $ledgers = [];
        foreach ($voucher->LedgerEntries->Ledger as $ledger) {
            $ledgers[(string) $ledger['Name']] = [(string) $ledger['Amount'], (string) $ledger['DrCr']];
        }
        $this->assertSame(['200.00', 'Dr'], $ledgers['Freight']);
        $this->assertSame(['100.00', 'Dr'], $ledgers['Packing']);

        // PUR-013: the courier payment is its own voucher, outside the bill.
        $payment = $byNumber[$this->separate->invoice_number . '-C1'];
        $this->assertSame('Payment', (string) $payment->attributes()['VchType']);
        $this->assertSame('Ganga Courier', (string) $payment->PartyName);
        $this->assertSame('590.00', (string) $payment->Totals['GrandTotal']);
        $this->assertSame('Other paid separately on bill ' . $this->separate->invoice_number,
            (string) $payment->Narration);
    }

    /* ------------------------------------------------------------------ GST summary + day book */

    public function test_gst_summary_buckets_input_tax_by_charge_head(): void
    {
        $this->assertSame(
            '996731',
            (string) PurchaseCharge::where('purchase_id', $this->charged->id)
                ->where('head_code', 'FREIGHT')->value('sac_code'),
            'The seeded Freight head carries its SAC, so the bucket has one'
        );

        $res = $this->auth()->get($this->url('gst-summary', 'csv'));
        $res->assertOk();

        $chargeRows = $this->where($this->csvRows($res->getContent()), 'Source', 'purchase-charge');
        $this->assertNotEmpty($chargeRows, 'A bill charge is input tax the item rows never saw');

        $freight = $this->rowBy($chargeRows, 'HSN/SAC', '996731');
        $this->assertSame('18.00', $freight['GST %']);
        $this->assertSame('200.00', $freight['Taxable']);
        $this->assertSame('18.00', $freight['CGST']);
        $this->assertSame('18.00', $freight['SGST']);
        $this->assertSame('36.00', $freight['Tax Total']);
        $this->assertSame('236.00', $freight['Invoice Total']);

        // Heads with no SAC of their own bucket together the way an HSN-less item line does, so
        // the whole 1,300 of charge value has to still be somewhere.
        $this->assertSame('1300.00', number_format(array_sum(array_map(
            fn (array $row) => (float) $row['Taxable'],
            $chargeRows
        )), 2, '.', ''));
    }

    public function test_day_book_counts_a_supplier_borne_charge_once(): void
    {
        $res = $this->auth()->get($this->url('daybook', 'csv'));
        $res->assertOk();

        $rows = $this->csvRows($res->getContent());
        $numbers = array_column($rows, 'Voucher No');

        // REP-008: the packing twin is already inside the purchase row of the same day book; only
        // money that left through its own till may appear beside the bill, because it is that money.
        $this->assertNotContains('EXP-PC-' . $this->charged->id . '-2', $numbers,
            'An in-bill charge must not add an expense row beside its bill');
        $this->assertContains('EXP-PC-' . $this->separate->id . '-1', $numbers);

        $courier = $this->rowBy($rows, 'Voucher No', 'EXP-PC-' . $this->separate->id . '-1');
        $this->assertSame('Expense (bill charge)', $courier['Voucher Type']);
        $this->assertSame('500.00', $courier['Taxable'], 'PUR-012 put the claimable GST outside the amount');
        $this->assertSame('90.00', $courier['Tax']);
        $this->assertSame('590.00', $courier['Total']);
        $this->assertSame('Paid Separately', $courier['Payment Mode']);

        $this->assertSame('Expense', $this->rowBy($rows, 'Voucher No', 'EXP-MANUAL-1')['Voucher Type']);
    }

    /* ------------------------------------------------------------------ expense register CSV */

    public function test_expense_register_csv_lists_manual_and_charge_rows_with_a_footing(): void
    {
        $res = $this->auth()->get($this->url('expenses', 'csv'));
        $res->assertOk();
        $this->assertStringContainsString(
            'attachment; filename="expense-register-2026-11-01_to_2026-11-30.csv"',
            (string) $res->headers->get('content-disposition')
        );

        $rows = $this->csvRows($res->getContent());
        $footing = array_pop($rows);
        $this->assertSame('TOTAL', $footing['Source']);

        $packing = $this->rowBy($this->where($rows, 'Head Code', 'PACKING'), 'Head Code', 'PACKING');
        $this->assertSame('purchase_charge', $packing['Source']);
        $this->assertSame('2026-11-15', $packing['Date'], 'The posting follows its bill, not the day it imported');
        $this->assertSame('100.00', $packing['Taxable']);
        $this->assertSame('18.00', $packing['GST %']);
        $this->assertSame('18.00', $packing['Tax Total']);
        $this->assertSame('100.00', $packing['Posted Amount'], 'PUR-012: an eligible head posts ex-GST');
        $this->assertSame('18.00', $packing['Creditable Tax']);
        $this->assertSame('0.00', $packing['Non-Creditable Tax']);
        $this->assertSame('Yes', $packing['In Payable']);
        $this->assertSame('No', $packing['Paid Separately']);
        $this->assertSame($this->charged->invoice_number, $packing['Bill No']);

        $courier = $this->rowBy($this->where($rows, 'Head Code', 'OTHER'), 'Head Code', 'OTHER');
        $this->assertSame('Ganga Courier', $courier['Paid To']);
        $this->assertSame('Paid Separately', $courier['Payment Mode']);
        $this->assertSame('No', $courier['In Payable']);
        $this->assertSame('500.00', $courier['Posted Amount']);

        $manual = $this->rowBy($rows, 'Source', 'manual');
        $this->assertSame('Electricity', $manual['Head']);
        $this->assertSame('350.00', $manual['Posted Amount']);
        $this->assertSame('', $manual['Bill No']);

        // 100 + 500 + 350 posted, 18 + 90 of tax, all of it creditable.
        $this->assertSame('950.00', $footing['Taxable']);
        $this->assertSame('108.00', $footing['Tax Total']);
        $this->assertSame('950.00', $footing['Posted Amount']);
        $this->assertSame('108.00', $footing['Creditable Tax']);
        $this->assertSame('0.00', $footing['Non-Creditable Tax']);
    }

    /* ------------------------------------------------------------------ data exchange */

    public function test_data_exchange_export_carries_the_charges_and_both_costs(): void
    {
        $res = $this->auth()->getJson('/api/admin/data-exchange/export/purchases');
        $res->assertOk();

        $bills = collect($res->json('data'))->keyBy('invoice_number');
        $charged = $bills[$this->charged->invoice_number];

        $this->assertCount(2, $charged['charges']);
        $this->assertSame(['FREIGHT', 'PACKING'], array_column($charged['charges'], 'head_code'));
        $this->assertSame('236.00', number_format((float) $charged['charges'][0]['total'], 2));
        $this->assertTrue($charged['charges'][0]['in_payable']);

        $item = $charged['items'][0];
        $this->assertSame('100.00', number_format((float) $item['billed_cost'], 2), 'PUR-011: the supplier rate survives');
        $this->assertSame('102.00', number_format((float) $item['landed_cost'], 2));

        // PUR-017: a bill that only owns the scalar still exports one explainable Freight head.
        $this->assertSame('FREIGHT', $bills['LEG-1']['charges'][0]['head_code']);
        $this->assertSame('legacy_freight', $bills['LEG-1']['charges'][0]['source']);

        $charges = $this->auth()->getJson('/api/admin/data-exchange/export/purchase_charges');
        $charges->assertOk();

        $rows = collect($charges->json('data'));
        $this->assertCount(3, $rows);
        $this->assertSame(
            $this->separate->invoice_number,
            $rows->firstWhere('head_code', 'OTHER')['purchase_reference']
        );
        $this->assertSame('236.00', number_format(
            (float) $rows->firstWhere('head_code', 'FREIGHT')['total_amount'],
            2
        ));
    }

    public function test_data_exchange_templates_document_the_charge_columns(): void
    {
        $purchases = $this->auth()->getJson('/api/admin/data-exchange/templates/purchases');
        $purchases->assertOk();

        foreach (['freight', 'charge_head', 'charge_amount', 'charge_treatment', 'charge_paid_separately'] as $field) {
            $this->assertContains($field, $purchases->json('template.fields'),
                "The purchase template must name the {$field} column");
        }
        $this->assertSame(11554, $purchases->json('template.sample.total_amount'));

        $standalone = $this->auth()->getJson('/api/admin/data-exchange/templates/purchase_charges');
        $standalone->assertOk();
        $this->assertContains('purchase_reference', $standalone->json('template.fields'));
    }
}
