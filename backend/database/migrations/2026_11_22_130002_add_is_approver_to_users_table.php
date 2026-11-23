<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * APR-001 / Q6: an approver is an existing person flagged for the job, not a
 * new account. The flag is separate from the role because a store may want a
 * manager who runs the floor without holding the approval PIN.
 *
 * Rows that already carry an approving role keep approving, so the rollout does
 * not take the ability away from anyone who had it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('users', 'is_approver')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('is_approver')->default(false)->index();
            });
        }

        DB::table('users')
            ->whereIn('role', ['super_admin', 'store_owner', 'admin', 'manager'])
            ->update(['is_approver' => true]);
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'is_approver')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('is_approver');
            });
        }
    }
};
