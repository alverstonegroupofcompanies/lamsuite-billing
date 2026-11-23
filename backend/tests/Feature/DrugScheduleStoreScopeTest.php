<?php

namespace Tests\Feature;

use App\Models\MasterLookup;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use App\Support\DrugSchedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GAP-02 / PHR-001, PHR-011 — the schedule list an owner owns, and the flag
 * that makes it mean something on a product.
 *
 * Until now "Schedule H1" existed only as a badge the till drew from a field
 * the server never stored, so every restricted drug sold freely. A schedule is
 * now a per-store row the panel edits, a product names one of its own store's
 * schedules, and the restricted/prescription marks are read from that row when
 * a bill is checked — which is what lets an owner widen or narrow the rule and
 * have it apply to the next bill without rewriting the history of the last one.
 */
class DrugScheduleStoreScopeTest extends TestCase
{
    use RefreshDatabase;

    private Store $pharmacy;
    private Store $grocery;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->pharmacy = Store::create([
            'name' => 'LamStone Medicos',
            'code' => 'LMS',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);
        $this->grocery = Store::create([
            'name' => 'Fresh Mart',
            'code' => 'FRM',
            'state_code' => '32',
            'store_type' => 'kirana_general',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@drug-schedule.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->pharmacy->id,
        ]);
    }

    private function createSchedule(array $overrides = [], ?Store $store = null)
    {
        $call = $this->actingAs($this->owner, 'sanctum')->withHeaders([
            'X-Store-Id' => (string) ($store ?? $this->pharmacy)->id,
        ]);

        return $call->postJson('/api/admin/lookups', array_merge([
            'type' => 'drug_schedule',
            'code' => 'H1',
            'name' => 'Schedule H1',
            'config' => ['restricted' => true, 'prescription_required' => true],
        ], $overrides));
    }

    private function createProduct(array $overrides = [], ?Store $store = null)
    {
        $call = $this->actingAs($this->owner, 'sanctum')->withHeaders([
            'X-Store-Id' => (string) ($store ?? $this->pharmacy)->id,
        ]);

        return $call->postJson('/api/admin/products', array_merge([
            'store_id' => (string) ($store ?? $this->pharmacy)->id,
            'name' => 'Alprazolam 0.25mg Strip',
            'barcode' => 'QA-ALP-01',
            'hsn_sac_code' => '3004',
            'mrp' => 42.00,
            'sel_rate' => 38.00,
            'gst_percent' => 5.00,
            'units_per_pack' => 1,
        ], $overrides));
    }

