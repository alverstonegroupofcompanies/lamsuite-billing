<?php

namespace App\Services\Migration;

/**
 * MIG-03 — the source's spelling is not this schema's spelling.
 *
 * The legacy export and the till's sync payload name the same figure several ways
 * (`tax_percent`, `gst_rate`, a `cgst_percent` + `sgst_percent` pair, or nothing but a
 * taxable value beside a tax amount), and a document family is a *column* here
 * (`invoices.module_key`) rather than a separate table there. Reading one preferred key
 * per field is what let a year of GST rates arrive as 0 while the rupee totals matched to
 * the paisa — the money was copied, the rate was dropped.
 *
 * This class answers two questions for every field: which key holds it, and what type this
 * schema wants. It does not touch the database, does not decide whether a row should exist,
 * and returns null where a value genuinely is not present so the caller chooses the
 * fallback. The line-rate resolver deliberately distinguishes "zero-rated" (0.0) from
 * "cannot be matched" (null) because pre-check has to block on the second and not the first.
 */
class LegacyRecordNormalizer
{
    public const SALE = 'sale';
    public const PURCHASE = 'purchase';

    /** Document families as this schema stores them in `module_key`. */
    public const KIND_INVOICE = 'invoice';
    public const KIND_CREDIT_NOTE = 'credit_note';
    public const KIND_PURCHASE = 'purchase';
    public const KIND_DEBIT_NOTE = 'debit_note';

    private const KIND_KEYS = [
        'module_key', 'sales_module_key', 'purchase_type', 'document_type', 'doc_type',
        'bill_type', 'type', 'transaction_type',
    ];

    private const NOTE_NUMBER_KEYS = [
        'return_number', 'credit_note_number', 'credit_note_no', 'cn_number', 'return_no',
        'debit_note_number', 'debit_note_no', 'purchase_return_number', 'pr_number',
    ];

    private const ORIGINAL_DOC_KEYS = [
        'original_invoice_number', 'original_bill_number', 'reference_invoice_number',
        'against_invoice_number', 'ref_invoice_number', 'original_invoice_no',
    ];

    // `reference_no` and `purchase_number` are how the legacy pull spells a purchase bill's own
    // number; a document left unnumbered cannot be filed in a GST register after cutover.
    private const DOC_NUMBER_KEYS = [
        'invoice_number', 'bill_number', 'invoice_no', 'bill_no', 'inv_no', 'document_number',
        'purchase_bill_no', 'purchase_number', 'voucher_no', 'reference_no', 'challan_no',
        'po_number', 'receipt_no', 'bill_ref', 'number',
    ];

    private const DATE_KEYS = [
        'invoice_date', 'bill_date', 'purchase_date', 'date', 'document_date', 'reference_date', 'created_at',
    ];

    private const SUBTOTAL_KEYS = ['subtotal', 'taxable_subtotal', 'basic_amount', 'net_taxable_value', 'taxable_value'];
    private const TAXABLE_SUBTOTAL_KEYS = ['taxable_subtotal', 'net_taxable_value', 'taxable_value', 'basic_amount'];
    private const TAX_KEYS = ['tax_total', 'tax_amount', 'gst_total', 'total_tax', 'gst_amount'];
    private const GRAND_KEYS = ['grand_total', 'total', 'bill_amount', 'net_amount', 'amount', 'value'];
    private const PAID_KEYS = ['paid_amount', 'amount_paid', 'received_amount', 'collection_amount'];
    private const ROUND_KEYS = ['round_off', 'roundoff', 'rounded_off', 'rounding_off'];
    private const DISCOUNT_TOTAL_KEYS = ['discount_total', 'bill_discount', 'total_discount', 'discount_amount'];

    public const TAX_MODE_KEYS = [
        'tax_mode', 'tax_type', 'gst_tax_type', 'price_inclusive_of_tax', 'tax_inclusive',
        'inclusive_tax', 'mrp_inclusive', 'selling_inclusive', 'is_tax_inclusive',
        // The legacy panel's own switch, including the misspelling its settings row was saved
        // under; 1 meant the shelf price already carried the GST.
        'price_includes_gst', 'price_incines_gst',
    ];

    // A document line and a stock row count the same idea with different words, and reading
    // a line's `balance` as a quantity would invent stock.
    private const LINE_QTY_KEYS = ['qty', 'quantity', 'units', 'sold_qty', 'invoiced_qty', 'dispatch_qty'];

    // `opening_qty` and the pack pair are the only quantity figures a legacy batch row carries:
    // the panel keeps a batch's live balance in its stock ledger, so a migrator that looked only
    // for `quantity`/`stock` read every shelf as empty.
    private const BATCH_QTY_KEYS = [
        'stock_qty', 'quantity', 'qty', 'opening_qty', 'stock', 'current_stock', 'in_stock',
        'available_qty', 'balance',
    ];
    private const PACK_QTY_KEYS = ['packs', 'pack_qty'];
    private const PER_PACK_KEYS = ['units_per_pack', 'pack_size', 'units_per_strip'];
    private const LOOSE_QTY_KEYS = ['loose_qty', 'loose_units', 'loose'];

    private const RATE_KEYS = ['unit_price', 'rate', 'price', 'sel_rate', 'selling_rate', 'basic_rate'];
    // A legacy purchase line books its cost as `unit_price`, which is the same word the sale side
    // uses for the selling price; `ptr`/`pts` on that row are retailer prices, not the cost.
    private const PURCHASE_RATE_KEYS = [
        'purchase_rate', 'unit_price', 'cost_price', 'rate', 'purchase_value', 'buying_rate',
        'cost_rate', 'landing_rate', 'ptr',
    ];
    private const SELLING_RATE_KEYS = ['selling_rate', 'selling_price', 'sel_rate', 'pts', 'price'];
    private const MRP_KEYS = ['mrp', 'max_retail_price', 'retail_price'];
    private const LINE_TAX_KEYS = ['tax_amount', 'total_tax', 'gst_amount', 'tax'];
    private const LINE_TOTAL_KEYS = ['total_amount', 'line_total', 'gross_amount', 'amount', 'value'];
    private const LINE_TAXABLE_KEYS = ['taxable_amount', 'basic_amount', 'taxable_value', 'net_amount'];
    private const BATCH_NO_KEYS = ['batch_no', 'batch', 'batch_number', 'batch_id'];
    private const EXPIRY_KEYS = ['expiry_date', 'expiry', 'exp_date', 'exp'];
    private const MFG_KEYS = ['mfg_date', 'manufacture_date', 'mfd_date', 'manuf_date'];

