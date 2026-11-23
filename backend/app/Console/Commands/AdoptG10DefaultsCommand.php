<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Store;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * PAY-04 / EXP-01 backfill for stores set up before v2.1.2.
 *
 * - The till saved its old payment rules for every store it ran in, with UPI and
 *   Card references "optional". The server keeps a saved setting, so those
 *   stores would go on accepting UPI with nothing to trace it to. Only a setting
 *   whose reference rules are still exactly the old shipped ones is moved; one
 *   rule changed by hand means the owner chose, and it is left alone.
 * - Store menus and counter profiles written before v2.1.2 could not carry
 *   Expenses, so its absence there is not a choice. A store menu gains it; a
 *   counter profile gains it only if it still holds every pre-2.1.2 module (a
 *   trimmed profile was curated) and its drawer is on (an expense is paid from it).
 *
 * After the upgrade an owner can switch any of these off on purpose, so
 * --saved-before limits the command to rows last saved before the upgrade.
 * It prints every candidate and changes nothing until --apply.
 */
class AdoptG10DefaultsCommand extends Command
{
    protected $signature = 'payments:adopt-g10-defaults
        {--apply : Write the changes (default is a dry run)}
        {--store= : Limit to one store id}
        {--saved-before= : Only change rows last saved before this date-time (the upgrade to v2.1.2)}';

    protected $description = 'Move stores still on the pre-v2.1.2 payment reference rules and menus to the G10 defaults';

    /** The reference rules the till shipped before v2.1.2, by mode id. */
    private const OLD_REFERENCE_RULES = [
        'cash' => 'off',
        'upi' => 'optional',
        'card' => 'optional',
        'bank_transfer' => 'optional',
        'cheque' => 'required',
        'wallet' => 'optional',
        'gift_voucher' => 'required',
        'credit' => 'off',
    ];

    /** Every module a counter profile could hold before Expenses existed. */
    private const OLD_MODULES = [
        'dashboard', 'pos', 'bills', 'sales_returns', 'customer_debit_notes', 'purchases',
        'purchase_returns', 'stock', 'stock_transfers', 'reports', 'masters', 'import_export',
        'migration', 'settings', 'counters',
    ];

    private bool $apply = false;
    private ?Carbon $savedBefore = null;
    private int $changes = 0;

    public function handle(): int
    {
        // One command object can serve several calls in a process: start clean.
        $this->apply = (bool) $this->option('apply');
        $this->savedBefore = null;
        $this->changes = 0;

        if ($this->option('saved-before') !== null) {
            try {
                $this->savedBefore = Carbon::parse((string) $this->option('saved-before'));
            } catch (\Throwable) {
                $this->error('--saved-before must be a date-time, for example "2026-11-23 10:45".');
                return self::INVALID;
            }
        }

        $stores = Store::query()->orderBy('id');
        if ($this->option('store') !== null) {
            $stores->where('id', (int) $this->option('store'));
        }

        foreach ($stores->get() as $store) {
            DB::transaction(function () use ($store) {
                $this->paymentRules($store);
                $this->storeMenu($store);
                foreach (Counter::where('store_id', $store->id)->orderBy('id')->get() as $counter) {
                    $this->counterModules($store, $counter);
                }
            });
        }

        if ($this->changes === 0) {
            $this->info('Nothing to adopt.');
        } elseif ($this->apply) {
            $this->info("Adopted {$this->changes} change(s).");
        } else {
            $this->info("{$this->changes} change(s) would be made. Re-run with --apply to write them.");
        }

        return self::SUCCESS;
    }

