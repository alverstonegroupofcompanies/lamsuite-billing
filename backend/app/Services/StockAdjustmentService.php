<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockAdjustment;
use App\Models\StockAdjustmentDocument;
use App\Models\StockAdjustmentLine;
use App\Models\StockLedgerEntry;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class StockAdjustmentService
{
    public function __construct(private StockAdjustmentPolicy $policy)
    {
    }

    /**
     * Post (or queue for approval) one multi-line stock adjustment document.
     *
     * A client-generated document_id makes the operation idempotent, so the
     * local-first sync queue can retry safely with the same id.
     *
     * @return array{document: StockAdjustmentDocument, duplicate: bool}
     */
    public function post(int $storeId, ?User $user, array $payload, ?Counter $counter = null): array
    {
        $documentId = trim((string) ($payload['document_id'] ?? ''));
        if ($documentId === '') {
            $documentId = 'adj_' . now()->format('YmdHis') . '_' . substr(md5(uniqid('', true)), 0, 6);
        }

        $existing = StockAdjustmentDocument::where('document_id', $documentId)->first();
        if ($existing) {
            return ['document' => $existing->load('lines'), 'duplicate' => true];
        }

        $mode = ($payload['mode'] ?? 'adjustment') === 'physical_count' ? 'physical_count' : 'adjustment';
        $notes = $payload['notes'] ?? null;
        $documentDate = $payload['document_date'] ?? now()->toDateString();
        $rawLines = $payload['lines'] ?? [];

        if (!is_array($rawLines) || count($rawLines) === 0) {
            throw ValidationException::withMessages(['lines' => 'At least one adjustment line is required.']);
        }

        $resolved = [];
        foreach (array_values($rawLines) as $index => $raw) {
            $resolved[] = $this->resolveLine($storeId, $raw, $index + 1, $mode);
        }

        $check = $this->policy->validate(
            $storeId,
            $user,
            $resolved,
            $mode,
            $notes,
            $documentDate,
            $counter
        );

        if (!empty($check['errors'])) {
            throw ValidationException::withMessages([
                'policy' => $check['errors'],
                'blocking_rule' => $check['blocker'],
            ]);
        }

        $postedLines = array_values(array_filter($resolved, fn($line) => (float) $line['adjustment_qty'] !== 0.0));
        if (count($postedLines) === 0) {
            throw ValidationException::withMessages(['lines' => 'All adjustment lines have zero variance.']);
        }

        $status = $check['requires_approval'] ? 'pending_approval' : 'posted';
        $totalQty = 0.0;
        $totalValue = 0.0;
        foreach ($postedLines as $line) {
            $totalQty += abs((float) $line['adjustment_qty']);
            $totalValue += abs((float) $line['adjustment_qty']) * (float) ($line['unit_cost'] ?? 0);
        }

        return DB::transaction(function () use (
            $storeId,
            $user,
            $counter,
            $documentId,
            $mode,
            $notes,
            $documentDate,
            $status,
            $check,
            $postedLines,
            $totalQty,
            $totalValue
        ) {
            $document = StockAdjustmentDocument::create([
                'document_id' => $documentId,
                'store_id' => $storeId,
                'counter_id' => $counter?->id,
                'mode' => $mode,
                'reason' => $postedLines[0]['reason'] ?? null,
                'notes' => $notes,
                'document_date' => substr((string) $documentDate, 0, 10),
                'status' => $status,
                'requires_approval' => (bool) $check['requires_approval'],
                'blocking_rule' => null,
                'lines_count' => count($postedLines),
                'total_qty' => $totalQty,
                'total_value' => $totalValue,
                'metadata' => ['source' => 'stock_adjustment'],
                'created_by' => $user?->id,
            ]);

            foreach ($postedLines as $line) {
                StockAdjustmentLine::create([
                    'stock_adjustment_document_id' => $document->id,
                    'product_id' => $line['product_id'],
                    'batch_id' => $line['batch_id'],
                    'batch_no' => $line['batch_no'],
                    'product_name' => $line['product_name'],
                    'system_qty' => $line['system_qty'],
                    'counted_qty' => $line['counted_qty'],
                    'adjustment_qty' => $line['adjustment_qty'],
                    'unit_cost' => $line['unit_cost'],
                    'reason' => $line['reason'],
                    'notes' => $line['notes'],
                ]);
            }

            if ($status === 'posted') {
                $this->applyLines($document, $user, $storeId);
            }

            AuditLog::log(
                $status === 'posted' ? 'post_stock_adjustment' : 'submit_stock_adjustment',
                'StockAdjustmentDocument',
                (string) $document->id,
                null,
                [
                    'document_id' => $document->document_id,
                    'mode' => $mode,
                    'lines' => count($postedLines),
                    'total_qty' => $totalQty,
                    'total_value' => $totalValue,
                    'requester_role' => StockAdjustmentPolicy::normalizeRole($user?->role),
                ],
                $storeId
            );

            return ['document' => $document->fresh('lines'), 'duplicate' => false];
        });
    }

    public function approve(StockAdjustmentDocument $document, User $approver): StockAdjustmentDocument
    {
        if ($document->status !== 'pending_approval') {
            throw ValidationException::withMessages(['status' => 'Only documents pending approval can be approved.']);
        }

        if (!$this->policy->canApprove($approver, (int) $document->store_id)) {
            throw ValidationException::withMessages([
                'approval' => 'Your role is not permitted to approve stock adjustments for this store.',
            ]);
        }

        return DB::transaction(function () use ($document, $approver) {
            $this->applyLines($document, $approver, (int) $document->store_id);

            $document->update([
                'status' => 'approved',
                'approved_by' => $approver->id,
                'approved_at' => now(),
            ]);

            AuditLog::log(
                'approve_stock_adjustment',
                'StockAdjustmentDocument',
                (string) $document->id,
                ['status' => 'pending_approval'],
                ['status' => 'approved', 'approved_by' => $approver->id],
                (int) $document->store_id
            );

            return $document->fresh('lines');
        });
    }

    public function reject(StockAdjustmentDocument $document, User $approver, ?string $reason = null): StockAdjustmentDocument
    {
        if ($document->status !== 'pending_approval') {
            throw ValidationException::withMessages(['status' => 'Only documents pending approval can be rejected.']);
        }

        if (!$this->policy->canApprove($approver, (int) $document->store_id)) {
            throw ValidationException::withMessages([
                'approval' => 'Your role is not permitted to reject stock adjustments for this store.',
            ]);
        }

        $document->update([
            'status' => 'rejected',
            'approved_by' => $approver->id,
            'approved_at' => now(),
            'blocking_rule' => $reason ?: 'Rejected by approver',
        ]);

        AuditLog::log(
            'reject_stock_adjustment',
            'StockAdjustmentDocument',
            (string) $document->id,
            ['status' => 'pending_approval'],
            ['status' => 'rejected', 'reason' => $reason],
            (int) $document->store_id
        );

        return $document->fresh('lines');
    }

    /**
     * Resolve and validate one incoming line against the batch master.
     */
    private function resolveLine(int $storeId, array $raw, int $lineNo, string $mode): array
    {
        $product = null;
        $productId = $raw['product_id'] ?? null;
        if ($productId !== null && $productId !== '') {
            $product = Product::where('store_id', $storeId)
                ->where(function ($q) use ($productId) {
                    $q->where('id', $productId)->orWhere('external_id', (string) $productId);
                })
                ->first();
        }
        if (!$product && !empty($raw['barcode'])) {
            $product = Product::where('store_id', $storeId)->where('barcode', $raw['barcode'])->first();
        }
        if (!$product) {
            throw ValidationException::withMessages([
                "lines.$lineNo" => "Product not found for line {$lineNo}.",
            ]);
        }

        $batch = null;
        $batchId = $raw['batch_id'] ?? null;
        if ($batchId !== null && $batchId !== '' && is_numeric($batchId)) {
            $batch = ProductBatch::where('store_id', $storeId)->where('id', $batchId)->first();
        }
        if (!$batch && !empty($raw['batch_no'])) {
            $batch = ProductBatch::where('store_id', $storeId)
                ->where('product_id', $product->id)
                ->where('batch_no', (string) $raw['batch_no'])
                ->first();
        }

        if (!$batch) {
            throw ValidationException::withMessages([
                "lines.$lineNo" => sprintf(
                    'Batch "%s" for "%s" was not found in this store.',
                    $raw['batch_no'] ?? '-',
                    $product->name
                ),
            ]);
        }

        $systemQty = (float) $batch->stock_qty;
        $countedQty = array_key_exists('counted_qty', $raw) && $raw['counted_qty'] !== null && $raw['counted_qty'] !== ''
            ? (float) $raw['counted_qty']
            : null;

        if ($mode === 'physical_count') {
            if ($countedQty === null) {
                throw ValidationException::withMessages([
                    "lines.$lineNo" => "Counted quantity is required for line {$lineNo} in physical-count mode.",
                ]);
            }
            $delta = $countedQty - $systemQty;
        } else {
            $delta = (float) ($raw['adjustment_qty'] ?? 0);
        }

        return [
            'line_no' => $lineNo,
            'product_id' => $product->id,
            'product_name' => $product->name,
            'batch_id' => $batch->id,
            'batch_no' => $batch->batch_no,
            'system_qty' => $systemQty,
            'counted_qty' => $countedQty,
            'adjustment_qty' => round($delta, 3),
            'unit_cost' => isset($raw['unit_cost']) && $raw['unit_cost'] !== ''
                ? (float) $raw['unit_cost']
                : (float) ($batch->purchase_rate ?? 0),
            'reason' => $raw['reason'] ?? null,
            'notes' => $raw['notes'] ?? null,
        ];
    }

    /**
     * Apply every line in the document: one ledger entry per line and a single
     * balance update per batch. Must run inside a DB transaction.
     */
    private function applyLines(StockAdjustmentDocument $document, ?User $user, int $storeId): void
    {
        $now = now();

        foreach ($document->lines()->orderBy('id')->get() as $lineNo => $line) {
            $batch = ProductBatch::where('store_id', $storeId)->where('id', $line->batch_id)->first();
            if (!$batch) {
                throw ValidationException::withMessages([
                    'lines' => sprintf('Batch %s is no longer available for adjustment.', $line->batch_no ?? $line->batch_id),
                ]);
            }

            $delta = (float) $line->adjustment_qty;
            if ($delta === 0.0) {
                continue;
            }

            $currentBalance = (float) $batch->stock_qty;
            $newBalance = round($currentBalance + $delta, 3);

            $batch->update(['stock_qty' => $newBalance]);

            $totalStock = ProductBatch::where('store_id', $storeId)
                ->where('product_id', $line->product_id)
                ->sum('stock_qty');
            Product::where('id', $line->product_id)->update(['current_stock' => $totalStock]);

            $eventType = $document->mode === 'physical_count'
                ? 'RECONCILIATION_ADJUSTMENT'
                : ($delta >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT');

            $ledgerEntry = StockLedgerEntry::firstOrCreate(
                ['idempotency_key' => 'stock_adj_' . $document->document_id . '_' . ($lineNo + 1)],
                [
                    'store_id' => $storeId,
                    'product_id' => $line->product_id,
                    'batch_id' => $line->batch_id,
                    'counter_id' => $document->counter_id,
                    'counter_code' => $document->counter_id
                        ? \App\Models\Counter::whereKey($document->counter_id)->value('counter_code')
                        : null,
                    'location_name' => null,
                    'event_type' => $eventType,
                    'qty_delta' => $delta,
                    'reference_type' => 'STOCK_ADJUSTMENT',
                    'reference_id' => $document->document_id,
                    'is_reconciled_negative' => $newBalance < 0,
                    'balance_after' => $newBalance,
                    'staff_user_id' => $user?->id,
                ]
            );

            // AUD-02: a write-off that takes the shelf below zero is the owner's business too.
            if ($ledgerEntry->wasRecentlyCreated && $newBalance < 0) {
                app(\App\Services\Alerts\OperationalAlertService::class)->negativeStockFromLedger($ledgerEntry);
            }

            // Keep the legacy line-level table populated for older admin views.
            StockAdjustment::create([
                'store_id' => $storeId,
                'product_id' => $line->product_id,
                'batch_no' => $line->batch_no,
                'adjustment_type' => $delta >= 0 ? 'increase' : 'decrease',
                'qty' => abs($delta),
                'reason' => trim(($line->reason ?: $document->reason ?: $eventType) . ' [' . $document->document_id . ']'),
                'user_id' => $user?->id,
            ]);
        }

        $document->forceFill(['metadata' => array_merge($document->metadata ?? [], [
            'applied_at' => $now->toIso8601String(),
        ])])->save();
    }
}