    /** Percent keys, strongest spelling first. A bare `gst` is deliberately absent: in some
     *  exports that key holds the tax *amount*, and guessing a rate from it is worse than
     *  deriving one from the taxable value beside it. `tax_pct`/`gst_pct` are the spellings the
     *  legacy panel's own line tables use, and missing them is why a taxed year arrived at 0%. */
    private const PERCENT_KEYS = [
        'gst_percent', 'tax_percent', 'gst_pct', 'tax_pct', 'gst_rate', 'tax_rate',
        'gst_percentage', 'tax_percentage', 'rate_percent', 'percentage',
    ];

    /** The tax split as separate columns, which is how a GST catalog and a purchase line state a
     *  slab. Bare `cgst`/`sgst` are absent on purpose: on a bill line those hold rupee amounts. */
    private const SPLIT_PERCENT_KEYS = [
        ['cgst_percent', 'cgst_pct', 'cgst_rate'],
        ['sgst_percent', 'sgst_pct', 'sgst_rate'],
        ['igst_percent', 'igst_pct', 'igst_rate'],
    ];

    // --- Header builders -------------------------------------------------------------

    public function invoice(array $row, bool $provenanceIsNote = false): array
    {
        $kind = $this->documentKind($row, self::SALE, $provenanceIsNote);
        $note = $kind === self::KIND_CREDIT_NOTE;

        $subtotal = $this->magnitude($this->number($row, self::SUBTOTAL_KEYS), $note);
        $tax = $this->magnitude($this->number($row, self::TAX_KEYS), $note);
        $grand = $this->magnitude($this->number($row, self::GRAND_KEYS, $subtotal + $tax), $note);

        return [
            'module_key' => $kind,
            'invoice_number' => $this->documentNumber($row, $note),
            'invoice_date' => $this->day($row, self::DATE_KEYS),
            'customer_id' => $this->idRef($row, ['customer_id', 'customer', 'party_id', 'client_id']),
            'customer_name' => $this->text($row, ['customer_name', 'party_name']) ?? $this->nestedName($row, ['customer', 'party']),
            'customer_phone' => $this->text($row, ['customer_phone', 'phone', 'mobile']),
            'customer_gstin' => $this->text($row, ['customer_gstin', 'gstin']),
            'place_of_supply' => $this->stateCode($row, ['place_of_supply', 'pos_state', 'gst_state', 'state_code']),
            'taxable_subtotal' => $this->magnitude($this->number($row, self::TAXABLE_SUBTOTAL_KEYS, $subtotal), $note),
            'subtotal' => $subtotal,
            'discount_total' => $this->magnitude($this->number($row, self::DISCOUNT_TOTAL_KEYS), $note),
            'tax_total' => $tax,
            'cgst_total' => $this->magnitude($this->number($row, ['cgst_total', 'cgst_amount', 'cgst']), $note),
            'sgst_total' => $this->magnitude($this->number($row, ['sgst_total', 'sgst_amount', 'sgst']), $note),
            'igst_total' => $this->magnitude($this->number($row, ['igst_total', 'igst_amount', 'igst']), $note),
            'cess_total' => $this->magnitude($this->number($row, ['cess_total', 'cess_amount', 'cess']), $note),
            'round_off' => $this->magnitude($this->number($row, self::ROUND_KEYS), $note),
            'grand_total' => $grand,
            'paid_amount' => $this->magnitude($this->number($row, self::PAID_KEYS, $grand), $note),
            'payment_mode' => $this->text($row, ['payment_mode', 'tender_mode', 'mode', 'payment_type']),
            'status' => $this->status($row),
            'cancel_reason' => $this->text($row, ['cancel_reason', 'cancellation_reason']),
            'cancelled_at' => $this->day($row, ['cancelled_at', 'cancel_date']),
            'patient_name' => $this->text($row, ['patient_name']) ?? $this->nestedName($row, ['patient']),
            'doctor_name' => $this->text($row, ['doctor_name', 'prescriber_name']) ?? $this->nestedName($row, ['doctor']),
            'doctor_reg_no' => $this->text($row, ['doctor_reg_no', 'doctor_registration_no', 'doctor_id']),
            'counter_code' => $this->text($row, ['counter_code', 'counter']),
            'salesperson_name' => $this->text($row, ['salesperson_name', 'salesman_name', 'sales_person']),
            // A note is filed against the bill it reverses; the linkage is what keeps the
            // credit traceable instead of looking like a second sale.
            'original_invoice_number' => $this->text($row, self::ORIGINAL_DOC_KEYS),
            'original_invoice_id' => $this->idRef($row, ['original_invoice_id', 'invoice_id', 'ref_invoice_id', 'against_invoice_id']),
            'external_id' => $this->text($row, ['external_id', 'uuid', 'guid']),
            'items' => $this->invoiceItems($this->lineRows($row), $note),
        ];
    }

