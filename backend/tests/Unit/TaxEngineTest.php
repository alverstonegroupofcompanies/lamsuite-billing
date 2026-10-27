<?php

namespace Tests\Unit;

use App\Services\Tax\TaxEngine;
use PHPUnit\Framework\TestCase;

class TaxEngineTest extends TestCase
{
    public function test_matches_statutory_gst_test_vectors(): void
    {
        $jsonPath = dirname(__DIR__, 2) . '/specs/gst_tax_test_vectors.json';
        if (!file_exists($jsonPath)) {
            $jsonPath = dirname(__DIR__, 3) . '/specs/gst_tax_test_vectors.json';
        }

        $this->assertFileExists($jsonPath);
        $data = json_decode(file_get_contents($jsonPath), true);
        $this->assertNotEmpty($data['test_cases']);

        foreach ($data['test_cases'] as $tc) {
            $input = [
                'store_state' => $tc['store_state'],
                'customer_gstin' => $tc['customer_gstin'],
                'place_of_supply' => $tc['place_of_supply'],
                'default_tax_mode' => $tc['tax_mode'],
                'lines' => $tc['lines'],
                'bill_discount' => $tc['bill_discount'],
                'auto_round_off' => $tc['auto_round_off'],
            ];

            $result = TaxEngine::calculateDocumentTaxes($input);

            // Assert line count
            $this->assertCount(count($tc['expected_lines']), $result['lines'], "Line count mismatch for {$tc['id']}");

            foreach ($tc['expected_lines'] as $i => $exp) {
                $act = $result['lines'][$i];
                $this->assertEqualsWithDelta($exp['gross_amount'], $act['gross_amount'], 0.01, "Gross mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['line_discount'], $act['line_discount'], 0.01, "Line disc mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['allocated_bill_discount'], $act['allocated_bill_discount'], 0.01, "Alloc disc mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['taxable_amount'], $act['taxable_amount'], 0.01, "Taxable mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['cgst_rate'], $act['cgst_rate'], 0.01, "CGST rate mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['cgst_amount'], $act['cgst_amount'], 0.01, "CGST amt mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['sgst_rate'], $act['sgst_rate'], 0.01, "SGST rate mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['sgst_amount'], $act['sgst_amount'], 0.01, "SGST amt mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['igst_rate'], $act['igst_rate'], 0.01, "IGST rate mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['igst_amount'], $act['igst_amount'], 0.01, "IGST amt mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['cess_amount'], $act['cess_amount'], 0.01, "Cess mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['total_tax'], $act['total_tax'], 0.01, "Total tax mismatch in {$tc['id']} line {$i}");
                $this->assertEqualsWithDelta($exp['total_amount'], $act['total_amount'], 0.01, "Total amt mismatch in {$tc['id']} line {$i}");
            }

            // Assert totals
            $expTot = $tc['expected_totals'];
            $this->assertEqualsWithDelta($expTot['gross_subtotal'], $result['gross_subtotal'], 0.01, "Gross subtotal mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['line_discount_total'], $result['line_discount_total'], 0.01, "Line disc total mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['bill_discount_total'], $result['bill_discount_total'], 0.01, "Bill disc total mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['taxable_subtotal'], $result['taxable_subtotal'], 0.01, "Taxable subtotal mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['cgst_total'], $result['cgst_total'], 0.01, "CGST total mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['sgst_total'], $result['sgst_total'], 0.01, "SGST total mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['igst_total'], $result['igst_total'], 0.01, "IGST total mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['cess_total'], $result['cess_total'], 0.01, "Cess total mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['total_tax'], $result['total_tax'], 0.01, "Total tax mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['net_before_round'], $result['net_before_round'], 0.01, "Net before round mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['round_off'], $result['round_off'], 0.01, "Round off mismatch in {$tc['id']}");
            $this->assertEqualsWithDelta($expTot['grand_total'], $result['grand_total'], 0.01, "Grand total mismatch in {$tc['id']}");

            // Invariant: sum of lines equals invoice totals
            $sumTaxable = round(array_sum(array_column($result['lines'], 'taxable_amount')), 2);
            $sumCgst = round(array_sum(array_column($result['lines'], 'cgst_amount')), 2);
            $sumSgst = round(array_sum(array_column($result['lines'], 'sgst_amount')), 2);
            $sumIgst = round(array_sum(array_column($result['lines'], 'igst_amount')), 2);
            $sumCess = round(array_sum(array_column($result['lines'], 'cess_amount')), 2);
            $sumTotal = round(array_sum(array_column($result['lines'], 'total_amount')), 2);

            $this->assertEquals($result['taxable_subtotal'], $sumTaxable, "Sum of line taxables != subtotal in {$tc['id']}");
            $this->assertEquals($result['cgst_total'], $sumCgst, "Sum of line CGST != cgst_total in {$tc['id']}");
            $this->assertEquals($result['sgst_total'], $sumSgst, "Sum of line SGST != sgst_total in {$tc['id']}");
            $this->assertEquals($result['igst_total'], $sumIgst, "Sum of line IGST != igst_total in {$tc['id']}");
            $this->assertEquals($result['cess_total'], $sumCess, "Sum of line Cess != cess_total in {$tc['id']}");
            $this->assertEquals($result['grand_total'], round($sumTotal + $result['round_off'], 2), "Sum of lines + round_off != grand_total in {$tc['id']}");
        }
    }
}
