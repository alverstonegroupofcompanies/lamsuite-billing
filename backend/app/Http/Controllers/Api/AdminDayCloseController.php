<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\StoreDayClose;
use App\Services\DayClose\StoreDayCloseService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminDayCloseController
{
    public function __construct(private StoreDayCloseService $service)
    {
    }

    public function show(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        if (! $storeId) {
            return $this->storeRequired();
        }

        $date = $this->resolveDate($request);
        if ($date === null) {
            return response()->json(['success' => false, 'message' => 'Invalid date supplied.'], 422);
        }

        return response()->json([
            'success' => true,
            'day_close' => $this->service->summary($storeId, $date),
        ]);
    }

    public function history(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        if (! $storeId) {
            return $this->storeRequired();
        }

        return response()->json([
            'success' => true,
            'history' => $this->service->history($storeId, $request->query('from'), $request->query('to')),
        ]);
    }

    public function close(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        if (! $storeId) {
            return $this->storeRequired();
        }

        $validated = $request->validate([
            'close_date' => 'required|date',
            'notes' => 'nullable|string|max:500',
        ]);

        try {
            $close = $this->service->close(
                $storeId,
                $validated['close_date'],
                $request->user()?->id,
                $validated['notes'] ?? null
            );
        } catch (\App\Exceptions\BusinessRuleException $e) {
            return $e->render();
        }

        AuditLog::log('close_store_day', 'StoreDayClose', (string) $close->id, null, [
            'close_date' => $close->close_date?->toDateString(),
            'expected_cash' => (float) $close->expected_cash,
            'cash_collected' => (float) $close->total_cash_collected,
        ], $storeId);

        return response()->json([
            'success' => true,
            'day_close' => $this->service->summary($storeId, $close->close_date->toDateString()),
            'message' => "Day {$close->close_date->toDateString()} closed. Expected cash ₹" . number_format((float) $close->expected_cash, 2) . ' pending reconciliation.',
        ]);
    }

    public function reconcile(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request);
        if (! $storeId) {
            return $this->storeRequired();
        }

        $validated = $request->validate([
            'close_date' => 'required|date',
            'counted_cash' => 'required|numeric|min:0',
            'notes' => 'nullable|string|max:500',
        ]);

        try {
            $close = StoreDayClose::query()
                ->where('store_id', $storeId)
                ->whereDate('close_date', $validated['close_date'])
                ->first();

            if (! $close) {
                $close = $this->service->close($storeId, $validated['close_date'], $request->user()?->id);
            }

            $close = $this->service->reconcile(
                $close,
                (float) $validated['counted_cash'],
                $request->user()?->id,
                $validated['notes'] ?? null
            );
        } catch (\App\Exceptions\BusinessRuleException $e) {
            return $e->render();
        }

        AuditLog::log('reconcile_store_day', 'StoreDayClose', (string) $close->id, null, [
            'close_date' => $close->close_date?->toDateString(),
            'counted_cash' => (float) $close->counted_cash,
            'expected_cash' => (float) $close->expected_cash,
            'variance' => (float) $close->cash_variance,
        ], $storeId);

        return response()->json([
            'success' => true,
            'day_close' => $this->service->summary($storeId, $close->close_date->toDateString()),
            'message' => 'Day reconciled. Cash variance ₹' . number_format((float) $close->cash_variance, 2) . '.',
        ]);
    }

    public function reopen(Request $request): JsonResponse
    {
        if (! $request->user()?->isSuperAdmin()) {
            return response()->json([
                'success' => false,
                'message' => 'Only a super administrator can reopen a reconciled day.',
            ], 403);
        }

        $storeId = $this->resolveStoreId($request);
        if (! $storeId) {
            return $this->storeRequired();
        }

        $validated = $request->validate([
            'close_date' => 'required|date',
            'reason' => 'nullable|string|max:300',
        ]);

        $close = StoreDayClose::query()
            ->where('store_id', $storeId)
            ->whereDate('close_date', $validated['close_date'])
            ->first();

        if (! $close) {
            return response()->json(['success' => false, 'message' => 'No day close found for that date.'], 404);
        }

        $close = $this->service->reopen($close, $validated['reason'] ?? null);

        AuditLog::log('reopen_store_day', 'StoreDayClose', (string) $close->id, null, [
            'close_date' => $close->close_date?->toDateString(),
            'reason' => $validated['reason'] ?? null,
        ], $storeId);

        return response()->json([
            'success' => true,
            'day_close' => $this->service->summary($storeId, $close->close_date->toDateString()),
            'message' => 'Day reopened. Backdated bills are allowed again until the next reconciliation.',
        ]);
    }

    private function resolveStoreId(Request $request): ?int
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->input('store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->user()?->store_id;

        return is_numeric($candidate) ? (int) $candidate : null;
    }

    private function resolveDate(Request $request): ?string
    {
        $candidate = (string) $request->query('date', now()->toDateString());

        try {
            return \Carbon\Carbon::parse($candidate)->toDateString();
        } catch (\Throwable) {
            return null;
        }
    }

    private function storeRequired(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Select a store to view its day close.',
        ], 422);
    }
}