    public function purchase(array $row, bool $provenanceIsNote = false): array
    {
        $kind = $this->documentKind($row, self::PURCHASE, $provenanceIsNote);
        $note = $kind === self::KIND_DEBIT_NOTE;

        $subtotal = $this->magnitude($this->number($row, self::SUBTOTAL_KEYS), $note);
        $tax = $this->magnitude($this->number($row, self::TAX_KEYS), $note);
        $grand = $this->magnitude($this->number($row, self::GRAND_KEYS, $subtotal + $tax), $note);

        return [
            'module_key' => $kind,
            'invoice_number' => $this->documentNumber($row, $note),
            // This schema keeps the internal receipt number and the supplier's own bill
            // number in separate columns; a legacy row often carries both.
            'document_number' => $this->text($row, ['document_number', 'grn_number', 'grn_no', 'receipt_number', 'voucher_no']),
            'supplier_invoice_no' => $this->text($row, ['supplier_invoice_no', 'supplier_invoice_number', 'supplier_bill_no', 'supplier_bill_number']),
            'invoice_date' => $this->day($row, self::DATE_KEYS),
            'supplier_id' => $this->idRef($row, ['supplier_id', 'supplier', 'party_id', 'vendor_id']),
            'supplier_name' => $this->text($row, ['supplier_name', 'party_name']) ?? $this->nestedName($row, ['supplier', 'party']),
            'supplier_gstin' => $this->text($row, ['supplier_gstin', 'gstin']),
            'place_of_supply' => $this->stateCode($row, ['place_of_supply', 'pos_state', 'state_code']),
            'subtotal' => $subtotal,
            'bill_discount' => $this->magnitude($this->number($row, self::DISCOUNT_TOTAL_KEYS), $note),
            'tax_total' => $tax,
            'cgst_total' => $this->magnitude($this->number($row, ['cgst_total', 'cgst_amount', 'cgst']), $note),
            'sgst_total' => $this->magnitude($this->number($row, ['sgst_total', 'sgst_amount', 'sgst']), $note),
            'igst_total' => $this->magnitude($this->number($row, ['igst_total', 'igst_amount', 'igst']), $note),
            'cess_total' => $this->magnitude($this->number($row, ['cess_total', 'cess_amount', 'cess']), $note),
            'freight_charges' => $this->magnitude($this->number($row, ['freight_charges', 'freight', 'transport_charges']), $note),
            'round_off' => $this->magnitude($this->number($row, self::ROUND_KEYS), $note),
            'grand_total' => $grand,
            'paid_amount' => $this->magnitude($this->number($row, self::PAID_KEYS), $note),
            'status' => $this->status($row, 'received'),
            'cancel_reason' => $this->text($row, ['cancel_reason', 'cancellation_reason']),
            'notes' => $this->text($row, ['notes', 'remarks', 'narration']),
            'external_id' => $this->text($row, ['external_id', 'uuid', 'guid']),
            'items' => $this->purchaseItems($this->lineRows($row), $note),
        ];
    }

    public function batch(array $row): array
    {
        return [
            'product_id' => $this->idRef($row, ['product_id', 'product', 'medicine_id', 'item_id']),
            'batch_no' => $this->text($row, self::BATCH_NO_KEYS),
            'mfg_date' => $this->day($row, self::MFG_KEYS),
            'expiry_date' => $this->day($row, self::EXPIRY_KEYS),
            // On-hand quantity is the one figure a stock row cannot be wrong about: the
            // legacy export has been seen to call it `stock`, `balance`, `opening_qty`, or
            // nothing but a pack count beside a units-per-pack.
            'stock_qty' => $this->batchStock($row),
            'mrp' => $this->number($row, self::MRP_KEYS),
            'purchase_rate' => $this->number($row, self::PURCHASE_RATE_KEYS),
            'selling_rate' => $this->number($row, self::SELLING_RATE_KEYS),
            'rack_location' => $this->text($row, ['rack_location', 'rack']),
            'shelf_location' => $this->text($row, ['shelf_location', 'shelf']),
            'external_id' => $this->text($row, ['external_id', 'uuid', 'guid']),
        ];
    }

    // --- Line builders ---------------------------------------------------------------

    /**
     * A note line arrives with the sign the legacy ledger used, but this schema stores the
     * whole document as a magnitude and applies the sign where it is read. Flipping the lines
     * without the header (or the other way round) is how a credit note starts summing as a
     * sale in the GST working papers.
     */
    public function invoiceItems(array $rows, bool $isNote = false): array
    {
        $out = [];

        foreach ($rows as $line) {
            if (!is_array($line)) {
                continue;
            }
            $qty = $this->number($line, self::LINE_QTY_KEYS, 1);
            $price = $this->number($line, self::RATE_KEYS);
            $tax = $this->number($line, self::LINE_TAX_KEYS);
            $total = $this->number($line, self::LINE_TOTAL_KEYS);
            // Only a total the bill itself states carries tax inside it. When the base falls back
            // to qty × rate — a net figure — subtracting the tax from it would file a 12% slab as
            // 13.64%, which is how a clean export ends up with tax that reconciles to nothing.
            $taxable = $this->number($line, self::LINE_TAXABLE_KEYS, $total > 0.0 ? $total - $tax : $qty * $price);
            $rate = $this->lineRate($line, abs($taxable), abs($tax));

            $out[] = [
                // A legacy bill line names its product by the catalog row and by the device-side
                // uuid; the numeric id is missing from a payload pulled after a re-import, and an
                // unmatched line is a bill that prints without stock.
                'product_id' => $this->idRef($line, ['product_id', 'product', 'medicine_id', 'item_id', 'sku_id'])
                    ?? $this->idRef($line, ['product_external_id', 'product_uuid', 'product_uid']),
                'product_external_id' => $this->text($line, ['product_external_id', 'product_uuid', 'product_uid']),
                'product_name' => $this->text($line, ['product_name', 'description', 'name', 'item_name', 'product']) ?? 'Item',
                'batch_no' => $this->text($line, self::BATCH_NO_KEYS),
                'expiry_date' => $this->day($line, self::EXPIRY_KEYS),
                'qty' => $this->magnitude($qty, $isNote),
                'loose_qty' => $this->magnitude($this->number($line, self::LOOSE_QTY_KEYS), $isNote),
                'free_qty' => $this->magnitude($this->number($line, ['free_qty', 'free_quantity', 'complimentary_qty']), $isNote),
                'free_loose_qty' => $this->magnitude($this->number($line, ['free_loose_qty']), $isNote),
                'units_per_pack' => $this->number($line, self::PER_PACK_KEYS, 1),
                'unit_price' => $this->magnitude($price, $isNote),
                'mrp' => $this->magnitude($this->number($line, self::MRP_KEYS), $isNote),
                'rate_basis' => $this->text($line, ['rate_basis', 'billed_on', 'rate_basis_type']),
                'stock_action' => $this->text($line, ['stock_action', 'return_action']),
                'discount_percent' => $this->magnitude($this->number($line, ['discount_percent', 'discount_pct', 'disc_percent', 'discount_pc']), $isNote),
                'discount_amount' => $this->magnitude($this->number($line, ['discount_amount', 'disc_amount', 'discount']), $isNote),
                'allocated_discount' => $this->magnitude($this->number($line, ['allocated_discount', 'allocated_bill_discount']), $isNote),
                'taxable_amount' => $this->magnitude($taxable, $isNote),
                'gst_percent' => $rate,
                'cgst_amount' => $this->magnitude($this->number($line, ['cgst_amount', 'cgst']), $isNote),
                'sgst_amount' => $this->magnitude($this->number($line, ['sgst_amount', 'sgst']), $isNote),
                'igst_amount' => $this->magnitude($this->number($line, ['igst_amount', 'igst']), $isNote),
                'cess_rate' => $this->magnitude($this->number($line, ['cess_rate']), $isNote),
                'cess_amount' => $this->magnitude($this->number($line, ['cess_amount', 'cess']), $isNote),
                'tax_amount' => $this->magnitude($tax, $isNote),
                'total_amount' => $this->magnitude($total, $isNote),
            ];
        }

        return $out;
    }

