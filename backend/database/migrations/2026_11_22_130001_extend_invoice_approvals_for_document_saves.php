<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Wave C, the part GAP-03 needs: an approval is now a credential for one
 * *document save*, not only for an invoice that already exists.
 *
 * A bill that crosses the owner's discount or price threshold is authorised
 * before it is written, so the grant cannot name an invoice id yet. The row
 * keeps the till's own document identity instead (`document_external_id`), the
 * counter that asked, and the action keys it settles — one grant may settle the
 * discount and the retyped rate of the same bill.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_approvals', function (Blueprint $table) {
            if (!Schema::hasColumn('invoice_approvals', 'counter_id')) {
                $table->unsignedBigInteger('counter_id')->nullable()->index();
            }
            if (!Schema::hasColumn('invoice_approvals', 'document_type')) {
                $table->string('document_type', 32)->nullable()->index();
            }
            if (!Schema::hasColumn('invoice_approvals', 'document_external_id')) {
                $table->string('document_external_id', 100)->nullable()->index();
            }
            if (!Schema::hasColumn('invoice_approvals', 'actions')) {
                $table->json('actions')->nullable();
            }
            if (!Schema::hasColumn('invoice_approvals', 'rule_snapshot')) {
                $table->json('rule_snapshot')->nullable();
            }
        });

        // A pre-save grant has no invoice id until the bill is written.
        if (Schema::hasColumn('invoice_approvals', 'invoice_id')) {
            Schema::table('invoice_approvals', function (Blueprint $table) {
                $table->unsignedBigInteger('invoice_id')->nullable()->change();
            });
        }

        // What rate the line was billed on is the fact that separates a retyped
        // price from a legitimate PTR/loose-rate sale, offline as well as live.
        if (!Schema::hasColumn('invoice_items', 'rate_basis')) {
            Schema::table('invoice_items', function (Blueprint $table) {
                $table->string('rate_basis', 20)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('invoice_items', 'rate_basis')) {
            Schema::table('invoice_items', function (Blueprint $table) {
                $table->dropColumn('rate_basis');
            });
        }

        Schema::table('invoice_approvals', function (Blueprint $table) {
            $table->dropColumn(['counter_id', 'document_type', 'document_external_id', 'actions', 'rule_snapshot']);
        });
    }
};
