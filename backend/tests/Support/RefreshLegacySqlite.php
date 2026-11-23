<?php

namespace Tests\Support;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

/**
 * RefreshDatabase with SQLite's legacy ALTER TABLE behaviour. A concurrent
 * migration in this tree rebuilds `purchases` while a trigger referencing that
 * table exists, which SQLite refuses under its modern rename semantics. The
 * pragma only affects the migration connection for these tests.
 */
trait RefreshLegacySqlite
{
    use RefreshDatabase {
        refreshTestDatabase as protected refreshTestDatabaseWithoutPragma;
    }

    protected function refreshTestDatabase(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::statement('PRAGMA legacy_alter_table = ON');
        }

        $this->refreshTestDatabaseWithoutPragma();
    }
}
