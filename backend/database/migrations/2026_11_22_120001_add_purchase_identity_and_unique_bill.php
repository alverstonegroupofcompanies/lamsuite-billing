<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * G3-PURCHASE-SYNC — a purchase needs an identity that survives a retry.
 *
 * `external_id` is the till's own document id; `bill_key` is the supplier-bill identity
 * the server refuses to see twice. Rows that predate this migration are stamped here,
 * but only after the migration proves there are no duplicate supplier bills — a database
 * that already holds one must run `purchases:dedupe-bills --apply` first, and the message
 * says so instead of failing on an index with a MySQL error code.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('purchases', 'external_id')) {
            Schema::table('purchases', function (Blueprint $table) {
                $table->string('external_id', 64)->nullable()->after('store_id');
                $table->index(['store_id', 'external_id']);
            });
        }

        if (!Schema::hasColumn('purchases', 'bill_key')) {
            Schema::table('purchases', function (Blueprint $table) {
                $table->string('bill_key', 255)->nullable()->after('external_id');
            });
        }

        $duplicates = $this->duplicateGroups();

        if ($duplicates !== []) {
            throw new RuntimeException(
                'purchases: ' . count($duplicates) . ' duplicate supplier bill(s) found, so uniqueness cannot be enforced yet. '
                . 'Run `php artisan purchases:dedupe-bills` to review them, then `--apply`, then migrate again. '
                . 'First group: ' . $duplicates[0]
            );
        }

        $this->stampExistingRows();

        Schema::table('purchases', function (Blueprint $table) {
            $table->unique(['store_id', 'bill_key'], 'purchases_store_bill_key_unique');
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('purchases', 'bill_key')) {
            Schema::table('purchases', function (Blueprint $table) {
                $table->dropUnique('purchases_store_bill_key_unique');
            });
        }

        if (Schema::hasColumn('purchases', 'external_id')) {
            Schema::table('purchases', function (Blueprint $table) {
                $table->dropIndex(['store_id', 'external_id']);
                $table->dropColumn('external_id');
            });
        }

        if (Schema::hasColumn('purchases', 'bill_key')) {
            Schema::table('purchases', function (Blueprint $table) {
                $table->dropColumn('bill_key');
            });
        }
    }

    /**
     * @return array<int, string> one readable line per duplicate group
     */
    private function duplicateGroups(): array
    {
        $rows = DB::table('purchases')
            ->where(fn ($q) => $q->whereNull('module_key')->orWhereNotIn('module_key', ['purchase_order', 'order']))
            ->where('status', '!=', 'cancelled')
            ->select(['id', 'store_id', 'module_key', 'supplier_id', 'supplier_name', 'invoice_number', 'supplier_invoice_no'])
            ->get();

        $groups = [];

        foreach ($rows as $row) {
            $key = $this->billKeyOf($row);
            if ($key === null) {
                continue;
            }

            $groups[$key][] = (int) $row->id;
        }

        $duplicates = [];

        foreach ($groups as $key => $ids) {
            if (count($ids) > 1) {
                $duplicates[] = $key . ' → purchase ids ' . implode(', ', $ids);
            }
        }
        return $duplicates;
    }

    private function stampExistingRows(): void
    {
        DB::table('purchases')
            ->where(fn ($q) => $q->whereNull('module_key')->orWhereNotIn('module_key', ['purchase_order', 'order']))
            ->where('status', '!=', 'cancelled')
            ->orderBy('id')
            ->chunkById(500, function ($rows): void {
                foreach ($rows as $row) {
                    $key = $this->billKeyOf($row);

                    if ($key !== null) {
                        DB::table('purchases')->where('id', $row->id)->update(['bill_key' => $key]);
                    }
                }
            });
    }

    private function billKeyOf(object $row): ?string
    {
        $module = strtolower(trim((string) ($row->module_key ?? 'purchase'))) ?: 'purchase';
        if ($module === 'debit_note') {
            $module = 'purchase_return';
        }

        // A debit note is identified by its own note number; an inward bill by the supplier's.
        $number = in_array($module, ['purchase_return', 'debit_note'], true)
            ? ($row->invoice_number ?: $row->supplier_invoice_no)
            : ($row->supplier_invoice_no ?: $row->invoice_number);
        $number = strtoupper(trim((string) $number));
        if ($number === '') {
            return null;
        }

        $supplier = $row->supplier_id
            ? 'id:' . $row->supplier_id
            : 'name:' . strtoupper(trim((string) ($row->supplier_name ?? '')));

        // Matches PurchasePostingService::billKeyFor(); the store is the other half of the index.
        return $module . '|' . $supplier . '|' . $number;
    }
};
