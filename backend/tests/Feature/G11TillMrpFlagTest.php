<?php

namespace Tests\Feature;

use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * TAX-02 (till side): a till that bills offline cannot ask the server about the MRP
 * ceiling, so the settings document it caches has to carry the store's switch.
 */
class G11TillMrpFlagTest extends TestCase
{
    use RefreshDatabase;

    private function store(array $flags = null): Store
    {
        return Store::create([
            'name' => 'Ceiling Pharmacy',
            'code' => 'CEIL-01',
            'store_type' => 'pharmacy',
            'state_code' => '29',
            'gstin' => '29AAAAA0000A1Z5',
            'invoice_prefix' => 'INV-KA',
            'is_active' => true,
            'version' => 1,
            'feature_flags' => $flags,
        ]);
    }

    public function test_the_till_settings_say_the_ceiling_is_on_when_the_store_never_set_it(): void
    {
        $this->actAsClaimedCounterOfRequestedStore();
        $store = $this->store();

        $this->withHeader('X-Store-Id', $store->id)
            ->getJson('/api/settings')
            ->assertOk()
            ->assertJsonPath('billing.enforce_mrp_capping', true);
    }

    public function test_the_till_settings_carry_a_store_that_switched_the_ceiling_off(): void
    {
        $this->actAsClaimedCounterOfRequestedStore();
        $store = $this->store(['enforce_mrp_capping' => false]);

        $this->withHeader('X-Store-Id', $store->id)
            ->getJson('/api/settings')
            ->assertOk()
            ->assertJsonPath('billing.enforce_mrp_capping', false);
    }
}
