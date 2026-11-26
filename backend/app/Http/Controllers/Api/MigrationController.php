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
use App\Services\Tax\StoreTaxPolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
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
        private readonly StoreTaxPolicy $taxPolicy,
    ) {}

    /**
     * A terminal is answered by its device token, and the counter that token claims
     * decides the branch. A store_id in the body is ignored from there: a workstation
     * must not be able to write another branch's entire dataset.
     */
    private function isTerminalRequest(Request $request): bool
    {
        return $request->user() === null
            && $request->attributes->get('device_store_id') !== null;
    }

    private function terminalStoreId(Request $request): ?int
    {
        $store = $request->attributes->get('active_store_id')
            ?? $request->attributes->get('device_store_id');

        return $store !== null ? (int) $store : null;
    }

    /**
     * The store a migration may touch, or null when no caller identity resolves one.
     */
    private function resolveStoreId(Request $request, mixed $requested): ?int
    {
        if ($this->isTerminalRequest($request)) {
            return $this->terminalStoreId($request);
        }

        $user = $request->user();
        if (!$user) {
            return null;
        }

        if ($requested && $requested !== 'all' && $user->isSuperAdmin()) {
            return (int) $requested;
        }

        return $user->store_id ? (int) $user->store_id : null;
    }

    private function storeMismatch(Request $request, MigrationRun $run): ?JsonResponse
    {
        $terminalStoreId = $this->isTerminalRequest($request) ? $this->terminalStoreId($request) : null;

        if ($terminalStoreId !== null && (int) $run->store_id !== $terminalStoreId) {
            return response()->json([
                'success' => false,
                'message' => 'This terminal can only act on migration runs for its own store.',
            ], 403);
        }

        return null;
    }

    /**
     * The phrase the cutover step asks to be typed, sent beside the run it belongs
     * to. It is the branch's own code, so nothing secret travels — its job is to stop
     * a confirmation being clicked by accident, not to authorise the caller.
     *
     * @return array<string,mixed>
     */
    private function runResource(MigrationRun $run): array
    {
        $resource = $run->toArray();
        $resource['cutover_phrase'] = $run->store ? "CUTOVER-{$run->store->code}" : null;

        return $resource;
    }

    /**
     * List migration runs for the current store.
     */
    public function index(Request $request): JsonResponse
    {
        $storeId = $this->resolveStoreId($request, $request->query('store_id'));

        if (!$storeId) {
            return response()->json([
                'success' => false,
                'message' => 'Claim this terminal to a counter, or sign in as a store account, to list migration runs.',
            ], 422);
        }

        $runs = MigrationRun::where('store_id', $storeId)
            ->with(['reconciliationReport', 'store'])
            ->orderBy('id', 'desc')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $runs->map(fn(MigrationRun $run) => $this->runResource($run)),
        ]);
    }

    /**
     * MIG-02: Menu & Feature Control decides whether a store may run the pipeline
     * at all. The answer is checked here rather than only hidden in the nav,
     * because a switch that a direct call walks past is a label, not a control.
     *
     * Reading a past run and rolling it back stay open: switching the wizard off
     * is how an owner stops a migration, not how they strand the rows it wrote.
     */
    private function migrationSwitchedOff(Request $request): ?JsonResponse
    {
        if (!$this->isTerminalRequest($request)) {
            return null;
        }

        $storeId = $this->terminalStoreId($request);
        $store = $storeId !== null ? Store::find($storeId) : null;

        if ($store && !$store->featureFlag('allow_data_migration')) {
            return response()->json([
                'success' => false,
                'code' => 'data_migration_disabled',
                'message' => "Data migration is switched off for {$store->name}. Turn it on under Menu & Feature Control, or run the wizard from a store account.",
            ], 403);
        }

        return null;
    }

    /**
     * Accept the exported bundle from a workstation's disk and hand back an opaque
     * reference. The client never names a server path, so nothing here can be pointed
     * at a file the upload did not put there.
     */
    public function upload(Request $request): JsonResponse
    {
        if ($denied = $this->migrationSwitchedOff($request)) {
            return $denied;
        }

        $request->validate([
            'bundle' => 'required|file|max:51200',
        ]);

        $file = $request->file('bundle');
        $raw = file_get_contents($file->getRealPath());

        if (str_starts_with($raw, "\x1f\x8b")) {
            $decoded = gzdecode($raw);
            if ($decoded === false) {
                return response()->json([
                    'success' => false,
                    'message' => 'The bundle is gzip-compressed but could not be decompressed.',
                ], 422);
            }
            $raw = $decoded;
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return response()->json([
                'success' => false,
                'message' => 'The bundle is not readable JSON: ' . json_last_error_msg(),
            ], 422);
        }

        $entities = $this->sourceReader->presentEntities($data);
        if ($entities === []) {
            return response()->json([
                'success' => false,
                'message' => 'The bundle holds no migration entities. Export it again with "php artisan lamsuite:export-store <store_id>".',
            ], 422);
        }

        $ref = (string) Str::uuid();
        Storage::disk('local')->put("migrations/{$ref}.json", $raw);

        return response()->json([
            'success' => true,
            'data' => [
                'bundle_ref' => $ref,
                'bytes' => strlen($raw),
                'entities' => $entities,
            ],
        ]);
    }

    /**
     * Pre-check source data (connectivity, counts, quality diagnostics).
     */
    public function precheck(Request $request): JsonResponse
    {
        if ($denied = $this->migrationSwitchedOff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'store_id' => 'nullable',
            'source_type' => 'required|in:api,file,device',
            'config' => 'required|array',
            'config.tax_mode' => 'nullable|in:inclusive,exclusive',
        ]);

        $storeId = $this->resolveStoreId($request, $validated['store_id'] ?? null);
        if (!$storeId) {
            return response()->json([
                'success' => false,
                'message' => 'Claim this terminal to a counter before migrating its store.',
            ], 422);
        }

        try {
            // The rules above check config.tax_mode, but validated() prunes an array down to the
            // children its rules name — which would drop bundle_ref, url and since before the
            // reader ever sees them. The request's own copy is handed over after the check.
            $config = $this->sourceConfig($request->input('config', []));
            $sourceData = $this->sourceReader->readSource($validated['source_type'], $config);
            $report = $this->diagnosticsService->runPrecheck($sourceData, [
                'tax_mode' => $config['tax_mode'] ?? null,
                'current_tax_mode' => $this->taxPolicy->statedModeForStore($storeId),
            ]);

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
        if ($denied = $this->migrationSwitchedOff($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'store_id' => 'nullable',
            'source_type' => 'required|in:api,file,device',
            'config' => 'required|array',
            'is_dry_run' => 'boolean',
            'config.tax_mode' => 'nullable|in:inclusive,exclusive',
            'mapping_config' => 'nullable|array',
            'mapping_config.tax_mode' => 'nullable|in:inclusive,exclusive',
        ]);

        $storeId = $this->resolveStoreId($request, $validated['store_id'] ?? null);
        if (!$storeId) {
            return response()->json([
                'success' => false,
                'message' => 'Claim this terminal to a counter before migrating its store.',
            ], 422);
        }

        $store = Store::findOrFail($storeId);
        // See precheck: validated() would prune the transport keys the reader needs.
        $config = $this->sourceConfig($request->input('config', []));
        // The pricing mode the operator chose here is the one the import reads prices with, and
        // it has to survive on the run row: a replayed run must not fall back to a default.
        $mappingConfig = $request->input('mapping_config', []);
        $mappingConfig = is_array($mappingConfig) ? $mappingConfig : [];
        if (isset($config['tax_mode'])) {
            $mappingConfig['tax_mode'] = $config['tax_mode'];
        }
        $runUuid = (string) Str::uuid();
        $isDryRun = (bool) ($validated['is_dry_run'] ?? false);

        $run = MigrationRun::create([
            'store_id' => $store->id,
            'user_id' => $request->user()->id ?? null,
            'run_uuid' => $runUuid,
            'source_type' => $validated['source_type'],
            'source_reference' => $config['url'] ?? $config['bundle_ref'] ?? 'device-payload',
            'status' => 'running',
            'is_dry_run' => $isDryRun,
            'mapping_config' => $mappingConfig ?: null,
        ]);

        try {
            $sourceData = $this->sourceReader->readSource($validated['source_type'], $config);
            $stats = $this->pipelineRunner->execute($run, $sourceData, $isDryRun);

            // A dry run writes nothing, so reconciling it against the database would
            // report every entity as missing. The stats are the only honest number.
            $reconciliation = $isDryRun
                ? null
                : $this->reconciliationService->reconcile($run, $sourceData);

            return response()->json([
                'success' => true,
                'data' => [
                    'run' => $this->runResource($run->fresh(['reconciliationReport', 'store'])),
                    'stats' => $stats,
                    'is_dry_run' => $isDryRun,
                    'reconciliation' => $reconciliation,
                    'cutover_phrase' => "CUTOVER-{$store->code}",
                ],
            ]);
        } catch (Throwable $e) {
            // The runner already rolled back and recorded the failure on the run.
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
    public function show(Request $request, string $uuid): JsonResponse
    {
        $run = MigrationRun::where('run_uuid', $uuid)
            ->with(['reconciliationReport', 'unresolvedItems', 'store'])
            ->firstOrFail();

        if ($denied = $this->storeMismatch($request, $run)) {
            return $denied;
        }

        return response()->json([
            'success' => true,
            'data' => $this->runResource($run),
        ]);
    }

    /**
     * Reconcile a migration run against source data.
     */
    public function reconcile(Request $request, string $uuid): JsonResponse
    {
        $run = MigrationRun::where('run_uuid', $uuid)->firstOrFail();

        if ($denied = $this->storeMismatch($request, $run)) {
            return $denied;
        }

        $validated = $request->validate([
            'source_type' => 'required|in:api,file,device',
            'config' => 'required|array',
        ]);

        $sourceData = $this->sourceReader->readSource($validated['source_type'], $this->sourceConfig($validated['config']));
        $report = $this->reconciliationService->reconcile($run, $sourceData);

        return response()->json([
            'success' => true,
            'data' => $report,
        ]);
    }

    /**
     * Rollback a migration run.
     */
    public function rollback(Request $request, string $uuid): JsonResponse
    {
        $run = MigrationRun::where('run_uuid', $uuid)->firstOrFail();

        if ($denied = $this->storeMismatch($request, $run)) {
            return $denied;
        }

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

        if ($denied = $this->storeMismatch($request, $run)) {
            return $denied;
        }

        if ($denied = $this->migrationSwitchedOff($request)) {
            return $denied;
        }

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
        if (!$report) {
            return response()->json([
                'success' => false,
                'message' => 'Cannot cutover: this run has no reconciliation report. Run the migration, then reconcile it.',
            ], 422);
        }
        if (!$report->is_passed) {
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
            'data' => $this->runResource($run->fresh(['store'])),
        ]);
    }

    /**
     * The reader only accepts a bundle_ref it issued; a client-supplied server path is
     * dropped here so it can never reach the filesystem.
     */
    private function sourceConfig(array $config): array
    {
        unset($config['file_path']);

        return $config;
    }
}
