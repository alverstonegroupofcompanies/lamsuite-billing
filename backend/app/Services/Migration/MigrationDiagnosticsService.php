<?php

namespace App\Services\Migration;

class MigrationDiagnosticsService
{
    private LegacyRecordNormalizer $normalizer;

    public function __construct(?LegacyRecordNormalizer $normalizer = null)
    {
        $this->normalizer = $normalizer ?? new LegacyRecordNormalizer();
    }

    /**
     * Runs precheck quality scan on the ingested payload before migration.
     * Detects:
     * - Record counts per entity
     * - Duplicate barcodes / codes
     * - Missing GSTIN or HSN
     * - Negative stock quantities
     * - Orphan batches (without parent product)
     * - Invalid or unparseable dates
     * - Mismatched line totals vs invoice grand totals
     * - Figures the import cannot read at all (a shelf with no quantity column, a bill with no
     *   number, a line that names no tax rate)
     * - Pending unsynced device check
     */
    public function runPrecheck(array $sourceData): array
    {
        $issues = [];
        $counts = [];

        // 1. Entities count
        $entities = [
            'store_profile', 'stores', 'users', 'billing_app_users',
            'groups', 'brands', 'units', 'banks', 'locations', 'departments', 'designations', 'discount_schemas',
            'customers', 'suppliers',
            'products', 'product_batches', 'batches',
            'invoices', 'invoice_items',
            'credit_notes', 'sales_returns', 'returns',
            'purchases', 'purchase_documents', 'purchase_returns', 'debit_notes',
            'stock_adjustments', 'stock_transfers',
            'expenses', 'customer_loans', 'device_holds', 'sync_queue'
        ];

        foreach ($entities as $entity) {
            $data = $sourceData[$entity] ?? [];
            if (is_array($data)) {
                $counts[$entity] = count($data);
            }
        }

        // A source with nothing recognisable in it is not a migration. Without this the
        // wizard walks six green steps, writes no rows and reports success.
        if (array_sum($counts) === 0) {
            $issues[] = [
                'type' => 'error',
                'category' => 'source',
                'message' => 'The source carries no migratable records. Check that the bundle was exported for the right store, or that the token names a store whose data has not already been migrated.',
            ];
        }

        // 2. Barcode & Product scan
        $barcodesSeen = [];
        $duplicateBarcodes = [];
        $missingHsnCount = 0;
        $products = $sourceData['products'] ?? [];
        $productIds = [];
        // A line that names no rate is only a problem if the product master names none either:
        // the importer takes the slab off the catalog when the bill omits it.
        $productRates = [];

        foreach ($products as $idx => $p) {
            $pId = $p['id'] ?? $p['product_id'] ?? $idx;
            $productIds[$pId] = true;

            if (is_array($p) && ($masterRate = $this->normalizer->lineRate($p)) !== null) {
                $productRates[$pId] = $masterRate;
            }

            $barcode = trim((string)($p['barcode'] ?? ''));
            if ($barcode !== '') {
                if (isset($barcodesSeen[$barcode])) {
                    $duplicateBarcodes[] = $barcode;
                } else {
                    $barcodesSeen[$barcode] = true;
                }
            }

            $hsn = trim((string)($p['hsn_sac_code'] ?? $p['hsn_code'] ?? ''));
            if ($hsn === '' || $hsn === '0000') {
                $missingHsnCount++;
            }
        }

        if (!empty($duplicateBarcodes)) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'catalog',
                'message' => count($duplicateBarcodes) . ' duplicate barcode(s) found in source catalog.',
                'details' => array_slice(array_unique($duplicateBarcodes), 0, 10),
            ];
        }

        if ($missingHsnCount > 0) {
            $issues[] = [
                'type' => 'info',
                'category' => 'compliance',
                'message' => "{$missingHsnCount} item(s) have missing or placeholder (0000) HSN/SAC codes.",
            ];
        }

        // 3. Batches & Stock scan
        $batches = $sourceData['product_batches'] ?? $sourceData['batches'] ?? [];
        $orphanBatches = 0;
        $negativeStockBatches = 0;
        $batchesWithQuantity = 0;
        $stockAcrossBatches = 0.0;

        foreach ($batches as $b) {
            $parentPId = $b['product_id'] ?? null;
            if ($parentPId && !isset($productIds[$parentPId])) {
                $orphanBatches++;
            }

            if (is_array($b) && $this->normalizer->hasStockFigure($b)) {
                $batchesWithQuantity++;
            }

            $stock = (float) $this->normalizer->batch(is_array($b) ? $b : [])['stock_qty'];
            $stockAcrossBatches += $stock;
            if ($stock < 0) {
                $negativeStockBatches++;
            }
        }

        // A store whose shelves really are empty and a source that never named a quantity column
        // look identical after import — both arrive as 0 — and only one of them is supposed to.
        if (!empty($batches) && $batchesWithQuantity === 0) {
            $issues[] = [
                'type' => 'error',
                'category' => 'inventory',
                'message' => 'None of the ' . count($batches) . ' batch record(s) carries a quantity under any known key (stock_qty, quantity, stock, in_stock, available_qty, balance). Importing them would open every batch on the new till at zero units.',
            ];
        } elseif (!empty($batches) && $stockAcrossBatches <= 0.0 && $negativeStockBatches === 0) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'inventory',
                'message' => 'All ' . count($batches) . ' batch record(s) resolve to zero units. Confirm the store genuinely holds no stock before cutting over.',
            ];
        }

        if ($orphanBatches > 0) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'inventory',
                'message' => "{$orphanBatches} batch record(s) lack a matching parent product. They will be linked to an autogenerated placeholder product if migrated.",
            ];
        }

        if ($negativeStockBatches > 0) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'inventory',
                'message' => "{$negativeStockBatches} batch(es) have negative stock. Migration will record corresponding reconciliation adjustment entries.",
            ];
        }

        // 4. The money this store runs on, read the way the importer will read it
        // Scanning the raw rows here instead would fail an export that only spells its total
        // `bill_amount` and its date `bill_date` — the same mistake that dropped a year of
        // purchases and filed a taxed year under the 0% slab.
        $mismatchedInvoices = 0;
        $undatedDocuments = [];
        $unnumbered = 0;
        $unratedLines = 0;
        $rateFromMaster = 0;
        $rateFromBill = 0;
        $ratedDocuments = 0;

        foreach ([[$this->normalizer->saleDocuments($sourceData), true],
                  [$this->normalizer->purchaseDocuments($sourceData), false]] as [$documents, $isSale]) {
            foreach ($documents as [$row, $filedAsNote]) {
                $doc = $isSale
                    ? $this->normalizer->invoice($row, $filedAsNote)
                    : $this->normalizer->purchase($row, $filedAsNote);

                $label = $doc['invoice_number'] ?? ('row ' . ($row['id'] ?? '?'));

                if ($doc['invoice_date'] === null || strtotime($doc['invoice_date']) === false) {
                    $undatedDocuments[] = $label;
                }

                $roundOff = (float) $doc['round_off'];
                $gross = 0.0;
                $net = 0.0;
                foreach ($doc['items'] as $line) {
                    $lineTax = (float) $line['tax_amount'];
                    $stated = (float) $line['total_amount'];
                    $base = (float) $line['qty'] * max(
                        (float) ($line['unit_price'] ?? 0.0),
                        (float) ($line['purchase_rate'] ?? 0.0)
                    );
                    $gross += $stated > 0.0 ? $stated : $base + $lineTax;
                    $net += $stated > 0.0 ? max($stated - $lineTax, 0.0) : $base;
                }
                // Only report when neither a tax-inclusive nor a tax-exclusive reading of the lines
                // adds up to the bill: that is a missing line, not a differently spelled total.
                if (($gross > 0.0 || $net > 0.0)
                    && abs($gross + $roundOff - $doc['grand_total']) > 1.0
                    && abs($net + $roundOff - $doc['grand_total']) > 1.0) {
                    $mismatchedInvoices++;
                }

                if ($doc['invoice_number'] === null) {
                    $unnumbered++;
                    continue;
                }

                if ($doc['tax_total'] <= 0.0) {
                    continue;
                }
                $ratedDocuments++;
                $billPercent = $doc['subtotal'] > 0.0
                    ? round($doc['tax_total'] / $doc['subtotal'] * 100, 2)
                    : null;
                foreach ($doc['items'] as $line) {
                    if ($line['gst_percent'] !== null) {
                        continue;
                    }
                    if ($line['product_id'] !== null && isset($productRates[$line['product_id']])) {
                        $rateFromMaster++;
                    } elseif ($billPercent !== null) {
                        // The bill states its tax and its taxable value, so the line can be filed
                        // at the average slab the document itself implies.
                        $rateFromBill++;
                    } else {
                        // Neither the line, nor the product catalog, nor the bill's own totals state
                        // a rate for it — nothing is left to file it under.
                        $unratedLines++;
                    }
                }
            }
        }

        if ($mismatchedInvoices > 0) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'invoices',
                'message' => "{$mismatchedInvoices} document(s) show a total variance > ₹1 against their line items. Migration will preserve the original grand total to protect the accounting ledger.",
            ];
        }

        if (!empty($undatedDocuments)) {
            $issues[] = [
                'type' => 'error',
                'category' => 'invoices',
                'message' => count($undatedDocuments) . " sale/purchase document(s) carry no date any known key can read, so they cannot be filed in a financial year. Export them with their bill dates.",
                'details' => array_slice($undatedDocuments, 0, 10),
            ];
        }

        if ($unnumbered > 0) {
            $issues[] = [
                'type' => 'error',
                'category' => 'invoices',
                'message' => "{$unnumbered} sale/purchase document(s) carry no bill number under any known key, so they cannot be filed or found after cutover. Export them with their invoice/bill numbers.",
            ];
        }

        if ($unratedLines > 0) {
            $issues[] = [
                'type' => 'error',
                'category' => 'compliance',
                'message' => "{$unratedLines} line(s) across {$ratedDocuments} taxed document(s) record tax no rate can be found for — not on the line, not in the product catalog, and not implied by the bill's own totals. They would be filed under the 0% slab in the GST returns, so export the rate or the taxable value with them.",
            ];
        }

        if ($rateFromMaster > 0) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'compliance',
                'message' => "{$rateFromMaster} taxed line(s) name no rate on the bill; the slab will be taken from the product catalog. Confirm those items still carry the rate they were billed at.",
            ];
        }

        if ($rateFromBill > 0) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'compliance',
                'message' => "{$rateFromBill} taxed line(s) name no rate and no catalog slab either; they will be filed at the average slab the bill itself implies, which is exact for a single-rate bill and a spread for a mixed one. Check the slabs before filing the return.",
            ];
        }

        $storeProfile = $sourceData['store_profile'] ?? ($sourceData['stores'][0] ?? []);
        $settings = $sourceData['company_settings'] ?? $sourceData['store_settings'] ?? [];
        $billingFromSettings = [];
        foreach ($settings as $setting) {
            if (is_array($setting) && in_array($setting['key'] ?? $setting['setting_key'] ?? '', ['billing', 'tax_settings'], true)
                && is_array($setting['value'] ?? null)) {
                $billingFromSettings += $setting['value'];
            }
        }
        if ($this->normalizer->taxMode(is_array($storeProfile) ? $storeProfile : []) === null
            && $this->normalizer->taxMode($billingFromSettings) === null) {
            $issues[] = [
                'type' => 'info',
                'category' => 'compliance',
                'message' => 'The source does not state whether its prices include tax, so the till keeps this store\'s current billing mode. Set it under Billing before the first bill is printed.',
            ];
        }

        // 5. Unsynced queue / Held bills warning
        $queueItems = $sourceData['sync_queue'] ?? [];
        $heldBills = $sourceData['device_holds'] ?? [];
        if (!empty($queueItems)) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'unsynced',
                'message' => count($queueItems) . " unsynced offline queue item(s) detected. Ensure device synchronization or migration bridge is applied before final cutover.",
            ];
        }
        if (!empty($heldBills)) {
            $issues[] = [
                'type' => 'info',
                'category' => 'unsynced',
                'message' => count($heldBills) . " held POS bill(s) detected and queued for draft bill recovery.",
            ];
        }

        $canProceed = count(array_filter($issues, fn($i) => $i['type'] === 'error')) === 0;

        return [
            'can_proceed' => $canProceed,
            'record_counts' => $counts,
            'issues' => $issues,
            'summary' => [
                'total_entities' => count($counts),
                'total_records' => array_sum($counts),
                'warnings_count' => count(array_filter($issues, fn($i) => $i['type'] === 'warning')),
                'errors_count' => count(array_filter($issues, fn($i) => $i['type'] === 'error')),
            ],
        ];
    }
}
