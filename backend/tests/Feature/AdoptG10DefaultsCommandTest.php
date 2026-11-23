<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * PAY-04 / EXP-01 backfill. A store set up before v2.1.2 had the till's old
 * "optional" reference rule for UPI and Card saved for it automatically, and its
 * menus and counter profiles were written before Expenses could be chosen. Saved
 * values are never rewritten just by being read, so those stores would keep
 * accepting UPI with no reference and never see the Expenses screen.
 */
class AdoptG10DefaultsCommandTest extends TestCase
{
    use RefreshDatabase;

    /** The modules a counter profile could hold before v2.1.2 offered Expenses. */
    private const OLD_MODULES = [
        'dashboard', 'pos', 'bills', 'sales_returns', 'customer_debit_notes', 'purchases',
        'purchase_returns', 'stock', 'stock_transfers', 'reports', 'masters', 'import_export',
        'migration', 'settings', 'counters',
    ];

    private const OLD_PAYMENT_MODES = [
        ['id' => 'cash', 'name' => 'Cash', 'referenceRequirement' => 'off'],
        ['id' => 'upi', 'name' => 'UPI', 'referenceRequirement' => 'optional', 'referenceMinLength' => 12],
        ['id' => 'card', 'name' => 'Card', 'referenceRequirement' => 'optional'],
        ['id' => 'bank_transfer', 'name' => 'Bank Transfer', 'referenceRequirement' => 'optional'],
        ['id' => 'cheque', 'name' => 'Cheque', 'referenceRequirement' => 'required'],
        ['id' => 'wallet', 'name' => 'Wallet / Store Credit', 'referenceRequirement' => 'optional'],
        ['id' => 'gift_voucher', 'name' => 'Gift Voucher', 'referenceRequirement' => 'required'],
        ['id' => 'credit', 'name' => 'Credit (Udhari)', 'referenceRequirement' => 'off'],
    ];

    private function store(string $code, ?array $menus = ['pos', 'bills', 'purchases', 'stock', 'reports', 'masters', 'settings']): Store
    {
        return Store::create([
            'name' => "Store {$code}",
            'code' => $code,
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'state_code' => '32',
            'is_active' => true,
            'enabled_menu_items' => $menus,
            'version' => 3,
        ]);
    }

    private function payments(Store $store, array $modes): CompanySetting
    {
        return CompanySetting::create([
            'store_id' => $store->id,
            'key' => 'payments',
            'value' => ['modes' => $modes, 'printShowReferences' => false],
            'is_secret' => false,
        ]);
    }

    private function counter(Store $store, string $code, array $modules = self::OLD_MODULES, bool $drawer = true): Counter
    {
        return Counter::create([
            'store_id' => $store->id,
            'counter_code' => $code,
            'counter_name' => "Counter {$code}",
            'status' => 'active',
            'device_uuid' => "uuid_adopt_{$store->id}_{$code}",
            'permission_profile' => ['version' => 1, 'modules' => $modules, 'cash_drawer' => $drawer],
            'permission_profile_version' => 1,
        ]);
    }

    private function requirement(Store $store, string $id): ?string
    {
        $modes = CompanySetting::where('store_id', $store->id)->where('key', 'payments')->first()->value['modes'];
        foreach ($modes as $mode) {
            if ($mode['id'] === $id) {
                return $mode['referenceRequirement'];
            }
        }
        return null;
    }

    public function test_dry_run_lists_candidates_and_writes_nothing(): void
    {
        $store = $this->store('ADPT1');
        $this->payments($store, self::OLD_PAYMENT_MODES);
        $counter = $this->counter($store, 'C01');

        $this->artisan('payments:adopt-g10-defaults')
            ->expectsOutputToContain('WOULD')
            ->assertExitCode(0);

        $this->assertSame('optional', $this->requirement($store, 'upi'));
        $this->assertNotContains('expenses', $store->fresh()->enabled_menu_items);
        $this->assertNotContains('expenses', $counter->fresh()->permission_profile['modules']);
        $this->assertSame(3, $store->fresh()->version);
    }

