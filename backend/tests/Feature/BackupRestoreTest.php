<?php

namespace Tests\Feature;

use App\Models\BackupRun;
use App\Models\Store;
use App\Models\User;
use App\Services\Backup\DatabaseBackupService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class BackupRestoreTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $superAdmin;
    protected User $manager;
    protected string $backupDir;
    protected FakeBackupService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Apex Healthcare',
            'code' => 'APEX-01',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'admin@apex.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->manager = User::create([
            'name' => 'Store Manager',
            'email' => 'manager@apex.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->store->id,
        ]);

        $this->backupDir = storage_path('framework/testing/backups-' . uniqid());
        File::ensureDirectoryExists($this->backupDir);
        config(['backup.path' => $this->backupDir, 'backup.retention_days' => 14]);

        $this->service = new FakeBackupService();
        $this->app->instance(DatabaseBackupService::class, $this->service);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->backupDir);
        parent::tearDown();
    }

    public function test_super_admin_can_create_and_list_backups(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/settings/backups', ['notes' => 'Before FY close']);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('backup.status', 'completed')
            ->assertJsonPath('backup.kind', 'manual')
            ->assertJsonPath('backup.notes', 'Before FY close');

        $id = $response->json('backup.id');
        $run = BackupRun::findOrFail($id);

        $this->assertFileExists($this->backupDir . '/' . $run->filename);
        $this->assertSame(hash_file('sha256', $this->backupDir . '/' . $run->filename), $run->sha256);
        $this->assertGreaterThan(0, $run->size_bytes);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson('/api/admin/settings/backups')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('backups.0.id', $id)
            ->assertJsonPath('can_create', true)
            ->assertJsonPath('backups.0.exists', true);
    }

    public function test_backup_endpoints_are_super_admin_only(): void
    {
        $this->actingAs($this->manager, 'sanctum')
            ->getJson('/api/admin/settings/backups')
            ->assertStatus(403);

        $this->actingAs($this->manager, 'sanctum')
            ->postJson('/api/admin/settings/backups')
            ->assertStatus(403);
    }

    public function test_backup_download_streams_archive(): void
    {
        $created = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/settings/backups')
            ->assertStatus(201);

        $id = $created->json('backup.id');

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->get("/api/admin/settings/backups/{$id}/download");

        $response->assertOk();
        $this->assertSame('application/gzip', $response->headers->get('content-type'));
        $this->assertStringContainsString('.sqlite.gz', (string) $response->headers->get('content-disposition'));
    }

    public function test_download_returns_not_found_when_file_is_missing(): void
    {
        $run = $this->service->create('manual');
        File::delete($this->backupDir . '/' . $run->filename);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson("/api/admin/settings/backups/{$run->id}/download")
            ->assertStatus(404);
    }

    public function test_restore_requires_exact_filename_confirmation(): void
    {
        $run = $this->service->create('manual');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/settings/backups/{$run->id}/restore", ['confirmation' => 'wrong'])
            ->assertStatus(422)
            ->assertJsonPath('success', false);

        $this->assertFalse($this->service->restoreCalled);
    }

    public function test_restore_runs_after_confirmation(): void
    {
        $run = $this->service->create('manual');

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson("/api/admin/settings/backups/{$run->id}/restore", ['confirmation' => $run->filename])
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertTrue($this->service->restoreCalled);
    }

    public function test_delete_removes_file_and_record(): void
    {
        $run = $this->service->create('manual');
        $filename = $run->filename;

        $this->actingAs($this->superAdmin, 'sanctum')
            ->deleteJson("/api/admin/settings/backups/{$run->id}")
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertFileDoesNotExist($this->backupDir . '/' . $filename);
        $this->assertDatabaseMissing('backup_runs', ['id' => $run->id]);
    }

    public function test_command_creates_scheduled_snapshot(): void
    {
        Artisan::call('backup:database', ['--kind' => 'scheduled']);

        $run = BackupRun::query()->latest('id')->first();

        $this->assertNotNull($run);
        $this->assertSame('scheduled', $run->kind);
        $this->assertSame('completed', $run->status);
        $this->assertFileExists($this->backupDir . '/' . $run->filename);
    }

    public function test_retention_prunes_expired_snapshots(): void
    {
        $expired = $this->service->create('scheduled');
        $expired->forceFill(['created_at' => now()->subDays(30)])->save();

        $fresh = $this->service->create('scheduled');

        $result = $this->service->prune(14);

        $this->assertSame(1, $result['deleted']);
        $this->assertDatabaseMissing('backup_runs', ['id' => $expired->id]);
        $this->assertDatabaseHas('backup_runs', ['id' => $fresh->id]);
        $this->assertFileDoesNotExist($this->backupDir . '/' . $expired->filename);
        $this->assertFileExists($this->backupDir . '/' . $fresh->filename);
    }
}

class FakeBackupService extends DatabaseBackupService
{
    public bool $restoreCalled = false;

    public function supportsSnapshots(): bool
    {
        return true;
    }

    public function supportsRestore(): bool
    {
        return true;
    }

    public function create(string $kind = 'manual', ?int $userId = null, ?string $notes = null): BackupRun
    {
        $filename = 'test-' . uniqid() . '.sqlite.gz';
        file_put_contents($this->backupDirectory() . '/' . $filename, gzencode('fake-sqlite-snapshot'));

        return BackupRun::create([
            'filename' => $filename,
            'disk_path' => $filename,
            'size_bytes' => filesize($this->backupDirectory() . '/' . $filename),
            'sha256' => hash_file('sha256', $this->backupDirectory() . '/' . $filename),
            'kind' => $kind,
            'status' => 'completed',
            'started_at' => now(),
            'finished_at' => now(),
            'created_by' => $userId,
            'notes' => $notes,
        ]);
    }

    public function restore(BackupRun $run): BackupRun
    {
        $this->restoreCalled = true;

        return $run;
    }
}
