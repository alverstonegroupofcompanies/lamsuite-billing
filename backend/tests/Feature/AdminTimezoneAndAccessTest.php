<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class AdminTimezoneAndAccessTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store;
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Timezone Store',
            'code' => 'TZ01',
            'store_type' => 'pharmacy',
            'gst_type' => 'regular',
            'state_code' => '32',
            'timezone' => 'Pacific/Kiritimati',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'store_id' => $this->store->id,
            'name' => 'Admin',
            'email' => 'admin@tz.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function invoice(string $date, float $total, string $number): void
    {
        Invoice::create([
            'store_id' => $this->store->id,
            'customer_name' => 'Walk-in',
            'module_key' => 'invoice',
            'invoice_number' => $number,
            'invoice_date' => $date,
            'subtotal' => $total,
            'tax_total' => 0,
            'grand_total' => $total,
            'paid_amount' => $total,
            'payment_mode' => 'Cash',
            'status' => 'paid',
        ]);
    }

    public function test_admin_dashboard_uses_the_store_timezone_for_today(): void
    {
        // 20:00 UTC on the 14th is already 10:00 on the 15th in UTC+14.
        Carbon::setTestNow(Carbon::parse('2026-11-14 20:00:00', 'UTC'));
        $this->invoice('2026-11-15', 500, 'INV-TZ-001');
        $this->invoice('2026-11-14', 300, 'INV-TZ-002');

        $res = $this->actingAs($this->admin)
            ->getJson('/api/admin/dashboard', ['X-Store-Id' => (string) $this->store->id]);

        $res->assertStatus(200)
            ->assertJsonPath('timezone', 'Pacific/Kiritimati');

        $this->assertEquals(500, $res->json('sales.today.amount'));
        $this->assertEquals(1, $res->json('sales.today.count'));
        $this->assertEquals(800, $res->json('sales.week.amount'));
    }

    public function test_store_timezone_can_be_updated_through_admin_settings(): void
    {
        $res = $this->actingAs($this->admin)->postJson('/api/admin/settings', [
            'timezone' => 'Asia/Dubai',
        ], ['X-Store-Id' => (string) $this->store->id]);

        $res->assertStatus(200);
        $this->assertSame('Asia/Dubai', $this->store->fresh()->timezone);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/settings', ['X-Store-Id' => (string) $this->store->id])
            ->assertStatus(200)
            ->assertJsonPath('timezone', 'Asia/Dubai');
    }

    public function test_invalid_timezone_is_rejected(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/admin/settings', [
                'timezone' => 'Mars/Olympus_Mons',
            ], ['X-Store-Id' => (string) $this->store->id])
            ->assertStatus(422)
            ->assertJsonPath('error', 'INVALID_TIMEZONE');

        $this->assertSame('Pacific/Kiritimati', $this->store->fresh()->timezone);
    }

    public function test_device_session_admin_routes_enforce_device_permission(): void
    {
        $cashier = User::create([
            'store_id' => $this->store->id,
            'name' => 'Cashier',
            'email' => 'cashier@tz.test',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'is_active' => true,
        ]);

        $this->actingAs($cashier)
            ->getJson('/api/admin/device-sessions', ['X-Store-Id' => (string) $this->store->id])
            ->assertStatus(403);

        $this->actingAs($this->admin)
            ->getJson('/api/admin/device-sessions', ['X-Store-Id' => (string) $this->store->id])
            ->assertStatus(200)
            ->assertJsonPath('success', true);
    }
}
