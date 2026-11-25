<?php

namespace Tests\Unit;

use App\Services\Migration\LegacyRecordNormalizer;
use Tests\TestCase;

/**
 * MIG-03 — the shapes a legacy export arrives in, and what this schema must store.
 *
 * Every case here is a spelling that has been seen to cost a store its data: a line rate
 * under `tax_percent` that landed as 0, an on-hand quantity under `stock` that landed as 0,
 * a credit bill that had to become a row in the invoice table rather than a second table.
 */
class LegacyRecordNormalizerTest extends TestCase
{
    private LegacyRecordNormalizer $norm;

    protected function setUp(): void
    {
        parent::setUp();
        $this->norm = new LegacyRecordNormalizer();
    }

    public function test_a_line_rate_survives_whatever_the_export_calls_it(): void
    {
        foreach (['gst_percent', 'tax_percent', 'gst_rate', 'tax_rate', 'percentage'] as $key) {
            $line = $this->norm->invoiceItems([['product_name' => 'Dolo', $key => 12]])[0];
            $this->assertSame(12.0, $line['gst_percent'], "read 12% from {$key}");
        }
    }

    public function test_a_split_rate_is_read_as_one_percent(): void
    {
        $line = $this->norm->invoiceItems([
            ['product_name' => 'Dolo', 'cgst_percent' => 6, 'sgst_percent' => 6],
        ])[0];

        $this->assertSame(12.0, $line['gst_percent']);
    }

    public function test_a_rate_is_derived_from_the_taxable_value_beside_the_tax(): void
    {
        $line = $this->norm->invoiceItems([[
            'product_name' => 'Dolo',
            'taxable_amount' => 60.00,
            'tax_amount' => 7.20,
            'total_amount' => 67.20,
        ]])[0];

        $this->assertSame(12.0, $line['gst_percent']);
        $this->assertSame(60.0, $line['taxable_amount']);
    }

    public function test_a_zero_rated_line_is_zero_but_an_unmatchable_one_is_null(): void
    {
        $zero = $this->norm->invoiceItems([['product_name' => 'Salt', 'gst_percent' => 0, 'taxable_amount' => 20]])[0];
        $this->assertSame(0.0, $zero['gst_percent']);

        $unknown = $this->norm->invoiceItems([['product_name' => 'Dolo', 'unit_price' => 30, 'qty' => 2]])[0];
        $this->assertNull($unknown['gst_percent']);
    }

    public function test_an_ambiguous_bare_gst_key_is_refused_rather_than_guessed(): void
    {
        // Some exports put the tax *amount* in `gst`, others the *percent*. Reading either as
        // the other would silently move a migrated year between GST slabs, so the line comes
        // back unmatchable and pre-check blocks it instead of a run filing it under a guess.
        $line = $this->norm->invoiceItems([[
            'product_name' => 'Dolo', 'taxable_amount' => 60, 'gst' => 7.20,
        ]])[0];

        $this->assertNull($line['gst_percent']);

        $spelled = $this->norm->invoiceItems([[
            'product_name' => 'Dolo', 'taxable_amount' => 60, 'gst_amount' => 7.20,
        ]])[0];
        $this->assertSame(12.0, $spelled['gst_percent'], 'an unambiguous tax key does derive');
    }

    public function test_a_credit_bill_is_recognised_from_each_of_its_tells(): void
    {
        $this->assertSame('credit_note', $this->norm->documentKind(['module_key' => 'sales_return'], 'sale'));
        $this->assertSame('credit_note', $this->norm->documentKind(['type' => 'Credit_Note'], 'sale'));
        $this->assertSame('credit_note', $this->norm->documentKind(['return_number' => 'RET-9'], 'sale'));
        $this->assertSame('credit_note', $this->norm->documentKind(['original_invoice_number' => 'INV-1'], 'sale'));
        $this->assertSame('credit_note', $this->norm->documentKind(['grand_total' => -560.0], 'sale'));
        $this->assertSame('invoice', $this->norm->documentKind(['grand_total' => 560.0], 'sale'));

        $this->assertSame('debit_note', $this->norm->documentKind(['module_key' => 'purchase_return'], 'purchase'));
        $this->assertSame('purchase', $this->norm->documentKind(['invoice_number' => 'PB-1'], 'purchase'));
    }

    public function test_a_note_is_stored_positive_under_its_own_number_and_keeps_its_source(): void
    {
        $head = $this->norm->invoice([
            'return_number' => 'CN-2026-004',
            'invoice_number' => 'CN-2026-004',
            'original_invoice_number' => 'ADH-CN26-27-0040',
            'subtotal' => -50.00,
            'tax_total' => -6.00,
            'grand_total' => -56.00,
            'paid_amount' => -56.00,
            'items' => [['product_name' => 'Dolo', 'qty' => -2, 'tax_amount' => -6, 'total_amount' => -56]],
        ]);

        $this->assertSame('credit_note', $head['module_key']);
        $this->assertSame('CN-2026-004', $head['invoice_number']);
        $this->assertSame('ADH-CN26-27-0040', $head['original_invoice_number']);
        $this->assertSame(50.0, $head['subtotal']);
        $this->assertSame(56.0, $head['grand_total']);
        $this->assertSame(6.0, $head['tax_total']);
    }

