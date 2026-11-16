<?php

namespace App\Http\Controllers\Api;

use App\Models\Expense;
use App\Models\Invoice;
use App\Models\MasterLookup;
use App\Models\Party;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;

class AdminAccountingExportController
{
    /**
     * Supported export types and the formats each one can produce.
     */
    private const FORMATS = [
        'sales' => ['tally', 'busy', 'csv'],
        'purchases' => ['tally', 'busy', 'csv'],
        'customers' => ['tally', 'csv'],
        'suppliers' => ['tally', 'csv'],
        'products' => ['tally', 'csv'],
        'gst-summary' => ['csv'],
        'daybook' => ['csv'],
        'party-statement' => ['csv'],
    ];

    private const LABELS = [
        'sales' => 'Sales & credit notes',
        'purchases' => 'Purchase bills',
        'customers' => 'Customer masters (Sundry Debtors)',
        'suppliers' => 'Supplier masters (Sundry Creditors)',
        'products' => 'Item masters & stock items',
        'gst-summary' => 'GST tax summary (HSN / rate)',
        'daybook' => 'Day book (sales + purchases + expenses)',
        'party-statement' => 'Party ledger statement',
    ];

    public function catalog(Request $request): JsonResponse
    {
        $types = [];
        foreach (self::FORMATS as $type => $formats) {
            $types[] = [
                'type' => $type,
                'label' => self::LABELS[$type],
                'formats' => $formats,
                'requires_party' => $type === 'party-statement',
            ];
        }

        return response()->json([
            'success' => true,
            'store_scope' => $request->attributes->get('store_scope_all') ? 'all' : 'single',
            'date_defaults' => [
                'from' => Carbon::today()->startOfMonth()->toDateString(),
                'to' => Carbon::today()->toDateString(),
            ],
            'types' => $types,
        ]);
    }

    public function parties(Request $request): JsonResponse
    {
        $storeIds = $this->storeIds($request);

        $parties = Party::with('store:id,name')
            ->whereIn('type', ['customer', 'supplier'])
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->orderBy('name')
            ->get(['id', 'store_id', 'type', 'name', 'phone', 'gstin']);

        return response()->json([
            'success' => true,
            'parties' => $parties->map(fn (Party $party) => [
                'id' => $party->id,
                'type' => $party->type,
                'name' => $party->name,
                'phone' => $party->phone,
                'gstin' => $party->gstin,
                'store' => $party->store?->name,
            ])->values(),
        ]);
    }

    public function download(Request $request, string $type, string $format): Response|JsonResponse
    {
        $type = strtolower($type);
        $format = strtolower($format);

        if (!array_key_exists($type, self::FORMATS)) {
            return response()->json(['success' => false, 'message' => 'Unknown export type.'], 404);
        }
        if (!in_array($format, self::FORMATS[$type], true)) {
            return response()->json([
                'success' => false,
                'message' => "Format '{$format}' is not available for '{$type}'. Supported: " . implode(', ', self::FORMATS[$type]),
            ], 422);
        }

        $validated = $request->validate([
            'from' => 'nullable|date_format:Y-m-d',
            'to' => 'nullable|date_format:Y-m-d',
            'party_id' => 'nullable|integer',
        ]);

        $from = $validated['from'] ?? Carbon::today()->startOfMonth()->toDateString();
        $to = $validated['to'] ?? Carbon::today()->toDateString();
        if ($from > $to) {
            return response()->json(['success' => false, 'message' => 'The from date must be before the to date.'], 422);
        }

        $storeIds = $this->storeIds($request);
        $company = $this->companyName($storeIds);
        $stamp = $from === $to ? $from : "{$from}_to_{$to}";

        return match (true) {
            $type === 'sales' && $format === 'tally' => $this->xmlResponse(
                "sales-tally-{$stamp}.xml",
                $this->tallySales($storeIds, $company, $from, $to)
            ),
            $type === 'sales' && $format === 'busy' => $this->xmlResponse(
                "sales-busy-{$stamp}.xml",
                $this->busyVouchers($storeIds, $company, $from, $to, 'sales')
            ),
            $type === 'sales' => $this->csvResponse(
                "sales-{$stamp}.csv",
                ...$this->salesCsv($storeIds, $from, $to)
            ),

            $type === 'purchases' && $format === 'tally' => $this->xmlResponse(
                "purchases-tally-{$stamp}.xml",
                $this->tallyPurchases($storeIds, $company, $from, $to)
            ),
            $type === 'purchases' && $format === 'busy' => $this->xmlResponse(
                "purchases-busy-{$stamp}.xml",
                $this->busyVouchers($storeIds, $company, $from, $to, 'purchases')
            ),
            $type === 'purchases' => $this->csvResponse(
                "purchases-{$stamp}.csv",
                ...$this->purchasesCsv($storeIds, $from, $to)
            ),

            $type === 'customers' && $format === 'tally' => $this->xmlResponse(
                "customers-tally-{$stamp}.xml",
                $this->tallyPartyMasters($storeIds, $company, 'customer')
            ),
            $type === 'customers' => $this->csvResponse(
                "customers-{$stamp}.csv",
                ...$this->partiesCsv($storeIds, 'customer')
            ),

            $type === 'suppliers' && $format === 'tally' => $this->xmlResponse(
                "suppliers-tally-{$stamp}.xml",
                $this->tallyPartyMasters($storeIds, $company, 'supplier')
            ),
            $type === 'suppliers' => $this->csvResponse(
                "suppliers-{$stamp}.csv",
                ...$this->partiesCsv($storeIds, 'supplier')
            ),

            $type === 'products' && $format === 'tally' => $this->xmlResponse(
                "products-tally-{$stamp}.xml",
                $this->tallyStockItems($storeIds, $company)
            ),
            $type === 'products' => $this->csvResponse(
                "products-{$stamp}.csv",
                ...$this->productsCsv($storeIds)
            ),

            $type === 'gst-summary' => $this->csvResponse(
                "gst-summary-{$stamp}.csv",
                ...$this->gstSummaryCsv($storeIds, $from, $to)
            ),
            $type === 'daybook' => $this->csvResponse(
                "daybook-{$stamp}.csv",
                ...$this->daybookCsv($storeIds, $from, $to)
            ),
            $type === 'party-statement' => $this->partyStatementCsv($request, $storeIds, $from, $to, $stamp),
        };
    }

