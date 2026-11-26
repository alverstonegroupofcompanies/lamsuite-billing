<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\MigrationRun;
use App\Models\Party;
use App\Models\Product;
use App\Models\Store;
use App\Support\Counter\CounterProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * MIG-01 — the wizard at the till has to drive the server pipeline.
 *
 * Every step of the old client engine reported success while writing rows only
 * into that one workstation's SQLite, stamped "synced", so the store's real
 * database stayed empty. These tests hold the replacement to the one standard
 * that matters: after a run, the data is in the database the admin panel reads.
 *
 * The terminal rules come with it: the device token picks the branch, a body
 * cannot name another, a server path cannot be handed to the reader, and the
 * store's Menu & Feature Control switch is honoured by the server rather than
 * only by the navigation (MIG-02).
 */
class TillMigrationPipelineTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private Counter $counter;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Migrating Branch',
            'code' => 'MIGT',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->otherStore = Store::create([
            'name' => 'Other Branch',
            'code' => 'MIGO',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Front Counter',
        ]);

        $issued = ActivationKey::generateForCounter($this->counter);
        $this->token = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => 'dev-till-migration',
        ])->assertOk()->json('device_token');
    }

    /** A counter speaks for its own branch; no signed-in person is involved. */
    private function tillPost(string $uri, array $data = [])
    {
        return $this->withHeaders(['X-Device-Token' => $this->token])->postJson($uri, $data);
    }

    private function tillGet(string $uri)
    {
        return $this->withHeaders(['X-Device-Token' => $this->token])->getJson($uri);
    }

    private function bundle(): array
    {
        return [
            'generated_at' => '2026-11-25 09:00:00',
            'store_id' => 4,
            'groups' => [['id' => 11, 'name' => 'Analgesics', 'code' => 'ANA']],
            'brands' => [['id' => 21, 'name' => 'GSK']],
            'units' => [['id' => 31, 'name' => 'STRIP', 'code' => 'STP', 'units_per_pack' => 10]],
            'customers' => [['id' => 41, 'name' => 'Anjali N', 'phone' => '9847000001', 'current_balance' => 250.00]],
            'suppliers' => [['id' => 51, 'name' => 'Central Distributors', 'phone' => '9847000002', 'current_balance' => 4500.00]],
            'products' => [[
                'id' => 61,
                'name' => 'Crocin 650 Tablet',
                'barcode' => '8901111222233',
                'category_id' => 11,
                'brand_id' => 21,
                'unit_id' => 31,
                'hsn_sac_code' => '30049099',
                'mrp' => 35.00,
                'sel_rate' => 30.00,
                'ptr' => 22.00,
                'gst_percent' => 12.00,
                'units_per_pack' => 10,
            ]],
            'product_batches' => [[
                'id' => 71,
                'product_id' => 61,
                'batch_no' => 'CR-01',
                'expiry_date' => '2028-06-30',
                'stock_qty' => 120,
                'mrp' => 35.00,
                'purchase_rate' => 20.00,
                'selling_rate' => 30.00,
            ]],
            'invoices' => [[
                'id' => 81,
                'invoice_number' => 'INV-2026-001',
                'invoice_date' => '2026-10-10',
                'customer_id' => 41,
                'subtotal' => 60.00,
                'tax_total' => 7.20,
                'round_off' => 0.00,
                'grand_total' => 67.20,
                'paid_amount' => 67.20,
                'payment_mode' => 'UPI',
                'status' => 'issued',
                'items' => [[
                    'product_id' => 61,
                    'product_name' => 'Crocin 650 Tablet',
                    'batch_no' => 'CR-01',
                    'qty' => 2,
                    'unit_price' => 30.00,
                    'gst_percent' => 12.00,
                    'tax_amount' => 7.20,
                    'total_amount' => 67.20,
                ]],
            ]],
        ];
    }

    /**
     * Hand a payload to the upload endpoint and return the reference it issues.
     *
     * @param  array<string,mixed>  $data
     */
    private function uploadBundle(array $data): string
    {
        $res = $this->tillPost('/api/till/migrations/bundle', [
            'bundle' => UploadedFile::fake()->createWithContent('bundle.json', json_encode($data)),
        ])->assertOk();

        return $res->json('data.bundle_ref');
    }

    private function fakeDisk(): void
    {
        Storage::fake('local');
    }

    public function test_the_counter_uploads_a_bundle_and_gets_a_reference_back(): void
    {
        $this->fakeDisk();

        $res = $this->tillPost('/api/till/migrations/bundle', [
            'bundle' => UploadedFile::fake()->createWithContent('bundle.json', json_encode($this->bundle())),
        ])->assertOk();

        $ref = $res->json('data.bundle_ref');
        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $ref);
        $this->assertSame(1, $res->json('data.entities.products'));
        $this->assertSame(1, $res->json('data.entities.invoices'));
        $this->assertTrue(Storage::disk('local')->exists("migrations/{$ref}.json"));
    }

    public function test_a_file_holding_no_migration_entities_is_refused_before_it_is_stored(): void
    {
        $this->fakeDisk();

        $res = $this->tillPost('/api/till/migrations/bundle', [
            'bundle' => UploadedFile::fake()->createWithContent('backup.json', json_encode(['meta' => ['rows' => 0]])),
        ])->assertStatus(422);

        $this->assertStringContainsString('no migration entities', $res->json('message'));
        $this->assertSame([], Storage::disk('local')->allFiles('migrations'));
    }

    public function test_a_bundle_with_no_rows_blocks_precheck_instead_of_passing_it(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle(['products' => [], 'customers' => [], 'invoices' => []]);

        $res = $this->tillPost('/api/till/migrations/precheck', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertOk();

        $this->assertFalse($res->json('data.can_proceed'));
        $this->assertSame('source', $res->json('data.issues.0.category'));
        $this->assertStringContainsString('no migratable records', $res->json('data.issues.0.message'));
    }

    public function test_precheck_reports_the_counts_a_run_will_actually_move(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $res = $this->tillPost('/api/till/migrations/precheck', [
            'source_type' => 'file',
            // Nothing in this bundle, and nothing on a fresh store, states how the shop priced
            // its bills, so the operator states it here.
            'config' => ['bundle_ref' => $ref, 'tax_mode' => 'exclusive'],
        ])->assertOk();

        $this->assertTrue($res->json('data.can_proceed'));
        $this->assertSame(1, $res->json('data.record_counts.products'));
        $this->assertSame(1, $res->json('data.record_counts.invoices'));
        $this->assertSame(1, $res->json('data.record_counts.product_batches'));
        $this->assertSame(1, $res->json('data.record_counts.sales_invoices'));
        $this->assertSame(0, $res->json('data.record_counts.credit_bills'));
        // Seven rows the bundle lists plus the batch nested in the product — and not the invoice
        // counted twice, once as a table and once as the sale it is filed as.
        $this->assertSame(8, $res->json('data.summary.total_records'));

        $stated = array_filter(
            $res->json('data.issues'),
            fn ($issue) => str_contains($issue['message'], 'as chosen in this wizard')
        );
        $this->assertNotEmpty($stated, 'the pricing answer the till gave was not read by the server');
    }

    public function test_a_store_that_never_priced_a_bill_stops_the_scan_until_the_mode_is_said(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $res = $this->tillPost('/api/till/migrations/precheck', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertOk();

        // The stores row defaults to 'inclusive', and reading that as an instruction re-derives a
        // migrated year while every total still reconciles, so an unset till has to be asked.
        $this->assertFalse($res->json('data.can_proceed'));
        $this->assertNotEmpty(array_filter(
            $res->json('data.issues'),
            fn ($issue) => $issue['type'] === 'error' && str_contains($issue['message'], 'Set "How the old system priced a bill"')
        ));
    }

    public function test_the_pricing_mode_chosen_at_the_till_is_the_one_the_run_saves(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $res = $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref, 'tax_mode' => 'exclusive'],
        ])->assertOk();

        $uuid = $res->json('data.run.run_uuid');
        $this->assertSame('exclusive', $res->json('data.run.mapping_config.tax_mode'));
        $this->assertSame('exclusive', $this->store->fresh()->tax_mode);

        $billing = CompanySetting::where('store_id', $this->store->id)->where('key', 'billing')->first();
        $this->assertSame('exclusive', $billing->value['tax_mode'] ?? null);

        // The choice survives on the run row, so a replay reads prices the same way.
        $this->assertSame(
            'exclusive',
            MigrationRun::where('run_uuid', $uuid)->value('mapping_config')['tax_mode'] ?? null
        );
    }

    public function test_a_dry_run_writes_nothing_and_leaves_the_store_empty(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $res = $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
            'is_dry_run' => true,
        ])->assertOk();

        $this->assertTrue($res->json('data.is_dry_run'));
        $this->assertNull($res->json('data.reconciliation'));
        $this->assertSame(1, $res->json('data.stats.products'));
        $this->assertSame(0, Product::where('store_id', $this->store->id)->count());
        $this->assertSame(0, Invoice::where('store_id', $this->store->id)->count());

        // Nothing was reconciled, so there is nothing to cut over on.
        $this->tillPost("/api/till/migrations/{$res->json('data.run.run_uuid')}/cutover", [
            'confirmation_phrase' => 'CUTOVER-MIGT',
        ])->assertStatus(422);
    }

    public function test_a_run_puts_the_bundle_into_the_store_database(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $res = $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertOk();

        $uuid = $res->json('data.run.run_uuid');
        $this->assertSame('completed', $res->json('data.run.status'));
        $this->assertSame(1, $res->json('data.stats.products'));

        // The claim under test: rows exist in the branch database, not on the till.
        $this->assertSame(1, Product::where('store_id', $this->store->id)->count());
        $this->assertSame(1, Party::where('store_id', $this->store->id)->where('type', 'customer')->count());
        $this->assertSame(1, Party::where('store_id', $this->store->id)->where('type', 'supplier')->count());
        $this->assertSame(1, Invoice::where('store_id', $this->store->id)->count());
        $this->assertSame('8901111222233', Product::where('store_id', $this->store->id)->value('barcode'));

        $run = MigrationRun::where('run_uuid', $uuid)->firstOrFail();
        $this->assertSame($this->store->id, (int) $run->store_id);
        $this->assertSame($ref, $run->source_reference);
        $this->assertTrue((bool) $run->reconciliationReport?->is_passed);
    }

    public function test_a_client_named_server_path_is_never_handed_to_the_reader(): void
    {
        $this->fakeDisk();

        $res = $this->tillPost('/api/till/migrations/precheck', [
            'source_type' => 'file',
            'config' => ['file_path' => storage_path('logs/laravel.log')],
        ])->assertStatus(422);

        $this->assertStringContainsString('bundle_ref', $res->json('message'));
    }

    public function test_a_body_naming_another_branch_is_refused_before_anything_is_read(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $res = $this->tillPost('/api/till/migrations/start', [
            'store_id' => $this->otherStore->id,
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertStatus(403);

        $this->assertStringContainsString('Tenant isolation', $res->json('message'));
        $this->assertSame(0, Product::where('store_id', $this->store->id)->count());
        $this->assertSame(0, Product::where('store_id', $this->otherStore->id)->count());
        $this->assertSame(0, MigrationRun::where('store_id', $this->otherStore->id)->count());
    }

    public function test_a_stale_local_registry_key_still_migrates_the_counters_own_branch(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $this->tillPost('/api/till/migrations/start', [
            'store_id' => 'store_main',
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertOk();

        $this->assertSame(1, Product::where('store_id', $this->store->id)->count());
        $this->assertSame(0, Product::where('store_id', $this->otherStore->id)->count());
    }

    public function test_a_terminal_cannot_act_on_another_branchs_run(): void
    {
        $foreign = MigrationRun::create([
            'store_id' => $this->otherStore->id,
            'run_uuid' => (string) \Illuminate\Support\Str::uuid(),
            'source_type' => 'file',
            'status' => 'completed',
        ]);

        $this->tillGet("/api/till/migrations/{$foreign->run_uuid}")->assertStatus(403);
        $this->tillPost("/api/till/migrations/{$foreign->run_uuid}/cutover", [
            'confirmation_phrase' => 'CUTOVER-MIGO',
        ])->assertStatus(403);

        // Its own branch's history stays readable.
        $this->tillGet('/api/till/migrations')->assertOk()->assertJsonPath('data', []);
    }

    public function test_cutover_demands_the_branch_phrase(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $uuid = $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertOk()->json('data.run.run_uuid');

        $this->tillPost("/api/till/migrations/{$uuid}/cutover", [
            'confirmation_phrase' => 'CUTOVER-EVERYTHING',
        ])->assertStatus(422);

        $this->assertNull(MigrationRun::where('run_uuid', $uuid)->value('cutover_at'));

        $this->tillPost("/api/till/migrations/{$uuid}/cutover", [
            'confirmation_phrase' => 'CUTOVER-MIGT',
        ])->assertOk();

        $this->assertNotNull(MigrationRun::where('run_uuid', $uuid)->value('cutover_at'));
    }

    public function test_a_counter_whose_profile_excludes_the_migration_screen_is_denied(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $this->counter->update([
            'permission_profile' => CounterProfile::normalize(['modules' => ['pos', 'bills']]),
        ]);

        $res = $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertStatus(403);

        $this->assertSame('counter_action_not_permitted', $res->json('code'));
        $this->assertSame(0, Product::where('store_id', $this->store->id)->count());
    }

    public function test_switching_migration_off_stops_the_pipeline_but_not_the_history(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $this->store->update(['feature_flags' => ['allow_data_migration' => false]]);

        $res = $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertStatus(403);

        $this->assertSame('data_migration_disabled', $res->json('code'));
        $this->assertSame(0, Product::where('store_id', $this->store->id)->count());

        // A switch that stops future imports must not strand what already landed.
        $this->tillPost('/api/till/migrations/precheck', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertStatus(403);

        $this->tillGet('/api/till/migrations')->assertOk();

        // Turning the switch back on is the only way the pipeline opens again.
        $this->store->update(['feature_flags' => ['allow_data_migration' => true]]);

        $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertOk();

        $this->assertSame(1, Product::where('store_id', $this->store->id)->count());
    }

    /**
     * The wizard was reachable on every till before there was a switch, so a branch
     * that never saved one must keep working. A flag can say that; a menu list cannot,
     * because an old list is indistinguishable from an owner having unchecked a row.
     */
    public function test_a_store_that_never_touched_the_switch_still_migrates(): void
    {
        $this->fakeDisk();
        $ref = $this->uploadBundle($this->bundle());

        $this->store->update(['feature_flags' => null]);
        $this->assertTrue($this->store->fresh()->featureFlag('allow_data_migration'));

        $this->tillPost('/api/till/migrations/start', [
            'source_type' => 'file',
            'config' => ['bundle_ref' => $ref],
        ])->assertOk();

        $this->assertSame(1, Product::where('store_id', $this->store->id)->count());
    }
}
