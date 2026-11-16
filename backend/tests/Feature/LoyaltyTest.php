<?php

namespace Tests\Feature;

use App\Models\Coupon;
use App\Models\CouponRedemption;
use App\Models\Invoice;
use App\Models\LoyaltyLedger;
use App\Models\LoyaltyProgram;
use App\Models\Party;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LoyaltyTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $otherStore;
    private User $admin;
    private User $cashier;
    private Party $customer;
    private Party $otherCustomer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'Loyalty Store', 'code' => 'LOY01', 'is_active' => true]);
        $this->otherStore = Store::create(['name' => 'Other Loyalty Store', 'code' => 'LOY02', 'is_active' => true]);

        $this->admin = User::create([
            'name' => 'Loyalty Admin',
            'email' => 'loyalty@test.local',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $this->cashier = User::create([
            'name' => 'Loyalty Cashier',
            'email' => 'loyalty-cashier@test.local',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->customer = Party::create([
            'store_id' => $this->store->id,
            'type' => 'customer',
            'name' => 'Loyal Customer',
            'phone' => '9100000001',
            'is_active' => true,
        ]);

        $this->otherCustomer = Party::create([
            'store_id' => $this->otherStore->id,
            'type' => 'customer',
            'name' => 'Foreign Customer',
            'phone' => '9100000002',
            'is_active' => true,
        ]);
    }

    private function auth(?User $user = null)
    {
        return $this->actingAs($user ?? $this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id]);
    }

    private function activateProgram(array $overrides = []): LoyaltyProgram
    {
        $res = $this->auth()->putJson('/api/admin/loyalty/program', array_merge([
            'is_active' => true,
            'earn_points_per_100' => 2,
            'redeem_value_per_point' => 0.5,
            'min_redeem_points' => 100,
        ], $overrides));
        $res->assertOk();

        return LoyaltyProgram::where('store_id', $this->store->id)->firstOrFail();
    }

    private function makeCoupon(array $overrides = []): Coupon
    {
        $res = $this->auth()->postJson('/api/admin/loyalty/coupons', array_merge([
            'code' => 'save10',
            'discount_type' => 'percent',
            'value' => 10,
            'min_bill_amount' => 500,
            'is_active' => true,
        ], $overrides));
        $res->assertStatus(201);

        return Coupon::findOrFail($res->json('coupon.id'));
    }

    private function makeInvoice(string $number = 'INV-LOY-001', float $total = 1000): Invoice
    {
        return Invoice::create([
            'store_id' => $this->store->id,
            'customer_id' => $this->customer->id,
            'invoice_number' => $number,
            'invoice_date' => date('Y-m-d'),
            'grand_total' => $total,
            'paid_amount' => $total,
            'status' => 'issued',
        ]);
    }

    public function test_program_defaults_are_created_and_can_be_updated(): void
    {
        $res = $this->auth()->getJson('/api/admin/loyalty/program');
        $res->assertOk();
        $res->assertJsonPath('program.is_active', false);
        $res->assertJsonPath('program.earn_points_per_100', 1);

        $this->assertDatabaseHas('loyalty_programs', ['store_id' => $this->store->id, 'is_active' => false]);

        $this->activateProgram(['expiry_days' => 365]);

        $program = LoyaltyProgram::where('store_id', $this->store->id)->firstOrFail();
        $this->assertTrue((bool) $program->is_active);
        $this->assertSame(2.0, (float) $program->earn_points_per_100);
        $this->assertSame(365, $program->expiry_days);
        $this->assertDatabaseHas('audit_logs', ['action' => 'update_loyalty_program', 'entity_type' => 'LoyaltyProgram']);
    }

    public function test_program_is_scoped_per_store(): void
    {
        $this->activateProgram();

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->otherStore->id])
            ->getJson('/api/admin/loyalty/program')
            ->assertOk()
            ->assertJsonPath('program.is_active', false)
            ->assertJsonPath('program.store_id', $this->otherStore->id);
    }

    public function test_coupon_crud_with_validation(): void
    {
        $coupon = $this->makeCoupon();
        $this->assertSame('SAVE10', $coupon->code);
        $this->assertSame(10.0, (float) $coupon->value);

        // Duplicate code in same store
        $this->auth()->postJson('/api/admin/loyalty/coupons', [
            'code' => 'SAVE10',
            'discount_type' => 'percent',
            'value' => 5,
        ])->assertStatus(422);

        // Percent > 100 rejected
        $this->auth()->postJson('/api/admin/loyalty/coupons', [
            'code' => 'BAD',
            'discount_type' => 'percent',
            'value' => 150,
        ])->assertStatus(422);

        // Update
        $this->auth()->putJson("/api/admin/loyalty/coupons/{$coupon->id}", [
            'value' => 15,
            'usage_limit' => 50,
        ])->assertOk()->assertJsonPath('coupon.value', 15);

        // List search
        $this->auth()->getJson('/api/admin/loyalty/coupons?search=save')
            ->assertOk()
            ->assertJsonCount(1, 'coupons');

        // Delete
        $this->auth()->deleteJson("/api/admin/loyalty/coupons/{$coupon->id}")->assertOk();
        $this->assertDatabaseMissing('coupons', ['id' => $coupon->id]);
    }

    public function test_coupon_is_store_scoped_for_writes(): void
    {
        $coupon = $this->makeCoupon();

        $this->actingAs($this->admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->otherStore->id])
            ->putJson("/api/admin/loyalty/coupons/{$coupon->id}", ['value' => 20])
            ->assertStatus(404);
    }

    public function test_coupon_validation_applies_minimums_and_caps(): void
    {
        $this->makeCoupon(['value' => 10, 'max_discount' => 100, 'min_bill_amount' => 500]);

        $res = $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/validate', ['code' => 'save10', 'bill_amount' => 1000]);
        $res->assertOk();
        $this->assertSame(100.0, (float) $res->json('discount_amount'));

        // Below minimum
        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/validate', ['code' => 'SAVE10', 'bill_amount' => 400])
            ->assertStatus(422);

        // Unknown code
        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/validate', ['code' => 'NOPE', 'bill_amount' => 1000])
            ->assertStatus(404);
    }

    public function test_inactive_or_expired_coupon_fails_validation(): void
    {
        $this->makeCoupon(['code' => 'OLD', 'valid_to' => now()->subDay()->toDateString()]);

        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/validate', ['code' => 'OLD', 'bill_amount' => 1000])
            ->assertStatus(422);

        $this->makeCoupon(['code' => 'DEAD', 'is_active' => false]);

        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/validate', ['code' => 'DEAD', 'bill_amount' => 1000])
            ->assertStatus(422);
    }

    public function test_coupon_redemption_is_idempotent_per_invoice(): void
    {
        $coupon = $this->makeCoupon(['discount_type' => 'amount', 'value' => 75]);
        $invoice = $this->makeInvoice();

        $payload = ['code' => 'SAVE10', 'invoice_id' => (string) $invoice->id, 'bill_amount' => 1000];

        $first = $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/redeem', $payload);
        $first->assertStatus(201);
        $this->assertSame(75.0, (float) $first->json('discount_amount'));

        $second = $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/redeem', $payload);
        $second->assertOk()->assertJsonPath('already_redeemed', true);

        $this->assertSame(1, CouponRedemption::where('coupon_id', $coupon->id)->count());
        $this->assertSame(1, (int) $coupon->refresh()->used_count);
    }

    public function test_coupon_redemption_requires_existing_invoice(): void
    {
        $this->makeCoupon();

        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/redeem', ['code' => 'SAVE10', 'invoice_id' => '999999', 'bill_amount' => 1000])
            ->assertStatus(404);
    }

    public function test_points_are_earned_once_per_invoice(): void
    {
        $this->activateProgram(['earn_points_per_100' => 2]);
        $invoice = $this->makeInvoice('INV-LOY-100', 1000);

        $payload = [
            'invoice_id' => (string) $invoice->id,
            'customer_id' => $this->customer->id,
            'bill_amount' => 1000,
        ];

        $res = $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/loyalty/earn', $payload);
        $res->assertStatus(201);
        $this->assertSame(20.0, (float) $res->json('points_earned'));
        $this->assertSame(20.0, (float) $res->json('balance'));

        $again = $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/loyalty/earn', $payload);
        $again->assertOk()->assertJsonPath('already_credited', true);

        $this->assertSame(1, LoyaltyLedger::where('invoice_id', $invoice->id)->where('type', 'earn')->count());
    }

    public function test_points_are_not_earned_when_program_inactive(): void
    {
        $invoice = $this->makeInvoice('INV-LOY-200', 500);

        $res = $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/loyalty/earn', [
                'invoice_id' => (string) $invoice->id,
                'customer_id' => $this->customer->id,
                'bill_amount' => 500,
            ]);
        $res->assertOk()->assertJsonPath('program_active', false)->assertJsonPath('points_earned', 0);
        $this->assertSame(0, LoyaltyLedger::count());
    }

    public function test_points_balance_and_redemption_rules(): void
    {
        $this->activateProgram(['min_redeem_points' => 100, 'redeem_value_per_point' => 0.5]);
        LoyaltyLedger::create([
            'store_id' => $this->store->id,
            'customer_id' => $this->customer->id,
            'type' => 'adjust',
            'points_delta' => 250,
            'balance_after' => 250,
        ]);

        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->getJson("/api/loyalty/balance?customer_id={$this->customer->id}")
            ->assertOk()
            ->assertJsonPath('balance', 250);

        // Below minimum
        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/loyalty/redeem', ['customer_id' => $this->customer->id, 'points' => 50])
            ->assertStatus(422);

        // Above balance
        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/loyalty/redeem', ['customer_id' => $this->customer->id, 'points' => 500])
            ->assertStatus(422);

        // Valid redemption, capped by bill
        $res = $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/loyalty/redeem', [
                'customer_id' => $this->customer->id,
                'points' => 200,
                'bill_amount' => 80,
            ]);
        $res->assertStatus(201);
        $this->assertSame(80.0, (float) $res->json('discount_amount'));
        $this->assertSame(50.0, (float) $res->json('balance'));

        $this->assertDatabaseHas('loyalty_ledger', [
            'store_id' => $this->store->id,
            'customer_id' => $this->customer->id,
            'type' => 'redeem',
            'points_delta' => -200,
            'balance_after' => 50,
        ]);
    }

    public function test_manual_adjustment_cannot_go_below_zero_or_cross_store(): void
    {
        $res = $this->auth()->postJson('/api/admin/loyalty/points/adjust', [
            'customer_id' => $this->customer->id,
            'points_delta' => 100,
            'note' => 'Birthday bonus',
        ]);
        $res->assertOk()->assertJsonPath('balance', 100);

        $this->auth()->postJson('/api/admin/loyalty/points/adjust', [
            'customer_id' => $this->customer->id,
            'points_delta' => -500,
        ])->assertStatus(422);

        $this->auth()->postJson('/api/admin/loyalty/points/adjust', [
            'customer_id' => $this->otherCustomer->id,
            'points_delta' => 50,
        ])->assertStatus(422);

        $this->auth()->getJson('/api/admin/loyalty/ledger')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('entries.0.type', 'adjust');
    }

    public function test_ledger_is_store_scoped(): void
    {
        LoyaltyLedger::create([
            'store_id' => $this->otherStore->id,
            'customer_id' => $this->otherCustomer->id,
            'type' => 'adjust',
            'points_delta' => 999,
            'balance_after' => 999,
        ]);

        $this->auth()->getJson('/api/admin/loyalty/ledger')
            ->assertOk()
            ->assertJsonPath('meta.total', 0);
    }

    public function test_cashier_is_denied_admin_loyalty_routes(): void
    {
        $this->auth($this->cashier)->getJson('/api/admin/loyalty/program')->assertStatus(403);
        $this->auth($this->cashier)->getJson('/api/admin/loyalty/coupons')->assertStatus(403);
        $this->auth($this->cashier)->postJson('/api/admin/loyalty/coupons', [
            'code' => 'X',
            'discount_type' => 'amount',
            'value' => 5,
        ])->assertStatus(403);
    }

    public function test_exhausted_usage_limit_blocks_validation(): void
    {
        $coupon = $this->makeCoupon(['usage_limit' => 1]);
        $invoice = $this->makeInvoice('INV-LOY-300', 1000);

        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/redeem', ['code' => 'SAVE10', 'invoice_id' => (string) $invoice->id, 'bill_amount' => 1000])
            ->assertStatus(201);

        $this->assertFalse($coupon->refresh()->isCurrentlyValid());

        $this->actingAs($this->cashier, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/coupons/validate', ['code' => 'SAVE10', 'bill_amount' => 1000])
            ->assertStatus(422);
    }
}