    public function purchaseItems(array $rows, bool $isNote = false): array
    {
        $out = [];

        foreach ($rows as $line) {
            if (!is_array($line)) {
                continue;
            }
            $qty = $this->number($line, self::LINE_QTY_KEYS, 1);
            $price = $this->number($line, self::PURCHASE_RATE_KEYS);
            $tax = $this->number($line, self::LINE_TAX_KEYS);
            $total = $this->number($line, self::LINE_TOTAL_KEYS);
            // As on a sale line: only a stated gross total has tax inside it.
            $taxable = $this->number($line, self::LINE_TAXABLE_KEYS, $total > 0.0 ? $total - $tax : $qty * $price);
            $rate = $this->lineRate($line, abs($taxable), abs($tax));

            $out[] = [
                'product_id' => $this->idRef($line, ['product_id', 'product', 'medicine_id', 'item_id', 'sku_id'])
                    ?? $this->idRef($line, ['product_external_id', 'product_uuid', 'product_uid']),
                'product_external_id' => $this->text($line, ['product_external_id', 'product_uuid', 'product_uid']),
                // A legacy purchase line calls the item `description`, so reading only
                // `product_name` left every migrated purchase line labelled "Item".
                'product_name' => $this->text($line, ['product_name', 'description', 'name', 'item_name', 'product']) ?? 'Item',
                'batch_no' => $this->text($line, self::BATCH_NO_KEYS),
                'mfg_date' => $this->day($line, self::MFG_KEYS),
                'expiry_date' => $this->day($line, self::EXPIRY_KEYS),
                'qty' => $this->magnitude($qty, $isNote),
                'received_qty' => $this->magnitude($this->number($line, ['received_qty']), $isNote),
                'pack_qty' => $this->magnitude($this->number($line, self::PACK_QTY_KEYS), $isNote),
                'loose_qty' => $this->magnitude($this->number($line, self::LOOSE_QTY_KEYS), $isNote),
                'free_qty' => $this->magnitude($this->number($line, ['free_qty', 'free_quantity']), $isNote),
                'units_per_pack' => $this->number($line, self::PER_PACK_KEYS, 1),
                'purchase_rate' => $this->magnitude($price, $isNote),
                'ptr' => $this->magnitude($this->number($line, ['ptr']), $isNote),
                'pts' => $this->magnitude($this->number($line, ['pts']), $isNote),
                'ptss' => $this->magnitude($this->number($line, ['ptss']), $isNote),
                'selling_rate' => $this->magnitude($this->number($line, self::SELLING_RATE_KEYS), $isNote),
                'mrp' => $this->magnitude($this->number($line, self::MRP_KEYS), $isNote),
                'hsn_code' => $this->text($line, ['hsn_code', 'hsn_sac_code', 'hsn']),
                'discount_percent' => $this->magnitude($this->number($line, ['discount_percent', 'discount_pct', 'disc_percent']), $isNote),
                'discount_amount' => $this->magnitude($this->number($line, ['discount_amount', 'disc_amount']), $isNote),
                'taxable_amount' => $this->magnitude($taxable, $isNote),
                'gst_percent' => $rate,
                'cgst_amount' => $this->magnitude($this->number($line, ['cgst_amount', 'cgst']), $isNote),
                'sgst_amount' => $this->magnitude($this->number($line, ['sgst_amount', 'sgst']), $isNote),
                'igst_amount' => $this->magnitude($this->number($line, ['igst_amount', 'igst']), $isNote),
                'cess_amount' => $this->magnitude($this->number($line, ['cess_amount', 'cess']), $isNote),
                'tax_amount' => $this->magnitude($tax, $isNote),
                'total_amount' => $this->magnitude($total, $isNote),
            ];
        }

        return $out;
    }

    /**
     * Units a stock row holds. The legacy batch table states its live quantity as pack
     * arithmetic — `packs` × `units_per_pack` plus `loose_qty` — while its `opening_qty` column
     * keeps whatever the batch was booked in at, so neither figure alone is the shelf: taking
     * only a quantity column opened every migrated batch at zero, and taking only the packs
     * would re-count a batch that has since been sold down.
     */
    /**
     * The catalog's HSN/SAC code, or null. A shop that typed a placeholder into the field is not
     * stating a code, and printing one on a GST summary is worse than printing nothing.
     */
    public function hsnCode(array $row): ?string
    {
        $code = $this->text($row, ['hsn_sac_code', 'hsn_code', 'hsn']);
        if ($code === null || preg_match('/^0+$/', $code) || in_array(strtoupper($code), ['NA', 'N/A', 'NIL', 'NONE', '-'], true)) {
            return null;
        }

        return $code;
    }

