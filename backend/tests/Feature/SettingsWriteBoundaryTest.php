<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * SET-03: a till's routine work must never rewrite the store's numbering.
 * Document numbers belong to the counter's own series (CNT-014); the settings
 * document a device posts may carry presentation choices, not sequences.
 */
class SettingsWriteBoundaryTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Boundary Pharmacy',
            'code' => 'BND-01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5',
            'invoice_prefix' => 'INV-KL',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@boundary.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);
    }

    public function test_a_counter_settings_write_cannot_change_numbering(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', [
                'sequences' => [
                    'invoicePrefix' => 'HACK',
                    'nextInvoiceNumber' => 9999,
                ],
                'next_invoice_number' => 9999,
                'invoice_prefix' => 'HACK',
                'printing' => ['footerNote' => 'Saved from the till'],
            ]);

        $response->assertStatus(200)->assertJson(['success' => true]);

        $this->assertSame('INV-KL', $this->store->fresh()->invoice_prefix);
        $this->assertNull(
            CompanySetting::where('store_id', $this->store->id)->where('key', 'sequences')->first(),
            'A device settings write must not create the sequences mirror.'
        );
        $this->assertSame(
            'Saved from the till',
            CompanySetting::where('store_id', $this->store->id)->where('key', 'printing')->first()->value['footerNote']
        );
    }

    public function test_the_panel_can_still_set_the_store_numbering_prefix(): void
    {
        Sanctum::actingAs($this->owner);

        $response = $this->postJson('/api/admin/settings', [
            'sequences' => [
                'invoicePrefix' => 'BILL',
                'nextInvoiceNumber' => 5001,
            ],
        ]);

        $response->assertStatus(200)->assertJson(['success' => true]);

        $this->assertSame('BILL', $this->store->fresh()->invoice_prefix);
        $sequences = CompanySetting::where('store_id', $this->store->id)->where('key', 'sequences')->first();
        $this->assertNotNull($sequences);
        $this->assertSame(5001, $sequences->value['nextInvoiceNumber']);
    }

    public function test_a_queued_settings_document_is_treated_as_a_device_write(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/batch', [
                'items' => [[
                    'id' => 'sync_settings_1',
                    'entity_type' => 'settings',
                    'action' => 'update',
                    'payload' => [
                        'sequences' => [
                            'invoicePrefix' => 'OFFLINE',
                            'nextInvoiceNumber' => 7001,
                        ],
                        'invoice_prefix' => 'OFFLINE',
                        'tax_mode' => 'exclusive',
                    ],
                ]],
            ]);

        $response->assertStatus(200)->assertJsonPath('results.failed', 0);

        $this->assertSame('INV-KL', $this->store->fresh()->invoice_prefix);
        $this->assertNull(
            CompanySetting::where('store_id', $this->store->id)->where('key', 'sequences')->first(),
            'A queued device document must not create the sequences mirror.'
        );
        $this->assertSame('exclusive', $this->store->fresh()->tax_mode);
    }

    public function test_the_settings_payload_carries_the_version_a_write_must_match(): void
    {
        $this->withHeader('X-Store-Id', $this->store->id)
            ->getJson('/api/settings')
            ->assertStatus(200)
            ->assertJsonPath('settings_version', 1);
    }

    public function test_a_write_from_a_stale_settings_document_is_refused(): void
    {
        $this->store->update(['tax_mode' => 'inclusive', 'version' => 4]);

        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', [
                'settings_version' => 3,
                'tax_mode' => 'exclusive',
                'printing' => ['footerNote' => 'Stale'],
            ]);

        $response->assertStatus(409)->assertJsonPath('current_version', 4);

        $this->assertSame('inclusive', $this->store->fresh()->tax_mode);
        $this->assertNull(
            CompanySetting::where('store_id', $this->store->id)->where('key', 'printing')->first()
        );
    }

    public function test_a_current_write_moves_the_version_on(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', [
                'settings_version' => 1,
                'printing' => ['footerNote' => 'Fresh'],
            ]);

        $response->assertStatus(200)->assertJsonPath('settings.settings_version', 2);
        $this->assertSame(2, (int) $this->store->fresh()->version);

        // The same version again is now stale: a second device that read
        // version 1 cannot overwrite what the first one just saved.
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', [
                'settings_version' => 1,
                'printing' => ['footerNote' => 'Second device'],
            ])
            ->assertStatus(409);
    }

    public function test_a_stale_queued_settings_document_fails_instead_of_overwriting(): void
    {
        $this->store->update(['tax_mode' => 'inclusive', 'version' => 5]);

        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/batch', [
                'items' => [[
                    'id' => 'sync_settings_stale',
                    'entity_type' => 'settings',
                    'action' => 'update',
                    'payload' => [
                        'settings_version' => 2,
                        'tax_mode' => 'exclusive',
                    ],
                ]],
            ]);

        $response->assertStatus(200)->assertJsonPath('results.failed', 1);
        $this->assertSame('inclusive', $this->store->fresh()->tax_mode);
    }
}
