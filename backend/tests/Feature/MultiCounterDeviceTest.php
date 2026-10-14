<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MultiCounterDeviceTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'LamStone Main',
            'code' => 'MAIN',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->user = User::create([
            'name' => 'Counter Cashier',
            'email' => 'cashier@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
            'is_active' => true,
        ]);
    }

    public function test_device_registration_returns_tokens_and_counter_metadata(): void
    {
        $response = $this->postJson('/api/devices/register', [
            'device_uuid' => 'hw_test_mac_12345',
            'device_name' => 'Counter 02 Station',
            'store_id' => 'store_main',
            'is_hub' => false,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'status' => 'activated',
                'counter_name' => 'Counter 02 Station',
                'is_hub' => false,
                'license_plan' => 'Enterprise Retail & Pharmacy Chain',
            ]);

        $this->assertNotEmpty($response->json('device_token'));
        $this->assertNotEmpty($response->json('refresh_token'));
        $this->assertNotEmpty($response->json('counter_id'));
    }

    public function test_branches_endpoint_returns_store_options(): void
    {
        $response = $this->getJson('/api/branches');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'name', 'code', 'city', 'state_code', 'gstin'],
                ],
            ]);
    }

    public function test_license_check_returns_valid_features(): void
    {
        $response = $this->getJson('/api/license/check');

        $response->assertStatus(200)
            ->assertJson([
                'valid' => true,
                'status' => 'active',
            ])
            ->assertJsonFragment(['multi_counter']);
    }

    public function test_daily_collection_filters_by_counter_id(): void
    {
        // Counter 01 invoice
        Invoice::create([
            'invoice_number' => 'C01-INV-1001',
            'store_id' => $this->store->id,
            'user_id' => $this->user->id,
            'counter_id' => 'cntr_01',
            'customer_name' => 'Walk-in',
            'module_key' => 'invoice',
            'invoice_date' => now()->toDateString(),
            'subtotal' => 100,
            'tax_total' => 12,
            'grand_total' => 112,
            'payment_mode' => 'Cash',
            'status' => 'issued',
            'sync_state' => 'synced',
        ]);

        // Counter 02 invoice
        Invoice::create([
            'invoice_number' => 'C02-INV-1001',
            'store_id' => $this->store->id,
            'user_id' => $this->user->id,
            'counter_id' => 'cntr_02',
            'customer_name' => 'Walk-in 2',
            'module_key' => 'invoice',
            'invoice_date' => now()->toDateString(),
            'subtotal' => 200,
            'tax_total' => 24,
            'grand_total' => 224,
            'payment_mode' => 'UPI',
            'status' => 'issued',
            'sync_state' => 'synced',
        ]);

        $this->assertEquals(2, Invoice::count());
        $respAll = $this->actingAs($this->user, 'sanctum')->getJson('/api/reports/daily-collection');
        $respAll->assertStatus(200);
        $this->assertEquals(336.0, $respAll->json('gross_sales'));

        // Query with counter_id=cntr_01 -> only 112
        $respC1 = $this->actingAs($this->user, 'sanctum')->getJson('/api/reports/daily-collection?counter_id=cntr_01');
        $respC1->assertStatus(200);
        $this->assertEquals(112.0, $respC1->json('gross_sales'));

        // Query with counter_id=cntr_02 -> only 224
        $respC2 = $this->actingAs($this->user, 'sanctum')->getJson('/api/reports/daily-collection?counter_id=cntr_02');
        $respC2->assertStatus(200);
        $this->assertEquals(224.0, $respC2->json('gross_sales'));
    }
}
