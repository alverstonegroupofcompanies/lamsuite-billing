<?php

namespace Tests\Feature;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * GAP-01 / SPR-006, 010 — the salesperson a bill carries.
 *
 * The store decides whether naming one is off, optional or required; a bill
 * remembers the person and the name they had, and the two paths a till bill
 * arrives by — the live save and the offline upload — stamp the same pair.
 */
class SalespersonBillCaptureTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Counter $counter;
    private Product $product;
    private ProductBatch $batch;
    private Salesperson $rina;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->store = Store::create([
            'name' => 'Capture Store',
            'code' => 'SP-CAP',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->counter = Counter::create([
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'counter_name' => 'Counter 01',
            'status' => Counter::STATUS_ACTIVE,
        ]);

        $this->product = Product::create([
            'store_id' => $this->store->id,
            'name' => 'Paracetamol 500mg',
            'current_stock' => 100,
            'mrp' => 120.00,
            'sel_rate' => 100.00,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $this->batch = ProductBatch::create([
            'store_id' => $this->store->id,
            'product_id' => $this->product->id,
            'batch_no' => 'CAP-B1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 100,
            'mrp' => 120.00,
            'selling_rate' => 100.00,
        ]);

        $this->rina = Salesperson::create([
            'store_id' => $this->store->id,
            'name' => 'Rina Thomas',
            'code' => 'SP-01',
            'is_active' => true,
        ]);
    }

    /**
     * @param  array<string,mixed>  $overrides
     * @return array<string,mixed>
     */
    private function payload(array $overrides = []): array
    {
        $externalId = $overrides['external_id'] ?? 'ext_cap_' . uniqid();

        return array_merge([
            'counter_code' => 'C01',
            'store_id' => $this->store->id,
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'CAP-B1',
                'qty' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 0.00,
            ]],
        ], $overrides);
    }

    private function setMode(string $mode): void
    {
        CompanySetting::updateOrCreate(
            ['store_id' => $this->store->id, 'key' => 'salesperson_on_bill'],
            ['value' => $mode, 'is_secret' => false]
        );
    }

    public function test_a_bill_stamps_the_person_and_the_name_they_had(): void
    {
        $externalId = 'ext_cap_stamp';

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/invoices', $this->payload([
                'external_id' => $externalId,
                'idempotency_key' => $externalId,
                'salesperson_id' => $this->rina->id,
            ]))
            ->assertCreated();

        $invoice = Invoice::firstWhere('external_id', $externalId);
        $this->assertSame((int) $this->rina->id, (int) $invoice->salesperson_id);
        $this->assertSame('Rina Thomas', $invoice->salesperson_name);

        // Renaming the master later never rewrites a bill already printed.
        $this->rina->update(['name' => 'Rina Mathew']);

        $this->assertSame('Rina Thomas', $invoice->fresh()->salesperson_name);
    }

    /** SPR-006: `required` blocks an empty bill as soon as the store has staff. */
    public function test_required_blocks_a_bill_without_a_salesperson(): void
    {
        $this->setMode('required');

        $externalId = 'ext_cap_missing';

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/invoices', $this->payload([
                'external_id' => $externalId,
                'idempotency_key' => $externalId,
            ]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'salesperson_required')
            ->assertJsonPath('field', 'salesperson_id');

        $this->assertDatabaseMissing('invoices', ['external_id' => $externalId]);
    }

    public function test_optional_and_off_do_not_block_a_bill(): void
    {
        foreach (['optional', 'off'] as $mode) {
            $this->setMode($mode);

            $externalId = 'ext_cap_' . $mode;

            $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
                ->postJson('/api/invoices', $this->payload([
                    'external_id' => $externalId,
                    'idempotency_key' => $externalId,
                ]))
                ->assertCreated();

            $this->assertNull(Invoice::firstWhere('external_id', $externalId)->salesperson_id);
        }
    }

    /**
     * SPR-006: `required` is a promise about the store's own list. A store
     * that upgraded with nobody on it keeps billing until its owner names staff.
     */
    public function test_required_does_not_strand_a_store_with_no_salespeople(): void
    {
        $this->setMode('required');
        Salesperson::query()->delete();

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/invoices', $this->payload())
            ->assertCreated();
    }

    /** An archived person is out of the bills, though their history survives. */
    public function test_a_bill_cannot_name_an_archived_salesperson(): void
    {
        $this->rina->update(['is_active' => false, 'archived_at' => now()]);

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/invoices', $this->payload(['salesperson_id' => $this->rina->id]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'salesperson_unknown');
    }

    public function test_a_bill_cannot_name_another_stores_salesperson(): void
    {
        $other = Store::create(['name' => 'Elsewhere', 'code' => 'SP-ELSE', 'state_code' => '32', 'is_active' => true]);
        $foreign = Salesperson::create([
            'store_id' => $other->id,
            'name' => 'Someone Else',
            'code' => 'SP-01',
            'is_active' => true,
        ]);

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/invoices', $this->payload(['salesperson_id' => $foreign->id]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'salesperson_unknown');

        $this->assertSame(0, Invoice::count());
    }

    /**
     * SPR-006: `off` is the owner saying this store does not keep the column.
     * A stale payload naming a person is then ignored, not stamped.
     */
    public function test_off_writes_no_salesperson_even_when_one_is_named(): void
    {
        $this->setMode('off');

        $externalId = 'ext_cap_off_named';

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/invoices', $this->payload([
                'external_id' => $externalId,
                'idempotency_key' => $externalId,
                'salesperson_id' => $this->rina->id,
            ]))
            ->assertCreated();

        $invoice = Invoice::firstWhere('external_id', $externalId);
        $this->assertNull($invoice->salesperson_id);
        $this->assertNull($invoice->salesperson_name);
    }

    /**
     * SPR-010: most till bills arrive as an offline upload, so the same pair
     * of columns has to survive that path too — the snapshot is the till's
     * own words, not a fresh read of the master.
     */
    public function test_an_offline_upload_carries_the_salesperson(): void
    {
        $response = $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/sync/push/invoices', [
                'invoices' => [$this->syncInvoice('ext_cap_offline', 'INV-OFF-SP-01', [
                    'salesperson_id' => $this->rina->id,
                    'salesperson_name' => 'Rina Thomas',
                ])],
            ])
            ->assertOk()
            ->assertJson(['ingested_count' => 1, 'failed_count' => 0]);

        $invoice = Invoice::firstWhere('external_id', 'ext_cap_offline');
        $this->assertNotNull($invoice, json_encode($response->json()));
        $this->assertSame((int) $this->rina->id, (int) $invoice->salesperson_id);
        $this->assertSame('Rina Thomas', $invoice->salesperson_name);
    }

    /**
     * The offline path is the till's word, not a bypass: a person of another
     * store fails that one document, the way a live save refuses it, and the
     * bills uploaded beside it still land.
     */
    public function test_an_offline_upload_cannot_name_another_stores_salesperson(): void
    {
        $other = Store::create(['name' => 'Elsewhere', 'code' => 'SP-ELSE2', 'state_code' => '32', 'is_active' => true]);
        $foreign = Salesperson::create([
            'store_id' => $other->id,
            'name' => 'Someone Else',
            'code' => 'SP-01',
            'is_active' => true,
        ]);

        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/sync/push/invoices', [
                'invoices' => [
                    $this->syncInvoice('ext_cap_foreign', 'INV-OFF-SP-02', [
                        'salesperson_id' => $foreign->id,
                        'salesperson_name' => 'Someone Else',
                    ]),
                    $this->syncInvoice('ext_cap_offline_ok', 'INV-OFF-SP-03', [
                        'salesperson_id' => $this->rina->id,
                        'salesperson_name' => 'Rina Thomas',
                    ]),
                ],
            ])
            ->assertOk()
            ->assertJson(['ingested_count' => 1, 'failed_count' => 1]);

        $this->assertDatabaseMissing('invoices', ['external_id' => 'ext_cap_foreign']);
        $this->assertDatabaseHas('invoices', [
            'external_id' => 'ext_cap_offline_ok',
            'salesperson_id' => $this->rina->id,
        ]);
    }

    /**
     * @param  array<string,mixed>  $extra
     * @return array<string,mixed>
     */
    private function syncInvoice(string $externalId, string $invoiceNumber, array $extra = []): array
    {
        return array_merge([
            'external_id' => $externalId,
            'invoice_number' => $invoiceNumber,
            'store_id' => $this->store->id,
            'counter_code' => 'C01',
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'subtotal' => 100.00,
            'taxable_subtotal' => 100.00,
            'discount_total' => 0,
            'tax_total' => 0,
            'grand_total' => 100.00,
            'paid_amount' => 100.00,
            'items' => [[
                'product_id' => $this->product->id,
                'batch_id' => $this->batch->id,
                'batch_no' => 'CAP-B1',
                'qty' => 1,
                'unit_price' => 100.00,
                'gst_percent' => 0.00,
            ]],
        ], $extra);
    }


    /** SPR-002: an id that is not this store's person never becomes a bill. */
    public function test_a_salesperson_id_of_nothing_is_refused_not_ignored(): void
    {
        $this->withHeaders(['X-Store-Id' => (string) $this->store->id])
            ->postJson('/api/invoices', $this->payload(['salesperson_id' => 999999]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'salesperson_unknown');
    }
}
