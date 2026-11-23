<?php

namespace App\Http\Controllers\Api;

use App\Models\Counter;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\Salesperson;
use App\Models\ScheduledReport;
use App\Models\Store;
use App\Services\Reports\OutwardSalesService;
use App\Services\Reports\ScheduledReportService;
use App\Support\Money;
use App\Support\RestrictedDrugResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AdminReportController
{
    /**
     * Daily collection summary & sales breakdown.
     */
    public function salesSummary(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $startDate = $request->query('start_date', Carbon::today()->startOfMonth()->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());

        $service = OutwardSalesService::forWindow(
            $storeId ? (int) $storeId : null,
            $startDate,
            $endDate
        );
        $gst = $service->gst();
        $tenders = $service->tenders();

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'total_invoices_count' => $service->billsCount(),
            'gross_sales' => $service->grossSales(),
            'returns' => $service->totalReturns(),
            'net_sales' => $service->netSales(),
            'total_taxable' => $gst['taxable_value'],
            'total_tax' => $gst['tax_amount'],
            'by_tender' => [
                'cash' => $tenders['cash'],
                'upi' => $tenders['upi'],
                'card' => $tenders['card'],
                'credit' => $tenders['credit'],
            ],
        ]);
    }

    /**
     * Consolidated item-level sales with an admin-chosen matching key.
     * P-STORE-SCOPE: products are per-store, so under All-Stores scope the
     * same physical item exists as several independent product rows. This
     * read-only aggregation groups lines per run by barcode / item code
     * (external_id) / name+unit and lists lines lacking the chosen key as
     * unmatched. No merges are stored.
     */
    public function consolidatedSales(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $matchBy = (string) $request->query('match_by', 'barcode');
        if (!in_array($matchBy, ['barcode', 'external_id', 'name_unit'], true)) {
            return response()->json([
                'message' => 'match_by must be one of: barcode, external_id, name_unit.',
            ], 422);
        }

        $startDate = $request->query('start_date', Carbon::today()->startOfMonth()->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());
        $limit = max(1, min(200, (int) $request->query('limit', 100)));

        $storeNames = Store::pluck('name', 'id');

        $rows = InvoiceItem::query()
            ->join('invoices', 'invoice_items.invoice_id', '=', 'invoices.id')
            ->leftJoin('products', 'invoice_items.product_id', '=', 'products.id')
            ->where('invoices.status', '!=', 'cancelled')
            ->whereDate('invoices.invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoices.invoice_date', '<=', substr($endDate, 0, 10))
            ->when($storeId, fn($q) => $q->where('invoices.store_id', $storeId))
            ->select(
                'invoice_items.product_name',
                'invoice_items.qty',
                'invoice_items.total_amount',
                'invoice_items.units_per_pack',
                'invoices.store_id',
                'invoices.module_key',
                'products.barcode',
                'products.external_id',
                'products.units_per_pack as product_units_per_pack',
            )
            ->get();

        $groups = [];
        $unmatched = [];
        $matchedRevenue = 0.0;
        $unmatchedRevenue = 0.0;

        foreach ($rows as $row) {
            $isReturn = in_array($row->module_key, ['credit_note', 'sales_return']);
            $sign = $isReturn ? -1 : 1;
            $qty = (float) $row->qty * $sign;
            $revenue = (float) $row->total_amount * $sign;

            $storeName = $storeNames[$row->store_id] ?? ('Store ' . $row->store_id);

            $key = match ($matchBy) {
                'barcode' => trim((string) $row->barcode),
                'external_id' => trim((string) $row->external_id),
                'name_unit' => strtolower(trim((string) $row->product_name))
                    . '|u' . (int) ($row->product_units_per_pack ?? $row->units_per_pack ?? 1),
            };

            if ($key === '' || ($matchBy === 'name_unit' && strtolower(trim((string) $row->product_name)) === '')) {
                $unmatchedRevenue += $revenue;
                $unmatched[] = [
                    'store_id' => $row->store_id,
                    'store_name' => $storeName,
                    'product_name' => $row->product_name,
                    'qty_sold' => round($qty, 2),
                    'revenue' => round($revenue, 2),
                ];
                continue;
            }

            $matchedRevenue += $revenue;

            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'key' => $key,
                    'label' => $row->product_name,
                    'stores' => [],
                    'qty_sold' => 0.0,
                    'revenue' => 0.0,
                ];
            }

            $group = &$groups[$key];
            $group['qty_sold'] += $qty;
            $group['revenue'] += $revenue;

            $storeBucket = &$group['stores'];
            if (!isset($storeBucket[$row->store_id])) {
                $storeBucket[$row->store_id] = [
                    'store_id' => $row->store_id,
                    'store_name' => $storeName,
                    'qty_sold' => 0.0,
                    'revenue' => 0.0,
                ];
            }
            $storeBucket[$row->store_id]['qty_sold'] += $qty;
            $storeBucket[$row->store_id]['revenue'] += $revenue;

            unset($group, $storeBucket);
        }

        $groups = collect($groups)
            ->sortByDesc('revenue')
            ->take($limit)
            ->map(function ($g) {
                return [
                    'key' => $g['key'],
                    'label' => $g['label'],
                    'stores' => array_values($g['stores']),
                    'qty_sold' => round($g['qty_sold'], 2),
                    'revenue' => round($g['revenue'], 2),
                ];
            })
            ->values()
            ->all();

        $unmatched = collect($unmatched)
            ->sortByDesc('revenue')
            ->take($limit)
            ->values()
            ->all();

        return response()->json([
            'match_by' => $matchBy,
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'groups' => $groups,
            'unmatched' => $unmatched,
            'totals' => [
                'matched_revenue' => round($matchedRevenue, 2),
                'unmatched_revenue' => round($unmatchedRevenue, 2),
            ],
        ]);
    }

    /**
     * GSTR-1 Compliance Summary (B2B, B2CL, B2CS, Table 12 HSN, Table 13 Docs).
     */
    public function gstr1(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $startDate = $request->query('start_date', Carbon::today()->startOfMonth()->toDateString());
        $endDate = $request->query('end_date', Carbon::today()->toDateString());

        $query = Invoice::with(['items', 'payments'])
            ->whereDate('invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoice_date', '<=', substr($endDate, 0, 10))
            ->where('status', '!=', 'cancelled')
            ->orderBy('invoice_date')
            ->orderBy('id');
        if ($storeId) {
            $query->where('store_id', $storeId);
        }
        $invoices = $query->get();

        $service = OutwardSalesService::fromInvoices($invoices);

        // Table 4 (B2B) and Table 7 (B2CS) hold sales only, on the exclusive
        // base. The credit note is reported once, in Table 9.
        $b2b = ['count' => 0, 'taxable' => 0, 'tax' => 0, 'value' => 0];
        $b2c = ['count' => 0, 'taxable' => 0, 'tax' => 0, 'value' => 0];
        $creditNotes = ['count' => 0, 'taxable' => 0, 'tax' => 0, 'value' => 0];

        foreach ($invoices as $invoice) {
            $isReturn = OutwardSalesService::isReturn($invoice);
            if (! $isReturn && ! OutwardSalesService::isSale($invoice)) {
                continue;
            }

            $taxable = Money::paise($service->taxableBase($invoice));
            $tax = Money::paise($invoice->tax_total);
            $value = Money::paise($invoice->grand_total);

            if ($isReturn) {
                $creditNotes['count']++;
                $creditNotes['taxable'] += $taxable;
                $creditNotes['tax'] += $tax;
                $creditNotes['value'] += $value;
                continue;
            }

            $bucket = strlen(trim((string) $invoice->customer_gstin)) === 15 ? 'b2b' : 'b2c';
            $target = &${$bucket};
            $target['count']++;
            $target['taxable'] += $taxable;
            $target['tax'] += $tax;
            $target['value'] += $value;
            unset($target);
        }

        // Table 12: HSN summary, with returns subtracted on the line they came
        // from and header-only bills kept so the table still adds up.
        $hsnMap = [];
        $addHsn = function (string $hsn, string $description, float $qty, int $sign, int $taxable, int $cgst, int $sgst, int $igst, int $cess) use (&$hsnMap) {
            if (! isset($hsnMap[$hsn])) {
                $hsnMap[$hsn] = [
                    'hsn_code' => $hsn,
                    'description' => $description,
                    'total_qty' => 0.0,
                    'taxable' => 0,
                    'cgst' => 0,
                    'sgst' => 0,
                    'igst' => 0,
                    'cess' => 0,
                ];
            }

            $hsnMap[$hsn]['total_qty'] += $qty * $sign;
            $hsnMap[$hsn]['taxable'] += $taxable * $sign;
            $hsnMap[$hsn]['cgst'] += $cgst * $sign;
            $hsnMap[$hsn]['sgst'] += $sgst * $sign;
            $hsnMap[$hsn]['igst'] += $igst * $sign;
            $hsnMap[$hsn]['cess'] += $cess * $sign;
        };

        foreach ($invoices as $invoice) {
            $isReturn = OutwardSalesService::isReturn($invoice);
            if (! $isReturn && ! OutwardSalesService::isSale($invoice)) {
                continue;
            }

            $sign = OutwardSalesService::sign($invoice);

            if ($invoice->items->isEmpty()) {
                $tax = Money::paise($invoice->tax_total);
                [$cgst, $sgst, $igst] = $this->splitHeaderTax(
                    Money::paise($invoice->cgst_total),
                    Money::paise($invoice->sgst_total),
                    Money::paise($invoice->igst_total),
                    $tax
                );

                $addHsn(
                    'OTHER',
                    'Item',
                    0.0,
                    $sign,
                    Money::paise($service->taxableBase($invoice)),
                    $cgst,
                    $sgst,
                    $igst,
                    Money::paise($invoice->cess_total)
                );

                continue;
            }

            foreach ($invoice->items as $item) {
                $product = $item->product_id ? Product::find($item->product_id) : null;
                $hsn = trim((string) ($item->hsn_code ?? $product?->hsn_sac_code ?? ''));
                if ($hsn === '') {
                    $hsn = 'OTHER';
                }

                $tax = Money::paise($item->tax_amount);
                $cgst = Money::paise($item->cgst_amount);
                $sgst = Money::paise($item->sgst_amount);
                $igst = Money::paise($item->igst_amount);
                $cess = Money::paise($item->cess_amount);

                if ($cgst + $sgst + $igst + $cess === 0 && $tax !== 0) {
                    [$cgst, $sgst, $igst] = $this->splitHeaderTax(0, 0, Money::paise($invoice->igst_total), $tax);
                }

                $taxable = $item->taxable_amount !== null
                    ? Money::paise($item->taxable_amount)
                    : Money::paise($item->total_amount) - $cgst - $sgst - $igst - $cess;

                $addHsn(
                    $hsn,
                    $product?->name ?? $item->product_name ?? 'Item',
                    (float) $item->qty,
                    $sign,
                    $taxable,
                    $cgst,
                    $sgst,
                    $igst,
                    $cess
                );
            }
        }

        $salesDocuments = $invoices->filter(fn ($invoice) => OutwardSalesService::isSale($invoice));

        // Table 13: Document Issue
        $docIssue = [
            'from_doc' => $salesDocuments->min('invoice_number') ?? 'N/A',
            'to_doc' => $salesDocuments->max('invoice_number') ?? 'N/A',
            'total_number' => $salesDocuments->count(),
            'cancelled_number' => $this->cancelledDocumentCount($storeId, $startDate, $endDate),
        ];

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'table_4_b2b' => [
                'count' => $b2b['count'],
                'taxable_value' => Money::toFloat($b2b['taxable']),
                'tax_amount' => Money::toFloat($b2b['tax']),
                'invoice_value' => Money::toFloat($b2b['value']),
            ],
            'table_7_b2cs' => [
                'count' => $b2c['count'],
                'taxable_value' => Money::toFloat($b2c['taxable']),
                'tax_amount' => Money::toFloat($b2c['tax']),
                'invoice_value' => Money::toFloat($b2c['value']),
            ],
            'table_9_credit_notes' => [
                'count' => $creditNotes['count'],
                'note_value' => Money::toFloat($creditNotes['value']),
                'taxable_value' => Money::toFloat($creditNotes['taxable']),
                'tax_amount' => Money::toFloat($creditNotes['tax']),
            ],
            'table_12_hsn' => array_values(array_map(function ($h) {
                return [
                    'hsn_code' => $h['hsn_code'],
                    'description' => $h['description'],
                    'total_qty' => round($h['total_qty'], 2),
                    'taxable_value' => Money::toFloat($h['taxable']),
                    'cgst_amount' => Money::toFloat($h['cgst']),
                    'sgst_amount' => Money::toFloat($h['sgst']),
                    'igst_amount' => Money::toFloat($h['igst']),
                    'cess_amount' => Money::toFloat($h['cess']),
                    'total_tax' => Money::toFloat($h['cgst'] + $h['sgst'] + $h['igst'] + $h['cess']),
                ];
            }, $hsnMap)),
            'table_13_docs' => $docIssue,
        ]);
    }

    /**
     * @return array{0: int, 1: int, 2: int}  [cgst, sgst, igst] in paise
     */
    private function splitHeaderTax(int $cgst, int $sgst, int $igst, int $tax): array
    {
        if ($cgst + $sgst + $igst === 0 && $tax !== 0) {
            if ($igst > 0) {
                return [0, 0, $tax];
            }

            $cgst = intdiv($tax, 2);

            return [$cgst, $tax - $cgst, 0];
        }

        return [$cgst, $sgst, $igst];
    }

    private function cancelledDocumentCount(mixed $storeId, string $startDate, string $endDate): int
    {
        return Invoice::whereDate('invoice_date', '>=', substr($startDate, 0, 10))
            ->whereDate('invoice_date', '<=', substr($endDate, 0, 10))
            ->where('status', 'cancelled')
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->count();
    }

    /**
     * Customer Outstanding & Real Aging Report based on unpaid invoice dates.
     */
    public function customerAging(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $today = Carbon::today();

        $parties = Party::where('type', 'customer')
            ->where('current_balance', '>', 0)
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->orderBy('current_balance', 'desc')
            ->get();

        $customers = $parties->map(function ($party) use ($today) {
            $totalOutstanding = (float)$party->current_balance;

            $unpaidInvoices = Invoice::where('customer_id', $party->id)
                ->where('status', '!=', 'cancelled')
                ->whereRaw('grand_total > paid_amount')
                ->orderBy('invoice_date', 'asc')
                ->get();

            $b0_30 = 0.0;
            $b31_60 = 0.0;
            $b61_90 = 0.0;
            $b90_plus = 0.0;

            if ($unpaidInvoices->isNotEmpty()) {
                foreach ($unpaidInvoices as $inv) {
                    $due = max(0, (float)$inv->grand_total - (float)$inv->paid_amount);
                    $invDate = Carbon::parse($inv->invoice_date);
                    $daysOld = $invDate->diffInDays($today);

                    if ($daysOld <= 30) {
                        $b0_30 += $due;
                    } elseif ($daysOld <= 60) {
                        $b31_60 += $due;
                    } elseif ($daysOld <= 90) {
                        $b61_90 += $due;
                    } else {
                        $b90_plus += $due;
                    }
                }
            } else {
                $b0_30 = $totalOutstanding;
            }

            return [
                'id' => $party->id,
                'name' => $party->name,
                'phone' => $party->phone,
                'credit_limit' => $party->credit_limit,
                'current_balance' => round($totalOutstanding, 2),
                'bracket_0_30' => round($b0_30, 2),
                'bracket_31_60' => round($b31_60, 2),
                'bracket_61_90' => round($b61_90, 2),
                'bracket_90_plus' => round($b90_plus, 2),
            ];
        });

        return response()->json([
            'total_customers_with_dues' => $customers->count(),
            'total_outstanding' => round($customers->sum('current_balance'), 2),
            'customers' => $customers,
        ]);
    }

    /**
     * Pharmacy Specific Statutory Report (Schedule H/H1, Doctors).
     */
    public function pharmacyReport(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $startDate = substr((string) $request->query('start_date', Carbon::today()->subDays(30)->toDateString()), 0, 10);
        $endDate = substr((string) $request->query('end_date', Carbon::today()->toDateString()), 0, 10);

        $doctorSales = Invoice::whereBetween('invoice_date', [$startDate, $endDate])
            ->where('status', '!=', 'cancelled')
            ->whereNotNull('doctor_name')
            ->when($storeId, fn($q) => $q->where('store_id', $storeId))
            ->select('doctor_name', 'doctor_reg_no', DB::raw('COUNT(id) as rx_count'), DB::raw('SUM(grand_total) as total_value'))
            ->groupBy('doctor_name', 'doctor_reg_no')
            ->orderByDesc('total_value')
            ->get();

        return response()->json([
            'doctor_sales' => $doctorSales,
            'restricted_drug_register' => $this->restrictedDrugRegister(
                $storeId ? (int) $storeId : null,
                $startDate,
                $endDate
            ),
        ]);
    }

    /**
     * GAP-02 / PHR-007 — the restricted-drug register.
     *
     * One entry per restricted pack billed or taken back in the window, in the
     * order the entries happened, with the batch, the schedule the product is
     * listed under and the pharmacist who vouched for it. A line nobody vouched
     * for stays in the book and counts as unconfirmed — dropping it would hide
     * the very entry a statutory register exists to catch. Returns read as
     * negative entries, the way the store's own sales summary reads them, so
     * the footings agree with the money the till took.
     *
     * A schedule list belongs to one store, so the same product can be a
     * restricted pack here and an ordinary shelf line next door: each entry is
     * judged by the list of the store that wrote the bill. A store that sells
     * no medicines has no book at all (PHR-011).
     *
     * @return array{rows: list<array<string,mixed>>, totals: array<string,int|float>}
     */
    private function restrictedDrugRegister(?int $storeId, string $startDate, string $endDate): array
    {
        $stores = Store::query()
            ->where('store_type', 'pharmacy')
            ->when($storeId, fn ($query) => $query->where('id', $storeId))
            ->get(['id', 'name']);

        if ($stores->isEmpty()) {
            return ['rows' => [], 'totals' => ['lines' => 0, 'quantity' => 0.0, 'value' => 0.0, 'unconfirmed' => 0]];
        }

        /** @var array<int,array<int,string>> $byStore */
        $byStore = [];
        $productIds = [];

        foreach ($stores as $store) {
            $products = RestrictedDrugResolver::restrictedProducts((int) $store->id);

            if ($products === []) {
                continue;
            }

            $byStore[(int) $store->id] = $products;
            $productIds = array_merge($productIds, array_keys($products));
        }

        if ($productIds === []) {
            return ['rows' => [], 'totals' => ['lines' => 0, 'quantity' => 0.0, 'value' => 0.0, 'unconfirmed' => 0]];
        }

        $storeNames = $stores->pluck('name', 'id');
        $items = DB::table('invoice_items')
            ->join('invoices', 'invoices.id', '=', 'invoice_items.invoice_id')
            ->whereIn('invoice_items.product_id', $productIds)
            ->whereIn('invoices.store_id', array_keys($byStore))
            ->whereBetween('invoices.invoice_date', [$startDate, $endDate])
            ->where('invoices.status', '!=', 'cancelled')
            ->orderBy('invoices.invoice_date')
            ->orderBy('invoices.id')
            ->orderBy('invoice_items.id')
            ->get([
                'invoice_items.*',
                'invoices.invoice_number',
                'invoices.invoice_date',
                'invoices.module_key',
                'invoices.counter_id',
                'invoices.counter_code',
                'invoices.store_id',
                'invoices.pharmacist_id',
                'invoices.pharmacist_name',
                'invoices.pharmacist_reg_no',
                'invoices.pharmacist_confirmed_at',
            ]);

        $counterCodes = Counter::query()
            ->whereIn('id', $items->pluck('counter_id')->filter()->unique()->all())
            ->pluck('counter_code', 'id');

        $rows = [];
        $quantity = 0.0;
        $value = 0.0;
        $unconfirmed = 0;

        foreach ($items as $item) {
            $code = $byStore[(int) $item->store_id][(int) $item->product_id] ?? null;

            if ($code === null) {
                // The product is restricted in a neighbouring store, not this one.
                continue;
            }

            $isReturn = in_array($item->module_key, OutwardSalesService::RETURN_MODULES, true);
            $sign = $isReturn ? -1 : 1;
            $confirmedAt = $item->pharmacist_confirmed_at;

            if ($confirmedAt !== null && !is_numeric($confirmedAt)) {
                $confirmedAt = Carbon::parse((string) $confirmedAt)->toDateTimeString();
            }

            $entry = [
                'store_id' => (int) $item->store_id,
                'store_name' => $storeNames[(int) $item->store_id] ?? null,
                'invoice_id' => (int) $item->invoice_id,
                'invoice_number' => $item->invoice_number,
                'invoice_date' => substr((string) $item->invoice_date, 0, 10),
                'counter_code' => $item->counter_code
                    ?? ($item->counter_id ? $counterCodes[(int) $item->counter_id] : null),
                'is_return' => $isReturn,
                'product_id' => (int) $item->product_id,
                'product_name' => $item->product_name,
                'batch_no' => $item->batch_no,
                'schedule_code' => $code,
                'qty' => round($sign * (float) $item->qty, 2),
                'unit_price' => round((float) $item->unit_price, 2),
                'total_amount' => round($sign * (float) $item->total_amount, 2),
                'pharmacist_id' => $item->pharmacist_id === null ? null : (int) $item->pharmacist_id,
                'pharmacist_name' => $item->pharmacist_name,
                'pharmacist_reg_no' => $item->pharmacist_reg_no,
                'pharmacist_confirmed_at' => $confirmedAt,
            ];

            $rows[] = $entry;
            $quantity += (float) $entry['qty'];
            $value += (float) $entry['total_amount'];

            if ($item->pharmacist_id === null && $item->pharmacist_name === null) {
                $unconfirmed++;
            }
        }

        return [
            'rows' => $rows,
            'totals' => [
                'lines' => count($rows),
                'quantity' => round($quantity, 2),
                'value' => round($value, 2),
                'unconfirmed' => $unconfirmed,
            ],
        ];
    }

    /**
     * SPR-015 — the salesperson register: who sold what in a window.
     *
     * A person is read inside one store only, so two stores that both keep an
     * "SP-01 Rina" never share a row. Bills nobody is named on are gathered in
     * their own `unattributed` figure rather than dropped, which is what makes
     * the register add up to the same window the sales summary reads instead
     * of quietly differing from it.
     */
    public function salesperson(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $startDate = substr((string) $request->query('start_date', Carbon::today()->startOfMonth()->toDateString()), 0, 10);
        $endDate = substr((string) $request->query('end_date', Carbon::today()->toDateString()), 0, 10);

        $service = OutwardSalesService::forWindow(
            $storeId ? (int) $storeId : null,
            $startDate,
            $endDate,
            $request->query('counter_id')
        );

        $storeNames = Store::pluck('name', 'id');

        $people = Salesperson::query()
            ->when($storeId, fn ($q) => $q->where('store_id', (int) $storeId))
            ->get()
            ->keyBy(fn (Salesperson $person): string => $person->store_id . ':' . $person->id);

        /** @var array<string, array<string, mixed>> $groups */
        $groups = [];

        // One store's view is that store's whole payroll: an owner reads the
        // people who sold nothing too. All-stores views list who billed.
        if ($storeId) {
            foreach ($people as $key => $person) {
                if ($person->is_active && $person->archived_at === null) {
                    $groups[$key] = $this->emptySalespersonRow($person->store_id, $person->id, $person, $storeNames);
                }
            }
        }

        foreach ($service->invoices() as $invoice) {
            $key = $invoice->store_id . ':' . ($invoice->salesperson_id ?? 0);
            $groups[$key] ??= $this->emptySalespersonRow(
                (int) $invoice->store_id,
                $invoice->salesperson_id === null ? null : (int) $invoice->salesperson_id,
                $people->get($key),
                $storeNames,
                (string) ($invoice->salesperson_name ?: 'Unattributed')
            );

            $row = &$groups[$key];
            $sign = OutwardSalesService::sign($invoice);

            $value = Money::paise($invoice->grand_total);
            if (OutwardSalesService::isReturn($invoice)) {
                $row['returns']++;
                $row['returns_paise'] += $value;
            } elseif (OutwardSalesService::isSale($invoice)) {
                $row['bills']++;
                $row['gross_paise'] += $value;
                $row['discount_paise'] += Money::paise($invoice->discount_total);
            }

            $row['taxable_paise'] += $sign * Money::paise($service->taxableBase($invoice));

            $items = $invoice->relationLoaded('items') ? $invoice->items : $invoice->items()->get();
            foreach ($items as $item) {
                $itemKey = $item->product_id ?? 'name:' . strtolower((string) $item->product_name);
                $row['items'][$itemKey] ??= [
                    'product_id' => $item->product_id,
                    'product_name' => $item->product_name,
                    'qty' => 0.0,
                    'value_paise' => 0,
                ];
                $row['items'][$itemKey]['qty'] += $sign * (float) $item->qty;
                $row['items'][$itemKey]['value_paise'] += $sign * OutwardSalesService::lineTaxablePaise($item);
            }

            unset($row);
        }

        // Bills with no person become one figure, not a row per store: they
        // exist so the register reconciles, not to look like a person.
        $unattributed = null;
        $perPerson = [];
        foreach ($groups as $group) {
            if ($group['salesperson_id'] === null) {
                $unattributed = $unattributed === null ? $group : $this->mergeSalespersonRows($unattributed, $group);
                continue;
            }
            $perPerson[] = $group;
        }

        $rows = collect($perPerson)
            ->map(fn (array $group): array => $this->presentSalespersonRow($group))
            ->sortBy([['store_name', 'asc'], ['net_sales', 'desc']])
            ->values()
            ->all();

        $everything = $perPerson;
        if ($unattributed !== null) {
            $everything[] = $unattributed;
        }

        $totals = $this->presentSalespersonRow(array_reduce(
            $everything,
            fn (array $carry, array $group): array => $this->mergeSalespersonRows($carry, $group),
            $this->emptySalespersonRow($storeId ? (int) $storeId : null, null, null, $storeNames, 'All salespeople')
        ));

        return response()->json([
            'date_range' => ['start_date' => $startDate, 'end_date' => $endDate],
            'salespeople' => $rows,
            'unattributed' => $this->presentSalespersonRow(
                $unattributed ?? $this->emptySalespersonRow($storeId ? (int) $storeId : null, null, null, $storeNames)
            ),
            'totals' => $totals,
        ]);
    }

    /**
     * @param  \Illuminate\Support\Collection<int|string, string>  $storeNames
     * @return array<string, mixed>
     */
    private function emptySalespersonRow(?int $storeId, ?int $salespersonId, ?Salesperson $person, $storeNames, string $fallbackName = 'Unattributed'): array
    {
        return [
            'store_id' => $storeId,
            'store_name' => $storeId === null ? '' : (string) ($storeNames[$storeId] ?? ''),
            'salesperson_id' => $salespersonId,
            // The master row is the person; a bill's own snapshot is what a
            // person who is no longer on the master is still called.
            'name' => $person?->name ?: $fallbackName,
            'code' => $person?->code,
            'archived' => $person === null ? false : ($person->archived_at !== null || !$person->is_active),
            'bills' => 0,
            'returns' => 0,
            'gross_paise' => 0,
            'returns_paise' => 0,
            'discount_paise' => 0,
            'taxable_paise' => 0,
            'items' => [],
        ];
    }

    /**
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     * @return array<string, mixed>
     */
    private function mergeSalespersonRows(array $a, array $b): array
    {
        foreach (['bills', 'returns', 'gross_paise', 'returns_paise', 'discount_paise', 'taxable_paise'] as $field) {
            $a[$field] += $b[$field];
        }

        foreach ($b['items'] as $key => $item) {
            if (!isset($a['items'][$key])) {
                $a['items'][$key] = $item;
                continue;
            }

            $a['items'][$key]['qty'] += $item['qty'];
            $a['items'][$key]['value_paise'] += $item['value_paise'];
        }

        return $a;
    }

    /**
     * Paise in, rupees out: the one place this register turns its arithmetic
     * back into money, so no figure is ever added as a float.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function presentSalespersonRow(array $row): array
    {
        $gross = (int) $row['gross_paise'];
        $returns = (int) $row['returns_paise'];
        $bills = (int) $row['bills'];

        $items = collect($row['items'])
            ->map(fn (array $item): array => [
                'product_id' => $item['product_id'],
                'product_name' => $item['product_name'],
                'qty' => round((float) $item['qty'], 2),
                'net_value' => Money::toFloat((int) $item['value_paise']),
            ])
            ->sortByDesc('net_value')
            ->values()
            ->all();

        return [
            'salesperson_id' => $row['salesperson_id'],
            'name' => $row['name'],
            'code' => $row['code'],
            'store_id' => $row['store_id'],
            'store_name' => $row['store_name'],
            'archived' => $row['archived'],
            'bills' => $bills,
            'returns' => (int) $row['returns'],
            'gross_sales' => Money::toFloat($gross),
            'returns_value' => Money::toFloat($returns),
            'net_sales' => Money::toFloat($gross - $returns),
            'discounts' => Money::toFloat((int) $row['discount_paise']),
            'net_taxable_value' => Money::toFloat((int) $row['taxable_paise']),
            'average_bill' => $bills > 0 ? Money::toFloat((int) round($gross / $bills)) : 0.0,
            'items' => $items,
        ];
    }

    /**
     * Scheduled Email Reports configuration.
     */
    public function scheduledReports(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');

        $schedules = ScheduledReport::with('store:id,name,code')
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->orderBy('name')
            ->get()
            ->map(fn (ScheduledReport $schedule) => $this->schedulePayload($schedule))
            ->values();

        return response()->json(['schedules' => $schedules]);
    }

    public function storeScheduledReport(Request $request): JsonResponse
    {
        $validated = $this->validateSchedule($request);
        $storeId = $this->resolveScheduleStoreId($request, $validated);

        $schedule = ScheduledReport::create([
            'store_id' => $storeId,
            'name' => $validated['name'],
            'report_type' => $validated['report_type'],
            'frequency' => $validated['frequency'],
            'send_time' => $validated['send_time'],
            'day_of_week' => $validated['day_of_week'] ?? null,
            'day_of_month' => $validated['day_of_month'] ?? null,
            'recipients' => array_values(array_unique($validated['recipients'])),
            'is_active' => $validated['is_active'] ?? true,
            'created_by' => $request->user()->id,
        ]);

        return response()->json([
            'message' => 'Scheduled report created.',
            'schedule' => $this->schedulePayload($schedule->load('store:id,name,code')),
        ], 201);
    }

    public function updateScheduledReport(Request $request, int $id): JsonResponse
    {
        $schedule = $this->findScheduleForUser($request, $id);
        $validated = $this->validateSchedule($request);

        $schedule->fill([
            'name' => $validated['name'],
            'report_type' => $validated['report_type'],
            'frequency' => $validated['frequency'],
            'send_time' => $validated['send_time'],
            'day_of_week' => $validated['day_of_week'] ?? null,
            'day_of_month' => $validated['day_of_month'] ?? null,
            'recipients' => array_values(array_unique($validated['recipients'])),
        ]);

        if (array_key_exists('is_active', $validated)) {
            $schedule->is_active = (bool) $validated['is_active'];
        }

        $schedule->save();

        return response()->json([
            'message' => 'Scheduled report updated.',
            'schedule' => $this->schedulePayload($schedule->load('store:id,name,code')),
        ]);
    }

    public function destroyScheduledReport(Request $request, int $id): JsonResponse
    {
        $schedule = $this->findScheduleForUser($request, $id);
        $schedule->delete();

        return response()->json(['message' => 'Scheduled report deleted.']);
    }

    public function runScheduledReport(Request $request, int $id, ScheduledReportService $service): JsonResponse
    {
        $schedule = $this->findScheduleForUser($request, $id);

        try {
            $result = $service->deliver($schedule);
        } catch (\Throwable $e) {
            $service->markFailed($schedule, $e);

            return response()->json([
                'message' => 'Failed to send scheduled report: ' . $e->getMessage(),
                'schedule' => $this->schedulePayload($schedule->fresh()),
            ], 422);
        }

        return response()->json([
            'message' => 'Scheduled report sent to ' . implode(', ', $result['recipients']) . '.',
            'schedule' => $this->schedulePayload($schedule->fresh()),
        ]);
    }

    private function validateSchedule(Request $request): array
    {
        return $request->validate([
            'name' => 'required|string|max:120',
            'report_type' => ['required', Rule::in(ScheduledReport::REPORT_TYPES)],
            'frequency' => ['required', Rule::in(ScheduledReport::FREQUENCIES)],
            'send_time' => ['required', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'day_of_week' => 'required_if:frequency,weekly|nullable|integer|min:0|max:6',
            'day_of_month' => 'required_if:frequency,monthly|nullable|integer|min:1|max:31',
            'recipients' => 'required|array|min:1',
            'recipients.*' => 'required|email',
            'is_active' => 'sometimes|boolean',
            'store_id' => 'sometimes|nullable|integer|exists:stores,id',
        ]);
    }

    private function resolveScheduleStoreId(Request $request, array $validated): ?int
    {
        $user = $request->user();

        if (array_key_exists('store_id', $validated)) {
            $storeId = $validated['store_id'] !== null ? (int) $validated['store_id'] : null;
            if ($storeId !== null && !$user->canAccessStore($storeId)) {
                abort(403, 'You do not have access to the selected store.');
            }
            if ($storeId === null && !$user->canViewAllStores()) {
                abort(403, 'Consolidated schedules require access to every store.');
            }

            return $storeId;
        }

        $activeStoreId = $request->get('active_store_id');

        if ($activeStoreId === null && !$user->canViewAllStores()) {
            abort(403, 'Select a store before creating a scheduled report.');
        }

        return $activeStoreId !== null ? (int) $activeStoreId : null;
    }

    private function findScheduleForUser(Request $request, int $id): ScheduledReport
    {
        $schedule = ScheduledReport::find($id);

        if (!$schedule) {
            abort(404, 'Scheduled report not found.');
        }

        $user = $request->user();

        if ($schedule->store_id === null) {
            if (!$user->canViewAllStores()) {
                abort(403, 'Consolidated schedules require access to every store.');
            }
        } elseif (!$user->canAccessStore($schedule->store_id)) {
            abort(403, 'You do not have access to this scheduled report.');
        }

        return $schedule;
    }

    private function schedulePayload(ScheduledReport $schedule): array
    {
        return [
            'id' => $schedule->id,
            'store_id' => $schedule->store_id,
            'store_name' => $schedule->store?->name ?? 'All Stores',
            'name' => $schedule->name,
            'report_type' => $schedule->report_type,
            'frequency' => $schedule->frequency,
            'frequency_label' => $schedule->frequencyLabel(),
            'send_time' => $schedule->send_time,
            'day_of_week' => $schedule->day_of_week,
            'day_of_month' => $schedule->day_of_month,
            'recipients' => $schedule->recipients ?? [],
            'is_active' => $schedule->is_active,
            'last_sent_at' => $schedule->last_sent_at?->toIso8601String(),
            'last_status' => $schedule->last_status,
            'last_error' => $schedule->last_error,
            'created_at' => $schedule->created_at?->toIso8601String(),
        ];
    }
}
