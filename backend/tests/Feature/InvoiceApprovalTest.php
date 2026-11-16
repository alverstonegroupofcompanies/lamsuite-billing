<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\InvoiceApproval;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class InvoiceApprovalTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;
    private User $manager;
    private User $cashier;
    private Invoice $invoice;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Approval Pharmacy',
            'code' => 'APR-01',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Store Owner',
            'email' => 'owner@apr.in',
            'password' => bcrypt('owner-secret'),
            'role' => 'store_owner',
            'store_id' => $this->store->id,
        ]);

        $this->manager = User::create([
            'name' => 'Floor Manager',
            'email' => 'manager@apr.in',
            'username' => 'manager1',
            'password' => bcrypt('manager-pass'),
            'pin_hash' => bcrypt('246810'),
            'role' => 'manager',
            'store_id' => $this->store->id,
        ]);

        $this->cashier = User::create([
            'name' => 'Counter Cashier',
            'email' => 'cashier@apr.in',
            'username' => 'cashier1',
            'password' => bcrypt('cashier-pass'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->invoice = Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => 'APR-INV-100',
            'invoice_date' => now()->toDateString(),
            'grand_total' => 500,
            'status' => 'issued',
        ]);
    }

    private function verifyPayload(array $overrides = []): array
    {
        return array_merge([
            'action' => 'edit',
            'mode' => 'manager',
            'identifier' => 'manager1',
            'secret' => 'manager-pass',
            'requested_by' => 'Counter Cashier',
            'counter_code' => 'C01',
        ], $overrides);
    }

    public function test_manager_password_approval_creates_audited_grant(): void
    {
        $res = $this->postJson("/api/invoices/{$this->invoice->id}/approvals/verify", $this->verifyPayload());

        $res->assertStatus(200)
            ->assertJson([
                'success' => true,
                'approval' => [
                    'action' => 'edit',
                    'mode' => 'manager',
                    'status' => 'used',
                    'approved_by_name' => 'Floor Manager',
                ],
            ]);
        $this->assertNotEmpty($res->json('token'));

        $approval = InvoiceApproval::firstOrFail();
        $this->assertSame('manager', $approval->mode);
        $this->assertNotEmpty($approval->token_hash);
        $this->assertNull($approval->pin_hash);

        $this->assertDatabaseHas('audit_logs', ['action' => 'invoice_approval_used']);
    }

    public function test_manager_can_approve_with_own_pin(): void
    {
        $res = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            $this->verifyPayload(['identifier' => 'manager@apr.in', 'secret' => '246810'])
        );

        $res->assertStatus(200)->assertJson(['success' => true]);
    }

    public function test_wrong_manager_secret_is_rejected_and_audited(): void
    {
        $res = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            $this->verifyPayload(['secret' => 'not-the-password'])
        );

        $res->assertStatus(422)->assertJson([
            'success' => false,
            'code' => 'INVALID_CREDENTIALS',
        ]);
        $this->assertSame(0, InvoiceApproval::count());
        $this->assertSame(1, $this->manager->fresh()->failed_login_attempts);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'invoice_approval_failed',
        ]);
    }

    public function test_cashier_cannot_approve_an_invoice(): void
    {
        $res = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            $this->verifyPayload(['identifier' => 'cashier1', 'secret' => 'cashier-pass'])
        );

        $res->assertStatus(422)->assertJson(['code' => 'INVALID_APPROVER']);
        $this->assertSame(0, InvoiceApproval::count());
    }

    public function test_admin_issues_single_use_pin_bound_to_the_requesting_user(): void
    {
        $issue = $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/invoices/{$this->invoice->id}/edit-approvals", [
                'action' => 'edit',
                'user_id' => $this->cashier->id,
                'minutes' => 10,
                'reason' => 'Customer phone number correction',
            ]);

        $issue->assertStatus(201)->assertJson(['success' => true]);
        $pin = (string)$issue->json('pin');
        $this->assertMatchesRegularExpression('/^[0-9]{6}$/', $pin);

        $approval = InvoiceApproval::firstOrFail();
        $this->assertNotSame($pin, $approval->pin_hash, 'PIN must never be stored in plain text');
        $this->assertTrue(Hash::check($pin, $approval->pin_hash));
        $this->assertSame('pending', $approval->status);
        $this->assertDatabaseHas('audit_logs', ['action' => 'invoice_approval_issued']);

        // The PIN is bound to the cashier it was issued to.
        $wrongUser = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            ['action' => 'edit', 'mode' => 'one_time_pin', 'pin' => $pin, 'user_id' => $this->manager->id]
        );
        $wrongUser->assertStatus(422)->assertJson(['code' => 'INVALID_ONE_TIME_PIN']);

        $ok = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            ['action' => 'edit', 'mode' => 'one_time_pin', 'pin' => $pin, 'user_id' => $this->cashier->id]
        );
        $ok->assertStatus(200)->assertJson(['success' => true]);
        $this->assertNotEmpty($ok->json('token'));
        $this->assertSame('used', $approval->fresh()->status);
        $this->assertNull($approval->fresh()->pin_hash);

        // Single use: replaying the same PIN fails.
        $replay = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            ['action' => 'edit', 'mode' => 'one_time_pin', 'pin' => $pin, 'user_id' => $this->cashier->id]
        );
        $replay->assertStatus(422)->assertJson(['code' => 'INVALID_ONE_TIME_PIN']);
    }

    public function test_expired_one_time_pin_is_rejected(): void
    {
        $issue = $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/invoices/{$this->invoice->id}/edit-approvals", [
                'action' => 'cancel',
                'user_id' => $this->cashier->id,
                'minutes' => 1,
            ]);
        $issue->assertStatus(201);
        $pin = (string)$issue->json('pin');

        InvoiceApproval::query()->update(['expires_at' => now()->subMinute()]);

        $res = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            ['action' => 'cancel', 'mode' => 'one_time_pin', 'pin' => $pin, 'user_id' => $this->cashier->id]
        );

        $res->assertStatus(422)->assertJson(['code' => 'INVALID_ONE_TIME_PIN']);
    }

    public function test_revoked_pin_cannot_be_used(): void
    {
        $issue = $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/invoices/{$this->invoice->id}/edit-approvals", [
                'action' => 'edit',
                'user_id' => $this->cashier->id,
            ]);
        $pin = (string)$issue->json('pin');
        $approvalId = $issue->json('approval.id');

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/invoices/{$this->invoice->id}/edit-approvals/{$approvalId}/revoke")
            ->assertStatus(200);

        $res = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            ['action' => 'edit', 'mode' => 'one_time_pin', 'pin' => $pin, 'user_id' => $this->cashier->id]
        );

        $res->assertStatus(422)->assertJson(['code' => 'INVALID_ONE_TIME_PIN']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'invoice_approval_revoked']);
    }

    public function test_manager_cannot_issue_admin_one_time_pins(): void
    {
        $res = $this->actingAs($this->manager, 'sanctum')
            ->postJson("/api/admin/invoices/{$this->invoice->id}/edit-approvals", [
                'action' => 'edit',
                'user_id' => $this->cashier->id,
            ]);

        $res->assertStatus(403);
        $this->assertSame(0, InvoiceApproval::count());
    }

    public function test_approval_is_scoped_to_the_invoice_store(): void
    {
        $otherStore = Store::create([
            'name' => 'Other Store',
            'code' => 'OTH-01',
            'is_active' => true,
        ]);
        $foreignManager = User::create([
            'name' => 'Foreign Manager',
            'email' => 'foreign@oth.in',
            'username' => 'foreign1',
            'password' => bcrypt('foreign-pass'),
            'role' => 'manager',
            'store_id' => $otherStore->id,
        ]);

        $res = $this->postJson(
            "/api/invoices/{$this->invoice->id}/approvals/verify",
            $this->verifyPayload(['identifier' => 'foreign1', 'secret' => 'foreign-pass'])
        );

        $res->assertStatus(422)->assertJson(['code' => 'INVALID_APPROVER']);
        $this->assertSame(0, InvoiceApproval::count());
    }
}
