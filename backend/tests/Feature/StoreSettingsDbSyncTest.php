<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class StoreSettingsDbSyncTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $staffUser;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'City Health Pharmacy',
            'code' => 'STORE-CH01',
            'phone' => '+91 9876543210',
            'email' => 'cityhealth@lamstone.in',
            'address' => '100 Medical Square, Kochi',
            'state_code' => '32',
            'gstin' => '32ABCDE1234F1Z5',
            'tax_mode' => 'inclusive',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'invoice_prefix' => 'INV-CH',
            'is_active' => true,
        ]);

        $this->staffUser = User::create([
            'store_id' => $this->store->id,
            'name' => 'Alice Cashier',
            'email' => 'alice@lamstone.in',
            'username' => 'alice',
            'password' => Hash::make('secret123'),
            'pin_hash' => Hash::make('1234'),
            'role' => 'cashier',
            'permissions' => ['*'],
            'enabled_menus' => ['pos', 'bills', 'settings'],
        ]);
    }

    public function test_get_settings_returns_store_configuration(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->getJson('/api/settings');

        $response->assertStatus(200)
            ->assertJson([
                'store_id' => (string)$this->store->id,
                'store_name' => 'City Health Pharmacy',
                'gstin' => '32ABCDE1234F1Z5',
                'tax_mode' => 'inclusive',
                'gst_type' => 'regular',
                'invoice_prefix' => 'INV-CH',
            ]);
    }

    public function test_billing_and_taxes_settings_are_saved_to_db(): void
    {
        $updatedPayload = [
            'store_id' => (string)$this->store->id,
            'tax_mode' => 'exclusive',
            'purchase_tax_mode' => 'inclusive',
            'gst_type' => 'composition',
            'gstin' => '32XYZ9999999Z1',
            'state_code' => '33',
            'allow_tax_override_per_bill' => true,
            'default_rate_basis' => 'mrp',
            'credit_period_days' => 45,
            'default_discount_percent' => 5,
            'round_off_enabled' => false,
            'default_hsn_code' => '30049090',
            'billing' => [
                'tax_mode' => 'exclusive',
                'purchase_tax_mode' => 'inclusive',
                'gst_type' => 'composition',
                'allow_tax_override_per_bill' => true,
                'default_rate_basis' => 'mrp',
                'credit_period_days' => 45,
                'default_discount_percent' => 5,
                'round_off_enabled' => false,
                'default_hsn_code' => '30049090',
            ],
            'payments' => [
                'enableDynamicUpiQr' => true,
                'upiVpa' => 'pharmacy@upi',
                'upiPayeeName' => 'City Health Pharmacy',
            ],
        ];

        $saveResponse = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', $updatedPayload);

        $saveResponse->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        // Verify database records updated directly in MySQL/SQLite
        $this->store->refresh();
        $this->assertEquals('exclusive', $this->store->tax_mode);
        $this->assertEquals('composition', $this->store->gst_type);
        $this->assertEquals('32XYZ9999999Z1', $this->store->gstin);
        $this->assertEquals('33', $this->store->state_code);

        $companySetting = CompanySetting::where('store_id', $this->store->id)
            ->where('key', 'billing')
            ->first();
        $this->assertNotNull($companySetting);
        $this->assertEquals('exclusive', $companySetting->value['tax_mode']);
        $this->assertEquals('composition', $companySetting->value['gst_type']);
        $this->assertEquals('inclusive', $companySetting->value['purchase_tax_mode']);
        $this->assertTrue($companySetting->value['allow_tax_override_per_bill']);
        $this->assertEquals(45, $companySetting->value['credit_period_days']);
        $this->assertFalse($companySetting->value['round_off_enabled']);

        // Verify another device querying the store receives the new DB settings
        $device2Response = $this->withHeader('X-Store-Id', $this->store->id)
            ->getJson('/api/settings');

        $device2Response->assertStatus(200)
            ->assertJson([
                'tax_mode' => 'exclusive',
                'purchase_tax_mode' => 'inclusive',
                'gst_type' => 'composition',
                'gstin' => '32XYZ9999999Z1',
                'state_code' => '33',
                'allow_tax_override_per_bill' => true,
                'credit_period_days' => 45,
                'round_off_enabled' => false,
            ]);
    }

    public function test_all_devices_logging_into_same_store_receive_same_settings_via_staff_login(): void
    {
        // 1. Configure settings in database
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/settings', [
                'tax_mode' => 'exclusive',
                'gst_type' => 'regular',
                'round_off_enabled' => true,
                'sequences' => [
                    'invoicePrefix' => 'BILL',
                    'nextInvoiceNumber' => 5001,
                ],
                'printing' => [
                    'paperSize' => 'thermal_58mm',
                    'footerNote' => 'Custom Store Receipt Note',
                ],
            ]);

        // 2. Terminal 1 logs in
        $terminal1Login = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'pin' => '1234',
            'counter_id' => 'COUNTER-1',
            'device_uuid' => 'device-uuid-terminal-1',
        ]);

        $terminal1Login->assertStatus(200)
            ->assertJsonStructure([
                'success',
                'user',
                'store',
                'settings' => [
                    'store_id',
                    'tax_mode',
                    'sequences',
                    'printing',
                ],
            ]);

        $this->assertEquals('exclusive', $terminal1Login->json('settings.tax_mode'));
        $this->assertEquals('BILL', $terminal1Login->json('settings.sequences.invoicePrefix'));
        $this->assertEquals('Custom Store Receipt Note', $terminal1Login->json('settings.printing.footerNote'));

        // 3. Terminal 2 logs in with same store
        $terminal2Login = $this->postJson('/api/staff/login', [
            'store_id' => $this->store->id,
            'username' => 'alice',
            'pin' => '1234',
            'counter_id' => 'COUNTER-2',
            'device_uuid' => 'device-uuid-terminal-2',
        ]);

        $terminal2Login->assertStatus(200);
        $this->assertEquals($terminal1Login->json('settings'), $terminal2Login->json('settings'));
    }

    public function test_sync_push_batch_persists_settings_to_db(): void
    {
        $batchPayload = [
            'items' => [
                [
                    'id' => 'sync_set_001',
                    'entity_type' => 'settings',
                    'action' => 'update',
                    'payload' => [
                        'store_id' => (string)$this->store->id,
                        'tax_mode' => 'exclusive',
                        'gst_type' => 'no_tax',
                        'default_discount_percent' => 10,
                    ],
                ],
            ],
        ];

        $pushResponse = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/sync/push/batch', $batchPayload);

        $pushResponse->assertStatus(200)
            ->assertJson([
                'success' => true,
                'results' => [
                    'total' => 1,
                    'processed' => 1,
                    'failed' => 0,
                ],
            ]);

        $this->store->refresh();
        $this->assertEquals('exclusive', $this->store->tax_mode);
        $this->assertEquals('no_tax', $this->store->gst_type);
    }
}
