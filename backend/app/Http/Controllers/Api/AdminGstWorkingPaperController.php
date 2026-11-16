<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\Gstr2bEntry;
use App\Models\Gstr2bImport;
use App\Models\Purchase;
use App\Services\Gst\GstWorkingPaperService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AdminGstWorkingPaperController
{
    private const TAX_TOLERANCE = 1.0;

    public function __construct(private readonly GstWorkingPaperService $service)
    {
    }

    public function gstr3b(Request $request): JsonResponse
    {
        [$from, $to] = $this->dateRange($request);

        return response()->json([
            'success' => true,
            ...$this->service->gstr3b($this->storeIds($request), $from, $to),
        ]);
    }

    public function gstr3bExport(Request $request): Response|JsonResponse
    {
        [$from, $to] = $this->dateRange($request);
        $data = $this->service->gstr3b($this->storeIds($request), $from, $to);

        $headers = ['Section', 'Rate', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Cess', 'Tax Total'];
        $rows = [];

        foreach ($data['outward']['rate_wise'] as $row) {
            $rows[] = [
                '3.1 Outward taxable supplies',
                $this->rateLabel($row['rate']),
                $row['taxable_value'],
                $row['cgst_amount'],
                $row['sgst_amount'],
                $row['igst_amount'],
                $row['cess_amount'],
                $row['tax_amount'],
            ];
        }

        $rows[] = [
            '3.1 Outward total',
            '',
            $data['outward']['total_taxable'],
            $data['outward']['total_cgst'],
            $data['outward']['total_sgst'],
            $data['outward']['total_igst'],
            $data['outward']['total_cess'],
            $data['outward']['total_tax'],
        ];
        $rows[] = ['3.1 Nil/exempt supplies', '0%', $data['outward']['nil_rated_taxable'], 0, 0, 0, 0, 0];

        foreach ($data['itc']['rate_wise'] as $row) {
            $rows[] = [
                '4 ITC available',
                $this->rateLabel($row['rate']),
                $row['taxable_value'],
                $row['cgst_amount'],
                $row['sgst_amount'],
                $row['igst_amount'],
                $row['cess_amount'],
                $row['tax_amount'],
            ];
        }

        $rows[] = [
            '4 ITC total',
            '',
            $data['itc']['total_taxable'],
            $data['itc']['total_cgst'],
            $data['itc']['total_sgst'],
            $data['itc']['total_igst'],
            $data['itc']['total_cess'],
            $data['itc']['total_itc'],
        ];
        $rows[] = ['4 ITC ineligible', '', 0, 0, 0, 0, 0, $data['itc']['ineligible_itc']];
        $rows[] = ['5 Reverse charge inward', '', $data['itc']['rcm_taxable'], 0, 0, 0, 0, $data['itc']['rcm_tax']];
        $rows[] = [
            '6.1 Net tax payable',
            '',
            0,
            $data['net_payable']['cgst'],
            $data['net_payable']['sgst'],
            $data['net_payable']['igst'],
            $data['net_payable']['cess'],
            $data['net_payable']['total'],
        ];

        return $this->csvResponse("gstr3b-working-{$from}_to_{$to}.csv", $headers, $rows);
    }

    public function gstr9(Request $request): JsonResponse
    {
        [$from, $to] = $this->fiscalYearRange($request);

        return response()->json([
            'success' => true,
            ...$this->service->gstr9($this->storeIds($request), $from, $to),
        ]);
    }

    public function gstr9Export(Request $request): Response|JsonResponse
    {
        [$from, $to] = $this->fiscalYearRange($request);
        $data = $this->service->gstr9($this->storeIds($request), $from, $to);

        $headers = ['Section', 'Particulars', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Cess', 'Total'];
        $rows = [
            ['4', 'Gross sales', $data['turnover']['gross_sales'], '', '', '', '', $data['turnover']['gross_sales']],
            ['4', 'Returns / credit notes', $data['turnover']['returns'], '', '', '', '', $data['turnover']['returns']],
            ['4', 'Net turnover', $data['turnover']['net_turnover'], '', '', '', '', $data['turnover']['net_turnover']],
            ['5', 'Taxable turnover (from rate buckets)', $data['turnover']['taxable_turnover'], '', '', '', '', $data['turnover']['tax_on_outward']],
            ['5', 'Nil / exempt turnover', $data['turnover']['nil_exempt_turnover'], '', '', '', '', 0],
        ];

        foreach ($data['rate_wise_outward'] as $row) {
            $rows[] = [
                '5',
                'Outward supplies @ ' . $this->rateLabel($row['rate']),
                $row['taxable_value'],
                $row['cgst_amount'],
                $row['sgst_amount'],
                $row['igst_amount'],
                $row['cess_amount'],
                $row['tax_amount'],
            ];
        }

        foreach ($data['itc']['rate_wise'] as $row) {
            $rows[] = [
                '6',
                'ITC availed @ ' . $this->rateLabel($row['rate']),
                $row['taxable_value'],
                $row['cgst_amount'],
                $row['sgst_amount'],
                $row['igst_amount'],
                $row['cess_amount'],
                $row['tax_amount'],
            ];
        }

        $rows[] = ['6', 'Total ITC availed', $data['itc']['total_taxable'], '', '', '', '', $data['itc']['total_itc']];
        $rows[] = ['7', 'ITC reversed / ineligible', 0, '', '', '', '', $data['itc']['ineligible_itc']];
        $rows[] = ['9', 'Tax paid (per books)', '', '', '', '', '', $data['reconciliation']['tax_per_books']];
        $rows[] = ['11', 'Net tax estimate', '', '', '', '', '', $data['reconciliation']['net_tax_estimate']];

        $rows[] = ['13', 'Documents - invoices', '', '', '', '', '', $data['documents']['invoices']];
        $rows[] = ['13', 'Documents - credit notes', '', '', '', '', '', $data['documents']['credit_notes']];
        $rows[] = ['13', 'Documents - purchase bills', '', '', '', '', '', $data['documents']['purchase_bills']];
        $rows[] = ['13', 'Documents - cancelled invoices', '', '', '', '', '', $data['documents']['cancelled']];

        return $this->csvResponse(
            "gstr9-working-{$data['fiscal_year']}.csv",
            $headers,
            $rows
        );
    }

    public function gstr2bImports(Request $request): JsonResponse
    {
        $imports = Gstr2bImport::withCount('entries')
            ->with(['store:id,name', 'importer:id,name'])
            ->when($this->storeIds($request), fn ($q, $storeIds) => $q->whereIn('store_id', $storeIds))
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->map(fn (Gstr2bImport $import) => $this->importPayload($import))
            ->values();

        return response()->json(['success' => true, 'imports' => $imports]);
    }

    public function importGstr2b(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
            'file_name' => 'nullable|string|max:180',
            'source' => 'nullable|string|max:40',
            'rows' => 'required|array|min:1|max:5000',
            'rows.*.supplier_gstin' => 'nullable|string|max:15',
            'rows.*.supplier_name' => 'nullable|string|max:180',
            'rows.*.invoice_number' => 'required|string|max:60',
            'rows.*.invoice_date' => 'nullable|date',
            'rows.*.taxable_value' => 'nullable|numeric',
            'rows.*.igst_amount' => 'nullable|numeric',
            'rows.*.cgst_amount' => 'nullable|numeric',
            'rows.*.sgst_amount' => 'nullable|numeric',
            'rows.*.cess_amount' => 'nullable|numeric',
            'rows.*.total_value' => 'nullable|numeric',
            'rows.*.itc_eligible' => 'sometimes|boolean',
        ]);

        $storeId = $this->resolveImportStoreId($request);

        $import = DB::transaction(function () use ($validated, $request, $storeId) {
            $import = Gstr2bImport::create([
                'store_id' => $storeId,
                'period' => $validated['period'],
                'file_name' => $validated['file_name'] ?? null,
                'source' => $validated['source'] ?? 'upload',
                'imported_by' => $request->user()->id,
            ]);

            $counts = [
                Gstr2bEntry::MATCH_MATCHED => 0,
                Gstr2bEntry::MATCH_MISMATCH => 0,
                Gstr2bEntry::MATCH_UNMATCHED => 0,
            ];
            $itcAvailable = 0.0;

            foreach ($validated['rows'] as $row) {
                $entry = $this->storeEntry($import, $row, $storeId);
                $counts[$entry->match_status]++;

                if ($entry->itc_eligible) {
                    $itcAvailable += (float) $entry->igst_amount
                        + (float) $entry->cgst_amount
                        + (float) $entry->sgst_amount
                        + (float) $entry->cess_amount;
                }
            }

            $import->update([
                'total_entries' => count($validated['rows']),
                'matched_count' => $counts[Gstr2bEntry::MATCH_MATCHED],
                'mismatch_count' => $counts[Gstr2bEntry::MATCH_MISMATCH],
                'unmatched_count' => $counts[Gstr2bEntry::MATCH_UNMATCHED],
                'itc_available' => round($itcAvailable, 2),
            ]);

            return $import;
        });

        AuditLog::log(
            'import_gstr2b',
            'Gstr2bImport',
            (string) $import->id,
            null,
            [
                'store_id' => $storeId,
                'period' => $import->period,
                'total_entries' => $import->total_entries,
                'matched' => $import->matched_count,
                'mismatch' => $import->mismatch_count,
                'unmatched' => $import->unmatched_count,
                'itc_available' => $import->itc_available,
            ],
            $storeId,
            $request->user()->id
        );

        $import->loadCount('entries')->load(['store:id,name', 'importer:id,name']);

        return response()->json([
            'success' => true,
            'message' => "Imported {$import->total_entries} GSTR-2B entries.",
            'import' => $this->importPayload($import),
        ], 201);
    }

    public function gstr2bReport(Request $request, int $id): JsonResponse
    {
        $import = $this->findImport($request, $id);
        $import->load(['entries.matchedPurchase', 'store:id,name', 'importer:id,name']);

        return response()->json([
            'success' => true,
            'import' => $this->importPayload($import, withCounts: false),
            'entries' => $import->entries
                ->sortBy('id')
                ->map(fn (Gstr2bEntry $entry) => $this->entryPayload($entry))
                ->values(),
            'summary' => $this->entrySummary($import->entries),
        ]);
    }

    public function gstr2bExport(Request $request, int $id): Response|JsonResponse
    {
        $import = $this->findImport($request, $id);
        $import->load('entries.matchedPurchase');

        $headers = [
            'Supplier GSTIN', 'Supplier', 'Invoice Number', 'Invoice Date', 'Taxable Value',
            'IGST', 'CGST', 'SGST', 'Cess', 'Total Value', 'ITC Eligible',
            'Match Status', 'Matched Purchase', 'Purchase Tax', 'Tax Difference', 'Notes',
        ];

        $rows = $import->entries->sortBy('id')->map(function (Gstr2bEntry $entry) {
            $payload = $this->entryPayload($entry);

            return [
                $entry->supplier_gstin,
                $entry->supplier_name,
                $entry->invoice_number,
                $entry->invoice_date?->toDateString(),
                $entry->taxable_value,
                $entry->igst_amount,
                $entry->cgst_amount,
                $entry->sgst_amount,
                $entry->cess_amount,
                $entry->total_value,
                $entry->itc_eligible,
                $payload['match_status'],
                $payload['matched_purchase']['invoice_number'] ?? '',
                $payload['matched_purchase']['tax_total'] ?? '',
                $payload['tax_difference'] ?? '',
                $entry->notes,
            ];
        });

        return $this->csvResponse("gstr2b-{$import->period}-{$import->id}.csv", $headers, $rows);
    }

    public function destroyGstr2bImport(Request $request, int $id): JsonResponse
    {
        $import = $this->findImport($request, $id);

        AuditLog::log(
            'delete_gstr2b_import',
            'Gstr2bImport',
            (string) $import->id,
            ['period' => $import->period, 'total_entries' => $import->total_entries],
            null,
            $import->store_id,
            $request->user()->id
        );

        $import->delete();

        return response()->json(['success' => true, 'message' => 'GSTR-2B import deleted.']);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    private function storeEntry(Gstr2bImport $import, array $row, ?int $storeId): Gstr2bEntry
    {
        $invoiceNumber = trim((string) $row['invoice_number']);
        $gstin = isset($row['supplier_gstin']) ? strtoupper(trim((string) $row['supplier_gstin'])) : null;
        $gstin = $gstin === '' ? null : $gstin;

        $taxable = round((float) ($row['taxable_value'] ?? 0), 2);
        $igst = round((float) ($row['igst_amount'] ?? 0), 2);
        $cgst = round((float) ($row['cgst_amount'] ?? 0), 2);
        $sgst = round((float) ($row['sgst_amount'] ?? 0), 2);
        $cess = round((float) ($row['cess_amount'] ?? 0), 2);
        $total = isset($row['total_value'])
            ? round((float) $row['total_value'], 2)
            : round($taxable + $igst + $cgst + $sgst + $cess, 2);

        $status = Gstr2bEntry::MATCH_UNMATCHED;
        $matchedPurchaseId = null;
        $notes = null;

        $purchase = Purchase::query()
            ->where('store_id', $storeId)
            ->where('module_key', 'purchase')
            ->where('status', '!=', 'cancelled')
            ->whereRaw('LOWER(TRIM(invoice_number)) = ?', [mb_strtolower($invoiceNumber)])
            ->orderByDesc('invoice_date')
            ->first();

        if ($purchase) {
            $matchedPurchaseId = $purchase->id;
            $purchaseTax = (float) $purchase->cgst_total + (float) $purchase->sgst_total
                + (float) $purchase->igst_total + (float) $purchase->cess_total;
            $entryTax = $igst + $cgst + $sgst + $cess;

            $gstinMatches = true;
            if ($gstin !== null && !empty($purchase->supplier_gstin)) {
                $gstinMatches = strtoupper(trim($purchase->supplier_gstin)) === $gstin;
            }

            $difference = round($entryTax - $purchaseTax, 2);

            if ($gstinMatches && abs($difference) <= self::TAX_TOLERANCE) {
                $status = Gstr2bEntry::MATCH_MATCHED;
            } else {
                $status = Gstr2bEntry::MATCH_MISMATCH;
                $notes = $gstinMatches
                    ? "Tax difference of {$difference} against purchase bill {$purchase->invoice_number}."
                    : "Supplier GSTIN differs from purchase bill {$purchase->invoice_number}.";
            }
        }

        return $import->entries()->create([
            'supplier_gstin' => $gstin,
            'supplier_name' => $row['supplier_name'] ?? null,
            'invoice_number' => $invoiceNumber,
            'invoice_date' => $row['invoice_date'] ?? null,
            'taxable_value' => $taxable,
            'igst_amount' => $igst,
            'cgst_amount' => $cgst,
            'sgst_amount' => $sgst,
            'cess_amount' => $cess,
            'total_value' => $total,
            'itc_eligible' => (bool) ($row['itc_eligible'] ?? true),
            'match_status' => $status,
            'matched_purchase_id' => $matchedPurchaseId,
            'notes' => $notes,
        ]);
    }

    private function importPayload(Gstr2bImport $import, bool $withCounts = true): array
    {
        $payload = [
            'id' => $import->id,
            'store_id' => $import->store_id,
            'store_name' => $import->store?->name,
            'period' => $import->period,
            'file_name' => $import->file_name,
            'source' => $import->source,
            'total_entries' => $import->total_entries,
            'matched_count' => $import->matched_count,
            'mismatch_count' => $import->mismatch_count,
            'unmatched_count' => $import->unmatched_count,
            'itc_available' => (float) $import->itc_available,
            'imported_by' => $import->importer?->name,
            'created_at' => $import->created_at?->toIso8601String(),
        ];

        if ($withCounts && isset($import->entries_count)) {
            $payload['entries_count'] = $import->entries_count;
        }

        return $payload;
    }

    private function entryPayload(Gstr2bEntry $entry): array
    {
        $purchase = $entry->matchedPurchase;
        $entryTax = (float) $entry->igst_amount + (float) $entry->cgst_amount
            + (float) $entry->sgst_amount + (float) $entry->cess_amount;
        $purchaseTax = $purchase
            ? (float) $purchase->cgst_total + (float) $purchase->sgst_total
                + (float) $purchase->igst_total + (float) $purchase->cess_total
            : null;

        return [
            'id' => $entry->id,
            'supplier_gstin' => $entry->supplier_gstin,
            'supplier_name' => $entry->supplier_name,
            'invoice_number' => $entry->invoice_number,
            'invoice_date' => $entry->invoice_date?->toDateString(),
            'taxable_value' => (float) $entry->taxable_value,
            'igst_amount' => (float) $entry->igst_amount,
            'cgst_amount' => (float) $entry->cgst_amount,
            'sgst_amount' => (float) $entry->sgst_amount,
            'cess_amount' => (float) $entry->cess_amount,
            'tax_amount' => round($entryTax, 2),
            'total_value' => (float) $entry->total_value,
            'itc_eligible' => (bool) $entry->itc_eligible,
            'match_status' => $entry->match_status,
            'notes' => $entry->notes,
            'matched_purchase' => $purchase ? [
                'id' => $purchase->id,
                'invoice_number' => $purchase->invoice_number,
                'invoice_date' => $purchase->invoice_date?->toDateString(),
                'supplier_name' => $purchase->supplier_name,
                'subtotal' => (float) $purchase->subtotal,
                'tax_total' => round($purchaseTax, 2),
                'grand_total' => (float) $purchase->grand_total,
                'itc_eligibility' => $purchase->itc_eligibility,
                'is_rcm' => (bool) $purchase->is_rcm,
            ] : null,
            'tax_difference' => $purchaseTax !== null ? round($entryTax - $purchaseTax, 2) : null,
        ];
    }

    private function entrySummary($entries): array
    {
        $eligible = $entries->where('itc_eligible', true);

        return [
            'total_entries' => $entries->count(),
            'matched' => $entries->where('match_status', Gstr2bEntry::MATCH_MATCHED)->count(),
            'mismatch' => $entries->where('match_status', Gstr2bEntry::MATCH_MISMATCH)->count(),
            'unmatched' => $entries->where('match_status', Gstr2bEntry::MATCH_UNMATCHED)->count(),
            'itc_eligible_value' => round($eligible->sum(fn (Gstr2bEntry $entry) =>
                (float) $entry->igst_amount + (float) $entry->cgst_amount
                + (float) $entry->sgst_amount + (float) $entry->cess_amount), 2),
            'igst' => round($eligible->sum(fn (Gstr2bEntry $entry) => (float) $entry->igst_amount), 2),
            'cgst' => round($eligible->sum(fn (Gstr2bEntry $entry) => (float) $entry->cgst_amount), 2),
            'sgst' => round($eligible->sum(fn (Gstr2bEntry $entry) => (float) $entry->sgst_amount), 2),
            'cess' => round($eligible->sum(fn (Gstr2bEntry $entry) => (float) $entry->cess_amount), 2),
        ];
    }

    private function findImport(Request $request, int $id): Gstr2bImport
    {
        $import = Gstr2bImport::find($id);

        if (!$import) {
            abort(404, 'GSTR-2B import not found.');
        }

        $user = $request->user();

        if ($import->store_id !== null && !$user->canAccessStore($import->store_id)) {
            abort(403, 'You do not have access to this GSTR-2B import.');
        }

        if ($import->store_id === null && !$user->canViewAllStores()) {
            abort(403, 'You do not have access to this GSTR-2B import.');
        }

        return $import;
    }

    private function resolveImportStoreId(Request $request): int
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? $request->user()?->store_id;

        if ($candidate === null || $candidate === '' || !is_numeric($candidate)) {
            abort(422, 'Select a store before importing GSTR-2B data.');
        }

        $storeId = (int) $candidate;

        if (!$request->user()->canAccessStore($storeId)) {
            abort(403, 'Tenant isolation violation: cross-store access denied.');
        }

        return $storeId;
    }

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

    private function dateRange(Request $request): array
    {
        $validated = $request->validate([
            'start_date' => 'nullable|date_format:Y-m-d',
            'end_date' => 'nullable|date_format:Y-m-d',
        ]);

        $from = $validated['start_date'] ?? Carbon::today()->startOfMonth()->toDateString();
        $to = $validated['end_date'] ?? Carbon::today()->toDateString();

        if ($from > $to) {
            abort(422, 'The start date must be before the end date.');
        }

        return [$from, $to];
    }

    private function fiscalYearRange(Request $request): array
    {
        $validated = $request->validate([
            'fy' => ['nullable', 'regex:/^\d{4}-(\d{2}|\d{4})$/'],
        ]);

        if (isset($validated['fy'])) {
            $startYear = (int) substr($validated['fy'], 0, 4);
        } else {
            $today = Carbon::today();
            $startYear = $today->month >= 4 ? $today->year : $today->year - 1;
        }

        $from = Carbon::create($startYear, 4, 1)->toDateString();
        $to = Carbon::create($startYear + 1, 3, 31)->toDateString();

        return [$from, $to];
    }

    private function rateLabel(?float $rate): string
    {
        if ($rate === null) {
            return 'Header only';
        }

        return rtrim(rtrim(number_format($rate, 2, '.', ''), '0'), '.') . '%';
    }

    private function csvResponse(string $filename, array $headers, iterable $rows): Response
    {
        $handle = fopen('php://temp', 'r+');
        fwrite($handle, "\xEF\xBB\xBF");
        fputcsv($handle, $headers);

        foreach ($rows as $row) {
            fputcsv($handle, array_map(function ($value) {
                if (is_bool($value)) {
                    return $value ? 'Yes' : 'No';
                }

                return $value === null ? '' : $value;
            }, is_array($row) ? $row : iterator_to_array($row)));
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
}