    /* ------------------------------------------------------------------ */
    /* Store scoping & helpers                                             */
    /* ------------------------------------------------------------------ */

    private function storeIds(Request $request): ?array
    {
        if ($request->attributes->get('store_scope_all')) {
            return null;
        }

        $candidate = $request->attributes->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? $request->user()?->store_id;

        if ($candidate !== null && $candidate !== '' && is_numeric($candidate)) {
            return [(int) $candidate];
        }

        return null;
    }

    private function companyName(?array $storeIds): string
    {
        $names = $storeIds
            ? Store::whereIn('id', $storeIds)->orderBy('id')->pluck('name')
            : Store::orderBy('id')->pluck('name');

        if ($names->isEmpty()) {
            return 'Lamsuite';
        }

        return $names->count() === 1
            ? (string) $names->first()
            : 'Lamsuite Consolidated (' . $names->count() . ' stores)';
    }

    private function moneyText(mixed $value): string
    {
        return number_format((float) $value, 2, '.', '');
    }

    private function date(?Carbon $date, string $format = 'Y-m-d'): string
    {
        return $date ? $date->format($format) : '';
    }

    private function esc(mixed $value): string
    {
        $text = preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}]/u', '', (string) ($value ?? ''));

        return htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }

    private function qty(float $units): string
    {
        return rtrim(rtrim(number_format($units, 2, '.', ''), '0'), '.');
    }

    private function xmlResponse(string $filename, string $content): Response
    {
        return response("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" . $content, 200, [
            'Content-Type' => 'application/xml; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-store',
        ]);
    }

    /**
     * @param  array<int, string>  $headers
     * @param  iterable<int, array<int, mixed>>  $rows
     */
    private function csvResponse(string $filename, array $headers, iterable $rows): Response
    {
        $handle = fopen('php://temp', 'r+');
        fwrite($handle, "\xEF\xBB\xBF");
        if ($headers !== []) {
            fputcsv($handle, $headers);
        }
        foreach ($rows as $row) {
            fputcsv($handle, array_map(function ($value) {
                if (is_bool($value)) {
                    return $value ? 'Yes' : 'No';
                }

                return $value === null ? '' : $value;
            }, $row));
        }
        rewind($handle);
        $content = (string) stream_get_contents($handle);
        fclose($handle);

        return response($content, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control' => 'no-store',
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* Queries                                                             */
    /* ------------------------------------------------------------------ */

    private function salesQuery(?array $storeIds, string $from, string $to)
    {
        return Invoice::query()
            ->with(['items', 'store:id,name', 'customer:id,name,gstin'])
            ->whereIn('module_key', ['invoice', 'credit_note'])
            ->where('status', '!=', 'cancelled')
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->orderBy('invoice_date')
            ->orderBy('id');
    }

    private function purchasesQuery(?array $storeIds, string $from, string $to)
    {
        return Purchase::query()
            ->with(['items', 'store:id,name', 'supplier:id,name,gstin'])
            ->where('status', '!=', 'cancelled')
            ->whereNotIn('module_key', ['purchase_order', 'order'])
            ->whereBetween('invoice_date', [$from, $to])
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->orderBy('invoice_date')
            ->orderBy('id');
    }

    /* ------------------------------------------------------------------ */
    /* CSV builders                                                        */
    /* ------------------------------------------------------------------ */

    private function salesCsv(?array $storeIds, string $from, string $to): array
    {
        $headers = [
            'Invoice No', 'Date', 'Document', 'Customer', 'GSTIN', 'Place Of Supply',
            'Gross Subtotal', 'Discount', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess',
            'Tax Total', 'Round Off', 'Grand Total', 'Paid', 'Balance', 'Payment Mode',
            'Payment Status', 'Status', 'Items', 'Store',
        ];

        $rows = [];
        foreach ($this->salesQuery($storeIds, $from, $to)->get() as $invoice) {
            $rows[] = [
                $invoice->invoice_number,
                $this->date($invoice->invoice_date),
                $invoice->module_key === 'credit_note' ? 'Credit Note' : 'Sales',
                $invoice->customer_name ?: ($invoice->customer?->name ?? 'Cash'),
                $invoice->customer_gstin ?: ($invoice->customer?->gstin ?? ''),
                $invoice->place_of_supply,
                $this->moneyText($invoice->subtotal),
                $this->moneyText($invoice->discount_total),
                $this->moneyText($invoice->taxable_subtotal),
                $this->moneyText($invoice->cgst_total),
                $this->moneyText($invoice->sgst_total),
                $this->moneyText($invoice->igst_total),
                $this->moneyText($invoice->cess_total),
                $this->moneyText($invoice->tax_total),
                $this->moneyText($invoice->round_off),
                $this->moneyText($invoice->grand_total),
                $this->moneyText($invoice->paid_amount),
                $this->moneyText((float) $invoice->grand_total - (float) $invoice->paid_amount),
                $invoice->payment_mode,
                $invoice->payment_status,
                $invoice->status,
                $invoice->items->count(),
                $invoice->store?->name,
            ];
        }

        return [$headers, $rows];
    }

    private function purchasesCsv(?array $storeIds, string $from, string $to): array
    {
        $headers = [
            'Bill No', 'Supplier Bill No', 'Date', 'Supplier', 'GSTIN', 'Subtotal', 'Tax',
            'CGST', 'SGST', 'IGST', 'Cess', 'Freight', 'Bill Discount', 'Round Off',
            'Grand Total', 'Paid', 'Balance', 'Interstate', 'RCM', 'ITC Eligibility',
            'Status', 'Items', 'Store',
        ];

        $rows = [];
        foreach ($this->purchasesQuery($storeIds, $from, $to)->get() as $purchase) {
            $rows[] = [
                $purchase->id,
                $purchase->invoice_number,
                $this->date($purchase->invoice_date),
                $purchase->supplier_name ?: ($purchase->supplier?->name ?? ''),
                $purchase->supplier_gstin ?: ($purchase->supplier?->gstin ?? ''),
                $this->moneyText($purchase->subtotal),
                $this->moneyText($purchase->tax_total),
                $this->moneyText($purchase->cgst_total),
                $this->moneyText($purchase->sgst_total),
                $this->moneyText($purchase->igst_total),
                $this->moneyText($purchase->cess_total),
                $this->moneyText($purchase->freight_charges),
                $this->moneyText($purchase->bill_discount),
                $this->moneyText($purchase->round_off),
                $this->moneyText($purchase->grand_total),
                $this->moneyText($purchase->paid_amount),
                $this->moneyText((float) $purchase->grand_total - (float) $purchase->paid_amount),
                (bool) $purchase->is_interstate,
                (bool) $purchase->is_rcm,
                $purchase->itc_eligibility,
                $purchase->status,
                $purchase->items->count(),
                $purchase->store?->name,
            ];
        }

        return [$headers, $rows];
    }

    private function partiesCsv(?array $storeIds, string $type): array
    {
        $headers = [
            'Name', 'Type', 'Phone', 'Email', 'GSTIN', 'PAN', 'State Code', 'Address',
            'Credit Limit', 'Opening Balance', 'Current Balance', 'Active', 'Store',
        ];

        $rows = [];
        $parties = Party::with('store:id,name')
            ->where('type', $type)
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->orderBy('name')
            ->get();

        foreach ($parties as $party) {
            $rows[] = [
                $party->name,
                $party->type,
                $party->phone,
                $party->email,
                $party->gstin,
                $party->pan,
                $party->state_code,
                $party->address,
                $this->moneyText($party->credit_limit),
                $this->moneyText($party->opening_balance),
                $this->moneyText($party->current_balance),
                (bool) $party->is_active,
                $party->store?->name,
            ];
        }

        return [$headers, $rows];
    }

    private function productsCsv(?array $storeIds): array
    {
        $headers = [
            'Name', 'Print Name', 'Barcode', 'HSN/SAC', 'Category', 'Brand', 'Manufacturer',
            'Unit', 'MRP', 'Selling Rate', 'PTR', 'PTS', 'GST %', 'Units Per Pack',
            'Allow Loose Sale', 'Current Stock', 'Reorder Level', 'Active', 'Store',
        ];

        $products = Product::with('store:id,name')
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->orderBy('name')
            ->get();

        $lookupIds = $products->pluck('category_id')
            ->merge($products->pluck('brand_id'))
            ->merge($products->pluck('manufacturer_id'))
            ->merge($products->pluck('unit_id'))
            ->filter()
            ->unique()
            ->values();

        $lookups = MasterLookup::whereIn('id', $lookupIds->all())->pluck('name', 'id');

        $rows = [];
        foreach ($products as $product) {
            $rows[] = [
                $product->name,
                $product->print_name,
                $product->barcode,
                $product->hsn_sac_code,
                $lookups[$product->category_id] ?? '',
                $lookups[$product->brand_id] ?? '',
                $lookups[$product->manufacturer_id] ?? '',
                $lookups[$product->unit_id] ?? '',
                $this->moneyText($product->mrp),
                $this->moneyText($product->sel_rate),
                $this->moneyText($product->ptr),
                $this->moneyText($product->pts),
                $this->moneyText($product->gst_percent),
                $product->units_per_pack,
                (bool) $product->allow_loose_sale,
                $this->moneyText($product->current_stock),
                $this->moneyText($product->reorder_level),
                (bool) $product->is_active,
                $product->store?->name,
            ];
        }

        return [$headers, $rows];
    }

    private function gstSummaryCsv(?array $storeIds, string $from, string $to): array
    {
        $headers = [
            'Source', 'HSN/SAC', 'GST %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess',
            'Tax Total', 'Invoice Total', 'Lines', 'Documents',
        ];

        $sales = $this->salesQuery($storeIds, $from, $to)->with('items')->get();
        $purchases = $this->purchasesQuery($storeIds, $from, $to)->with('items')->get();

        $buckets = [];
        $add = function (string $source, ?string $hsn, float $rate, float $taxable, float $cgst, float $sgst, float $igst, float $cess, float $total, int $docKey) use (&$buckets) {
            $key = $source . '|' . ($hsn ?: '--') . '|' . number_format($rate, 2, '.', '');
            if (!isset($buckets[$key])) {
                $buckets[$key] = [
                    'source' => $source,
                    'hsn' => $hsn ?: '',
                    'rate' => $rate,
                    'taxable' => 0.0,
                    'cgst' => 0.0,
                    'sgst' => 0.0,
                    'igst' => 0.0,
                    'cess' => 0.0,
                    'tax' => 0.0,
                    'total' => 0.0,
                    'lines' => 0,
                    'documents' => [],
                ];
            }
            $buckets[$key]['taxable'] += $taxable;
            $buckets[$key]['cgst'] += $cgst;
            $buckets[$key]['sgst'] += $sgst;
            $buckets[$key]['igst'] += $igst;
            $buckets[$key]['cess'] += $cess;
            $buckets[$key]['tax'] += $cgst + $sgst + $igst + $cess;
            $buckets[$key]['total'] += $total;
            $buckets[$key]['lines']++;
            $buckets[$key]['documents'][$docKey] = true;
        };

        $hsnByProduct = Product::whereIn(
            'id',
            $sales->flatMap(fn (Invoice $invoice) => $invoice->items->pluck('product_id'))->filter()->unique()->all()
        )->pluck('hsn_sac_code', 'id');

        foreach ($sales as $invoice) {
            $source = $invoice->module_key === 'credit_note' ? 'sales-return' : 'sales';
            $sign = $invoice->module_key === 'credit_note' ? -1 : 1;
            foreach ($invoice->items as $item) {
                $add(
                    $source,
                    $item->product_id ? ($hsnByProduct[$item->product_id] ?? null) : null,
                    (float) $item->gst_percent,
                    $sign * (float) $item->taxable_amount,
                    $sign * (float) $item->cgst_amount,
                    $sign * (float) $item->sgst_amount,
                    $sign * (float) $item->igst_amount,
                    $sign * (float) $item->cess_amount,
                    $sign * (float) $item->total_amount,
                    $invoice->id
                );
            }
        }

        foreach ($purchases as $purchase) {
            foreach ($purchase->items as $item) {
                $add(
                    'purchase',
                    $item->hsn_code,
                    (float) $item->gst_percent,
                    (float) $item->taxable_amount,
                    (float) $item->cgst_amount,
                    (float) $item->sgst_amount,
                    (float) $item->igst_amount,
                    (float) $item->cess_amount,
                    (float) $item->total_amount,
                    $purchase->id
                );
            }
        }

        ksort($buckets);

        $rows = [];
        foreach ($buckets as $bucket) {
            $rows[] = [
                $bucket['source'],
                $bucket['hsn'],
                $this->moneyText($bucket['rate']),
                $this->moneyText($bucket['taxable']),
                $this->moneyText($bucket['cgst']),
                $this->moneyText($bucket['sgst']),
                $this->moneyText($bucket['igst']),
                $this->moneyText($bucket['cess']),
                $this->moneyText($bucket['tax']),
                $this->moneyText($bucket['total']),
                $bucket['lines'],
                count($bucket['documents']),
            ];
        }

        return [$headers, $rows];
    }

    private function daybookCsv(?array $storeIds, string $from, string $to): array
    {
        $headers = [
            'Date', 'Voucher Type', 'Voucher No', 'Party', 'GSTIN', 'Taxable', 'Tax',
            'Total', 'Payment Mode', 'Status', 'Store',
        ];

        $rows = [];

        foreach ($this->salesQuery($storeIds, $from, $to)->get() as $invoice) {
            $rows[] = [
                'date' => $this->date($invoice->invoice_date),
                'type' => $invoice->module_key === 'credit_note' ? 'Credit Note' : 'Sales',
                'no' => $invoice->invoice_number,
                'party' => $invoice->customer_name ?: ($invoice->customer?->name ?? 'Cash'),
                'gstin' => $invoice->customer_gstin ?: ($invoice->customer?->gstin ?? ''),
                'taxable' => $this->moneyText($invoice->taxable_subtotal),
                'tax' => $this->moneyText($invoice->tax_total),
                'total' => $this->moneyText($invoice->grand_total),
                'mode' => $invoice->payment_mode,
                'status' => $invoice->status,
                'store' => $invoice->store?->name,
            ];
        }

        foreach ($this->purchasesQuery($storeIds, $from, $to)->get() as $purchase) {
            $rows[] = [
                'date' => $this->date($purchase->invoice_date),
                'type' => 'Purchase',
                'no' => $purchase->invoice_number,
                'party' => $purchase->supplier_name ?: ($purchase->supplier?->name ?? ''),
                'gstin' => $purchase->supplier_gstin ?: ($purchase->supplier?->gstin ?? ''),
                'taxable' => $this->moneyText($purchase->subtotal),
                'tax' => $this->moneyText($purchase->tax_total),
                'total' => $this->moneyText($purchase->grand_total),
                'mode' => '',
                'status' => $purchase->status,
                'store' => $purchase->store?->name,
            ];
        }

        $expenses = Expense::with('store:id,name')
            ->whereBetween('expense_date', [$from, $to])
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->get();

        foreach ($expenses as $expense) {
            $rows[] = [
                'date' => $this->date($expense->expense_date),
                'type' => 'Expense',
                'no' => $expense->expense_number,
                'party' => $expense->expense_head,
                'gstin' => '',
                'taxable' => '',
                'tax' => '',
                'total' => $this->moneyText($expense->amount),
                'mode' => $expense->payment_mode,
                'status' => 'posted',
                'store' => $expense->store?->name,
            ];
        }

        usort($rows, fn ($a, $b) => [$a['date'], $a['no']] <=> [$b['date'], $b['no']]);

        return [$headers, array_map('array_values', $rows)];
    }

    private function partyStatementCsv(Request $request, ?array $storeIds, string $from, string $to, string $stamp): Response|JsonResponse
    {
        $partyId = (int) $request->query('party_id', 0);
        if ($partyId <= 0) {
            return response()->json(['success' => false, 'message' => 'party_id is required for a party statement.'], 422);
        }

        $party = Party::with('store:id,name')
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->find($partyId);

        if (!$party) {
            return response()->json(['success' => false, 'message' => 'Party not found in the selected store scope.'], 404);
        }

        $rows = [];
        if ($party->type === 'supplier') {
            $documents = Purchase::with('store:id,name')
                ->where('supplier_id', $party->id)
                ->where('status', '!=', 'cancelled')
                ->whereNotIn('module_key', ['purchase_order', 'order'])
                ->whereBetween('invoice_date', [$from, $to])
                ->orderBy('invoice_date')
                ->get();
            foreach ($documents as $doc) {
                $rows[] = [
                    'date' => $this->date($doc->invoice_date),
                    'no' => (string) $doc->invoice_number,
                    'type' => 'Purchase',
                    'due' => '',
                    'total' => $this->moneyText($doc->grand_total),
                    'paid' => $this->moneyText($doc->paid_amount),
                    'delta' => $this->moneyText((float) $doc->grand_total - (float) $doc->paid_amount),
                    'status' => $doc->status,
                    'store' => $doc->store?->name,
                ];
            }
        } else {
            $documents = Invoice::with('store:id,name')
                ->where('customer_id', $party->id)
                ->where('status', '!=', 'cancelled')
                ->whereBetween('invoice_date', [$from, $to])
                ->orderBy('invoice_date')
                ->get();
            foreach ($documents as $doc) {
                $sign = $doc->module_key === 'credit_note' ? -1 : 1;
                $rows[] = [
                    'date' => $this->date($doc->invoice_date),
                    'no' => (string) $doc->invoice_number,
                    'type' => $doc->module_key === 'credit_note' ? 'Credit Note' : 'Sales',
                    'due' => $this->date($doc->due_date),
                    'total' => $this->moneyText($sign * (float) $doc->grand_total),
                    'paid' => $this->moneyText($sign * (float) $doc->paid_amount),
                    'delta' => $this->moneyText($sign * ((float) $doc->grand_total - (float) $doc->paid_amount)),
                    'status' => $doc->status,
                    'store' => $doc->store?->name,
                ];
            }
        }

        $running = (float) $party->opening_balance;

        $final = [];
        $final[] = ['Party', $party->name, 'GSTIN', (string) $party->gstin, 'Opening Balance', $this->moneyText($running)];
        $final[] = ['Date', 'Voucher No', 'Type', 'Due Date', 'Total', 'Paid', 'Balance Delta', 'Running Balance', 'Status', 'Store'];
        foreach ($rows as $row) {
            $running += (float) $row['delta'];
            $final[] = [
                $row['date'], $row['no'], $row['type'], $row['due'],
                $row['total'], $row['paid'], $row['delta'], $this->moneyText($running),
                $row['status'], $row['store'],
            ];
        }
        $final[] = ['Closing Balance', '', '', '', '', '', '', $this->moneyText($running), '', ''];

        return $this->csvResponse("party-statement-{$party->id}-{$stamp}.csv", [], $final);
    }

    /* ------------------------------------------------------------------ */
    /* Tally XML builders                                                  */
    /* ------------------------------------------------------------------ */

    private function tallyEnvelope(string $company, string $reportName, string $body): string
    {
        return "<ENVELOPE>\n"
            . " <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n"
            . " <BODY>\n  <IMPORTDATA>\n"
            . '   <REQUESTDESC><REPORTNAME>' . $this->esc($reportName) . '</REPORTNAME>'
            . '<STATICVARIABLES><SVCURRENTCOMPANY>' . $this->esc($company) . '</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>'
            . "\n   <REQUESTDATA>\n"
            . $body
            . "\n   </REQUESTDATA>\n"
            . "  </IMPORTDATA>\n </BODY>\n</ENVELOPE>\n";
    }

    private function tallySales(?array $storeIds, string $company, string $from, string $to): string
    {
        $body = '';
        foreach ($this->salesQuery($storeIds, $from, $to)->get() as $invoice) {
            $isReturn = $invoice->module_key === 'credit_note';
            $sign = $isReturn ? -1 : 1;
            $voucherType = $isReturn ? 'Credit Note' : 'Sales';
            $party = $invoice->customer_name ?: ($invoice->customer?->name ?? 'Cash');

            $ledgers = '';
            $ledgers .= $this->tallyLedger($party, -1 * $sign * (float) $invoice->grand_total);
            $ledgers .= $this->tallyLedger('Sales', $sign * (float) $invoice->taxable_subtotal);
            $ledgers .= $this->tallyLedger('CGST', $sign * (float) $invoice->cgst_total);
            $ledgers .= $this->tallyLedger('SGST', $sign * (float) $invoice->sgst_total);
            $ledgers .= $this->tallyLedger('IGST', $sign * (float) $invoice->igst_total);
            $ledgers .= $this->tallyLedger('Cess', $sign * (float) $invoice->cess_total);
            $ledgers .= $this->tallyLedger('Round Off', $sign * (float) $invoice->round_off);

            $inventory = '';
            foreach ($invoice->items as $item) {
                $units = (float) $item->qty * max(1, (int) $item->units_per_pack) + (float) $item->loose_qty;
                $inventory .= $this->tallyInventoryEntry(
                    (string) $item->product_name,
                    $sign * $units,
                    (float) $item->taxable_amount,
                    (float) $item->unit_price
                );
            }

            $body .= $this->tallyVoucher([
                'type' => $voucherType,
                'number' => (string) $invoice->invoice_number,
                'date' => $this->date($invoice->invoice_date, 'Ymd'),
                'party' => $party,
                'partyGstin' => (string) ($invoice->customer_gstin ?: $invoice->customer?->gstin),
                'placeOfSupply' => (string) $invoice->place_of_supply,
                'narration' => $isReturn ? 'Credit note against ' . ($invoice->original_invoice_number ?? '') : 'Sales invoice',
                'ledgers' => $ledgers,
                'inventory' => $inventory,
            ]);
        }

        return $this->tallyEnvelope($company, 'Vouchers', $body);
    }

    private function tallyPurchases(?array $storeIds, string $company, string $from, string $to): string
    {
        $body = '';
        foreach ($this->purchasesQuery($storeIds, $from, $to)->get() as $purchase) {
            $party = $purchase->supplier_name ?: ($purchase->supplier?->name ?? 'Supplier');
            $taxable = (float) $purchase->subtotal - (float) $purchase->bill_discount;

            $ledgers = '';
            $ledgers .= $this->tallyLedger($party, (float) $purchase->grand_total);
            $ledgers .= $this->tallyLedger('Purchase', -1 * $taxable);
            $ledgers .= $this->tallyLedger('CGST (Input)', -1 * (float) $purchase->cgst_total);
            $ledgers .= $this->tallyLedger('SGST (Input)', -1 * (float) $purchase->sgst_total);
            $ledgers .= $this->tallyLedger('IGST (Input)', -1 * (float) $purchase->igst_total);
            $ledgers .= $this->tallyLedger('Cess (Input)', -1 * (float) $purchase->cess_total);
            $ledgers .= $this->tallyLedger('Freight Charges', -1 * (float) $purchase->freight_charges);
            $ledgers .= $this->tallyLedger('Round Off', -1 * (float) $purchase->round_off);

            $inventory = '';
            foreach ($purchase->items as $item) {
                $units = (float) $item->qty * max(1, (int) $item->units_per_pack) + (float) $item->loose_qty;
                $inventory .= $this->tallyInventoryEntry(
                    (string) $item->product_name,
                    $units,
                    (float) $item->taxable_amount,
                    (float) $item->purchase_rate
                );
            }

            $body .= $this->tallyVoucher([
                'type' => 'Purchase',
                'number' => (string) $purchase->invoice_number,
                'date' => $this->date($purchase->invoice_date, 'Ymd'),
                'party' => $party,
                'partyGstin' => (string) ($purchase->supplier_gstin ?: $purchase->supplier?->gstin),
                'placeOfSupply' => '',
                'narration' => 'Purchase bill',
                'ledgers' => $ledgers,
                'inventory' => $inventory,
            ]);
        }

        return $this->tallyEnvelope($company, 'Vouchers', $body);
    }

    private function tallyLedger(string $name, float $amount): string
    {
        if (abs($amount) < 0.005) {
            return '';
        }

        return '<ALLLEDGERENTRIES.LIST>'
            . '<LEDGERNAME>' . $this->esc($name) . '</LEDGERNAME>'
            . '<ISDEEMEDPOSITIVE>' . ($amount < 0 ? 'Yes' : 'No') . '</ISDEEMEDPOSITIVE>'
            . '<AMOUNT>' . $this->moneyText($amount) . '</AMOUNT>'
            . '</ALLLEDGERENTRIES.LIST>';
    }

    private function tallyInventoryEntry(string $item, float $units, float $amount, float $rate): string
    {
        if ($units === 0.0) {
            return '';
        }

        return '<INVENTORYENTRIES.LIST>'
            . '<STOCKITEMNAME>' . $this->esc($item) . '</STOCKITEMNAME>'
            . '<ISDEEMEDPOSITIVE>' . ($units < 0 ? 'Yes' : 'No') . '</ISDEEMEDPOSITIVE>'
            . '<RATE>' . $this->moneyText($rate) . '/Nos</RATE>'
            . '<AMOUNT>' . $this->moneyText($amount) . '</AMOUNT>'
            . '<ACTUALQTY>' . $this->qty(abs($units)) . ' Nos</ACTUALQTY>'
            . '<BILLEDQTY>' . $this->qty(abs($units)) . ' Nos</BILLEDQTY>'
            . '</INVENTORYENTRIES.LIST>';
    }

    /**
     * @param  array{type:string,number:string,date:string,party:string,partyGstin:string,placeOfSupply:string,narration:string,ledgers:string,inventory:string}  $voucher
     */
    private function tallyVoucher(array $voucher): string
    {
        return '<TALLYMESSAGE xmlns:UDF="TallyUDF">'
            . '<VOUCHER VCHTYPE="' . $this->esc($voucher['type']) . '" ACTION="Create" OBJVIEW="Accounting Voucher View">'
            . '<DATE>' . $this->esc($voucher['date']) . '</DATE>'
            . '<VOUCHERTYPENAME>' . $this->esc($voucher['type']) . '</VOUCHERTYPENAME>'
            . '<VOUCHERNUMBER>' . $this->esc($voucher['number']) . '</VOUCHERNUMBER>'
            . '<REFERENCE>' . $this->esc($voucher['number']) . '</REFERENCE>'
            . '<PARTYLEDGERNAME>' . $this->esc($voucher['party']) . '</PARTYLEDGERNAME>'
            . ($voucher['partyGstin'] !== '' ? '<PARTYGSTIN>' . $this->esc($voucher['partyGstin']) . '</PARTYGSTIN>' : '')
            . ($voucher['placeOfSupply'] !== '' ? '<PLACEOFSUPPLY>' . $this->esc($voucher['placeOfSupply']) . '</PLACEOFSUPPLY>' : '')
            . '<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>'
            . '<ISINVOICE>Yes</ISINVOICE>'
            . '<NARRATION>' . $this->esc($voucher['narration']) . '</NARRATION>'
            . $voucher['ledgers']
            . $voucher['inventory']
            . '</VOUCHER>'
            . '</TALLYMESSAGE>';
    }

    private function tallyPartyMasters(?array $storeIds, string $company, string $type): string
    {
        $parent = $type === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors';
        $sign = $type === 'supplier' ? -1 : 1;

        $body = '';
        $parties = Party::where('type', $type)
            ->when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->orderBy('name')
            ->get();

        foreach ($parties as $party) {
            $body .= '<TALLYMESSAGE xmlns:UDF="TallyUDF">'
                . '<LEDGER NAME="' . $this->esc($party->name) . '" ACTION="Create">'
                . '<PARENT>' . $parent . '</PARENT>'
                . '<ISBILLWISEON>Yes</ISBILLWISEON>'
                . '<OPENINGBALANCE>' . $this->moneyText($sign * (float) $party->opening_balance) . '</OPENINGBALANCE>'
                . '<ISACTIVE>' . ($party->is_active ? 'Yes' : 'No') . '</ISACTIVE>'
                . ($party->gstin ? '<GSTIN>' . $this->esc($party->gstin) . '</GSTIN><PARTYGSTIN>' . $this->esc($party->gstin) . '</PARTYGSTIN>' : '')
                . ($party->pan ? '<INCOMETAXNUMBER>' . $this->esc($party->pan) . '</INCOMETAXNUMBER>' : '')
                . ($party->phone ? '<PHONENUMBER>' . $this->esc($party->phone) . '</PHONENUMBER>' : '')
                . ($party->email ? '<EMAIL>' . $this->esc($party->email) . '</EMAIL>' : '')
                . ($party->address ? '<ADDRESS.LIST><ADDRESS>' . $this->esc($party->address) . '</ADDRESS></ADDRESS.LIST>' : '')
                . '</LEDGER></TALLYMESSAGE>';
        }

        return $this->tallyEnvelope($company, 'All Masters', $body);
    }

    private function tallyStockItems(?array $storeIds, string $company): string
    {
        $products = Product::when($storeIds, fn ($q) => $q->whereIn('store_id', $storeIds))
            ->orderBy('name')
            ->get();

        $unitIds = $products->pluck('unit_id')->filter()->unique()->values();
        $units = MasterLookup::whereIn('id', $unitIds->all())->pluck('name', 'id');

        $body = '';
        foreach ($products as $product) {
            $unit = $product->unit_id ? ($units[$product->unit_id] ?? 'Nos') : 'Nos';
            $rate = (float) ($product->sel_rate ?: $product->mrp);
            $stock = (float) $product->current_stock;

            $body .= '<TALLYMESSAGE xmlns:UDF="TallyUDF">'
                . '<STOCKITEM NAME="' . $this->esc($product->name) . '" ACTION="Create">'
                . '<PARENT>Primary</PARENT>'
                . '<BASEUNITS>' . $this->esc($unit) . '</BASEUNITS>'
                . ((int) $product->units_per_pack > 1 ? '<ADDITIONALUNITS>Pack</ADDITIONALUNITS>' : '')
                . '<GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>'
                . '<GSTAPPLICABLE>GST ' . $this->moneyText($product->gst_percent) . '%</GSTAPPLICABLE>'
                . ($product->hsn_sac_code ? '<HSNCODE>' . $this->esc($product->hsn_sac_code) . '</HSNCODE>' : '')
                . ($product->barcode ? '<ALTERID>' . $this->esc($product->barcode) . '</ALTERID>' : '')
                . '<ISBATCHWISEON>Yes</ISBATCHWISEON>'
                . '<OPENINGBALANCE>' . $this->qty($stock) . ' ' . $this->esc($unit) . '</OPENINGBALANCE>'
                . '<OPENINGRATE>' . $this->moneyText($rate) . '/' . $this->esc($unit) . '</OPENINGRATE>'
                . '<OPENINGVALUE>' . $this->moneyText($stock * $rate) . '</OPENINGVALUE>'
                . '</STOCKITEM></TALLYMESSAGE>';
        }

        return $this->tallyEnvelope($company, 'All Masters', $body);
    }

    /* ------------------------------------------------------------------ */
    /* Busy XML builders                                                   */
    /* ------------------------------------------------------------------ */

    private function busyVouchers(?array $storeIds, string $company, string $from, string $to, string $kind): string
    {
        $xml = '<BusyData>'
            . '<CompanyName>' . $this->esc($company) . '</CompanyName>'
            . '<ExportType>' . ($kind === 'sales' ? 'Sales' : 'Purchase') . '</ExportType>'
            . '<DateFrom>' . $this->esc($from) . '</DateFrom>'
            . '<DateTo>' . $this->esc($to) . '</DateTo>'
            . '<Vouchers>';

        if ($kind === 'sales') {
            foreach ($this->salesQuery($storeIds, $from, $to)->get() as $invoice) {
                $isReturn = $invoice->module_key === 'credit_note';
                $xml .= '<Voucher VchType="' . ($isReturn ? 'CreditNote' : 'Sale') . '">'
                    . '<VchNo>' . $this->esc($invoice->invoice_number) . '</VchNo>'
                    . '<Date>' . $this->esc($this->date($invoice->invoice_date)) . '</Date>'
                    . '<PartyName>' . $this->esc($invoice->customer_name ?: ($invoice->customer?->name ?? 'Cash')) . '</PartyName>'
                    . '<PartyGSTIN>' . $this->esc($invoice->customer_gstin ?: $invoice->customer?->gstin) . '</PartyGSTIN>'
                    . '<PlaceOfSupply>' . $this->esc($invoice->place_of_supply) . '</PlaceOfSupply>'
                    . '<LedgerEntries>'
                    . $this->busyLedger('Sales', (float) $invoice->taxable_subtotal, $isReturn ? 'Dr' : 'Cr')
                    . $this->busyLedger('CGST', (float) $invoice->cgst_total, $isReturn ? 'Dr' : 'Cr')
                    . $this->busyLedger('SGST', (float) $invoice->sgst_total, $isReturn ? 'Dr' : 'Cr')
                    . $this->busyLedger('IGST', (float) $invoice->igst_total, $isReturn ? 'Dr' : 'Cr')
                    . $this->busyLedger('Cess', (float) $invoice->cess_total, $isReturn ? 'Dr' : 'Cr')
                    . $this->busyLedger('Round Off', (float) $invoice->round_off, (float) $invoice->round_off >= 0 ? 'Cr' : 'Dr')
                    . '</LedgerEntries>'
                    . '<Items>';
                foreach ($invoice->items as $item) {
                    $units = (float) $item->qty * max(1, (int) $item->units_per_pack) + (float) $item->loose_qty;
                    $xml .= '<Item Name="' . $this->esc($item->product_name) . '"'
                        . ' Qty="' . $this->qty($units) . '" Unit="Nos"'
                        . ' Rate="' . $this->moneyText($item->unit_price) . '"'
                        . ' Amount="' . $this->moneyText($item->total_amount) . '"'
                        . ' GSTPercent="' . $this->moneyText($item->gst_percent) . '"/>';
                }
                $xml .= '</Items>'
                    . '<Totals Taxable="' . $this->moneyText($invoice->taxable_subtotal) . '"'
                    . ' Tax="' . $this->moneyText($invoice->tax_total) . '"'
                    . ' RoundOff="' . $this->moneyText($invoice->round_off) . '"'
                    . ' GrandTotal="' . $this->moneyText($invoice->grand_total) . '"/>'
                    . '</Voucher>';
            }
        } else {
            foreach ($this->purchasesQuery($storeIds, $from, $to)->get() as $purchase) {
                $xml .= '<Voucher VchType="Purchase">'
                    . '<VchNo>' . $this->esc($purchase->invoice_number) . '</VchNo>'
                    . '<Date>' . $this->esc($this->date($purchase->invoice_date)) . '</Date>'
                    . '<PartyName>' . $this->esc($purchase->supplier_name ?: ($purchase->supplier?->name ?? '')) . '</PartyName>'
                    . '<PartyGSTIN>' . $this->esc($purchase->supplier_gstin ?: $purchase->supplier?->gstin) . '</PartyGSTIN>'
                    . '<LedgerEntries>'
                    . $this->busyLedger('Purchase', (float) $purchase->subtotal - (float) $purchase->bill_discount, 'Dr')
                    . $this->busyLedger('CGST (Input)', (float) $purchase->cgst_total, 'Dr')
                    . $this->busyLedger('SGST (Input)', (float) $purchase->sgst_total, 'Dr')
                    . $this->busyLedger('IGST (Input)', (float) $purchase->igst_total, 'Dr')
                    . $this->busyLedger('Cess (Input)', (float) $purchase->cess_total, 'Dr')
                    . $this->busyLedger('Freight Charges', (float) $purchase->freight_charges, 'Dr')
                    . $this->busyLedger('Round Off', (float) $purchase->round_off, (float) $purchase->round_off >= 0 ? 'Dr' : 'Cr')
                    . '</LedgerEntries>'
                    . '<Items>';
                foreach ($purchase->items as $item) {
                    $units = (float) $item->qty * max(1, (int) $item->units_per_pack) + (float) $item->loose_qty;
                    $xml .= '<Item Name="' . $this->esc($item->product_name) . '"'
                        . ' Qty="' . $this->qty($units) . '" Unit="Nos"'
                        . ' Rate="' . $this->moneyText($item->purchase_rate) . '"'
                        . ' Amount="' . $this->moneyText($item->total_amount) . '"'
                        . ' GSTPercent="' . $this->moneyText($item->gst_percent) . '"/>';
                }
                $xml .= '</Items>'
                    . '<Totals Taxable="' . $this->moneyText((float) $purchase->subtotal - (float) $purchase->bill_discount) . '"'
                    . ' Tax="' . $this->moneyText($purchase->tax_total) . '"'
                    . ' RoundOff="' . $this->moneyText($purchase->round_off) . '"'
                    . ' GrandTotal="' . $this->moneyText($purchase->grand_total) . '"/>'
                    . '</Voucher>';
            }
        }

        return $xml . '</Vouchers></BusyData>';
    }

    private function busyLedger(string $name, float $amount, string $drCr): string
    {
        if (abs($amount) < 0.005) {
            return '';
        }

        return '<Ledger Name="' . $this->esc($name) . '"'
            . ' Amount="' . $this->moneyText(abs($amount)) . '"'
            . ' DrCr="' . $drCr . '"/>';
    }
}