    public function test_apply_requires_upi_and_card_references_on_the_old_default(): void
    {
        $store = $this->store('ADPT2');
        $this->payments($store, self::OLD_PAYMENT_MODES);

        $this->artisan('payments:adopt-g10-defaults', ['--apply' => true])->assertExitCode(0);

        $this->assertSame('required', $this->requirement($store, 'upi'));
        $this->assertSame('required', $this->requirement($store, 'card'));
        // Everything else in the setting is carried over untouched.
        $this->assertSame('optional', $this->requirement($store, 'bank_transfer'));
        $setting = CompanySetting::where('store_id', $store->id)->where('key', 'payments')->first()->value;
        $this->assertFalse($setting['printShowReferences']);
        $this->assertSame(12, $setting['modes'][1]['referenceMinLength']);
        // A till holding the old copy is refused on its next save and re-reads.
        $this->assertSame(4, $store->fresh()->version);
        $this->assertTrue(AuditLog::where('action', 'g10_defaults_adopted')->exists());
    }

    public function test_a_customised_payment_rule_is_left_alone(): void
    {
        $store = $this->store('ADPT3');
        $modes = self::OLD_PAYMENT_MODES;
        $modes[4]['referenceRequirement'] = 'optional'; // the owner relaxed cheques: a deliberate choice
        $this->payments($store, $modes);

        $this->artisan('payments:adopt-g10-defaults', ['--apply' => true])->assertExitCode(0);

        $this->assertSame('optional', $this->requirement($store, 'upi'));
        $this->assertSame(3, $store->fresh()->version);
    }

    public function test_apply_adds_expenses_to_store_menu_and_counter_profiles(): void
    {
        $store = $this->store('ADPT4');
        $old = $this->counter($store, 'C01');
        $noDrawer = $this->counter($store, 'C02', self::OLD_MODULES, false);
        $curated = $this->counter($store, 'C03', ['pos', 'bills']);
        $nullMenus = $this->store('ADPT5', null);

        $this->artisan('payments:adopt-g10-defaults', ['--apply' => true])->assertExitCode(0);

        $menus = $store->fresh()->enabled_menu_items;
        $this->assertContains('expenses', $menus);
        $this->assertSame(array_search('purchases', $menus) + 1, array_search('expenses', $menus));
        $this->assertNull($nullMenus->fresh()->enabled_menu_items);

        $profile = $old->fresh();
        $this->assertContains('expenses', $profile->permission_profile['modules']);
        $this->assertSame(2, (int) $profile->permission_profile_version);

        // A counter that may not touch the drawer cannot pay an expense from it.
        $this->assertNotContains('expenses', $noDrawer->fresh()->permission_profile['modules']);
        $this->assertSame(1, (int) $noDrawer->fresh()->permission_profile_version);
        // A counter the owner trimmed to two screens was curated, not defaulted.
        $this->assertSame(['pos', 'bills'], $curated->fresh()->permission_profile['modules']);
    }

    public function test_saved_before_leaves_rows_saved_after_the_upgrade(): void
    {
        $store = $this->store('ADPT6');
        $this->payments($store, self::OLD_PAYMENT_MODES);
        $counter = $this->counter($store, 'C01');
        DB::table('company_settings')->where('store_id', $store->id)->update(['updated_at' => '2026-11-23 12:00:00']);
        DB::table('counters')->where('id', $counter->id)->update(['updated_at' => '2026-11-20 09:00:00']);
        DB::table('stores')->where('id', $store->id)->update(['updated_at' => '2026-11-23 12:00:00']);

        $this->artisan('payments:adopt-g10-defaults', [
            '--apply' => true,
            '--saved-before' => '2026-11-23 10:00:00',
        ])->assertExitCode(0);

        $this->assertSame('optional', $this->requirement($store, 'upi'));
        $this->assertNotContains('expenses', $store->fresh()->enabled_menu_items);
        $this->assertContains('expenses', $counter->fresh()->permission_profile['modules']);
    }

    public function test_second_run_finds_nothing(): void
    {
        $store = $this->store('ADPT7');
        $this->payments($store, self::OLD_PAYMENT_MODES);
        $this->counter($store, 'C01');

        $this->artisan('payments:adopt-g10-defaults', ['--apply' => true])->assertExitCode(0);
        $this->artisan('payments:adopt-g10-defaults', ['--apply' => true])
            ->expectsOutputToContain('Nothing to adopt')
            ->assertExitCode(0);
    }
}
