<?php

/**
 * Live read of the date-window fix against the QA database.
 *
 * invoices.invoice_date is TEXT and holds both 'YYYY-MM-DD' (what the till syncs) and
 * 'YYYY-MM-DD HH:MM:SS' (what older writes left behind), so every window has to be compared on
 * the date part. This runs the real report controllers against the real QA data and prints what
 * they return next to the plain SQL count, plus what the old string-range predicates would have
 * returned, so the size of the hole is visible too.
 *
 * Usage: APP_ENV=local DB_CONNECTION=sqlite DB_DATABASE=<abs>/tests/qa/qa_gstcheck.sqlite
 *        php tests/qa/report_window_probe.php
 */

require __DIR__ . '/../../backend/vendor/autoload.php';

$app = require __DIR__ . '/../../backend/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\ReportController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

$storeId = (int) getenv('QA_STORE_ID') ?: 4;
$day = getenv('QA_DAY') ?: now()->toDateString();
$monthStart = substr($day, 0, 7) . '-01';
$controller = new ReportController();

function jsonOf($response): array
{
    return json_decode($response->getContent(), true) ?: [];
}

function sqlBills(int $store, string $from, string $to)
{
    return DB::select(
        "select count(*) as n,
                sum(case when length(invoice_date) = 10 then 1 else 0 end) as bare,
                sum(case when length(invoice_date) <> 10 then 1 else 0 end) as stamped
         from invoices
         where store_id = ? and substr(invoice_date, 1, 10) between ? and ?",
        [$store, $from, $to]
    )[0];
}

function sqlRevenue(int $store, string $from, string $to, string $predicate): float
{
    $signed = "case when i.module_key in ('credit_note','sales_return') then -1 else 1 end";
    $rows = DB::select(
        "select coalesce(sum({$signed} * it.total_amount), 0) as rev
         from invoices i join invoice_items it on it.invoice_id = i.id
         where i.store_id = ? and i.status <> 'cancelled' and {$predicate}",
        [$store, $from, $to]
    );
    return round((float) $rows[0]->rev, 2);
}

function sqlTaxable(int $store, string $from, string $to, string $predicate): float
{
    $signed = "case when i.module_key in ('credit_note','sales_return') then -1 else 1 end";
    $rows = DB::select(
        "select coalesce(sum({$signed} * coalesce(it.taxable_amount, it.total_amount - coalesce(it.tax_amount, 0))), 0) as v
         from invoices i join invoice_items it on it.invoice_id = i.id
         where i.store_id = ? and i.status <> 'cancelled' and {$predicate}",
        [$store, $from, $to]
    );
    return round((float) $rows[0]->v, 2);
}

// predicate the controllers use now, and the two string-range predicates they used before
$ON_DATE = "substr(i.invoice_date, 1, 10) between ? and ?";

$out = ['store_id' => $storeId];

foreach ([['day', $day, $day], ['month', $monthStart, $day]] as [$label, $from, $to]) {
    $window = ['start_date' => $from, 'end_date' => $to, 'store_id' => $storeId];
    $request = Request::create('/api/reports/x', 'GET', $window);

    $profit = jsonOf($controller->profit($request));
    $hsn = jsonOf($controller->hsnSummary($request));
    $gstr = jsonOf($controller->gstr1($request));
    $recon = jsonOf($controller->taxReconciliation($request));

    $hsnTaxable = round(array_sum(array_map(fn($r) => (float) $r['taxable_value'], $hsn['hsn_records'] ?? [])), 2);

    $bills = sqlBills($storeId, $from, $to);
    $wantRevenue = sqlRevenue($storeId, $from, $to, $ON_DATE);
    $wantTaxable = sqlTaxable($storeId, $from, $to, $ON_DATE);

    // what the two old predicate styles would have kept, on this same data
    $oldSuffix = DB::select(
        "select count(*) as n from invoices i
         where i.store_id = ? and i.status <> 'cancelled'
           and i.invoice_date between ? and ?",
        [$storeId, $from . ' 00:00:00', $to . ' 23:59:59']
    )[0]->n;
    $oldBare = DB::select(
        "select count(*) as n from invoices i
         where i.store_id = ? and i.status <> 'cancelled'
           and i.invoice_date between ? and ?",
        [$storeId, $from, $to]
    )[0]->n;
    $liveNonCancelled = DB::select(
        "select count(*) as n from invoices i where i.store_id = ? and i.status <> 'cancelled'
           and substr(i.invoice_date, 1, 10) between ? and ?",
        [$storeId, $from, $to]
    )[0]->n;

    $out[$label] = [
        'window' => [$from, $to],
        'sql_bills' => (int) $bills->n,
        'sql_bare_dates' => (int) $bills->bare,
        'sql_stamped_dates' => (int) $bills->stamped,
        'profit_total_revenue' => $profit['total_revenue'] ?? null,
        'expected_revenue' => $wantRevenue,
        'hsn_taxable_sum' => $hsnTaxable,
        'expected_taxable' => $wantTaxable,
        'gstr1_tables' => [
            'b2b' => count($gstr['table_4_b2b'] ?? []),
            'b2c_large' => count($gstr['table_5_b2c_large'] ?? []),
            'b2c_small' => count($gstr['table_7_b2c_small'] ?? []),
            'notes' => count($gstr['table_9_credit_debit_notes'] ?? []),
            'table_12' => count($gstr['table_12_hsn'] ?? ($gstr['hsn_summary'] ?? [])),
            'table_13' => count($gstr['table_13_documents'] ?? ($gstr['documents'] ?? [])),
        ],
        'recon_keys' => array_slice(array_keys($recon), 0, 10),
        'recon_invoice_count' => $recon['total_invoices'] ?? ($recon['summary']['total_invoices'] ?? null),
        'old_suffixed_range_would_return' => (int) $oldSuffix,
        'old_bare_range_would_return' => (int) $oldBare,
        'non_cancelled_bills_in_window' => (int) $liveNonCancelled,
    ];
}

$fail = 0;
foreach (['day', 'month'] as $label) {
    $w = $out[$label];
    foreach ([['revenue', 'profit_total_revenue', 'expected_revenue'], ['taxable', 'hsn_taxable_sum', 'expected_taxable']] as [$what, $gotKey, $wantKey]) {
        $got = $w[$gotKey];
        $want = $w[$wantKey];
        $ok = is_numeric($got) && abs((float) $got - (float) $want) < 0.02;
        if (!$ok) {
            $fail++;
        }
        fwrite(STDOUT, sprintf("%s %s: got %s want %s [%s]\n", $label, $what, var_export($got, true), var_export($want, true), $ok ? 'OK' : 'MISMATCH'));
    }
    fwrite(STDOUT, sprintf("%s bills: %d (%d bare-date, %d stamped) | old suffixed range kept %d, old bare range kept %d of %d non-cancelled\n",
        $label, $w['sql_bills'], $w['sql_bare_dates'], $w['sql_stamped_dates'],
        $w['old_suffixed_range_would_return'], $w['old_bare_range_would_return'], $w['non_cancelled_bills_in_window']));
    fwrite(STDOUT, sprintf("%s gstr1 tables: %s | recon keys: %s\n", $label, json_encode($w['gstr1_tables']), json_encode($w['recon_keys'])));
}

fwrite(STDOUT, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
exit($fail === 0 ? 0 : 1);