    public function test_the_owner_marks_which_schedules_are_restricted_and_which_need_a_prescription(): void
    {
        $created = $this->createSchedule()->assertCreated();

        $schedule = MasterLookup::query()->where('type', 'drug_schedule')->first();
        $this->assertNotNull($schedule, 'the schedule list wrote nothing');
        $this->assertSame($this->pharmacy->id, (int) $schedule->store_id);
        $this->assertSame('H1', $schedule->code);
        $this->assertTrue((bool) $schedule->config['restricted']);
        $this->assertTrue((bool) $schedule->config['prescription_required']);
        $this->assertSame('H1', $created->json('code'));

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'create_lookup',
            'entity_type' => 'MasterLookup',
            'entity_id' => (string) $schedule->id,
            'store_id' => $this->pharmacy->id,
        ]);
    }

    public function test_a_store_that_sells_no_drugs_is_told_it_has_no_schedule_list(): void
    {
        $refused = $this->createSchedule([], $this->grocery)->assertStatus(422);

        $this->assertStringContainsString(
            'pharmacy',
            strtolower((string) $refused->json('message'))
        );
        $this->assertSame(
            0,
            MasterLookup::query()->where('type', 'drug_schedule')->count(),
            'the refused schedule still wrote a row'
        );
    }

    public function test_a_product_names_a_schedule_of_its_own_store_and_no_other(): void
    {
        $mine = $this->createSchedule()->assertCreated()->json('id');

        $product = $this->createProduct(['drug_schedule_id' => $mine])
            ->assertCreated()
            ->json();

        $row = Product::find($product['id']);
        $this->assertNotNull($row);
        $this->assertSame((int) $mine, (int) $row->drug_schedule_id);
        // The code travels with the row so a later rename of the list cannot
        // rewrite what an old bill actually sold.
        $this->assertSame('H1', $row->schedule_code);
        $this->assertSame('H1', $product['schedule_code']);
    }

    private function secondPharmacy(): Store
    {
        $second = Store::create([
            'name' => 'Second Chemist',
            'code' => 'SEC',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);

        $this->createSchedule(['code' => 'X', 'name' => 'Schedule X'], $second);

        return $second;
    }

    public function test_a_schedule_from_another_store_is_refused_by_name(): void
    {
        $second = $this->secondPharmacy();
        $theirs = MasterLookup::query()
            ->where('type', 'drug_schedule')
            ->where('store_id', $second->id)
            ->value('id');

        $refused = $this->createProduct(['drug_schedule_id' => $theirs])->assertStatus(422);

        $this->assertArrayHasKey('drug_schedule_id', (array) $refused->json('errors'));
        $this->assertStringContainsString('own store', (string) $refused->json('errors.drug_schedule_id.0'));
        $this->assertSame(0, Product::query()->count(), 'the refused product wrote a row');
    }

    public function test_an_unknown_or_retired_schedule_is_refused(): void
    {
        $refused = $this->createProduct(['drug_schedule_id' => 999999])->assertStatus(422);
        $this->assertArrayHasKey('drug_schedule_id', (array) $refused->json('errors'));

        $retired = $this->createSchedule(['code' => 'G', 'name' => 'Schedule G'])->assertCreated()->json('id');
        MasterLookup::find($retired)->update(['is_active' => false]);

        $this->createProduct(['barcode' => 'QA-OTHER', 'drug_schedule_id' => $retired])
            ->assertStatus(422);
    }

    public function test_editing_the_list_changes_what_counts_as_restricted_on_the_next_bill(): void
    {
        $schedule = $this->createSchedule()->assertCreated()->json('id');
        $product = Product::create([
            'store_id' => $this->pharmacy->id,
            'name' => 'Azithromycin 500mg',
            'barcode' => 'QA-AZI-01',
            'hsn_sac_code' => '3004',
            'mrp' => 200,
            'sel_rate' => 180,
            'gst_percent' => 5,
            'drug_schedule_id' => $schedule,
            'schedule_code' => 'H1',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->assertTrue(DrugSchedule::isRestricted($product->schedule_code, (int) $this->pharmacy->id));
        $this->assertTrue(DrugSchedule::requiresPrescription($product->schedule_code, (int) $this->pharmacy->id));

        $call = $this->actingAs($this->owner, 'sanctum')->withHeaders([
            'X-Store-Id' => (string) $this->pharmacy->id,
        ])->putJson("/api/admin/lookups/{$schedule}", [
            'config' => ['restricted' => false, 'prescription_required' => false],
        ]);
        $call->assertOk();

        // The next bill reads the list as it stands now…
        $this->assertFalse(DrugSchedule::isRestricted('H1', (int) $this->pharmacy->id));
        $this->assertFalse(DrugSchedule::requiresPrescription('H1', (int) $this->pharmacy->id));
        // …and the row still says what it was called when it was sold.
        $this->assertSame('H1', $product->fresh()->schedule_code);
    }

    public function test_a_store_reads_only_its_own_schedule_list(): void
    {
        $this->createSchedule()->assertCreated();
        $second = $this->secondPharmacy();

        $call = $this->actingAs($this->owner, 'sanctum')->withHeaders([
            'X-Store-Id' => (string) $this->pharmacy->id,
        ])->getJson('/api/admin/lookups?type=drug_schedule');
        $call->assertOk();

        $codes = collect($call->json('data'))->map(fn (array $row): string => (string) $row['code'])->all();
        $this->assertSame(['H1'], $codes, 'another store\'s schedule leaked into this list');

        $this->assertNotEmpty(DrugSchedule::restrictedCodes((int) $second->id));
        $this->assertSame(['H1'], DrugSchedule::restrictedCodes((int) $this->pharmacy->id));
    }
}