    public function batchStock(array $row): float
    {
        $stated = $this->number($row, self::BATCH_QTY_KEYS, -1.0);
        // -1.0 is "this source names no quantity figure", which is the case the pack pair answers;
        // a stated zero is a genuinely empty shelf and stays the caller's answer.
        if ($stated !== -1.0) {
            return $stated;
        }

        $packs = $this->number($row, self::PACK_QTY_KEYS);
        $loose = $this->number($row, self::LOOSE_QTY_KEYS);
        if ($packs != 0.0 || $loose != 0.0) {
            return round($packs * $this->number($row, self::PER_PACK_KEYS, 1.0) + $loose, 3);
        }

        return $stated;
    }

    /**
     * Whether this stock row states an on-hand quantity anywhere. An export that omits the
     * column entirely has to be distinguished from a shop whose shelves genuinely are empty:
     * both arrive as zero, and only the first one is a mistake.
     */
    public function hasStockFigure(array $row): bool
    {
        return $this->raw($row, self::BATCH_QTY_KEYS) !== null
            || $this->raw($row, self::PACK_QTY_KEYS) !== null
            || $this->raw($row, self::LOOSE_QTY_KEYS) !== null;
    }

    // --- Document families -----------------------------------------------------------

    public const SALE_PLAIN_KEYS = ['invoices', 'sales', 'bills', 'sale_documents'];
    public const SALE_NOTE_KEYS = ['credit_notes', 'sales_returns', 'returns', 'return_invoices', 'credit_bills'];
    public const PURCHASE_PLAIN_KEYS = ['purchases', 'purchase_documents', 'purchase_bills', 'grns'];
    public const PURCHASE_NOTE_KEYS = ['purchase_returns', 'debit_notes', 'return_bills'];

    /**
     * The sale-side documents in a source, credit bills folded in.
     *
     * A legacy panel keeps a return in its own table while v2 stores both families in
     * `invoices` and separates them with `module_key`. Reading only `invoices` dropped a year
     * of credit bills without a word; reading both lists blindly double-imports a bundle that
     * files the same note twice, so a document's own identity decides which copy is kept.
     *
     * @param  callable(array, string):void|null  $onDuplicate  told about a copy it discards
     * @return array<int, array{0: array, 1: bool}>
     */
    public function saleDocuments(array $sourceData, ?callable $onDuplicate = null): array
    {
        return $this->collectDocuments($sourceData, self::SALE_PLAIN_KEYS, self::SALE_NOTE_KEYS, $onDuplicate);
    }

    /**
     * @return array<int, array{0: array, 1: bool}>
     */
    public function purchaseDocuments(array $sourceData, ?callable $onDuplicate = null): array
    {
        return $this->collectDocuments($sourceData, self::PURCHASE_PLAIN_KEYS, self::PURCHASE_NOTE_KEYS, $onDuplicate);
    }

    public const BATCH_LIST_KEYS = ['product_batches', 'batches', 'batch_stocks', 'stocks'];

    /**
     * Every batch the source offers, whether it is listed as its own entity or nested inside the
     * product that owns it.
     *
     * The legacy pull has no batches entity: it loads each product's batches and returns them
     * under `products[].batches`. Reading only a top-level batch list therefore reported a full
     * shop as "Batches & Stocks 0" — no batch numbers, no expiry dates, no shelf quantities — and
     * a product's own `batch_no`/`expiry_date` scalars are the same rows restated, which is why a
     * row seen under both spellings is imported once.
     *
     * @return array<int, array>
     */
    public function batchesOf(array $sourceData): array
    {
        $out = [];
        $seen = [];

        $collect = function (array $row, $parentId) use (&$out, &$seen): void {
            $batch = $this->raw($row, ['product_id']) === null && $parentId !== null
                ? array_merge($row, ['product_id' => $parentId])
                : $row;

            $identity = $this->batchIdentity($batch);
            if ($identity !== null) {
                if (isset($seen[$identity])) {
                    return;
                }
                $seen[$identity] = true;
            }

            $out[] = $batch;
        };

        foreach (self::BATCH_LIST_KEYS as $key) {
            $rows = $sourceData[$key] ?? null;
            if (!is_array($rows)) {
                continue;
            }
            foreach ($rows as $row) {
                if (is_array($row)) {
                    $collect($row, null);
                }
            }
        }

        foreach (($sourceData['products'] ?? []) as $product) {
            if (!is_array($product) || !is_array($product['batches'] ?? null)) {
                continue;
            }
            $parentId = $product['id'] ?? $product['product_id'] ?? $product['external_id'] ?? null;
            foreach ($product['batches'] as $row) {
                if (is_array($row)) {
                    $collect($row, $parentId);
                }
            }
        }

        return $out;
    }

    /**
     * What makes two stock rows the same batch: its own identity if it has one, otherwise the
     * product and batch number pair.
     */
    private function batchIdentity(array $row): ?string
    {
        $external = $this->text($row, ['external_id', 'uuid', 'guid']);
        if ($external !== null) {
            return 'uuid:' . strtolower($external);
        }

        $id = $row['id'] ?? $row['batch_id'] ?? null;
        if ($id !== null && $id !== '') {
            return 'row:' . $id;
        }

        $batchNo = $this->text($row, self::BATCH_NO_KEYS);
        if ($batchNo !== null) {
            return 'no:' . strtolower($batchNo) . '|' . ($row['product_id'] ?? '');
        }

        return null;
    }

    /**
     * @return array<int, array{0: array, 1: bool}>
     */
    private function collectDocuments(array $sourceData, array $plainKeys, array $noteKeys, ?callable $onDuplicate): array
    {
        $out = [];
        $seen = [];

        foreach ([[$plainKeys, false], [$noteKeys, true]] as [$keys, $filedAsNote]) {
            foreach ($keys as $key) {
                $rows = $sourceData[$key] ?? null;
                if (!is_array($rows)) {
                    continue;
                }
                foreach ($rows as $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    $identity = $this->documentIdentity($row, $filedAsNote);
                    if ($identity !== null && isset($seen[$identity])) {
                        if ($onDuplicate !== null) {
                            $onDuplicate($row, $key);
                        }
                        continue;
                    }
                    if ($identity !== null) {
                        $seen[$identity] = true;
                    }
                    $out[] = [$row, $filedAsNote];
                }
            }
        }

        return $out;
    }