    private function paymentRules(Store $store): void
    {
        $setting = CompanySetting::where('store_id', $store->id)->where('key', 'payments')->first();
        $value = $setting?->value;

        if (!is_array($value) || !is_array($value['modes'] ?? null) || !$this->savedInTime($setting->updated_at)) {
            return;
        }

        $rules = [];
        foreach ($value['modes'] as $mode) {
            if (is_array($mode) && isset($mode['id'])) {
                $rules[(string) $mode['id']] = $mode['referenceRequirement'] ?? null;
            }
        }

        if (($rules['upi'] ?? null) !== 'optional' || ($rules['card'] ?? null) !== 'optional') {
            return;
        }
        foreach ($rules as $id => $requirement) {
            if (array_key_exists($id, self::OLD_REFERENCE_RULES) && self::OLD_REFERENCE_RULES[$id] !== $requirement) {
                return; // one rule changed by hand: the owner chose these
            }
        }

        $this->report($store, 'payments', 'UPI and Card reference optional -> required');
        if (!$this->apply) {
            return;
        }

        foreach ($value['modes'] as $i => $mode) {
            if (is_array($mode) && in_array($mode['id'] ?? null, ['upi', 'card'], true)) {
                $value['modes'][$i]['referenceRequirement'] = 'required';
            }
        }
        $setting->update(['value' => $value]);
        // SET-03: a till still holding the old copy is refused on its next save
        // and re-reads, instead of writing "optional" straight back.
        $store->increment('version');

        $this->audit($store, 'Store', (string) $store->id, 'payments.referenceRequirement', [
            'upi' => 'optional', 'card' => 'optional',
        ], ['upi' => 'required', 'card' => 'required']);
    }

    private function storeMenu(Store $store): void
    {
        $menus = $store->enabled_menu_items;

        // No list means the till's own default, which already carries Expenses.
        if (!is_array($menus) || in_array('expenses', $menus, true) || !$this->savedInTime($store->updated_at)) {
            return;
        }

        $this->report($store, 'store menu', 'add Expenses');
        if (!$this->apply) {
            return;
        }

        $next = $this->insertAfter($menus, 'purchases', 'expenses');
        $store->forceFill(['enabled_menu_items' => $next])->save();

        $this->audit($store, 'Store', (string) $store->id, 'enabled_menu_items', $menus, $next);
    }

    private function counterModules(Store $store, Counter $counter): void
    {
        $profile = $counter->permission_profile;
        $modules = is_array($profile) ? ($profile['modules'] ?? null) : null;

        if (!is_array($modules) || in_array('expenses', $modules, true) || !$this->savedInTime($counter->updated_at)) {
            return;
        }
        if (array_diff(self::OLD_MODULES, $modules) !== []) {
            return; // trimmed by the owner
        }
        if (($profile['cash_drawer'] ?? true) === false) {
            return; // an expense is paid out of the drawer this counter may not touch
        }

        $this->report($store, "counter {$counter->counter_code} (id {$counter->id})", 'add Expenses module');
        if (!$this->apply) {
            return;
        }

        $profile['modules'] = $this->insertAfter($modules, 'purchase_returns', 'expenses');
        $counter->update([
            'permission_profile' => $profile,
            'permission_profile_version' => (int) ($counter->permission_profile_version ?? 0) + 1,
        ]);

        $this->audit($store, 'Counter', (string) $counter->id, 'permission_profile.modules', $modules, $profile['modules']);
    }

    private function savedInTime(mixed $updatedAt): bool
    {
        if ($this->savedBefore === null) {
            return true;
        }
        if ($updatedAt === null) {
            return true;
        }

        return Carbon::parse($updatedAt)->lt($this->savedBefore);
    }

    /**
     * @param array<int,string> $list
     * @return array<int,string>
     */
    private function insertAfter(array $list, string $anchor, string $item): array
    {
        $list = array_values($list);
        $at = array_search($anchor, $list, true);
        array_splice($list, $at === false ? count($list) : $at + 1, 0, [$item]);

        return $list;
    }

    private function report(Store $store, string $what, string $change): void
    {
        $this->changes++;
        $this->line(sprintf('%s store=%d (%s) %s: %s', $this->apply ? 'APPLY' : 'WOULD', $store->id, $store->code, $what, $change));
    }

    private function audit(Store $store, string $entity, string $entityId, string $field, mixed $before, mixed $after): void
    {
        AuditLog::log('g10_defaults_adopted', $entity, $entityId, [$field => $before], [$field => $after], (int) $store->id);
    }
}
