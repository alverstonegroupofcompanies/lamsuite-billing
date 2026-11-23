<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\InvoiceApproval;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use App\Support\Counter\CounterProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GAP-03 / APR-003..010 — a bill above the owner's threshold is not saved on
 * the counter's word. The server asks for a grant, a grant is a single-use
 * credential bound to one document, and a ceiling is never negotiable.
 *
 * The profile below is the shape Q8 settled on: `max_pct` is a hard ceiling,
 * `approval_pct` is the point above which a grant is needed.
 */
class ApprovalEnforcementTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private User $approver;
    private Product $product;
    private ProductBatch $batch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Approval Store',
            'code' => 'APR-ENF',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => 'active',
        ]);

        $this->counter->update([
            'permission_profile' => array_replace_recursive(CounterProfile::defaults(), [
                'discount' => ['max_pct' => 20, 'approval_pct' => 10, 'max_amount' => null],
                'price_override' => ['allowed' => true, 'approval_pct' => 10],
            ]),
            'permission_profile_version' => 7,
        ]);

        $this->approver = User::create([
            'name' => 'Floor Manager',
            'email' => 'approver@apr-enf.in',
            'username' => 'approver1',
            'password' => bcrypt('manager-pass'),
            'pin_hash' => bcrypt('246810'),
            'role' => 'manager',
            'store_id' => $this->store->id,
            'is_approver' => true,
        ]);

        // MRP 200 sits above every price this file bills at: TAX-02's ceiling
        // refuses an over-MRP rate outright, and an approval threshold is a
        // different question — the owner's rule has to be reachable on its own.
        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
            'current_stock' => 100,
            'mrp' => 200.00,
            'sel_rate' => 100.00,
            'ptr' => 90.00,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'APR-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 100,
            'mrp' => 200.00,
            'selling_rate' => 100.00,
        ]);
    }

    private function payload(array $overrides = [], array $itemOverrides = []): array
    {
        $externalId = $overrides['external_id'] ?? 'ext_apr_' . uniqid();

        return array_merge([
            'counter_code' => 'C01',
            'store_id' => $this->store->id,
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'items' => [
                array_merge([
                    'product_id' => $this->product->id,
                    'batch_id' => $this->batch->id,
                    'batch_no' => 'APR-B1',
                    'qty' => 1,
                    'unit_price' => 100.00,
                    'gst_percent' => 0.00,
                ], $itemOverrides),
            ],
        ], $overrides);
    }

    private function grant(array $overrides = []): \Illuminate\Testing\TestResponse
    {
        return $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/approvals/grant', array_merge([
                'document_type' => 'invoice',
                'document_external_id' => 'ext_unknown',
                'actions' => ['pos.discount'],
                'mode' => 'approver_pin',
                'identifier' => 'approver1',
                'pin' => '246810',
                'reason' => 'Customer loyalty price',
            ], $overrides));
    }

    public function test_the_default_profile_caps_discounts_and_asks_for_a_grant(): void
    {
        $document = CounterProfile::defaults();

        // Q8: 20% is the ceiling, 10% is where a grant starts.
        $this->assertSame(20, $document['discount']['max_pct']);
        $this->assertSame(10, $document['discount']['approval_pct']);
        $this->assertSame(10, $document['price_override']['approval_pct']);
    }

    /**
     * Q8: an owner who deletes a limit saves null, not a number. Reading the
     * document must keep that "no limit" instead of quietly restoring the
     * shipped ceiling and threshold and refusing bills that need no grant.
     */
    public function test_an_explicit_no_limit_reads_as_no_limit(): void
    {
        $document = CounterProfile::normalize([
            'discount' => ['max_pct' => null, 'approval_pct' => null, 'max_amount' => null],
            'price_override' => ['allowed' => true, 'approval_pct' => null],
        ]);

        $this->assertNull($document['discount']['max_pct']);
        $this->assertNull($document['discount']['approval_pct']);
        $this->assertNull($document['discount']['max_amount']);
        $this->assertNull($document['price_override']['approval_pct']);

        $this->counter->update([
            'permission_profile' => array_replace_recursive(CounterProfile::defaults(), [
                'discount' => ['max_pct' => null, 'approval_pct' => null, 'max_amount' => null],
                'price_override' => ['allowed' => true, 'approval_pct' => null],
            ]),
        ]);

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload([
                'external_id' => 'ext_no_ceiling_discount',
                'idempotency_key' => 'ext_no_ceiling_discount',
                'bill_discount_percent' => 60,
            ]))
            ->assertCreated();

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload([
                'external_id' => 'ext_no_ceiling_rate',
                'idempotency_key' => 'ext_no_ceiling_rate',
            ], ['unit_price' => 60.00]))
            ->assertCreated();
    }

    public function test_discount_above_the_ceiling_is_refused_even_with_a_grant(): void
    {
        $grant = $this->grant(['document_external_id' => 'ext_hard_ceiling'])
            ->assertCreated()
            ->json('token');

        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload([
                'external_id' => 'ext_hard_ceiling',
                'idempotency_key' => 'ext_hard_ceiling',
                'bill_discount_percent' => 25,
                'approval_token' => $grant,
            ]));

        $response->assertStatus(403)
            ->assertJsonPath('code', 'counter_action_not_permitted')
            ->assertJsonPath('action', 'pos.discount');

        $this->assertDatabaseMissing('invoices', ['external_id' => 'ext_hard_ceiling']);
    }

    public function test_discount_above_the_grant_threshold_without_a_grant_is_refused(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload(['bill_discount_percent' => 15]));

        $response->assertStatus(422)
            ->assertJsonPath('code', 'approval_required')
            ->assertJsonPath('success', false);

        $this->assertContains('pos.discount', $response->json('actions'));
        $this->assertDatabaseCount('invoices', 0);
    }

    public function test_discount_at_the_threshold_needs_no_grant(): void
    {
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload(['bill_discount_percent' => 10]))
            ->assertCreated()
            ->assertJsonPath('success', true);
    }

    public function test_a_grant_lets_the_discounted_bill_through_once(): void
    {
        $externalId = 'ext_granted_once';
        $token = $this->grant(['document_external_id' => $externalId])
            ->assertCreated()
            ->json('token');

        $payload = $this->payload([
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'bill_discount_percent' => 15,
            'approval_token' => $token,
            'approval_reason' => 'Damaged pack',
        ]);

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $payload)
            ->assertCreated()
            ->assertJsonPath('success', true);

        $approval = InvoiceApproval::where('document_external_id', $externalId)->firstOrFail();
        $this->assertNotNull($approval->consumed_at);
        $this->assertSame(['pos.discount'], $approval->actions);

        // The same grant cannot settle a second bill.
        $second = $this->payload(['bill_discount_percent' => 15, 'approval_token' => $token]);
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $second)
            ->assertStatus(422)
            ->assertJsonPath('code', 'approval_invalid');
    }

    public function test_a_grant_bound_to_another_document_cannot_settle_this_bill(): void
    {
        $token = $this->grant(['document_external_id' => 'ext_some_other_bill'])
            ->assertCreated()
            ->json('token');

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload([
                'external_id' => 'ext_this_bill',
                'idempotency_key' => 'ext_this_bill',
                'bill_discount_percent' => 15,
                'approval_token' => $token,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'approval_invalid');
    }

    public function test_a_grant_for_a_different_action_cannot_settle_a_discount(): void
    {
        $token = $this->grant(['document_external_id' => 'ext_wrong_action', 'actions' => ['invoice.edit']])
            ->assertCreated()
            ->json('token');

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload([
                'external_id' => 'ext_wrong_action',
                'idempotency_key' => 'ext_wrong_action',
                'bill_discount_percent' => 15,
                'approval_token' => $token,
            ], ['unit_price' => 100.00]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'approval_invalid');
    }

    public function test_a_price_change_above_the_threshold_needs_a_grant(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload(['external_id' => 'ext_price_150'], ['unit_price' => 150.00]));

        $response->assertStatus(422)
            ->assertJsonPath('code', 'approval_required');
        $this->assertContains('pos.price_override', $response->json('actions'));

        $token = $this->grant([
            'document_external_id' => 'ext_price_150',
            'actions' => ['pos.price_override'],
        ])->assertCreated()->json('token');

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload([
                'external_id' => 'ext_price_150', 'idempotency_key' => 'ext_price_150',
                'approval_token' => $token,
            ], ['unit_price' => 150.00]))
            ->assertCreated();
    }

    public function test_a_price_at_another_documented_rate_basis_is_not_an_override(): void
    {
        // 90 is the product's PTR, not a retyped price: biling at a documented
        // basis must not demand an approver on every purchase-rate sale.
        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload(
                ['external_id' => 'ext_ptr_rate'],
                ['unit_price' => 90.00, 'rate_basis' => 'ptr']
            ))
            ->assertCreated();
    }

    public function test_a_user_without_the_approver_flag_cannot_grant(): void
    {
        $this->approver->update(['is_approver' => false]);

        $this->grant()
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_APPROVER');
    }

    public function test_the_approver_pin_locks_out_after_five_failures(): void
    {
        for ($attempt = 1; $attempt <= 5; $attempt++) {
            $this->grant(['pin' => '999999'])
                ->assertStatus(422)
                ->assertJsonPath('code', 'INVALID_APPROVER_PIN');
        }

        // Even the right PIN waits for an administrator now.
        $this->grant()
            ->assertStatus(423)
            ->assertJsonPath('code', 'APPROVER_LOCKED');
    }

    public function test_an_administrator_issues_a_one_time_pin_that_grants_once(): void
    {
        $owner = User::create([
            'name' => 'Store Owner',
            'email' => 'owner@apr-enf.in',
            'password' => bcrypt('owner-pass'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);

        $issued = $this->actingAs($owner)->postJson('/api/admin/approvals/one-time-pins', [
            'counter_id' => $this->counter->id,
            'actions' => ['pos.discount'],
            'minutes' => 10,
            'reason' => 'Owner approved a one-off discount',
        ])->assertCreated()->json();

        // The PIN is redeemed at the till, which carries the counter's device
        // token and not the administrator's session.
        $this->app['auth']->forgetGuards();

        $token = $this->grant([
            'document_external_id' => 'ext_one_time',
            'mode' => 'one_time_pin',
            'pin' => $issued['pin'],
            'identifier' => null,
        ])->assertCreated()->json('token');

        $this->withHeader('X-Store-Id', $this->store->id)
            ->postJson('/api/invoices', $this->payload([
                'external_id' => 'ext_one_time',
                'idempotency_key' => 'ext_one_time',
                'bill_discount_percent' => 15,
                'approval_token' => $token,
            ]))
            ->assertCreated();
    }
}