    /**
     * What makes two rows the same document. A bill number alone is not enough — legacy data
     * reuses numbers across two genuinely different bills — so the money has to agree too.
     */
    private function documentIdentity(array $row, bool $filedAsNote): ?string
    {
        $number = $this->documentNumber($row, $filedAsNote);
        if ($number === null) {
            $id = $row['id'] ?? null;

            return $id === null || $id === '' ? null : ($filedAsNote ? 'row:' : 'doc:') . $id;
        }

        $money = abs($this->number($row, self::GRAND_KEYS, $this->number($row, self::SUBTOTAL_KEYS)));

        return strtolower($number) . '|' . number_format($money, 2, '.', '');
    }

    // --- Field resolvers -------------------------------------------------------------

    /**
     * The line's GST percent, or null when the source gives neither a percent nor a
     * taxable/tax pair to derive one from. Deriving is honest arithmetic — a ₹7.20 tax on a
     * ₹60.00 taxable value is 12% whatever the export chose to call it — and it is what keeps
     * a migrated year out of the 0% slab in the GST working papers.
     *
     * The order is evidence, not convenience. A legacy line defaults its percent column to
     * 0.000 while still recording the rupee tax against it, and a legacy catalog states its slab
     * as a CGST/SGST pair with the single `gst_percent` left at zero — so a stated zero is read
     * only after the pair and the tax figure beside it have been tried. A line that genuinely
     * states no tax inside a taxed bill is the exempt slab, and averaging the bill's rate onto it
     * would move rupees into a GST column where the shop reported none.
     */
    public function lineRate(array $line, ?float $taxable = null, ?float $tax = null): ?float
    {
        $percent = $this->number($line, self::PERCENT_KEYS, -1.0);

        $split = 0.0;
        $splitFound = false;
        foreach (self::SPLIT_PERCENT_KEYS as $keys) {
            $v = $this->number($line, $keys, -1.0);
            if ($v >= 0.0) {
                $split += $v;
                $splitFound = true;
            }
        }

        if ($percent > 0.0) {
            return round($percent, 2);
        }
        if ($split > 0.0) {
            return round($split, 2);
        }

        $taxable ??= $this->number($line, self::LINE_TAXABLE_KEYS);
        $tax ??= $this->number($line, self::LINE_TAX_KEYS);

        if ($taxable > 0.0 && $tax != 0.0) {
            return round(abs($tax / $taxable) * 100.0, 2);
        }

        if ($percent === 0.0 || ($splitFound && $split === 0.0)) {
            return 0.0;
        }

        if ($this->raw($line, self::LINE_TAX_KEYS) !== null && $tax === 0.0 && $taxable > 0.0) {
            return 0.0;
        }

        return null;
    }

    /**
     * How a tax figure divides between CGST/SGST and IGST. A source that already states the
     * split is kept as-is (the halves are what that system reported); otherwise the split
     * follows the only rule that decides it — place of supply against the store's own state.
     * Without a store state to compare against, no split is invented: a wrong one moves tax
     * between two GST returns.
     */
    public function splitTax(float $tax, ?string $placeOfSupply, ?string $storeStateCode): array
    {
        if ($tax == 0.0) {
            return ['cgst' => 0.0, 'sgst' => 0.0, 'igst' => 0.0];
        }

        if ($placeOfSupply !== null && $storeStateCode !== null && $placeOfSupply !== $storeStateCode) {
            return ['cgst' => 0.0, 'sgst' => 0.0, 'igst' => round($tax, 2)];
        }

        return ['cgst' => round($tax / 2, 2), 'sgst' => round($tax / 2, 2), 'igst' => 0.0];
    }

    /**
     * Which document family a row belongs to. The type the row states wins; failing that,
     * which source table the caller found it in; failing that, a note number or a reference to
     * the bill it reverses; failing that, a negative money figure.
     * This is the same vocabulary the sync path uses (a payload with `return_number` is a
     * credit note), so a migrated document and a synced one cannot disagree.
     */
    public function documentKind(array $row, string $family, bool $provenanceIsNote = false): string
    {
        // The legacy panel writes its document types hyphenated (`sales-return`, `purchase-bill`)
        // and v2 keeps them underscored, so both are one vocabulary here.
        $stated = str_replace('-', '_', trim((string) ($this->raw($row, self::KIND_KEYS) ?? '')));
        $stated = strtolower($stated);
        $isPurchase = $family === self::PURCHASE;

        // A purchase-side credit note is the same event as a purchase return: the vendor is owed
        // nothing and stock comes back. The legacy reports sign it the same way, so it belongs in
        // the note family rather than being imported as a second bill.
        $noteWords = $isPurchase
            ? ['purchase_return', 'purchase_returns', 'debit_note', 'debit', 'return_bill', 'return',
                'credit_note', 'credit', 'sales_return']
            : ['credit_note', 'credit', 'sales_return', 'return_invoice', 'return', 'cn'];
        $plainWords = $isPurchase
            ? ['purchase', 'purchase_bill', 'purchase_document', 'grn', 'stock_entry', 'received', 'bill',
                'invoice', 'po', 'purchase_order']
            : ['invoice', 'tax_invoice', 'sales_invoice', 'bill', 'sale', 'sales', 'pos', 'cash_sale',
                'debit_note', 'debit'];

        if ($stated !== '' && in_array($stated, $noteWords, true)) {
            return $isPurchase ? self::KIND_DEBIT_NOTE : self::KIND_CREDIT_NOTE;
        }
        if ($stated !== '' && in_array($stated, $plainWords, true)) {
            return $isPurchase ? self::KIND_PURCHASE : self::KIND_INVOICE;
        }

        // A row inside the returns table is a return even when it states no type at all; the
        // exporter already decided, and the legacy schema recorded it by placement.
        if ($provenanceIsNote) {
            return $isPurchase ? self::KIND_DEBIT_NOTE : self::KIND_CREDIT_NOTE;
        }

        if ($this->raw($row, self::NOTE_NUMBER_KEYS) !== null) {
            return $isPurchase ? self::KIND_DEBIT_NOTE : self::KIND_CREDIT_NOTE;
        }

        if (!$isPurchase && $this->raw($row, self::ORIGINAL_DOC_KEYS) !== null) {
            return self::KIND_CREDIT_NOTE;
        }

        $money = $this->number($row, self::GRAND_KEYS, $this->number($row, self::SUBTOTAL_KEYS));
        if ($money < 0.0) {
            return $isPurchase ? self::KIND_DEBIT_NOTE : self::KIND_CREDIT_NOTE;
        }

        return $isPurchase ? self::KIND_PURCHASE : self::KIND_INVOICE;
    }

