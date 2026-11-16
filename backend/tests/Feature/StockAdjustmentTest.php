<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockAdjustmentDocument;
use App\Models\StockLedgerEntry;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Items 27 & 28: multi-line adjustment documents, one ledger entry per line,
 * physical-count mode, and server-enforced per-store policy.
 */
class StockAdjustmentTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $owner;
    private Product $paracetamol;
    private Product $amoxicillin;
    private ProductBatch $paraBatch;
    private ProductBatch $amoxBatch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(\App\Http\Middleware\AuthenticateDevice::class);

        $this->store = Store::create([
            'name' => 'Adjustment Pharmacy',
            'code' => 'ADJ01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Adjustment Owner',
            'email' => 'owner@adjust.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        $this->paracetamol = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
            'barcode' => '8901000000011',
            'hsn_sac_code' => '30049099',
            'mrp' => 35,
            'sel_rate' => 32,
            'ptr' => 24,
            'gst_percent' => 12,
            'current_stock' => 100,
            'is_active' => true,
            'version' => 1,
        ]);

        $this->amoxicillin = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Amoxicillin 500mg',
            'barcode' => '8901000000028',
            'hsn_sac_code' => '30049099',
            'mrp' => 120,
            'sel_rate' => 110,
            'ptr' => 85,
            'gst_percent' => 12,
            'current_stock' => 40,
            'is_active' => true,
            'version' => 1,
        ]);

        $this->paraBatch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->paracetamol->id,
            'batch_no' => 'PAR-01',
            'expiry_date' => '2027-12-31',
            'stock_qty' => 100,
            'purchase_rate' => 24,
            'mrp' => 35,
            'selling_rate' => 32,
            'version' => 1,
        ]);

        $this->amoxBatch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->amoxicillin->id,
            'batch_no' => 'AMX-01',
            'expiry_date' => '2028-06-30',
            'stock_qty' => 40,
            'purchase_rate' => 85,
            'mrp' => 120,
            'selling_rate' => 110,
            'version' => 1,
        ]);

        Sanctum::actingAs($this->owner);
    }

    private function document(array $overrides = []): array
    {
        return array_merge([
            'store_id' => $this->store->id,
            'document_id' => 'adj_test_' . uniqid(),
            'mode' => 'adjustment',
            'notes' => 'Monthly stock audit',
            'lines' => [
                [
                    'product_id' => $this->paracetamol->id,
                    'batch_id' => $this->paraBatch->id,
                    'adjustment_qty' => -10,
                    'reason' => 'Damaged',
                    'notes' => 'Torn strips',
                ],
                [
                    'product_id' => $this->amoxicillin->id,
                    'batch_id' => $this->amoxBatch->id,
                    'adjustment_qty' => 5,
                    'reason' => 'Found Stock',
                    'notes' => 'Found in back shelf',
                ],
            ],
        ], $overrides);
    }

    public function test_multi_line_document_posts_one_ledger_entry_per_line(): void
    {
        $payload = $this->document();

        $res = $this->postJson('/api/stock/adjustments', $payload);

        $res->assertCreated()
            ->assertJson([
                'success' => true,
                'status' => 'posted',
                'lines_count' => 2,
                'adjustments_posted' => 2,
            ]);

        $this->assertSame(90.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(45.0, (float) $this->amoxBatch->fresh()->stock_qty);
        $this->assertSame(90.0, (float) $this->paracetamol->fresh()->current_stock);
        $this->assertSame(45.0, (float) $this->amoxicillin->fresh()->current_stock);

        $ledger = StockLedgerEntry::where('reference_id', $payload['document_id'])->orderBy('id')->get();
        $this->assertCount(2, $ledger);
        $this->assertSame(['ADJUSTMENT_OUT', 'ADJUSTMENT_IN'], $ledger->pluck('event_type')->all());
        $this->assertSame([-10.0, 5.0], $ledger->map(fn($e) => (float) $e->qty_delta)->all());
        $this->assertSame([90.0, 45.0], $ledger->map(fn($e) => (float) $e->balance_after)->all());

        $this->assertDatabaseHas('stock_adjustment_documents', [
            'document_id' => $payload['document_id'],
            'status' => 'posted',
            'lines_count' => 2,
        ]);
        $this->assertSame(2, \App\Models\StockAdjustment::where('store_id', $this->store->id)->count());
    }

    public function test_physical_count_mode_sets_stock_to_counted_quantity(): void
    {
        $res = $this->postJson('/api/stock/adjustments', [
            'store_id' => $this->store->id,
            'document_id' => 'adj_phys_1',
            'mode' => 'physical_count',
            'notes' => 'Quarter-end count',
            'lines' => [
                [
                    'product_id' => $this->paraBatch->product_id,
                    'batch_id' => $this->paraBatch->id,
                    'counted_qty' => 96,
                    'reason' => 'Physical Count',
                ],
            ],
        ]);

        $res->assertCreated();
        $this->assertSame(96.0, (float) $this->paraBatch->fresh()->stock_qty);
        $ledger = StockLedgerEntry::where('reference_id', 'adj_phys_1')->first();
        $this->assertSame('RECONCILIATION_ADJUSTMENT', $ledger->event_type);
        $this->assertSame(-4.0, (float) $ledger->qty_delta);
    }

    public function test_negative_stock_is_blocked_by_default(): void
    {
        $res = $this->postJson('/api/stock/adjustments', $this->document([
            'document_id' => 'adj_neg_1',
            'lines' => [[
                'product_id' => $this->paraBatch->product_id,
                'batch_id' => $this->paraBatch->id,
                'adjustment_qty' => -250,
                'reason' => 'Damaged',
            ]],
        ]));

        $res->assertStatus(422)->assertJsonValidationErrors(['policy']);
        $this->assertStringContainsString('negative stock is blocked', implode(' ', $res->json('errors.policy')));
        $this->assertSame(100.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(0, StockLedgerEntry::count());
    }

    public function test_store_policy_can_allow_negative_stock(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'stock_adjustment_policy',
            'value' => ['allow_negative_stock' => true],
        ]);

        $res = $this->postJson('/api/stock/adjustments', $this->document([
            'document_id' => 'adj_neg_allowed',
            'lines' => [[
                'product_id' => $this->paraBatch->product_id,
                'batch_id' => $this->paraBatch->id,
                'adjustment_qty' => -250,
                'reason' => 'Damaged',
            ]],
        ]));

        $res->assertCreated();
        $this->assertSame(-150.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertTrue((bool) StockLedgerEntry::first()->is_reconciled_negative);
    }

    public function test_role_restriction_and_quantity_cap_are_enforced(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'stock_adjustment_policy',
            'value' => [
                'allowed_roles' => ['store_owner', 'manager'],
                'max_qty_per_line' => 5,
            ],
        ]);

        $cashier = User::create([
            'name' => 'Counter Cashier',
            'email' => 'cashier@adjust.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);
        Sanctum::actingAs($cashier);

        $blockedRole = $this->postJson('/api/stock/adjustments', $this->document(['document_id' => 'adj_role_1']));
        $blockedRole->assertStatus(422);
        $this->assertStringContainsString('not allowed to post stock adjustments', implode(' ', $blockedRole->json('errors.policy')));

        Sanctum::actingAs($this->owner);
        $blockedQty = $this->postJson('/api/stock/adjustments', $this->document(['document_id' => 'adj_qty_1']));
        $blockedQty->assertStatus(422);
        $this->assertStringContainsString('exceeds the maximum 5 units', implode(' ', $blockedQty->json('errors.policy')));
    }

    public function test_required_notes_and_period_lock_are_enforced(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'stock_adjustment_policy',
            'value' => [
                'require_notes' => true,
                'locked_before_date' => '2026-11-01',
            ],
        ]);

        $noNotes = $this->postJson('/api/stock/adjustments', $this->document([
            'document_id' => 'adj_notes_1',
            'notes' => '',
            'lines' => [[
                'product_id' => $this->paraBatch->product_id,
                'batch_id' => $this->paraBatch->id,
                'adjustment_qty' => -1,
                'reason' => '',
            ]],
        ]));
        $noNotes->assertStatus(422);
        $this->assertStringContainsString('note or reason is required', implode(' ', $noNotes->json('errors.policy')));

        $locked = $this->postJson('/api/stock/adjustments', $this->document([
            'document_id' => 'adj_lock_1',
            'document_date' => '2026-10-20',
        ]));
        $locked->assertStatus(422);
        $this->assertStringContainsString('are locked by the store policy', implode(' ', $locked->json('errors.policy')));
    }

    public function test_document_above_approval_threshold_waits_for_manager(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'stock_adjustment_policy',
            'value' => ['approval_threshold_qty' => 4],
        ]);

        $res = $this->postJson('/api/stock/adjustments', $this->document(['document_id' => 'adj_approve_1']));
        $res->assertCreated()->assertJson([
            'status' => 'pending_approval',
            'requires_approval' => true,
            'adjustments_posted' => 0,
        ]);

        // Nothing is posted while the document waits for approval.
        $this->assertSame(100.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(40.0, (float) $this->amoxBatch->fresh()->stock_qty);
        $this->assertSame(0, StockLedgerEntry::count());

        $document = StockAdjustmentDocument::where('document_id', 'adj_approve_1')->firstOrFail();

        $manager = User::create([
            'name' => 'Store Manager',
            'email' => 'manager@adjust.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'manager',
            'store_id' => $this->store->id,
        ]);
        Sanctum::actingAs($manager);

        $approve = $this->postJson("/api/admin/stock-adjustments/{$document->id}/approve");
        $approve->assertOk()->assertJsonPath('document.status', 'approved');

        $this->assertSame(90.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(45.0, (float) $this->amoxBatch->fresh()->stock_qty);
        $this->assertSame(2, StockLedgerEntry::where('reference_id', 'adj_approve_1')->count());
    }

    public function test_cashier_cannot_approve_and_rejection_keeps_stock(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'stock_adjustment_policy',
            'value' => ['approval_threshold_qty' => 1],
        ]);
        $this->postJson('/api/stock/adjustments', $this->document(['document_id' => 'adj_reject_1']))->assertCreated();
        $document = StockAdjustmentDocument::where('document_id', 'adj_reject_1')->firstOrFail();

        $cashier = User::create([
            'name' => 'Approver Cashier',
            'email' => 'cashier2@adjust.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);
        Sanctum::actingAs($cashier);
        $this->postJson("/api/admin/stock-adjustments/{$document->id}/approve")->assertForbidden();

        Sanctum::actingAs($this->owner);
        $this->postJson("/api/admin/stock-adjustments/{$document->id}/reject", ['reason' => 'Wrong count'])->assertOk();
        $this->assertSame(100.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(0, StockLedgerEntry::count());
    }

    public function test_sync_push_is_idempotent_for_the_same_document_id(): void
    {
        $payload = $this->document(['document_id' => 'adj_sync_1']);
        $event = [
            'id' => 'queue_item_1',
            'document_id' => 'adj_sync_1',
            'mode' => 'adjustment',
            'notes' => 'Sync audit',
            'store_id' => $this->store->id,
            'lines' => $payload['lines'],
        ];

        $this->postJson('/api/sync/push/batch', [
            'store_id' => $this->store->id,
            'items' => [[
                'id' => 'queue_item_1',
                'entity_type' => 'stock_adjustment',
                'action' => 'create',
                'payload' => $event,
            ]],
        ])->assertOk()->assertJsonPath('results.processed', 1);

        $this->assertSame(90.0, (float) $this->paraBatch->fresh()->stock_qty);

        // Replaying the same document must not double-apply.
        $this->postJson('/api/sync/push/batch', [
            'store_id' => $this->store->id,
            'items' => [[
                'id' => 'queue_item_1',
                'entity_type' => 'stock_adjustment',
                'action' => 'create',
                'payload' => $event,
            ]],
        ])->assertOk();

        $this->assertSame(90.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(1, StockAdjustmentDocument::where('document_id', 'adj_sync_1')->count());
        $this->assertSame(2, StockLedgerEntry::where('reference_id', 'adj_sync_1')->count());
    }

    public function test_admin_reconcile_cannot_bypass_store_policy(): void
    {
        CompanySetting::create([
            'store_id' => $this->store->id,
            'key' => 'stock_adjustment_policy',
            'value' => ['allowed_roles' => ['store_owner']],
        ]);

        $manager = User::create([
            'name' => 'Inventory Manager',
            'email' => 'invmanager@adjust.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'manager',
            'store_id' => $this->store->id,
        ]);
        Sanctum::actingAs($manager);

        $blocked = $this->postJson('/api/admin/inventory/reconcile', [
            'store_id' => $this->store->id,
            'product_id' => $this->paracetamol->id,
            'batch_no' => 'PAR-01',
            'physical_qty' => 90,
            'reason' => 'Admin recount',
        ]);
        $blocked->assertStatus(422)->assertJsonValidationErrors(['policy']);
        $this->assertSame(100.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(0, StockLedgerEntry::count());

        Sanctum::actingAs($this->owner);
        $allowed = $this->postJson('/api/admin/inventory/reconcile', [
            'store_id' => $this->store->id,
            'product_id' => $this->paracetamol->id,
            'batch_no' => 'PAR-01',
            'physical_qty' => 90,
            'reason' => 'Admin recount',
        ]);
        $allowed->assertOk()->assertJsonPath('success', true);
        $this->assertSame(90.0, (float) $this->paraBatch->fresh()->stock_qty);
        $this->assertSame(1, StockLedgerEntry::count());
    }

    public function test_admin_can_read_and_update_the_policy(): void
    {
        $this->getJson('/api/admin/stock-adjustments/policy?store_id=' . $this->store->id)
            ->assertOk()
            ->assertJsonPath('policy.allow_negative_stock', false);

        $this->putJson('/api/admin/stock-adjustments/policy', [
            'store_id' => $this->store->id,
            'policy' => [
                'allow_negative_stock' => true,
                'max_qty_per_line' => 25,
                'require_notes' => true,
            ],
        ])->assertOk()->assertJsonPath('policy.max_qty_per_line', 25);

        $this->assertDatabaseHas('company_settings', [
            'store_id' => $this->store->id,
            'key' => 'stock_adjustment_policy',
        ]);
        $this->assertTrue($this->store->fresh()->allow_negative_stock);
    }
}
