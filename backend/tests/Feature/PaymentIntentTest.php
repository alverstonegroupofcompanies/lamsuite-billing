<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentIntentTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'UPI Store',
            'code' => 'UPI01',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@upi.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    private function saveUpiConfig(array $overrides = []): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'payments',
            'value' => array_merge([
                'upi' => [
                    'enabled' => true,
                    'showInSettlement' => true,
                    'qrSubtext' => 'Scan and pay',
                    'accounts' => [[
                        'id' => 'upi_main',
                        'upiId' => 'lamstone@okhdfcbank',
                        'payeeName' => 'LamStone Healthcare',
                        'isDefault' => true,
                        'qrSubtext' => 'Main counter UPI',
                    ]],
                ],
            ], $overrides),
            'is_secret' => false,
        ]);
    }

    public function test_builds_upi_intent_uri_with_exact_amount(): void
    {
        $this->saveUpiConfig();

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/payments/upi-intent?amount=499.5&invoice_number=INV-1001')
            ->assertStatus(200)
            ->json();

        $this->assertTrue($response['success']);
        $this->assertSame('upi_intent', $response['provider']);
        $this->assertSame('lamstone@okhdfcbank', $response['vpa']);
        $this->assertSame(499.5, $response['amount']);
        $this->assertStringStartsWith('upi://pay?', $response['upi_uri']);
        $this->assertStringContainsString('am=499.50', $response['upi_uri']);
        $this->assertStringContainsString('pa=lamstone%40okhdfcbank', $response['upi_uri']);
        $this->assertStringContainsString('tr=INV-1001', $response['upi_uri']);
        $this->assertSame('pending', $response['intent']['status']);
    }

    public function test_counter_override_wins_over_default_account(): void
    {
        $this->saveUpiConfig([
            'upi' => [
                'enabled' => true,
                'accounts' => [
                    [
                        'id' => 'upi_main',
                        'upiId' => 'main@okaxis',
                        'payeeName' => 'Main Store',
                        'isDefault' => true,
                    ],
                    [
                        'id' => 'upi_counter2',
                        'upiId' => 'counter2@okaxis',
                        'payeeName' => 'Counter Two',
                        'isDefault' => false,
                        'counterOverrides' => ['C02'],
                    ],
                ],
            ],
        ]);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/payments/upi-intent?amount=100&counter_code=C02')
            ->assertStatus(200)
            ->json();

        $this->assertSame('counter2@okaxis', $response['vpa']);
    }

    public function test_returns_422_when_upi_is_not_configured(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/payments/upi-intent?amount=100')
            ->assertStatus(422)
            ->assertJson(['success' => false]);
    }

    public function test_returns_422_when_upi_is_disabled(): void
    {
        $this->saveUpiConfig(['upi' => ['enabled' => false, 'accounts' => []]]);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/payments/upi-intent?amount=100')
            ->assertStatus(422);
    }

    public function test_validates_amount(): void
    {
        $this->saveUpiConfig();

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/payments/upi-intent?amount=0')
            ->assertStatus(422);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/payments/upi-intent?invoice_number=INV-1')
            ->assertStatus(422);
    }
}