    public function test_a_bracketed_ledger_amount_stays_a_reversal(): void
    {
        $this->assertSame(-1234.0, $this->norm->number(['total' => '(1,234.00)'], ['total']));
        $this->assertSame(1234.0, $this->norm->number(['total' => '₹1,234.00'], ['total']));
    }

    public function test_stock_figures_are_found_under_the_names_the_export_uses(): void
    {
        $batch = $this->norm->batch([
            'batch' => 'D-01', 'expiry' => '30/06/2028', 'stock' => '120', 'ptr' => '20.5', 'mrp' => '35',
        ]);

        $this->assertSame('D-01', $batch['batch_no']);
        $this->assertSame(120.0, $batch['stock_qty']);
        $this->assertSame(20.5, $batch['purchase_rate']);
        $this->assertSame('2028-06-30', $batch['expiry_date'], 'day-first dates are read day-first');

        $ambiguous = $this->norm->batch(['stock_qty' => 4, 'balance' => 9]);
        $this->assertSame(4.0, $ambiguous['stock_qty'], 'the explicit column wins over a generic one');
    }

    public function test_a_date_that_is_not_a_date_stays_absent_instead_of_becoming_1970(): void
    {
        $this->assertNull($this->norm->day(['invoice_date' => 'under review'], ['invoice_date']));
        $this->assertNull($this->norm->day(['invoice_date' => '99/99/2026'], ['invoice_date']));
        $this->assertSame('2026-10-10', $this->norm->day(['invoice_date' => '2026-10-10 14:03:00'], ['invoice_date']));
    }

    public function test_a_place_of_supply_is_only_kept_when_it_is_actually_a_state_code(): void
    {
        $this->assertSame('32', $this->norm->stateCode(['place_of_supply' => '32'], ['place_of_supply']));
        $this->assertNull($this->norm->stateCode(['place_of_supply' => 'Kerala'], ['place_of_supply']));
    }

    public function test_each_module_keeps_its_own_open_state_word(): void
    {
        $this->assertSame('issued', $this->norm->status(['status' => 'posted']));
        $this->assertSame('cancelled', $this->norm->status(['status' => 'CANCELED']));
        $this->assertSame('draft', $this->norm->status(['status' => 'held']));
        $this->assertSame('received', $this->norm->status(['status' => 'posted'], 'received'));
        $this->assertSame('received', $this->norm->status([], 'received'));
    }

    public function test_lines_are_found_wherever_the_document_put_them(): void
    {
        foreach (['items', 'invoice_items', 'lines'] as $key) {
            $rows = $this->norm->lineRows([$key => [['product_name' => 'Dolo']]]);
            $this->assertCount(1, $rows, "read lines from {$key}");
        }

        $this->assertSame([], $this->norm->lineRows(['items' => 'not a list']));
    }

    public function test_a_party_carried_as_an_object_does_not_stringify(): void
    {
        $head = $this->norm->invoice(['customer' => ['name' => 'Anjali N'], 'grand_total' => 10]);

        $this->assertSame('Anjali N', $head['customer_name']);
        $this->assertSame(10.0, $head['grand_total']);
    }

    public function test_an_invoice_header_reads_its_totals_under_each_spelling(): void
    {
        $head = $this->norm->invoice([
            'bill_no' => 'B-7',
            'bill_date' => '12/05/2026',
            'basic_amount' => 500.00,
            'gst_total' => 60.00,
            'bill_amount' => 560.00,
            'amount_paid' => 560.00,
            'tender_mode' => 'upi',
        ]);

        $this->assertSame('B-7', $head['invoice_number']);
        $this->assertSame('2026-05-12', $head['invoice_date']);
        $this->assertSame(500.0, $head['subtotal']);
        $this->assertSame(60.0, $head['tax_total']);
        $this->assertSame(560.0, $head['grand_total']);
        $this->assertSame(560.0, $head['paid_amount']);
        $this->assertSame('upi', $head['payment_mode']);
        $this->assertSame('invoice', $head['module_key']);
    }

    /**
     * Whether the shelf price already carried the GST is the one setting the whole tax year
     * depends on, and the legacy panel spelled its switch several ways — including a typo its
     * own settings row was saved under.
     */
    public function test_the_billing_mode_is_read_from_each_spelling_the_legacy_panel_used(): void
    {
        $this->assertSame('exclusive', $this->norm->taxMode(['price_incines_gst' => '0']));
        $this->assertSame('inclusive', $this->norm->taxMode(['price_incines_gst' => 1]));
        $this->assertSame('exclusive', $this->norm->taxMode(['tax_type' => 'exclusive']));
        $this->assertSame('inclusive', $this->norm->taxMode(['price_inclusive_of_tax' => true]));
        $this->assertNull($this->norm->taxMode(['tax_note' => 'as per rules']));
        // An empty switch states nothing, and must not overwrite the store's own mode with a guess.
        $this->assertNull($this->norm->taxMode(['tax_mode' => '']));
    }
}
