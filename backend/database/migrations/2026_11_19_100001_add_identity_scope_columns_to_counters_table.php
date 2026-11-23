<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P-IDENTITY-SCOPE / CNT-001 — the counter becomes an owner-owned master record.
 * Adds the permission-profile, locking, lifecycle and device-binding columns and
 * renames the never-populated plaintext `manager_pin` to a hashed unlock PIN.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('counters', function (Blueprint $table) {
            if (Schema::hasColumn('counters', 'manager_pin') && !Schema::hasColumn('counters', 'unlock_pin_hash')) {
                $table->renameColumn('manager_pin', 'unlock_pin_hash');
            }
        });

        Schema::table('counters', function (Blueprint $table) {
            if (!Schema::hasColumn('counters', 'permission_profile')) {
                $table->json('permission_profile')->nullable()->after('role_profile');
            }
            if (!Schema::hasColumn('counters', 'permission_profile_version')) {
                $table->unsignedBigInteger('permission_profile_version')->default(1)->after('permission_profile');
            }
            if (!Schema::hasColumn('counters', 'idle_lock_minutes')) {
                $table->integer('idle_lock_minutes')->default(5)->after('permission_profile_version');
            }
            if (!Schema::hasColumn('counters', 'grace_hours')) {
                $table->integer('grace_hours')->default(24)->after('idle_lock_minutes');
            }
            if (!Schema::hasColumn('counters', 'unlock_failed_attempts')) {
                $table->integer('unlock_failed_attempts')->default(0)->after('unlock_pin_hash');
            }
            if (!Schema::hasColumn('counters', 'unlock_locked_until')) {
                $table->timestamp('unlock_locked_until')->nullable()->after('unlock_failed_attempts');
            }
            if (!Schema::hasColumn('counters', 'current_device_id')) {
                $table->foreignId('current_device_id')->nullable()->constrained('devices')->nullOnDelete();
            }
            if (!Schema::hasColumn('counters', 'last_salesperson_id')) {
                $table->unsignedBigInteger('last_salesperson_id')->nullable();
            }
            if (!Schema::hasColumn('counters', 'last_salesperson_name')) {
                $table->string('last_salesperson_name')->nullable();
            }
            if (!Schema::hasColumn('counters', 'retired_at')) {
                $table->timestamp('retired_at')->nullable();
            }
            if (!Schema::hasColumn('counters', 'created_by')) {
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            }
        });

        // "unclaimed" is the new vocabulary default; pending_approval rows become unclaimed
        // (owner pre-creates counters from now on, so a waiting-for-approval state is meaningless).
        DB::table('counters')->where('status', 'pending_approval')->update(['status' => 'unclaimed']);

        // The live-name guard must cover unclaimed counters: an owner pre-creating a
        // duplicate name is rejected the same way an active counter's name is.
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('DROP INDEX IF EXISTS idx_counters_store_live_name');
            DB::statement(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_counters_store_live_name
                 ON counters (store_id, counter_name COLLATE NOCASE)
                 WHERE status IN ('unclaimed', 'active', 'locked')"
            );
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('DROP INDEX IF EXISTS idx_counters_store_live_name');
            DB::statement(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_counters_store_live_name
                 ON counters (store_id, counter_name COLLATE NOCASE)
                 WHERE status IN ('active', 'locked', 'pending_approval')"
            );
        }

        Schema::table('counters', function (Blueprint $table) {
            $columns = [
                'permission_profile',
                'permission_profile_version',
                'idle_lock_minutes',
                'grace_hours',
                'unlock_failed_attempts',
                'unlock_locked_until',
                'current_device_id',
                'last_salesperson_id',
                'last_salesperson_name',
                'retired_at',
                'created_by',
            ];

            foreach ($columns as $column) {
                if (in_array($column, ['current_device_id', 'created_by'], true) && Schema::hasColumn('counters', $column)) {
                    $table->dropConstrainedForeignId($column);
                } elseif (Schema::hasColumn('counters', $column)) {
                    $table->dropColumn($column);
                }
            }
        });

        Schema::table('counters', function (Blueprint $table) {
            if (Schema::hasColumn('counters', 'unlock_pin_hash') && !Schema::hasColumn('counters', 'manager_pin')) {
                $table->renameColumn('unlock_pin_hash', 'manager_pin');
            }
        });
    }
};
