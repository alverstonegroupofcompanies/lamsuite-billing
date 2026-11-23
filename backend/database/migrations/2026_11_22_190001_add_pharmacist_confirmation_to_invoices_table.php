<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PHR-005 — a restricted-drug bill remembers who stood behind it.
 *
 * The id points at the person; the name, the registration number and the
 * moment of confirmation are stamps of what was true when the bill was saved.
 * A later rename, renewal or archive therefore cannot rewrite a bill that has
 * already been printed, which is exactly what a council inspection asks for.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            if (!Schema::hasColumn('invoices', 'pharmacist_id')) {
                $table->unsignedBigInteger('pharmacist_id')->nullable()->index();
            }

            if (!Schema::hasColumn('invoices', 'pharmacist_name')) {
                $table->string('pharmacist_name', 191)->nullable();
            }

            if (!Schema::hasColumn('invoices', 'pharmacist_reg_no')) {
                $table->string('pharmacist_reg_no', 60)->nullable();
            }

            if (!Schema::hasColumn('invoices', 'pharmacist_confirmed_at')) {
                $table->timestamp('pharmacist_confirmed_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            // Additive columns; SQLite would rebuild the table to drop them.
            return;
        }

        Schema::table('invoices', function (Blueprint $table) {
            foreach (['pharmacist_id', 'pharmacist_name', 'pharmacist_reg_no', 'pharmacist_confirmed_at'] as $column) {
                if (Schema::hasColumn('invoices', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
