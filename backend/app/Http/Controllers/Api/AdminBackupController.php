<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\BackupRun;
use App\Services\Backup\DatabaseBackupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class AdminBackupController
{
    public function __construct(private DatabaseBackupService $backups)
    {
    }

    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $runs = BackupRun::query()->orderByDesc('id')->limit(100)->get();
        $scheduleTime = (string) config('backup.schedule', '02:00');

        return response()->json([
            'success' => true,
            'driver' => $this->backups->driver(),
            'can_create' => $this->backups->supportsSnapshots(),
            'can_restore' => $this->backups->supportsRestore(),
            'retention_days' => $this->backups->retentionDays(),
            'schedule' => [
                'text' => "Daily at {$scheduleTime} (server time)",
                'time' => $scheduleTime,
                'next_run' => $this->nextRunAt($scheduleTime),
            ],
            'backups' => $runs->map(fn (BackupRun $run) => $this->present($run))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'notes' => 'nullable|string|max:255',
        ]);

        try {
            $run = $this->backups->create('manual', $request->user()?->id, $validated['notes'] ?? null);
        } catch (\RuntimeException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        $this->backups->prune();

        AuditLog::log('create_backup', 'BackupRun', (string) $run->id, null, [
            'filename' => $run->filename,
            'size_bytes' => $run->size_bytes,
        ]);

        return response()->json(['success' => true, 'backup' => $this->present($run->fresh())], 201);
    }

    public function download(Request $request, string $id): BinaryFileResponse|JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $run = BackupRun::find($id);
        if (! $run) {
            return response()->json(['success' => false, 'message' => 'Backup not found.'], 404);
        }

        $absolute = $this->backups->absolutePath($run);
        if (! is_file($absolute)) {
            return response()->json(['success' => false, 'message' => 'Backup file is missing from disk.'], 404);
        }

        AuditLog::log('download_backup', 'BackupRun', (string) $run->id, null, ['filename' => $run->filename]);

        return response()->download($absolute, $run->filename, ['Content-Type' => 'application/gzip']);
    }

    public function restore(Request $request, string $id): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $run = BackupRun::find($id);
        if (! $run) {
            return response()->json(['success' => false, 'message' => 'Backup not found.'], 404);
        }

        $validated = $request->validate([
            'confirmation' => 'required|string',
        ]);

        if (! hash_equals($run->filename, trim($validated['confirmation']))) {
            return response()->json([
                'success' => false,
                'message' => 'Confirmation does not match the backup filename. Type the exact filename to proceed.',
            ], 422);
        }

        try {
            $safety = $this->backups->restore($run);
        } catch (\RuntimeException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], 422);
        }

        AuditLog::log('restore_backup', 'BackupRun', (string) $run->id, null, [
            'filename' => $run->filename,
            'pre_restore_backup_id' => $safety->id,
        ]);

        return response()->json([
            'success' => true,
            'message' => "Database restored from {$run->filename}.",
            'pre_restore_backup' => $this->present($safety->fresh()),
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $run = BackupRun::find($id);
        if (! $run) {
            return response()->json(['success' => false, 'message' => 'Backup not found.'], 404);
        }

        $absolute = $this->backups->absolutePath($run);
        if (is_file($absolute) && ! @unlink($absolute)) {
            return response()->json(['success' => false, 'message' => 'Unable to delete the backup file from disk.'], 500);
        }

        AuditLog::log('delete_backup', 'BackupRun', (string) $run->id, ['filename' => $run->filename], null);
        $run->delete();

        return response()->json(['success' => true, 'message' => 'Backup deleted.']);
    }

    private function present(BackupRun $run): array
    {
        return [
            'id' => $run->id,
            'filename' => $run->filename,
            'size_bytes' => $run->size_bytes,
            'sha256' => $run->sha256,
            'kind' => $run->kind,
            'status' => $run->status,
            'started_at' => $run->started_at?->toIso8601String(),
            'finished_at' => $run->finished_at?->toIso8601String(),
            'created_by' => $run->created_by,
            'creator_name' => $run->creator?->name,
            'notes' => $run->notes,
            'exists' => is_file($this->backups->absolutePath($run)),
        ];
    }

    private function nextRunAt(string $time): string
    {
        [$hour, $minute] = array_pad(array_map('intval', explode(':', $time)), 2, 0);
        $next = now()->setTime($hour, $minute, 0);
        if ($next->isPast()) {
            $next = $next->addDay();
        }

        return $next->toIso8601String();
    }

    private function denyUnlessSuperAdmin(Request $request): ?JsonResponse
    {
        if ($request->user()?->isSuperAdmin()) {
            return null;
        }

        return response()->json([
            'success' => false,
            'message' => 'Central database backups are restricted to the super administrator.',
        ], 403);
    }
}