    /**
     * The number this document is filed under. A note keeps its own series (`CN-…`,
     * `RET-…`) rather than the number of the bill it reverses, because two documents cannot
     * share a unique key and the note is the row that has to be findable on its own.
     */
    public function documentNumber(array $row, bool $isNote): ?string
    {
        $number = $this->text($row, self::DOC_NUMBER_KEYS)
            ?? $this->text($row, ['supplier_invoice_no', 'supplier_invoice_number', 'supplier_bill_no', 'grn_number']);

        if ($isNote) {
            $noteNumber = $this->text($row, self::NOTE_NUMBER_KEYS)
                ?? $this->text($row, ['number', 'code']);
            if ($noteNumber !== null) {
                return $noteNumber;
            }

            return $number;
        }

        // A credit bill filed into the plain invoice table spells its number only in a return
        // column. Read it, or the same document listed under both families arrives with two
        // different identities and is imported twice.
        return $number ?? $this->text($row, self::NOTE_NUMBER_KEYS);
    }

    /**
     * The number to file a document under when the source states none anywhere.
     *
     * Dropping the bill is the worse of the two mistakes: the money, the stock and the customer
     * balance all disappear while the totals still look plausible. A derived number keeps the
     * document, is unique against the source's own row identity, announces itself as a migration
     * artifact on the bills screen, and is listed for the operator to rename.
     */
    public function derivedDocumentNumber(array $row, string $prefix): ?string
    {
        $handle = $this->text($row, ['external_id', 'uuid', 'guid'])
            ?? $this->text($row, ['id', 'row_id']);
        if ($handle === null) {
            return null;
        }

        $handle = preg_replace('/[^0-9A-Za-z]/', '', $handle) ?? '';
        if ($handle === '') {
            return null;
        }

        // The tail of a uuid distinguishes two rows; the whole of a numeric id does the same job.
        return $prefix . '-' . strtoupper(substr($handle, -12));
    }

    /**
     * v2 keeps one status vocabulary per document; the legacy panels wrote several words for
     * the same state ('posted', 'done', 'received'). Anything that is neither a void nor a
     * draft lands on the caller's open state, because a status this schema does not know
     * would drop the document out of every report silently.
     */
    public function status(array $row, string $openState = 'issued'): string
    {
        $stated = strtolower(trim((string) ($this->raw($row, ['status', 'document_status', 'state']) ?? '')));

        if (in_array($stated, ['cancelled', 'canceled', 'void', 'voided'], true)) {
            return 'cancelled';
        }

        if (in_array($stated, ['draft', 'held', 'pending', 'quote', 'quotation'], true)) {
            return 'draft';
        }

        return $openState;
    }

    public function number(array $row, array $keys, float $default = 0.0): float
    {
        $v = $this->raw($row, $keys);
        if ($v === null) {
            return $default;
        }
        if (is_bool($v)) {
            return $v ? 1.0 : 0.0;
        }

        $s = trim((string) $v);
        // A ledger writes a reversal as (1,234.00); reading it as 1234 would flip a return
        // into a sale, which is the one mistake this layer cannot afford.
        $bracketed = str_starts_with($s, '(') && str_ends_with($s, ')');
        if ($bracketed) {
            $s = trim($s, '()');
        }
        $s = preg_replace('/[^0-9.\-]/', '', $s) ?? '';

        if ($s === '' || $s === '-' || $s === '.' || $s === '-.') {
            return $default;
        }

        $n = (float) $s;

        return $bracketed ? -$n : $n;
    }

    public function text(array $row, array $keys): ?string
    {
        $v = $this->raw($row, $keys);
        if ($v === null) {
            return null;
        }
        $s = trim(preg_replace('/\s+/u', ' ', (string) $v) ?? '');

        return $s === '' ? null : $s;
    }

