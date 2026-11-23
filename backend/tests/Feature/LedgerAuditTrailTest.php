<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Notification;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * AUD-02: the reversals and bindings an owner must be able to audit used to leave no
 * trace, and the alerts that matter sat behind an open notification drawer. This pins
 * the trail (cancel, claim) and the alerts that must be raised without anyone looking.
 */
class LedgerAuditTrailTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private Product $product;
    private ProductBatch $batch;
    private User $owner;
    private User $manager;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Trail Store',
            'code' => 'TRAIL01',
            'state_code' => '32',
            'gst_type' => 'regular',
            'tax_mode' => 'exclusive',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Main Counter',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->owner = User::create([
            'store_id' => $this->store->id,
            'name' => 'Trail Owner',
            'email' => 'trail-owner@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'is_active' => true,
        ]);

        $this->manager = User::create([
            'store_id' => $this->store->id,
            'name' => 'Floor Manager',
            'email' => 'trail-manager@lamstone.in',
            'username' => 'trailmanager',
            'password' => bcrypt('manager-pass'),
            'role' => 'manager',
            'is_active' => true,
        ]);

        $this->cashier = User::create([
            'store_id' => $this->store->id,
            'name' => 'Trail Cashier',
            'email' => 'trail-cashier@lamstone.in',
            'password' => bcrypt('cashier-pass'),
            'role' => 'cashier',
            'is_active' => true,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Trail Tablet',
            'current_stock' => 10,
            'mrp' => 100.00,
            'sel_rate' => 100.00,
            'gst_percent' => 0,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'TRAIL-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 10,
            'mrp' => 100.00,
            'selling_rate' => 100.00,
        ]);
    }

    private function sell(array $line = []): Invoice
    {
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in Customer',
                'items' => [array_merge([
                    'product_id' => $this->product->id,
                    'batch_id' => $this->batch->id,
                    'unit_price' => 100.00,
                    'qty' => 1,
                    'loose_qty' => 0,
                    'units_per_pack' => 1,
                    'gst_percent' => 0,
                ], $line)],
            ])
            ->assertStatus(201);

        return Invoice::with('items')->latest('id')->firstOrFail();
    }

    public function test_a_cashier_cancel_writes_invoice_cancelled_to_the_audit_trail(): void
    {
        $invoice = $this->sell();

        $grant = $this->grantCancellationToken($invoice, [
            'action' => 'cancel',
            'mode' => 'manager',
            'identifier' => 'trailmanager',
            'secret' => 'manager-pass',
            'requested_by' => $this->cashier->name,
            'requested_by_user_id' => $this->cashier->id,
            'counter_code' => 'C01',
        ]);

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson("/api/invoices/{$invoice->id}/cancel", [
                'reason' => 'Customer changed mind',
                'approval_token' => $grant,
            ])
            ->assertOk();

        $entry = AuditLog::where('action', 'invoice_cancelled')
            ->where('entity_type', 'Invoice')
            ->where('entity_id', (string) $invoice->id)
            ->firstOrFail();

        $this->assertSame($this->store->id, (int) $entry->store_id);
        $this->assertSame('issued', $entry->old_values['status']);
        $this->assertSame('cancelled', $entry->new_values['status']);
        $this->assertTrue($entry->new_values['stock_restored']);

        // A replay returns "already cancelled" before the service runs, so it adds no trail.
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson("/api/invoices/{$invoice->id}/cancel", ['reason' => 'Customer changed mind'])
            ->assertOk();

        $this->assertSame(1, AuditLog::where('action', 'invoice_cancelled')
            ->where('entity_id', (string) $invoice->id)
            ->count());
    }

    public function test_an_admin_cancel_keeps_its_own_cancel_invoice_action(): void
    {
        $invoice = $this->sell();

        $this->actingAs($this->owner, 'sanctum')
            ->postJson("/api/admin/invoices/{$invoice->id}/cancel", [
                'reason' => 'Customer returned the goods today',
            ])
            ->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'cancel_invoice',
            'entity_type' => 'Invoice',
            'entity_id' => (string) $invoice->id,
            'store_id' => $this->store->id,
        ]);
    }

    public function test_a_successful_counter_claim_leaves_one_audit_row_and_a_replay_leaves_none(): void
    {
        $this->counter->update(['status' => 'pending', 'device_uuid' => null]);

        $raw = ActivationKey::generateForCounter($this->counter)['raw_key'];

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/counters/claim', [
                'code' => $raw,
                'device_uuid' => 'uuid-trail-till',
                'device_name' => 'Counter Laptop',
            ])
            ->assertOk();

        $this->assertSame(1, AuditLog::where('action', 'counter_claimed')
            ->where('entity_id', (string) $this->counter->id)
            ->count());

        // The key is single-use, so a replay cannot claim — and must not add a second trail.
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/counters/claim', [
                'code' => $raw,
                'device_uuid' => 'uuid-trail-till',
                'device_name' => 'Counter Laptop',
            ])
            ->assertStatus(401);

        $this->assertSame(1, AuditLog::where('action', 'counter_claimed')
            ->where('entity_id', (string) $this->counter->id)
            ->count());
    }

    public function test_a_sale_that_drives_the_shelf_negative_raises_an_alert(): void
    {
        $this->batch->update(['stock_qty' => 1]);
        $this->product->update(['current_stock' => 1]);

        $invoice = $this->sell(['qty' => 2]);

        $alert = Notification::where('type', 'negative_stock')->firstOrFail();
        $this->assertSame($invoice->id, (int) $alert->data['invoice_id']);
        $this->assertSame($this->product->id, (int) $alert->data['product_id']);
        $this->assertLessThan(0, (float) $alert->data['remaining']);
    }

    public function test_a_deep_line_discount_raises_an_alert(): void
    {
        // The default counter profile caps discounts at 20% and defers the rest to an
        // approver, so this fixture lifts the ceiling to observe the bill itself.
        $this->counter->update([
            'permission_profile' => ['discount' => ['max_pct' => 100, 'approval_pct' => 100]],
        ]);

        $invoice = $this->sell(['discount_percent' => 60]);

        $alert = Notification::where('type', 'large_discount')->firstOrFail();
        $this->assertSame($invoice->id, (int) $alert->data['invoice_id']);
        $this->assertGreaterThanOrEqual(50, (float) $alert->data['discount_percent']);
        $this->assertSame(0, Notification::where('type', 'negative_stock')->count());
    }

    public function test_the_scheduled_sweep_flags_a_silent_counter_and_does_not_repeat_itself(): void
    {
        DB::table('counters')->where('id', $this->counter->id)
            ->update(['last_seen_at' => now()->subMinutes(20)]);

        $this->artisan('alerts:sweep')->assertExitCode(0);
        $this->assertSame(1, Notification::where('type', 'counter_offline')
            ->where('data->counter_id', $this->counter->id)
            ->count());

        $this->artisan('alerts:sweep')->assertExitCode(0);
        $this->assertSame(1, Notification::where('type', 'counter_offline')
            ->where('data->counter_id', $this->counter->id)
            ->count(), 'the sweep must not page the owner twice for the same silence');
    }
}
