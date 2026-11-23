<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use App\Support\PharmacistRule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GAP-02 / PHR-002, PHR-003, PHR-008, PHR-011 — the pharmacist record.
 *
 * A pharmacist is a salesperson the store has registered with the council: the
 * same person may sell and may confirm a restricted-drug bill, but the right to
 * confirm comes from a registration number with a validity window, not from a
 * login. Nothing here signs anybody in — the record is a staff master row, and
 * the credential that will release a restricted bill (PHR-004) is that
 * person's own PIN, which must not be a PIN the store already uses to unlock a
 * counter or to approve a bill.
 */
class PharmacistRecordTest extends TestCase
{
    use RefreshDatabase;

    private Store $pharmacy;
    private Store $grocery;
    private User $owner;
    private Counter $c01;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->pharmacy = Store::create([
            'name' => 'LamStone Medicos',
            'code' => 'LRP',
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
            'email' => 'owner@pharmacist-record.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->pharmacy->id,
        ]);

        $this->c01 = Counter::create([
            'store_id' => $this->pharmacy->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => Counter::STATUS_ACTIVE,
        ]);
    }

    /**
     * @param  array<string,mixed>  $overrides
     */
    private function create(array $overrides = [], ?Store $store = null)
    {
        return $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) ($store ?? $this->pharmacy)->id])
            ->postJson('/api/admin/salespeople', array_merge([
                'name' => 'Dr. Firoza Ali',
                'code' => 'SP-09',
            ], $overrides));
    }

    /**
     * @param  array<string,mixed>  $overrides
     */
    private function pharmacist(array $overrides = [], ?Store $store = null)
    {
        return $this->create(array_merge([
            'is_pharmacist' => true,
            'reg_no' => 'KPK-2019-45512',
            'reg_valid_from' => '2019-06-01',
            'reg_valid_until' => '2029-05-31',
            'pin' => '582913',
        ], $overrides), $store);
    }

    private function person(): Salesperson
    {
        $person = Salesperson::firstWhere('code', 'SP-09');
        $this->assertNotNull($person, 'the pharmacist record was not written');

        return $person;
    }

    public function test_the_panel_records_a_pharmacist_with_a_registration_and_its_window(): void
    {
        $created = $this->pharmacist()->assertCreated();

        $person = $this->person();
        $this->assertTrue((bool) $person->is_pharmacist);
        $this->assertSame('KPK-2019-45512', $person->reg_no);
        $this->assertSame('2019-06-01', $person->reg_valid_from->toDateString());
        $this->assertSame('2029-05-31', $person->reg_valid_until->toDateString());
        $this->assertSame('KPK-2019-45512', $created->json('salesperson.reg_no'));
        $this->assertNull($created->json('salesperson.pin_hash'), 'the feed handed back a hash');

        // PHR-002: the digits are a credential, so only its hash is kept and
        // neither the response nor the audit trail carries the value.
        $this->assertTrue(Hash::check('582913', (string) $person->pin_hash));
        $this->assertNotSame('582913', $person->pin_hash);

        $audit = \App\Models\AuditLog::query()
            ->where('action', 'salesperson_created')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($audit);
        $this->assertStringNotContainsString('582913', (string) json_encode($audit->new_values));
        $this->assertStringNotContainsString('$2y$', (string) json_encode($audit->new_values));
    }

    /** PHR-002: a flag without a registration is a claim, not a pharmacist. */
    public function test_a_pharmacist_without_a_registration_number_is_refused(): void
    {
        $refused = $this->pharmacist(['reg_no' => null])->assertStatus(422);

        $this->assertArrayHasKey('reg_no', (array) $refused->json('errors'));
        $this->assertSame(0, Salesperson::count(), 'the refused pharmacist wrote a row');

        $noWindow = $this->pharmacist(['code' => 'SP-10', 'reg_valid_until' => null])->assertStatus(422);
        $this->assertArrayHasKey('reg_valid_until', (array) $noWindow->json('errors'));
        $this->assertSame(0, Salesperson::count());
    }

    /** PHR-011: a store that sells no drugs keeps no pharmacists. */
    public function test_a_store_that_is_not_a_pharmacy_cannot_have_a_pharmacist(): void
    {
        $refused = $this->pharmacist([], $this->grocery)->assertStatus(422);

        $this->assertStringContainsString('pharmacy', strtolower((string) $refused->json('message')));
        $this->assertArrayHasKey('is_pharmacist', (array) $refused->json('errors'));
        $this->assertSame(0, Salesperson::count(), 'the refused pharmacist wrote a row');

        // The same store still takes ordinary salespeople.
        $this->create()->assertCreated();
        $this->assertFalse((bool) $this->person()->is_pharmacist);
    }

    /** E2: the pharmacist credential is judged by the pharmacist domain. */
    public function test_a_pharmacist_pin_is_measured_by_the_pharmacist_domain(): void
    {
        $refused = $this->pharmacist(['pin' => '1234'])->assertStatus(422);

        $this->assertArrayHasKey('pin', (array) $refused->json('errors'));
        $this->assertStringContainsString(
            'pharmacist',
            strtolower((string) $refused->json('errors.pin.0'))
        );
        $this->assertSame(0, Salesperson::count());

        // A salesperson who is not a pharmacist is untouched by the rule.
        $this->create(['pin' => '908123'])->assertCreated();
    }

    /**
     * PHR-008: one PIN, one job. The digits that unlock a counter or approve a
     * bill may not also be the digits that confirm a restricted drug.
     */
    public function test_a_pharmacist_pin_that_borrows_another_domains_value_is_refused(): void
    {
        User::create([
            'name' => 'Approving Manager',
            'email' => 'approver@pharmacist-record.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->pharmacy->id,
            'is_approver' => true,
            'pin_hash' => Hash::make('908123'),
        ]);
        $this->c01->update(['unlock_pin_hash' => Hash::make('415926')]);

        $approverClash = $this->pharmacist(['pin' => '908123'])->assertStatus(422);
        $this->assertArrayHasKey('pin', (array) $approverClash->json('errors'));
        $this->assertStringContainsString(
            'approver',
            strtolower((string) $approverClash->json('errors.pin.0'))
        );

        $counterClash = $this->pharmacist(['code' => 'SP-10', 'pin' => '415926'])->assertStatus(422);
        $this->assertStringContainsString(
            'counter',
            strtolower((string) $counterClash->json('errors.pin.0'))
        );

        $this->assertSame(0, Salesperson::count(), 'a refused PIN still wrote a person');

        $this->pharmacist(['pin' => '372084'])->assertCreated();

        // Two pharmacists cannot share one secret either: the confirmation has
        // to name the person who entered it.
        $ownClash = $this->pharmacist(['code' => 'SP-10', 'pin' => '372084'])->assertStatus(422);
        $this->assertStringContainsString(
            'pharmacist',
            strtolower((string) $ownClash->json('errors.pin.0'))
        );
        $this->assertSame(1, Salesperson::count(), 'a borrowed PIN still wrote a second pharmacist');

        // Rotating onto a borrowed value is refused the same way as issuing it.
        $rotated = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->pharmacy->id])
            ->putJson('/api/admin/salespeople/' . $this->person()->id, ['pin' => '908123'])
            ->assertStatus(422);
        $this->assertArrayHasKey('pin', (array) $rotated->json('errors'));
        $this->assertTrue(Hash::check('372084', (string) $this->person()->fresh()->pin_hash));
    }

    /** PHR-002: a pharmacist is a staff record, never an account. */
    public function test_a_registration_is_not_a_login(): void
    {
        $this->pharmacist()->assertCreated();

        $this->assertSame(1, User::count(), 'the pharmacist master minted an account');

        $attempt = $this->postJson('/api/staff/login', [
            'store_id' => $this->pharmacy->id,
            'username' => 'KPK-2019-45512',
            'pin' => '582913',
        ]);
        $attempt->assertStatus(401);
        $this->assertEmpty($attempt->json('token'), 'a pharmacist record signed in');
    }

    /** PHR-003: what the gate will accept, measured at the moment of the bill. */
    public function test_only_a_registration_that_is_current_and_live_can_confirm(): void
    {
        $this->pharmacist()->assertCreated();
        $person = $this->person();

        $this->assertNull(PharmacistRule::refusal($person, Carbon::parse('2024-01-01')));
        $this->assertTrue(PharmacistRule::canConfirm($person, Carbon::parse('2024-01-01')));

        $expired = PharmacistRule::refusal($person, Carbon::parse('2030-01-01'));
        $this->assertNotNull($expired);
        $this->assertStringContainsString('expired', strtolower($expired));
        $this->assertStringContainsString('KPK-2019-45512', $expired);

        $notYet = PharmacistRule::refusal($person, Carbon::parse('2015-01-01'));
        $this->assertNotNull($notYet);
        $this->assertStringContainsString('starts', strtolower($notYet));

        $person->update(['is_active' => false]);
        $this->assertStringContainsString(
            'switched off',
            strtolower((string) PharmacistRule::refusal($person->fresh()))
        );

        // PHR-003: bringing the record back is what lets the next bill through.
        $person->update(['is_active' => true]);
        $this->assertNull(PharmacistRule::refusal($person->fresh()));

        $person->update(['archived_at' => now()]);
        $this->assertStringContainsString(
            'left',
            strtolower((string) PharmacistRule::refusal($person->fresh()))
        );

        $person->update(['archived_at' => null, 'pin' => null]);
        $this->assertStringContainsString(
            'pin',
            strtolower((string) PharmacistRule::refusal($person->fresh()))
        );
    }

    public function test_a_plain_salesperson_can_never_confirm_a_restricted_bill(): void
    {
        $this->create(['pin' => '582913'])->assertCreated();

        $refusal = PharmacistRule::refusal($this->person());

        $this->assertNotNull($refusal);
        $this->assertStringContainsString('not', strtolower($refusal));
        $this->assertStringContainsString('pharmacist', strtolower($refusal));
    }

    /**
     * PHR-011: the counter feed says who may confirm for a pharmacy and says
     * nothing of pharmacists for a store that keeps no drug schedule.
     */
    public function test_the_counter_feed_carries_the_marks_for_a_pharmacy_only(): void
    {
        $this->pharmacist()->assertCreated();
        $this->create(['name' => 'Counter Staff', 'code' => 'SP-11'], $this->grocery)->assertCreated();

        $pharmacy = $this->withHeaders(['X-Store-Id' => (string) $this->pharmacy->id])
            ->getJson('/api/salespeople/eligible?counter_code=C01')
            ->assertOk()
            ->json('salespeople');

        $row = collect((array) $pharmacy)->firstWhere('code', 'SP-09');
        $this->assertNotNull($row);
        $this->assertTrue((bool) $row['is_pharmacist']);
        $this->assertTrue((bool) $row['registration_valid']);
        $this->assertSame('KPK-2019-45512', $row['reg_no']);
        $this->assertSame(
            null,
            $row['registration_refusal'],
            'a live registration was described as blocked'
        );

        $grocery = $this->withHeaders(['X-Store-Id' => (string) $this->grocery->id])
            ->getJson('/api/salespeople/eligible')
            ->assertOk()
            ->json('salespeople');

        $groceryRow = collect((array) $grocery)->firstWhere('code', 'SP-11');
        $this->assertNotNull($groceryRow);
        $this->assertArrayNotHasKey('is_pharmacist', (array) $groceryRow);
        $this->assertArrayNotHasKey('reg_no', (array) $groceryRow);
        $this->assertArrayNotHasKey('registration_refusal', (array) $groceryRow);
    }

    /** PHR-003 seen from the feed: an expired window is reported, not hidden. */
    public function test_the_feed_reports_an_expired_registration_rather_than_dropping_the_person(): void
    {
        Carbon::setTestNow(Carbon::parse('2031-03-03 09:00:00'));

        try {
            $this->pharmacist()->assertCreated();

            $rows = $this->withHeaders(['X-Store-Id' => (string) $this->pharmacy->id])
                ->getJson('/api/salespeople/eligible')
                ->assertOk()
                ->json('salespeople');

            $row = collect((array) $rows)->firstWhere('code', 'SP-09');
            $this->assertNotNull($row, 'the person vanished from the type-ahead');
            $this->assertFalse((bool) $row['registration_valid']);
            $this->assertStringContainsString(
                'expired',
                strtolower((string) $row['registration_refusal'])
            );
        } finally {
            Carbon::setTestNow();
        }
    }
}
