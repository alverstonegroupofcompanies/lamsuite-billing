<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MigrationRun;
use App\Models\MigrationUnresolvedItem;
use App\Models\Store;
use App\Services\Migration\MigrationDiagnosticsService;
use App\Services\Migration\MigrationPipelineRunner;
use App\Services\Migration\MigrationReconciliationService;
use App\Services\Migration\MigrationRollbackService;
use App\Services\Migration\MigrationSourceReader;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Throwable;

class MigrationController extends Controller
{
    public function __construct(
        private readonly MigrationSourceReader $sourceReader,
        private readonly MigrationDiagnosticsService $diagnosticsService,
        private readonly MigrationPipelineRunner $pipelineRunner,
        private readonly MigrationReconciliationService $reconciliationService,
        private readonly MigrationRollbackService $rollbackService,
    ) {}

    /**
     * List migration runs for the current store.
     */
    public function index(Request $request): JsonResponse
    {
        $storeId = $request->user()->store_id ?? $request->query('store_id');
        $runs = MigrationRun::where('store_id', $storeId)
            ->with(['reconciliationReport'])
            ->orderBy('id', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $runs,
        ]);
    }

    /**
     * Pre-check source data (connectivity, counts, quality diagnostics).
     */
    public function precheck(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required|integer',
            'source_type' => 'required|in:api,file,device',
            'config' => 'required|array',
        ]);

        try {
            $sourceData = $this->sourceReader->readSource($validated['source_type'], $validated['config']);
            $report = $this->diagnosticsService->runPrecheck($sourceData);

            return response()->json([
                'success' => true,
                'data' => $report,
            ]);
        } catch (Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 422);
        }
    }

    /**
     * Start a migration run or a dry-run.
     */
    public function start(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'store_id' => 'required|integer',
            'source_type' => 'required|in:api,file,device',
            'config' => 'required|array',
            'is_dry_run' => 'boolean',
            'mapping_config' => 'nullable|array',
        ]);

        $store = Store::findOrFail($validated['store_id']);
        $runUuid = (string)Str::uuid();
        $isDryRun = (bool)($validated['is_dry_run'] ?? false);

        $run = MigrationRun::create([
            'store_id' => $store->id,
            'user_id' => $request->user()->id ?? null,
            'run_uuid' => $runUuid,
            'source_type' => $validated['source_type'],
            'source_reference' => $validated['config']['url'] ?? $validated['config']['file_path'] ?? 'device-payload',
            'status' => 'running',
            'is_dry_run' => $isDryRun,
            'mapping_config' => $validated['mapping_config'] ?? null,
        ]);

        try {
            $sourceData = $this->sourceReader->readSource($validated['source_type'], $validated['config']);
            $stats = $this->pipelineRunner->execute($run, $sourceData, $isDryRun);

            // Run reconciliation report
            $reconciliation = $this->reconciliationService->reconcile($run, $sourceData);

            return response()->json([
                'success' => true,
                'data' => [
                    'run' => $run->fresh(['reconciliationReport']),
                    'stats' => $stats,
                    'reconciliation' => $reconciliation,
                ],
            ]);
        } catch (Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'Migration failed: ' . $e->getMessage(),
                'run' => $run->fresh(),
            ], 500);
        }
    }

    /**
     * Get details of a specific migration run.
     */
    public function show(string $uuid): JsonResponse
    {
        $run = MigrationRun::where('run_uuid', $uuid)
            ->with(['reconciliationReport', 'unresolvedItems'])
            ->firstOrFail();

        return response()->json([
            'success' => true,
            'data' => $run,
        ]);
    }

    /**
     * Reconcile a migration run against source data.
     */
    public function reconcile(Request $request, string $uuid): JsonResponse
    {
        $run = MigrationRun::where('run_uuid', $uuid)->firstOrFail();
        $validated = $request->validate([
            'source_type' => 'required|in:api,file,device',
            'config' => 'required|array',
        ]);

        $sourceData = $this->sourceReader->readSource($validated['source_type'], $validated['config']);
        $report = $this->reconciliationService->reconcile($run, $sourceData);

        return response()->json([
            'success' => true,
            'data' => $report,
        ]);
    }

    /**
     * Rollback a migration run.
     */
    public function rollback(string $uuid): JsonResponse
    {
        $run = MigrationRun::where('run_uuid', $uuid)->firstOrFail();
        try {
            $stats = $this->rollbackService->rollback($run);

            return response()->json([
                'success' => true,
                'message' => 'Migration run successfully rolled back.',
                'data' => $stats,
            ]);
        } catch (Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => 'Rollback failed: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Confirm final cutover for a store.
     */
    public function cutover(Request $request, string $uuid): JsonResponse
    {
        $run = MigrationRun::where('run_uuid', $uuid)->firstOrFail();
        $store = Store::findOrFail($run->store_id);

        $validated = $request->validate([
            'confirmation_phrase' => 'required|string',
        ]);

        $expectedPhrase = "CUTOVER-{$store->code}";
        if (trim($validated['confirmation_phrase']) !== $expectedPhrase) {
            return response()->json([
                'success' => false,
                'message' => "Confirmation phrase mismatch. Please enter '{$expectedPhrase}' to confirm.",
            ], 422);
        }

        // Verify reconciliation passed
        $report = $run->reconciliationReport;
        if ($report && !$report->is_passed) {
            return response()->json([
                'success' => false,
                'message' => 'Cannot cutover: critical reconciliation mismatches remain. Resolve or review them first.',
            ], 422);
        }

        $run->update([
            'cutover_confirmation' => $validated['confirmation_phrase'],
            'cutover_at' => now(),
            'status' => 'completed',
        ]);

        return response()->json([
            'success' => true,
            'message' => "Cutover confirmed for store {$store->name}. Store is now fully active on new system.",
            'data' => $run->fresh(),
        ]);
    }
}
