<?php

namespace App\Http\Controllers\Api;

use App\Models\SettlementBatch;
use App\Models\SettlementLine;
use App\Models\Store;
use App\Services\Payments\SettlementReconService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminSettlementController
{
    public function __construct(private readonly SettlementReconService $recon)
    {
    }

    private function resolveStore(Request $request): ?Store
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->input('store_id')
            ?? ($request->user() ? $request->user()->store_id : null);

        if ($candidate !== null && $candidate !== '' && $candidate !== 'all') {
            return Store::find((int) $candidate);
        }

        return Store::query()->orderBy('id')->first();
    }

    public function index(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $batches = SettlementBatch::where('store_id', $store->id)
            ->withCount([
                'lines as unmatched_lines' => fn ($q) => $q->whereIn('status', [SettlementLine::STATUS_UNMATCHED, SettlementLine::STATUS_EXCEPTION]),
            ])
            ->orderByDesc('id')
            ->limit(100)
            ->get();

        return response()->json([
            'success' => true,
            'batches' => $batches->map(fn (SettlementBatch $batch) => [
                'id' => $batch->id,
                'source' => $batch->source,
                'file_name' => $batch->file_name,
                'period_start' => $batch->period_start?->toDateString(),
                'period_end' => $batch->period_end?->toDateString(),
                'total_amount' => (float) $batch->total_amount,
                'line_count' => $batch->line_count,
                'matched_count' => $batch->matched_count,
                'exception_count' => $batch->exception_count,
                'status' => $batch->status,
                'notes' => $batch->notes,
                'created_at' => optional($batch->created_at)->toIso8601String(),
            ])->values(),
        ]);
    }

    public function preview(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $csv = $this->readCsv($request);
        if ($csv instanceof JsonResponse) return $csv;

        try {
            $parsed = $this->recon->parseCsv($csv);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        $preview = $this->recon->preview($store->id, $parsed['rows']);

        return response()->json([
            'success' => empty($parsed['errors']) || !empty($parsed['rows']),
            'row_count' => count($parsed['rows']),
            'total_amount' => round(array_sum(array_map(fn ($r) => (float) $r['amount'], $parsed['rows'])), 2),
            'matched' => count(array_filter($preview, fn ($r) => $r['status'] === SettlementLine::STATUS_MATCHED)),
            'exceptions' => count(array_filter($preview, fn ($r) => in_array($r['status'], [SettlementLine::STATUS_EXCEPTION, SettlementLine::STATUS_UNMATCHED], true))),
            'rows' => $preview,
            'errors' => $parsed['errors'],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['success' => false, 'message' => 'Store not found.'], 404);
        }

        $csv = $this->readCsv($request);
        if ($csv instanceof JsonResponse) return $csv;

        try {
            $parsed = $this->recon->parseCsv($csv);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        if (empty($parsed['rows'])) {
            return response()->json(['success' => false, 'message' => 'No valid rows found in the settlement file.', 'errors' => $parsed['errors']], 422);
        }

        $batch = $this->recon->import($store->id, $parsed['rows'], [
            'source' => $request->input('source', 'bank'),
            'file_name' => $request->input('file_name') ?: ($request->hasFile('file') ? $request->file('file')->getClientOriginalName() : null),
            'period_start' => $request->input('period_start'),
            'period_end' => $request->input('period_end'),
            'notes' => $request->input('notes'),
        ], $request->user()?->id);

        return response()->json([
            'success' => true,
            'batch' => [
                'id' => $batch->id,
                'total_amount' => (float) $batch->total_amount,
                'line_count' => $batch->line_count,
                'matched_count' => $batch->matched_count,
                'exception_count' => $batch->exception_count,
                'status' => $batch->status,
            ],
            'parse_errors' => $parsed['errors'],
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $batch = SettlementBatch::when($store, fn ($q) => $q->where('store_id', $store->id))->find($id);
        if (!$batch) {
            return response()->json(['success' => false, 'message' => 'Settlement batch not found.'], 404);
        }

        $status = $request->query('status');
        $lines = $batch->lines()
            ->when($status, fn ($q, $value) => $q->where('status', $value))
            ->orderBy('id')
            ->limit(1000)
            ->get();

        return response()->json([
            'success' => true,
            'batch' => [
                'id' => $batch->id,
                'source' => $batch->source,
                'file_name' => $batch->file_name,
                'period_start' => $batch->period_start?->toDateString(),
                'period_end' => $batch->period_end?->toDateString(),
                'total_amount' => (float) $batch->total_amount,
                'line_count' => $batch->line_count,
                'matched_count' => $batch->matched_count,
                'exception_count' => $batch->exception_count,
                'status' => $batch->status,
                'notes' => $batch->notes,
                'created_at' => optional($batch->created_at)->toIso8601String(),
            ],
            'lines' => $lines->map(fn (SettlementLine $line) => $this->presentLine($line))->values(),
        ]);
    }

    public function rematch(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $batch = SettlementBatch::when($store, fn ($q) => $q->where('store_id', $store->id))->find($id);
        if (!$batch) {
            return response()->json(['success' => false, 'message' => 'Settlement batch not found.'], 404);
        }

        $batch = $this->recon->rematch($batch);

        return response()->json([
            'success' => true,
            'batch' => [
                'id' => $batch->id,
                'matched_count' => $batch->matched_count,
                'exception_count' => $batch->exception_count,
                'status' => $batch->status,
            ],
        ]);
    }

    public function resolveLine(Request $request, string $id): JsonResponse
    {
        $store = $this->resolveStore($request);
        $line = SettlementLine::when($store, fn ($q) => $q->where('store_id', $store->id))->find($id);
        if (!$line) {
            return response()->json(['success' => false, 'message' => 'Settlement line not found.'], 404);
        }

        $validated = $request->validate([
            'action' => 'required|in:ignore,attach',
            'match_type' => 'required_if:action,attach|in:invoice_payment,customer_payment',
            'match_id' => 'required_if:action,attach|integer',
            'note' => 'nullable|string|max:500',
        ]);

        try {
            $line = $this->recon->resolveLine(
                $line,
                $validated['action'],
                $validated['match_type'] ?? null,
                isset($validated['match_id']) ? (int) $validated['match_id'] : null,
                $validated['note'] ?? null
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        return response()->json(['success' => true, 'line' => $this->presentLine($line)]);
    }

    private function readCsv(Request $request): string|JsonResponse
    {
        if ($request->hasFile('file')) {
            return (string) file_get_contents($request->file('file')->getRealPath());
        }

        $csv = $request->input('csv');
        if (is_string($csv) && trim($csv) !== '') {
            return $csv;
        }

        return response()->json(['success' => false, 'message' => 'Upload a CSV file or provide raw CSV text.'], 422);
    }

    private function presentLine(SettlementLine $line): array
    {
        return [
            'id' => $line->id,
            'txn_date' => $line->txn_date?->toDateString(),
            'reference' => $line->reference,
            'amount' => (float) $line->amount,
            'mode' => $line->mode,
            'payer_ref' => $line->payer_ref,
            'status' => $line->status,
            'match_type' => $line->match_type,
            'match_id' => $line->match_id,
            'invoice_number' => $line->invoice_number,
            'note' => $line->note,
        ];
    }
}
