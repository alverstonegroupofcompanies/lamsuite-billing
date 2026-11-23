<?php

namespace Tests\Unit;

use App\Models\InvoiceItem;
use App\Services\Sales\SalesReturnPricingService;
use PHPUnit\Framework\TestCase;

class SalesReturnPricingServiceTest extends TestCase
{
    private function item(array $overrides = []): InvoiceItem
    {
        return new InvoiceItem(array_merge([
            'qty' => 1,
            'loose_qty' => 0,
            'units_per_pack' => 15,
            'unit_price' => 90,
            'gst_percent' => 12,
            'discount_percent' => 0,
            'discount_amount' => 0,
            'taxable_amount' => 80.36,
            'cgst_amount' => 4.82,
            'sgst_amount' => 4.82,
            'igst_amount' => 0,
            'cess_amount' => 0,
            'tax_amount' => 9.64,
            'total_amount' => 90,
        ], $overrides));
    }

    public function test_part_of_an_inclusive_line_credits_its_share_without_adding_tax(): void
    {
        $line = (new SalesReturnPricingService())->reverseLine($this->item(), 15, 0, 5);

        $this->assertSame(30.0, $line['total_amount']);
        $this->assertSame(26.79, $line['taxable_amount']);
        $this->assertSame(3.21, $line['tax_amount']);
        $this->assertSame(1.61, $line['cgst_amount']);
        $this->assertSame(1.60, $line['sgst_amount']);
        $this->assertSame(0.0, $line['igst_amount']);
        $this->assertSame(0.0, $line['discount_amount']);
    }

    public function test_a_full_return_reverses_the_line_exactly(): void
    {
        $line = (new SalesReturnPricingService())->reverseLine($this->item(), 15, 0, 15);

        $this->assertSame(90.0, $line['total_amount']);
        $this->assertSame(80.36, $line['taxable_amount']);
        $this->assertSame(9.64, $line['tax_amount']);
        $this->assertSame(4.82, $line['cgst_amount']);
        $this->assertSame(4.82, $line['sgst_amount']);
    }

    public function test_the_closing_return_carries_the_remainder_so_the_line_sums_exactly(): void
    {
        $service = new SalesReturnPricingService();

        $first = $service->reverseLine($this->item(), 15, 0, 5);
        $second = $service->reverseLine($this->item(), 15, 5, 10);

        $this->assertSame(60.0, $second['total_amount']);
        $this->assertSame(53.57, $second['taxable_amount']);
        $this->assertSame(6.43, $second['tax_amount']);
        $this->assertSame(3.21, $second['cgst_amount']);
        $this->assertSame(3.22, $second['sgst_amount']);

        $this->assertSame(90.0, round($first['total_amount'] + $second['total_amount'], 2));
        $this->assertSame(80.36, round($first['taxable_amount'] + $second['taxable_amount'], 2));
        $this->assertSame(4.82, round($first['cgst_amount'] + $second['cgst_amount'], 2));
        $this->assertSame(4.82, round($first['sgst_amount'] + $second['sgst_amount'], 2));
    }

    public function test_an_old_line_without_component_columns_splits_tax_by_state(): void
    {
        $line = (new SalesReturnPricingService())->reverseLine($this->item([
            'taxable_amount' => 300,
            'cgst_amount' => null,
            'sgst_amount' => null,
            'total_amount' => 336,
        ]), 30, 0, 30);

        $this->assertSame(336.0, $line['total_amount']);
        $this->assertSame(300.0, $line['taxable_amount']);
        $this->assertSame(36.0, $line['tax_amount']);
        $this->assertSame(18.0, $line['cgst_amount']);
        $this->assertSame(18.0, $line['sgst_amount']);
        $this->assertSame(0.0, $line['igst_amount']);
    }

    public function test_an_old_inter_state_line_puts_the_tax_in_igst(): void
    {
        $line = (new SalesReturnPricingService())->reverseLine($this->item([
            'taxable_amount' => 300,
            'cgst_amount' => null,
            'sgst_amount' => null,
            'total_amount' => 336,
        ]), 30, 0, 30, true);

        $this->assertSame(0.0, $line['cgst_amount']);
        $this->assertSame(0.0, $line['sgst_amount']);
        $this->assertSame(36.0, $line['igst_amount']);
    }

    public function test_a_discounted_line_credits_the_discounted_value(): void
    {
        $line = (new SalesReturnPricingService())->reverseLine($this->item([
            'discount_amount' => 9,
            'taxable_amount' => 72.32,
            'cgst_amount' => 4.34,
            'sgst_amount' => 4.34,
            'total_amount' => 81,
        ]), 15, 0, 15);

        $this->assertSame(81.0, $line['total_amount']);
        $this->assertSame(72.32, $line['taxable_amount']);
        $this->assertSame(8.68, $line['tax_amount']);
        $this->assertSame(9.0, $line['discount_amount']);
    }
}
