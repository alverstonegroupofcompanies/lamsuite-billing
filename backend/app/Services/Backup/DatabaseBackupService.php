<?php

namespace App\Services\Backup;

use App\Models\BackupRun;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class DatabaseBackupService
{
    public function driver(): string
    {
        return DB::connection()->getDriverName();
    }

    public function backupDirectory(): string
    {
        return (string) Config::get('backup.path', storage_path('app/backups'));
    }

    public function retentionDays(): int
    {
        return max(1, (int) Config::get('backup.retention_days', 14));
    }

    /**
     * SQLite is the only driver configured for snapshots. VACUUM INTO also
     * works for the in-memory database used by the test suite.
     */
    public function supportsSnapshots(): bool
    {
        return $this->driver() === 'sqlite';
    }

    public function supportsRestore(): bool
    {
        return $this->supportsSnapshots() && $this->sourcePath() !== ':memory:';
    }

    public function sourcePath(): string
    {
        $path = (string) Config::get('database.connections.sqlite.database', '');

        if ($path === '' || $path === ':memory:' || Str::startsWith($path, '/')) {
            return $path;
        }

        return base_path($path);
    }

    public function absolutePath(BackupRun $run): string
    {
        return $this->backupDirectory() . DIRECTORY_SEPARATOR . $run->disk_path;
    }

    public function create(string $kind = 'manual', ?int $userId = null, ?string $notes = null): BackupRun
    {
        if (! $this->supportsSnapshots()) {
            throw new RuntimeException(
                "Automated snapshots are not configured for the {$this->driver()} driver. Use the native database dump tooling instead."
            );
        }

        $directory = $this->backupDirectory();
        if (! is_dir($directory) && ! mkdir($directory, 0750, true) && ! is_dir($directory)) {
            throw new RuntimeException("Unable to create backup directory: {$directory}");
        }

        $filename = sprintf(
            'lamsuite-%s-%s-%s.sqlite.gz',
            now()->format('Ymd-His'),
            Str::slug($kind),
            Str::lower(Str::random(4))
        );
        $diskPath = $filename;
        $absolute = $directory . DIRECTORY_SEPARATOR . $diskPath;

        $run = BackupRun::create([
            'filename' => $filename,
            'disk_path' => $diskPath,
            'size_bytes' => 0,
            'kind' => $kind,
            'status' => 'running',
            'started_at' => now(),
            'created_by' => $userId,
            'notes' => $notes,
        ]);

        $snapshot = $directory . DIRECTORY_SEPARATOR . '.snapshot-' . Str::random(12) . '.sqlite';

        try {
            $this->vacuumInto($snapshot);
            $this->gzipFile($snapshot, $absolute);

            $run->update([
                'size_bytes' => filesize($absolute) ?: 0,
                'sha256' => hash_file('sha256', $absolute) ?: null,
                'status' => 'completed',
                'finished_at' => now(),
            ]);
        } catch (\Throwable $e) {
            @unlink($absolute);
            $run->update(['status' => 'failed', 'finished_at' => now(), 'notes' => $this->mergeNotes($run->notes, $e->getMessage())]);

            throw $e;
        } finally {
            @unlink($snapshot);
        }

        return $run->fresh();
    }

    /**
     * @return array{deleted: int, kept: int}
     */
    public function prune(?int $retentionDays = null): array
    {
        $cutoff = Carbon::now()->subDays($retentionDays ?? $this->retentionDays());
        $keepPreRestore = max(0, (int) Config::get('backup.keep_pre_restore', 3));

        $expired = BackupRun::query()
            ->where('status', 'completed')
            ->where('kind', '!=', 'pre_restore')
            ->where('created_at', '<', $cutoff)
            ->get();

        $deleted = 0;
        foreach ($expired as $run) {
            @unlink($this->absolutePath($run));
            $run->delete();
            $deleted++;
        }

        $stalePreRestore = BackupRun::query()
            ->where('status', 'completed')
            ->where('kind', 'pre_restore')
            ->where('created_at', '<', $cutoff)
            ->orderByDesc('created_at')
            ->skip($keepPreRestore)
            ->take(1000)
            ->get();

        foreach ($stalePreRestore as $run) {
            @unlink($this->absolutePath($run));
            $run->delete();
            $deleted++;
        }

        return ['deleted' => $deleted, 'kept' => BackupRun::count()];
    }

    public function verify(BackupRun $run): array
    {
        $absolute = $this->absolutePath($run);
        if (! is_file($absolute)) {
            return ['ok' => false, 'message' => 'Backup file is missing from disk.'];
        }

        $hash = hash_file('sha256', $absolute);
        $size = filesize($absolute) ?: 0;

        return [
            'ok' => $run->sha256 === null || hash_equals($run->sha256, (string) $hash),
            'size_bytes' => $size,
            'sha256' => $hash,
            'recorded_sha256' => $run->sha256,
        ];
    }

    public function restore(BackupRun $run): BackupRun
    {
        if (! $this->supportsRestore()) {
            throw new RuntimeException('Restore is not available for the current database driver.');
        }

        if ($run->status !== 'completed') {
            throw new RuntimeException('Only completed backups can be restored.');
        }

        $absolute = $this->absolutePath($run);
        if (! is_file($absolute)) {
            throw new RuntimeException('Backup file is missing from disk.');
        }

        $verification = $this->verify($run);
        if (! $verification['ok']) {
            throw new RuntimeException('Checksum verification failed; refusing to restore a corrupted backup.');
        }

        $target = $this->sourcePath();
        $working = $target . '.restore-' . Str::random(10);

        try {
            $this->gunzipFile($absolute, $working);
            $this->assertSqliteIntegrity($working);
        } catch (\Throwable $e) {
            @unlink($working);
            throw $e;
        }

        $safety = $this->create('pre_restore', $run->created_by, 'Automatic snapshot before restoring ' . $run->filename);

        DB::disconnect();
        $displaced = $target . '.displaced-' . now()->format('YmdHis');

        try {
            foreach (['-wal', '-shm'] as $suffix) {
                @unlink($target . $suffix);
            }

            if (is_file($target) && ! rename($target, $displaced)) {
                throw new RuntimeException('Unable to move the current database aside for restore.');
            }

            if (! rename($working, $target)) {
                if (is_file($displaced)) {
                    @rename($displaced, $target);
                }
                throw new RuntimeException('Unable to move the restored database into place.');
            }
        } finally {
            DB::purge();
            DB::reconnect();
        }

        // Keep one displaced copy next to the DB as a last-resort rollback path;
        // the pre_restore snapshot is the primary rollback artifact.
        if (is_file($displaced)) {
            @unlink($displaced);
        }

        // The pre_restore row was written into the database that was just
        // replaced, so re-register it in the restored database.
        if (! BackupRun::whereKey($safety->id)->exists()) {
            $safety = BackupRun::create([
                'filename' => $safety->filename,
                'disk_path' => $safety->disk_path,
                'size_bytes' => $safety->size_bytes,
                'sha256' => $safety->sha256,
                'kind' => $safety->kind,
                'status' => $safety->status,
                'started_at' => $safety->started_at,
                'finished_at' => $safety->finished_at,
                'created_by' => $safety->created_by,
                'notes' => $safety->notes,
            ]);
        }

        return $safety;
    }

    private function vacuumInto(string $path): void
    {
        $escaped = str_replace("'", "''", $path);
        DB::statement("VACUUM INTO '{$escaped}'");
    }

    private function gzipFile(string $source, string $destination): void
    {
        $in = fopen($source, 'rb');
        if ($in === false) {
            throw new RuntimeException("Unable to read snapshot at {$source}");
        }

        $out = gzopen($destination, 'wb9');
        if ($out === false) {
            fclose($in);
            throw new RuntimeException("Unable to open backup target {$destination}");
        }

        try {
            while (! feof($in)) {
                $chunk = fread($in, 1048576);
                if ($chunk === false) {
                    throw new RuntimeException('Failed while reading database snapshot.');
                }
                gzwrite($out, $chunk);
            }
            gzclose($out);
        } finally {
            fclose($in);
        }
    }

    private function gunzipFile(string $source, string $destination): void
    {
        $in = gzopen($source, 'rb');
        if ($in === false) {
            throw new RuntimeException("Unable to open backup archive {$source}");
        }

        $out = fopen($destination, 'wb');
        if ($out === false) {
            gzclose($in);
            throw new RuntimeException("Unable to write restore staging file {$destination}");
        }

        try {
            while (! gzeof($in)) {
                $chunk = gzread($in, 1048576);
                if ($chunk === false) {
                    throw new RuntimeException('Failed while reading backup archive.');
                }
                fwrite($out, $chunk);
            }
        } finally {
            gzclose($in);
            fclose($out);
        }
    }

    private function assertSqliteIntegrity(string $path): void
    {
        $pdo = new \PDO('sqlite:' . $path);
        $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);

        $check = $pdo->query('PRAGMA integrity_check')->fetchColumn();
        if ($check !== 'ok') {
            throw new RuntimeException("Backup integrity check failed: {$check}");
        }

        $tables = (int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'")->fetchColumn();
        if ($tables === 0) {
            throw new RuntimeException('Backup contains no tables.');
        }
    }

    private function mergeNotes(?string $existing, string $message): string
    {
        $message = trim($message);

        return $existing ? $existing . ' | ' . $message : $message;
    }
}
