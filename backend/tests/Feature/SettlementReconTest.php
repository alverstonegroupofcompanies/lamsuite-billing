<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InvoicePayment;
use App\Models\SettlementBatch;
use App\Models\SettlementLine;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SettlementReconTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Settlement Store',
            'code' => 'SET01',
            'is_active' => true,
        ]);

        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@set.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    private function seedPayment(string $reference, float $amount): InvoicePayment
    {
        $invoice = Invoice::create([
            'store_id' => $this->store->id,
            'invoice_number' => 'SET-INV-' . uniqid(),
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'grand_total' => $amount,
            'payment_mode' => 'UPI',
            'status' => 'paid',
        ]);

        return InvoicePayment::create([
            'store_id' => $this->store->id,
            'invoice_id' => $invoice->id,
            'payment_mode' => 'UPI',
            'amount' => $amount,
            'reference_no' => $reference,
            'status' => 'received',
        ]);
    }

    private function csv(): string
    {
        return implode("\n", [
            'date,utr,amount,mode',
            '2026-11-10,UTR-MATCH-1,100.00,UPI',
            '2026-11-10,UTR-MISSING,50.00,UPI',
            '2026-11-10,UTR-MATCH-1,80.00,UPI',
        ]);
    }

    public function test_preview_predicts_matches_without_persisting(): void
    {
        $this->seedPayment('UTR-MATCH-1', 100);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/settlements/preview', ['csv' => $this->csv()])
            ->assertStatus(200)
            ->json();

        $this->assertSame(3, $response['row_count']);
        $this->assertSame(1, $response['matched']);
        $this->assertSame(2, $response['exceptions']);
        $this->assertSame(0, SettlementBatch::count());
    }

    public function test_import_creates_batch_with_matches_and_exceptions(): void
    {
        $this->seedPayment('UTR-MATCH-1', 100);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/settlements', ['csv' => $this->csv(), 'source' => 'upi'])
            ->assertStatus(201)
            ->json();

        $this->assertSame(3, $response['batch']['line_count']);
        $this->assertSame(1, $response['batch']['matched_count']);
        $this->assertSame(2, $response['batch']['exception_count']);
        $this->assertSame(SettlementBatch::STATUS_PARTIAL, $response['batch']['status']);

        $batchId = $response['batch']['id'];
        $lines = SettlementLine::where('settlement_batch_id', $batchId)->orderBy('id')->get();

        $this->assertSame(SettlementLine::STATUS_MATCHED, $lines[0]->status);
        $this->assertSame('invoice_payment', $lines[0]->match_type);
        $this->assertSame(SettlementLine::STATUS_UNMATCHED, $lines[1]->status);
        $this->assertSame(SettlementLine::STATUS_EXCEPTION, $lines[2]->status);
        $this->assertStringContainsString('Amount mismatch', $lines[2]->note);
    }

    public function test_rematch_picks_up_newly_synced_payments(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/settlements', ['csv' => $this->csv()])
            ->assertStatus(201)
            ->json();

        $batchId = $response['batch']['id'];
        $this->assertSame(0, $response['batch']['matched_count']);

        $this->seedPayment('UTR-MATCH-1', 100);
        $this->seedPayment('UTR-MISSING', 50);
        $this->seedPayment('UTR-MATCH-1', 80);

        $rematch = $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/settlements/{$batchId}/rematch")
            ->assertStatus(200)
            ->json();

        $this->assertSame(3, $rematch['batch']['matched_count']);
        $this->assertSame(0, $rematch['batch']['exception_count']);
        $this->assertSame(SettlementBatch::STATUS_RECONCILED, $rematch['batch']['status']);
    }

    public function test_resolve_unmatched_line_by_ignoring_it(): void
    {
        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/settlements', ['csv' => $this->csv()])
            ->assertStatus(201)
            ->json();

        $batchId = $response['batch']['id'];
        $unmatched = SettlementLine::where('settlement_batch_id', $batchId)
            ->where('status', SettlementLine::STATUS_UNMATCHED)
            ->firstOrFail();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/admin/settlements/lines/{$unmatched->id}/resolve", ['action' => 'ignore'])
            ->assertStatus(200)
            ->assertJson(['success' => true, 'line' => ['status' => SettlementLine::STATUS_IGNORED]]);

        $batch = SettlementBatch::find($batchId);
        $this->assertSame(0, $batch->matched_count);
        $this->assertSame(2, $batch->exception_count);
    }

    public function test_rejects_csv_without_reference_or_amount_columns(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/admin/settlements', ['csv' => "foo,bar\n1,2"])
            ->assertStatus(422)
            ->assertJson(['success' => false]);
    }

    public function test_batches_are_scoped_to_active_store(): void
    {
        $other = Store::create(['name' => 'Other', 'code' => 'SET02', 'is_active' => true]);

        SettlementBatch::create([
            'store_id' => $other->id,
            'source' => 'bank',
            'total_amount' => 10,
            'line_count' => 1,
            'status' => SettlementBatch::STATUS_IMPORTED,
        ]);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/admin/settlements?active_store_id=' . $this->store->id)
            ->assertStatus(200)
            ->assertJsonCount(0, 'batches');
    }
}
