<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Support\Counter\CounterProfile;
use Illuminate\Console\Command;

/**
 * GAP-03 backfill: Q8 tightened the shipped ceilings (20% discount at most,
 * a grant above 10%), but a counter whose document was seeded by the old build
 * still carries the old values — 100% with no grant — and would keep them
 * forever, because reading a document never rewrites it.
 *
 * Only the exact legacy signature is moved. An owner who deliberately typed
 * 100% is indistinguishable from one who never chose, so the command prints
 * every candidate and changes nothing until --apply. New counters already get
 * the tightened values from CounterProfile::defaults().
 */
class TightenCounterProfileDefaultsCommand extends Command
{
    protected $signature = 'counters:tighten-approval-defaults
        {--apply : Write the changes (default is a dry run)}
        {--store= : Limit to one store id}';

    protected $description = 'Move counter profiles still carrying the pre-Q8 discount/override defaults to the tightened ceilings';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');

        $query = Counter::query()->whereNotNull('permission_profile');

        if ($this->option('store') !== null) {
            $query->where('store_id', (int) $this->option('store'));
        }

        $changed = 0;

        foreach ($query->lazyById(200) as $counter) {
            $stored = $counter->permission_profile;

            if (!is_array($stored) || !$this->isLegacyDefault($stored)) {
                continue;
            }

            $next = $this->tightened($stored);

            $this->line(sprintf(
                '%s store=%s counter=%s (%s) discount %s%%/%s -> 20%%/10%%, override approval %s -> 10%%',
                $apply ? 'APPLY' : 'WOULD',
                $counter->store_id,
                $counter->id,
                $counter->counter_code,
                $stored['discount']['max_pct'] ?? 'null',
                $stored['discount']['approval_pct'] ?? 'null',
                $stored['price_override']['approval_pct'] ?? 'null'
            ));

            $changed++;

            if (!$apply) {
                continue;
            }

            $counter->update([
                'permission_profile' => $next,
                'permission_profile_version' => (int) ($counter->permission_profile_version ?? 0) + 1,
            ]);

            AuditLog::log('counter_profile_defaults_tightened', 'Counter', (string) $counter->id, null, [
                'before' => [
                    'discount' => $stored['discount'] ?? null,
                    'price_override' => $stored['price_override'] ?? null,
                ],
                'after' => [
                    'discount' => $next['discount'] ?? null,
                    'price_override' => $next['price_override'] ?? null,
                ],
                'profile_version' => (int) $counter->permission_profile_version,
            ], $counter->store_id);
        }

        $this->info($apply
            ? "Tightened {$changed} counter profile(s)."
            : "{$changed} counter profile(s) would change. Re-run with --apply to write them.");

        return self::SUCCESS;
    }

    /**
     * The old shipped document, field by field. A single customised value means
     * the owner touched this control on purpose, and the command leaves it be.
     *
     * @param  array<string,mixed>  $stored
     */
    private function isLegacyDefault(array $stored): bool
    {
        $discount = $stored['discount'] ?? null;
        $override = $stored['price_override'] ?? null;

        if (!is_array($discount) || !is_array($override)) {
            return false;
        }

        return ($discount['max_pct'] ?? null) === 100
            && ($discount['approval_pct'] ?? null) === null
            && ($discount['max_amount'] ?? null) === null
            && ($override['allowed'] ?? true) === true
            && ($override['approval_pct'] ?? null) === null;
    }

    /**
     * @param  array<string,mixed>  $stored
     * @return array<string,mixed>
     */
    private function tightened(array $stored): array
    {
        $defaults = CounterProfile::defaults();

        $stored['discount'] = array_replace($defaults['discount'], $stored['discount']);
        $stored['discount']['max_pct'] = 20;
        $stored['discount']['approval_pct'] = 10;

        $stored['price_override'] = array_replace($defaults['price_override'], $stored['price_override']);
        $stored['price_override']['approval_pct'] = 10;

        return $stored;
    }
}
