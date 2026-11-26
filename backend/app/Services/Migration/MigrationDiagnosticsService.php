<?php

namespace App\Services\Migration;

class MigrationDiagnosticsService
{
    /**
     * Source keys holding sale- and purchase-family bills, plus the view keys that restate them as
     * "what the run files as a sale", "as a credit bill" or "as a purchase".
     *
     * A pre-check that counted `invoices` and `sales_invoices` in the same total billed the
     * operator for records the pipeline writes once, so the total is built from the views and the
     * table keys they were derived from are left out.
     */
    private const DOCUMENT_KEYS = [
        'invoices', 'credit_notes', 'sales_returns', 'returns', 'return_invoices', 'credit_bills',
        'sales', 'bills', 'sale_documents', 'sales_invoices', 'credit_bills',
        'purchases', 'purchase_documents', 'purchase_bills', 'grns',
        'purchase_returns', 'debit_notes', 'return_bills',
    ];

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
    /**
     * @param  array  $options  what the operator told the wizard, e.g. `tax_mode`
     */
    public function runPrecheck(array $sourceData, array $options = []): array
    {
        $issues = [];
        $counts = [];

        // 1. Entities count
        $entities = [
            'store_profile', 'stores', 'users', 'billing_app_users',
            'groups', 'brands', 'units', 'banks', 'locations', 'departments', 'designations', 'discount_schemas',
            'customers', 'suppliers',
            'products', 'invoice_items',
            'invoices', 'credit_notes', 'sales_returns', 'returns',
            'purchase_documents', 'purchase_returns', 'debit_notes',
            'stock_adjustments', 'stock_transfers',
            'expenses', 'customer_loans', 'device_holds', 'sync_queue'
        ];

        foreach ($entities as $entity) {
            $data = $sourceData[$entity] ?? [];
            if (is_array($data)) {
                $counts[$entity] = count($data);
            }
        }

        // Count what the importer will actually read, not which top-level key the source happened
        // to use. The legacy pull nests a product's batches inside that product and names its
        // purchase bills `purchase_documents`, so a stocked shop pre-checked as "Batches & Stocks
        // 0, Purchases 0" and an operator could not tell that from a store with neither.
        $batches = $this->normalizer->batchesOf($sourceData);
        $saleDocuments = $this->normalizer->saleDocuments($sourceData);
        $purchaseDocuments = $this->normalizer->purchaseDocuments($sourceData);

        $counts['product_batches'] = count($batches);
        $counts['purchases'] = count($purchaseDocuments);
        $counts['sales_invoices'] = count($saleDocuments);
        // A panel keeps its returns inside the invoice table tagged `sales_module_key`, so the
        // credit bills are counted the way the importer files them — by the row's own kind, with
        // its table as the fallback — not by which key the row happened to arrive under.
        $counts['credit_bills'] = count(array_filter(
            $saleDocuments,
            fn ($doc) => $this->normalizer->documentKind($doc[0], LegacyRecordNormalizer::SALE, $doc[1]) === LegacyRecordNormalizer::KIND_CREDIT_NOTE
        ));

        // A source with nothing recognisable in it is not a migration. Without this the
        // wizard walks six green steps, writes no rows and reports success.
        if ($this->recordTotal($counts) === 0) {
            $issues[] = [
                'type' => 'error',
                'category' => 'source',
                'message' => 'The source carries no migratable records. Check that the bundle was exported for the right store, or that the token names a store whose data has not already been migrated.',
            ];
        }

        // 2. Barcode & Product scan
        $barcodesSeen = [];
        $duplicateBarcodes = [];
        $missingHsn = [];
        $products = $sourceData['products'] ?? [];
        $productIds = [];
        // A line that names no rate is only a problem if the product master names none either:
        // the importer takes the slab off the catalog when the bill omits it.
        $productRates = [];
        // The catalog's own answer for how much stock a product holds, used as a cross-check on
        // the batch rows: two numbers from one source that disagree is a shelf nobody can trust.
        $catalogStock = 0.0;

        foreach ($products as $idx => $p) {
            if (!is_array($p)) {
                continue;
            }
            $pId = $p['id'] ?? $p['product_id'] ?? $idx;
            $productIds[$pId] = true;
            $external = $this->normalizer->text($p, ['external_id', 'uuid', 'guid']);
            if ($external !== null) {
                $productIds[$external] = true;
            }

            // A bill line may name its product by either handle, so the catalog's slab is filed
            // under both.
            if (($masterRate = $this->normalizer->lineRate($p)) !== null) {
                $productRates[$pId] = $masterRate;
                if ($external !== null) {
                    $productRates[$external] = $masterRate;
                }
            }

            $catalogStock += $this->normalizer->number($p, ['stock', 'current_stock', 'stock_qty']);

            $barcode = trim((string)($p['barcode'] ?? ''));
            if ($barcode !== '') {
                if (isset($barcodesSeen[$barcode])) {
                    $duplicateBarcodes[] = $barcode;
                } else {
                    $barcodesSeen[$barcode] = true;
                }
            }

            if ($this->normalizer->hsnCode($p) === null) {
                $missingHsn[] = (string) ($p['name'] ?? $p['print_name'] ?? $p['sku'] ?? 'row ' . ($p['id'] ?? $idx));
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

        if ($missingHsn !== []) {
            $issues[] = [
                'type' => 'info',
                'category' => 'compliance',
                'message' => count($missingHsn) . ' item(s) have missing or placeholder HSN/SAC codes, which a GST summary report has to print. They are listed here so the catalog can be corrected after cutover.',
                'details' => array_slice($missingHsn, 0, 10),
            ];
        }

        // 3. Batches & Stock scan
        $orphanBatches = 0;
        $negativeStockBatches = 0;
        $batchesWithQuantity = 0;
        $stockAcrossBatches = 0.0;

        foreach ($batches as $b) {
            $parentPId = $b['product_id'] ?? null;
            if ($parentPId && !isset($productIds[$parentPId])) {
                $orphanBatches++;
            }

            if ($this->normalizer->hasStockFigure($b)) {
                $batchesWithQuantity++;
            }

            $stock = $this->normalizer->batchStock($b);
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
                'message' => 'None of the ' . count($batches) . ' batch record(s) carries a quantity under any known key (stock_qty, quantity, opening_qty, stock, in_stock, available_qty, balance, or a packs × units-per-pack pair). Importing them would open every batch on the new till at zero units.',
            ];
        } elseif (!empty($batches) && $stockAcrossBatches <= 0.0 && $negativeStockBatches === 0) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'inventory',
                'message' => 'All ' . count($batches) . ' batch record(s) resolve to zero units. Confirm the store genuinely holds no stock before cutting over.',
            ];
        } elseif (!empty($batches) && $catalogStock > 0.0 && abs($stockAcrossBatches - $catalogStock) > 1.0) {
            // The two stock numbers a legacy catalog carries rarely agree: one is a running
            // column, the other is derived from batch rows or a ledger. Say which one is used.
            $issues[] = [
                'type' => 'warning',
                'category' => 'inventory',
                'message' => 'The batch rows total ' . rtrim(rtrim(number_format($stockAcrossBatches, 2, '.', ''), '0'), '.')
                    . ' units while the catalog states ' . rtrim(rtrim(number_format($catalogStock, 2, '.', ''), '0'), '.')
                    . ' units of stock. Migration opens each batch at its own quantity, so the shelf total after cutover is the batch figure; count the stock before the first bill if the two differ.',
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
        $unnumbered = [];
        $unidentifiable = [];
        $unratedLines = 0;
        $rateFromMaster = 0;
        $rateFromBill = 0;
        $ratedDocuments = 0;

        foreach ([[$saleDocuments, true], [$purchaseDocuments, false]] as [$documents, $isSale]) {
            foreach ($documents as [$row, $filedAsNote]) {
                $doc = $isSale
                    ? $this->normalizer->invoice($row, $filedAsNote)
                    : $this->normalizer->purchase($row, $filedAsNote);

                // Say up front what the importer will file it as, so the operator can find the
                // bill afterwards rather than wondering whether it arrived at all.
                $derived = $doc['invoice_number'] === null
                    ? $this->normalizer->derivedDocumentNumber($row, $isSale ? 'MIGBILL' : 'MIGPUR')
                    : null;
                $label = $doc['invoice_number'] ?? ($derived ?? 'row ' . ($row['id'] ?? '?'));

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
                    // A document with no number but with a row identity is still importable under
                    // a derived one; one with neither cannot be traced to anything, so that is the
                    // only case that stops the migration.
                    $party = $doc['customer_name'] ?? ($doc['supplier_name'] ?? null);
                    $where = trim(($doc['invoice_date'] ?? '') . ($party ? ' / ' . $party : ''));
                    if ($derived === null) {
                        $unidentifiable[] = 'row ' . ($row['id'] ?? '?') . ($where === '' ? '' : ' (' . $where . ')');
                    } else {
                        $unnumbered[] = $derived . ($where === '' ? '' : ' (' . $where . ')');
                    }
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

        if ($unnumbered !== []) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'invoices',
                'message' => count($unnumbered) . " sale/purchase document(s) state no bill number under any known key. They are imported under the numbers listed here — so their money, stock and party balances are not lost — and each is also left on the review list. Rename them from the Bills screen before filing a return against them.",
                'details' => array_slice($unnumbered, 0, 10),
            ];
        }

        if ($unidentifiable !== []) {
            $issues[] = [
                'type' => 'error',
                'category' => 'invoices',
                'message' => count($unidentifiable) . " document(s) carry neither a bill number nor a row identity, so importing them would create a GST record nothing can trace back to the old system. Export them with their invoice/bill numbers.",
                'details' => array_slice($unidentifiable, 0, 10),
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

        // Whether the old system priced with the GST already inside the displayed rate decides
        // how every rupee in the import is read, and a wrong answer cannot be spotted in a
        // reconciliation report — the totals still add up. The legacy panel stores this switch
        // nowhere in its pull, so the wizard is allowed to be told directly.
        $storeProfile = is_array($sourceData['store_profile'] ?? null)
            ? $sourceData['store_profile']
            : ($sourceData['stores'][0] ?? []);
        $settings = $this->normalizer->settingsFields($sourceData);
        $statedMode = $this->normalizer->taxMode(is_array($storeProfile) ? $storeProfile : [])
            ?? $this->normalizer->settingsTaxMode($settings);
        $chosenMode = in_array($options['tax_mode'] ?? null, ['inclusive', 'exclusive'], true)
            ? (string) $options['tax_mode']
            : null;
        $currentMode = in_array($options['current_tax_mode'] ?? null, ['inclusive', 'exclusive'], true)
            ? (string) $options['current_tax_mode']
            : null;

        if ($chosenMode !== null) {
            $issues[] = [
                'type' => 'info',
                'category' => 'compliance',
                'message' => "Prices are taken as {$chosenMode} of tax, as chosen in this wizard. The till's billing mode is set to match at cutover, and every migrated price is read the same way.",
            ];
        } elseif ($statedMode !== null) {
            $issues[] = [
                'type' => 'info',
                'category' => 'compliance',
                'message' => "The source states its prices as {$statedMode} of tax; the till's billing mode is set to match at cutover.",
            ];
        } elseif ($currentMode !== null) {
            $issues[] = [
                'type' => 'warning',
                'category' => 'compliance',
                'message' => "The source nowhere states whether its prices include tax, so the import reads them as this till's billing mode ({$currentMode}). If the old system priced the other way, set \"How the old system priced a bill\" under Source Setup before importing — a wrong one re-derives every price while the totals still reconcile.",
            ];
        } else {
            $issues[] = [
                'type' => 'error',
                'category' => 'compliance',
                'message' => 'Neither the source nor this till states whether prices include tax, so the import cannot tell ₹118.00 on an old bill from ₹118.00 plus GST. Set "How the old system priced a bill" under Source Setup, then scan again.',
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
        if (empty($heldBills) && empty($queueItems)) {
            // A zero here is not a statement about the shop: these rows live on the counter, and
            // no server-side export has ever held one. Say where to get them instead of showing 0.
            $issues[] = [
                'type' => 'info',
                'category' => 'source',
                'message' => 'Held bills and unsynced queue items are not part of a panel database — they live on each till. If a counter has bills on hold, export that till\'s backup bundle and migrate it as well before cutting over, or the held bills stay on the old machine.',
            ];
        }

        $canProceed = count(array_filter($issues, fn($i) => $i['type'] === 'error')) === 0;

        return [
            'can_proceed' => $canProceed,
            'record_counts' => $counts,
            'issues' => $issues,
            'summary' => [
                'total_entities' => count($counts),
                'total_records' => $this->recordTotal($counts),
                'warnings_count' => count(array_filter($issues, fn($i) => $i['type'] === 'warning')),
                'errors_count' => count(array_filter($issues, fn($i) => $i['type'] === 'error')),
            ],
        ];
    }

    /**
     * How many records the run moves, each counted once.
     *
     * `sales_invoices` and `purchases` are read out of the bill tables rather than being extra
     * tables, so the total takes those two views and drops every table key they were derived from.
     * A panel that keeps its returns inside `invoices` therefore reports the bills it has, not
     * twice the bills it has. `credit_bills` is a slice of the sale view, so it joins neither.
     *
     * @param  array<string,int>  $counts
     */
    private function recordTotal(array $counts): int
    {
        return array_sum(array_diff_key($counts, array_flip(self::DOCUMENT_KEYS)))
            + ($counts['sales_invoices'] ?? 0)
            + ($counts['purchases'] ?? 0);
    }
}