    /**
     * A calendar day as this schema stores it. Unparseable stays null rather than becoming
     * 1970-01-01, because a document dated to the epoch is harder to notice than one with no
     * date at all. Legacy dates arrive day-first; a value that can only be month-first is read
     * that way rather than rejected.
     */
    public function day(array $row, array $keys): ?string
    {
        $v = $this->raw($row, $keys);
        if ($v === null) {
            return null;
        }

        $s = trim((string) $v);

        if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})/', $s, $m)) {
            return sprintf('%04d-%02d-%02d', (int) $m[1], (int) $m[2], (int) $m[3]);
        }

        if (preg_match('#^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})#', $s, $m)) {
            $a = (int) $m[1];
            $b = (int) $m[2];
            $year = (int) $m[3];
            if ($b > 12 && $a <= 12) {
                [$a, $b] = [$b, $a];
            }
            if ($a < 1 || $a > 31 || $b < 1 || $b > 12) {
                return null;
            }

            return sprintf('%04d-%02d-%02d', $year, $b, $a);
        }

        $ts = strtotime($s);

        return $ts === false ? null : date('Y-m-d', $ts);
    }

    /**
     * A two-digit GST state code, or null. A state *name* is not a code, and guessing one
     * would move tax between CGST and IGST; the caller falls back to the store's own code.
     */
    public function stateCode(array $row, array $keys): ?string
    {
        $v = $this->text($row, $keys);
        if ($v === null) {
            return null;
        }
        if (preg_match('/\d{2}/', $v, $m)) {
            return $m[0];
        }

        return null;
    }

    /**
     * The line rows of a document, wherever the source put them. A legacy bill has arrived
     * with its lines under `invoice_items` and under `lines` as well as `items`.
     */
    public function lineRows(array $row): array
    {
        foreach (['items', 'invoice_items', 'purchase_items', 'lines', 'products'] as $key) {
            if (isset($row[$key]) && is_array($row[$key])) {
                return $row[$key];
            }
        }

        return [];
    }

    /**
     * A name carried inside a nested party object rather than flattened onto the document.
     */
    private function nestedName(array $row, array $keys): ?string
    {
        foreach ($keys as $key) {
            if (isset($row[$key]) && is_array($row[$key])) {
                $name = $this->text($row[$key], ['name', 'party_name', 'title']);
                if ($name !== null) {
                    return $name;
                }
            }
        }

        return null;
    }

    /**
     * The first key present with a usable value, so callers can keep the raw id fields
     * (which this layer must not cast) out of the way.
     */
    public function raw(array $row, array $keys): mixed
    {
        foreach ($keys as $k) {
            if (!array_key_exists($k, $row)) {
                continue;
            }
            $v = $row[$k];
            // A nested object is not a scalar waiting to be cast: reaching for it through
            // this method would stringify it as "Array" and store that as a name.
            if ($v === null || $v === '' || is_array($v) || (is_string($v) && trim($v) === '')) {
                continue;
            }

            return $v;
        }

        return null;
    }

    /**
     * Whether the source priced bills with tax already inside the displayed rate. Legacy
     * panels say this at least four ways — an 'inclusive'/'exclusive' word, a 0/1 flag, a
     * yes/no, or a separate `mrp_inclusive` column — and reading it backwards re-derives every
     * price in the store while leaving the rupee totals matching, so it is the one setting a
     * reconciliation report cannot catch on its own.
     */
    public function taxMode(array $row): ?string
    {
        foreach (self::TAX_MODE_KEYS as $key) {
            if (!array_key_exists($key, $row)) {
                continue;
            }
            $v = $row[$key];
            if ($v === null || $v === '') {
                continue;
            }
            if (is_bool($v)) {
                return $v ? 'inclusive' : 'exclusive';
            }
            if (is_numeric($v)) {
                return (float) $v > 0.0 ? 'inclusive' : 'exclusive';
            }
            $s = strtolower(trim((string) $v));
            if (in_array($s, ['inclusive', 'incl', 'inclusive_of_tax', 'tax_inclusive', 'mrp_inclusive', 'yes', 'y', 'true', '1'], true)) {
                return 'inclusive';
            }
            if (in_array($s, ['exclusive', 'excl', 'exclusive_of_tax', 'plus_tax', 'add_tax', 'no', 'n', 'false', '0'], true)) {
                return 'exclusive';
            }
        }

        return null;
    }

    public const SETTINGS_LIST_KEYS = ['company_settings', 'store_settings', 'settings'];

    /**
     * The source's settings as one flat bag of fields.
     *
     * A v2 bundle exports settings as `{key, value}` rows; the legacy panel answers with a single
     * flat object whose operator choices sit inside nested sections. Reading only the row shape
     * found nothing in the flat one, which is how a store that priced exclusive of tax ended up
     * inheriting the inclusive default.
     *
     * @return array<string, mixed>
     */
    public function settingsFields(array $sourceData): array
    {
        $bag = [];

        foreach (self::SETTINGS_LIST_KEYS as $entity) {
            $rows = $sourceData[$entity] ?? null;
            if (!is_array($rows)) {
                continue;
            }

            foreach ($rows as $key => $value) {
                $isRow = is_array($value) && (isset($value['key']) || isset($value['setting_key']));
                if (!$isRow) {
                    if (is_string($key)) {
                        $bag[$key] = $value;
                    }
                    continue;
                }

                $name = (string) ($value['key'] ?? $value['setting_key']);
                $stated = $value['value'] ?? null;
                if ($name === '') {
                    continue;
                }
                // A billing blob belongs at the top of the bag: that is where the mode lives.
                $bag = is_array($stated) ? array_merge($bag, $stated) : array_merge($bag, [$name => $stated]);
            }
        }

        return $bag;
    }

    /**
     * The billing mode as a settings payload states it, wherever in that payload the switch sits.
     *
     * The legacy panel answers with one flat settings object — not v2's list of `{key, value}`
     * rows — and keeps operator choices inside nested sections (`company_preferences.taxation`)
     * whose values are strings, '1' and '0' rather than booleans. Searching one level down is
     * what turns "the source does not state its tax mode" into a real answer.
     */
    public function settingsTaxMode(array $settings): ?string
    {
        $direct = $this->taxMode($settings);
        if ($direct !== null) {
            return $direct;
        }

        foreach ($settings as $value) {
            if (is_array($value)) {
                $nested = $this->taxMode($value);
                if ($nested !== null) {
                    return $nested;
                }
            }
        }

        return null;
    }

    /**
     * A reference to another record, wherever the source put it: a flat `customer_id`, or the
     * `id` of a party object embedded in the row. A value that is neither numeric nor clearly
     * an id stays null — a product name read as an id would look up the identity map, miss, and
     * silently unlink the line from its stock.
     */
    public function idRef(array $row, array $keys): int|string|null
    {
        foreach ($keys as $key) {
            if (!array_key_exists($key, $row)) {
                continue;
            }
            $v = $row[$key];
            if (is_array($v)) {
                $v = $v['id'] ?? null;
                if (!is_scalar($v) || $v === '' || is_bool($v)) {
                    continue;
                }

                return is_numeric($v) ? (int) $v : trim((string) $v);
            }
            if (!is_scalar($v) || $v === '' || is_bool($v)) {
                continue;
            }
            if (is_numeric($v)) {
                return (int) $v;
            }
            $s = trim((string) $v);
            if (str_ends_with($key, '_id') || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $s)) {
                return $s;
            }
        }

        return null;
    }

    /**
     * v2 stores a credit or debit note with positive figures and applies the sign where it
     * is read — the same convention the reports and the accounting export use. A note that
     * arrived negative is therefore normalised to magnitude, never stored as a negative bill.
     */
    private function magnitude(float $value, bool $isNote): float
    {
        return $isNote ? abs($value) : $value;
    }
}
