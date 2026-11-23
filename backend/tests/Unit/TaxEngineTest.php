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
                'charges' => $tc['charges'] ?? [],
                // CR-C-11: the payable policy is a document-level input, so a vector states it.
                'separately_paid_in_payable' => $tc['separately_paid_in_payable'] ?? false,
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

                foreach (['charge_allocation', 'landed_amount', 'landed_unit_cost'] as $key) {
                    if (array_key_exists($key, $exp)) {
                        $this->assertEqualsWithDelta($exp[$key], $act[$key], 0.005, "{$key} mismatch in {$tc['id']} line {$i}");
                    }
                }

                // PUR-002: the effective unit cost carries the charge allocation too.
                if (array_key_exists('landed_unit_cost', $exp)) {
                    $this->assertEqualsWithDelta(
                        $act['landed_unit_cost'],
                        $act['effective_unit_cost'],
                        0.005,
                        "effective_unit_cost ignores the charge allocation in {$tc['id']} line {$i}"
                    );
                }
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

            foreach ([
                'charge_taxable_total', 'charge_tax_total', 'charge_total',
                'separate_charge_taxable_total', 'separate_charge_tax_total', 'separate_charge_total',
                'landed_cost_addition', 'expense_charge_total',
                'creditable_input_tax_total', 'non_creditable_tax_total',
                'reconciliation_identity_delta',
            ] as $key) {
                if (array_key_exists($key, $expTot)) {
                    $this->assertEqualsWithDelta($expTot[$key], $result[$key], 0.005, "{$key} mismatch in {$tc['id']}");
                }
            }

            // Invariant: sum of lines equals invoice totals
            $sumTaxable = round(array_sum(array_column($result['lines'], 'taxable_amount')), 2);
            $sumCgst = round(array_sum(array_column($result['lines'], 'cgst_amount')), 2);
            $sumSgst = round(array_sum(array_column($result['lines'], 'sgst_amount')), 2);
            $sumIgst = round(array_sum(array_column($result['lines'], 'igst_amount')), 2);
            $sumCess = round(array_sum(array_column($result['lines'], 'cess_amount')), 2);
            $sumTotal = round(array_sum(array_column($result['lines'], 'total_amount')), 2);

            $chargeCgst = 0.0;
            $chargeSgst = 0.0;
            $chargeIgst = 0.0;
            $chargeCess = 0.0;
            $chargePayableTotal = 0.0;
            foreach ($result['charges'] as $charge) {
                if (!$charge['in_payable']) {
                    continue;
                }
                $chargeCgst += $charge['cgst_amount'];
                $chargeSgst += $charge['sgst_amount'];
                $chargeIgst += $charge['igst_amount'];
                $chargeCess += $charge['cess_amount'];
                $chargePayableTotal += $charge['total_amount'];
            }

            $this->assertEquals($result['taxable_subtotal'], $sumTaxable, "Sum of line taxables != subtotal in {$tc['id']}");
            $this->assertEquals(round($sumCgst + $chargeCgst, 2), $result['cgst_total'], "Line CGST + charge CGST != cgst_total in {$tc['id']}");
            $this->assertEquals(round($sumSgst + $chargeSgst, 2), $result['sgst_total'], "Line SGST + charge SGST != sgst_total in {$tc['id']}");
            $this->assertEquals(round($sumIgst + $chargeIgst, 2), $result['igst_total'], "Line IGST + charge IGST != igst_total in {$tc['id']}");
            $this->assertEquals(round($sumCess + $chargeCess, 2), $result['cess_total'], "Line Cess + charge Cess != cess_total in {$tc['id']}");
            $this->assertEquals(
                $result['grand_total'],
                round($sumTotal + $chargePayableTotal + $result['round_off'], 2),
                "Sum of lines + payable charges + round_off != grand_total in {$tc['id']}"
            );

            $sumHsnTaxable = round(array_sum(array_column($result['hsn_summary'], 'taxable_value')), 2);
            $this->assertEquals(
                round($sumTaxable + $result['charge_taxable_total'], 2),
                $sumHsnTaxable,
                "HSN/SAC summary taxable != goods + charge taxable in {$tc['id']}"
            );

            $this->assertCount(count($tc['expected_charges'] ?? []), $result['charges'], "Charge count mismatch in {$tc['id']}");
            foreach ($tc['expected_charges'] ?? [] as $i => $expCharge) {
                $act = $result['charges'][$i];
                $this->assertSame($expCharge['charge_id'], $act['charge_id'], "Charge id mismatch in {$tc['id']} charge {$i}");

                foreach ([
                    'taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'cess_amount',
                    'total_tax', 'total_amount', 'creditable_tax', 'non_creditable_tax', 'expense_posting',
                ] as $key) {
                    if (array_key_exists($key, $expCharge)) {
                        $this->assertEqualsWithDelta($expCharge[$key], $act[$key], 0.005, "{$key} mismatch in {$tc['id']} charge {$i}");
                    }
                }

                foreach (['spread_basis_used', 'spread_fallback_reason', 'in_payable', 'is_rcm'] as $key) {
                    if (array_key_exists($key, $expCharge)) {
                        $this->assertSame($expCharge[$key], $act[$key], "{$key} mismatch in {$tc['id']} charge {$i}");
                    }
                }

                if (array_key_exists('lines_without_weight', $expCharge)) {
                    $this->assertEquals($expCharge['lines_without_weight'], $act['lines_without_weight'], "Lines without weight mismatch in {$tc['id']} charge {$i}");
                }

                $this->assertCount(count($expCharge['allocations']), $act['allocations'], "Allocation count mismatch in {$tc['id']} charge {$i}");
                foreach ($expCharge['allocations'] as $j => $expAlloc) {
                    $actAlloc = $act['allocations'][$j];
                    $this->assertSame($expAlloc['line_id'], $actAlloc['line_id'], "Allocation line id mismatch in {$tc['id']} charge {$i}");
                    $this->assertEqualsWithDelta($expAlloc['allocated_amount'], $actAlloc['allocated_amount'], 0.005, "Allocation mismatch in {$tc['id']} charge {$i} line {$j}");
                    if (array_key_exists('is_remainder_paisa', $expAlloc)) {
                        $this->assertSame($expAlloc['is_remainder_paisa'], $actAlloc['is_remainder_paisa'], "Remainder paisa flag mismatch in {$tc['id']} charge {$i} line {$j}");
                    }
                }

                if ($act['treatment'] === 'add_to_cost') {
                    $sumAlloc = round(array_sum(array_column($act['allocations'], 'allocated_amount')), 2);
                    $spreadable = round($act['taxable_amount'] + $act['non_creditable_tax'], 2);
                    $this->assertEquals($spreadable, $sumAlloc, "Charge allocations do not equal the spreadable amount in {$tc['id']} charge {$i}");
                }
            }

            if (!empty($result['charges'])) {
                $this->assertEquals(
                    round(array_sum(array_column($result['lines'], 'charge_allocation')), 2),
                    $result['landed_cost_addition'],
                    "Sum of line charge allocations != landed_cost_addition in {$tc['id']}"
                );
                $this->assertEqualsWithDelta(0.0, $result['reconciliation_identity_delta'], 0.005, "Reconciliation identity does not balance in {$tc['id']}");
            }
        }
    }
}
