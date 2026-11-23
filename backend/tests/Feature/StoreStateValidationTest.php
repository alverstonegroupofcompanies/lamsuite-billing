<?php

namespace Tests\Feature;

use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * SET-01: a store's state_code decides CGST+SGST vs IGST, so "3232" is a tax
 * defect. Every writer of store identity (panel create/update, till store
 * profile, till settings document) validates it and the GSTIN's prefix.
 */
class StoreStateValidationTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $superAdmin;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Validation Store',
            'code' => 'VAL-01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'admin@valstore.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@valstore.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);
    }

    public function test_store_creation_rejects_a_non_gst_state_code(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/stores', [
                'name' => 'Doubled State Branch',
                'code' => 'DBL-01',
                'state_code' => '3232',
            ]);

        $response->assertStatus(422)->assertJsonValidationErrors('state_code');
        $this->assertDatabaseMissing('stores', ['code' => 'DBL-01']);
    }

    public function test_store_creation_rejects_a_code_with_unsafe_characters(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/stores', [
                'name' => 'Bad Code Branch',
                'code' => 'STORE 04/QA',
                'state_code' => '32',
            ]);

        $response->assertStatus(422)->assertJsonValidationErrors('code');
    }

    /**
     * Store codes are uppercase letters and digits in hyphen-separated groups,
     * at most 20 characters: they become counter codes and bill prefixes.
     */
    public function test_store_code_must_be_short_hyphenated_uppercase(): void
    {
        foreach (['STORE_04', 'STORE--04', '-STORE04', 'STORE04-', 'ABCDEFGHIJ-KLMNOPQRST'] as $code) {
            $response = $this->actingAs($this->superAdmin, 'sanctum')
                ->postJson('/api/admin/stores', [
                    'name' => 'Code Rule Branch',
                    'code' => $code,
                    'state_code' => '32',
                ]);

            $response->assertStatus(422)->assertJsonValidationErrors('code');
        }
    }

    public function test_store_code_is_saved_uppercase(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/stores', [
                'name' => 'Lowercase Branch',
                'code' => ' qa-ph ',
                'state_code' => '32',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('stores', ['code' => 'QA-PH']);
    }

    public function test_a_store_with_a_legacy_code_can_still_be_edited(): void
    {
        $legacy = Store::create([
            'name' => 'Legacy Branch',
            'code' => 'legacy_store_code_from_v1',
            'state_code' => '32',
            'is_active' => true,
            'version' => 1,
        ]);

        // The panel sends the whole record back, code included, unchanged.
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/stores/{$legacy->id}", [
                'name' => 'Legacy Branch Renamed',
                'code' => 'legacy_store_code_from_v1',
                'state_code' => '32',
            ]);

        $response->assertStatus(200);
        $this->assertSame('Legacy Branch Renamed', $legacy->fresh()->name);
        $this->assertSame('legacy_store_code_from_v1', $legacy->fresh()->code);

        // Changing it, though, must meet today's rule.
        $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/stores/{$legacy->id}", ['code' => 'still_bad'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('code');
    }

    public function test_store_creation_rejects_a_gstin_from_another_state(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/stores', [
                'name' => 'Mismatched GSTIN Branch',
                'code' => 'MM-01',
                'state_code' => '32',
                'gstin' => '27ABCDE1234F1Z5',
            ]);

        $response->assertStatus(422)->assertJsonValidationErrors('state_code');
        $this->assertDatabaseMissing('stores', ['code' => 'MM-01']);
    }

    public function test_store_update_rejects_a_non_gst_state_code(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/stores/{$this->store->id}", [
                'state_code' => '32332',
            ]);

        $response->assertStatus(422)->assertJsonValidationErrors('state_code');
        $this->assertSame('32', $this->store->fresh()->state_code);
    }

    public function test_till_store_profile_rejects_a_non_gst_state_code(): void
    {
        Sanctum::actingAs($this->owner);

        $response = $this->putJson('/api/store', [
            'state_code' => '3232',
        ]);

        $response->assertStatus(422)->assertJsonValidationErrors('state_code');
        $this->assertSame('32', $this->store->fresh()->state_code);
    }

    public function test_till_settings_write_rejects_a_non_gst_state_code(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', [
                'state_code' => '3232',
            ]);

        $response->assertStatus(422)->assertJsonValidationErrors('state_code');
        $this->assertSame('32', $this->store->fresh()->state_code);
    }

    public function test_till_settings_write_rejects_a_gstin_that_contradicts_the_state(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', [
                'state_code' => '32',
                'gstin' => '27ABCDE1234F1Z5',
            ]);

        $response->assertStatus(422)->assertJsonValidationErrors('state_code');
        $this->assertSame('32AAAAA0000A1Z5', $this->store->fresh()->gstin);
    }

    public function test_valid_store_identity_is_still_accepted(): void
    {
        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/stores', [
                'name' => 'Tamil Nadu Branch',
                'code' => 'TN-01',
                'state_code' => '33',
                'gstin' => '33ABCDE1234F1Z5',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('stores', ['code' => 'TN-01', 'state_code' => '33']);
    }

    public function test_the_profile_payload_carries_each_stores_state_code(): void
    {
        $karnataka = Store::create([
            'name' => 'Bengaluru Branch',
            'code' => 'KA-01',
            'store_type' => 'pharmacy',
            'state_code' => '29',
            'gstin' => '29AAAAA0000A1Z5',
            'is_active' => true,
            'version' => 1,
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')->getJson('/api/admin/me');

        $response->assertStatus(200);
        $byId = collect($response->json('stores'))->keyBy('id');
        $this->assertSame('29', $byId[$karnataka->id]['state_code'] ?? null);
        $this->assertSame('32', $byId[$this->store->id]['state_code'] ?? null);
    }
}
