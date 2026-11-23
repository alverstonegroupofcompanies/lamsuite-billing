<?php

namespace Tests\Feature;

use App\Models\Counter;
use App\Models\CompanySetting;
use App\Models\Invoice;
use App\Models\MasterLookup;
use App\Models\PharmacistConfirmation;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Salesperson;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * GAP-02 / PHR-004, PHR-005, PHR-011 — the gate that was missing.
 *
 * The QA run sold "QA Alprazolam 0.25 Strip" at C02 and nothing stopped it: no
 * restricted flag the server obeyed, no pharmacist asked, no registration
 * checked. These tests hold the server to the rule it now applies on its own —
 * a bill, a return or a cancellation that carries a restricted line is written
 * only after a registered pharmacist has confirmed it with their own PIN, and
 * the bill keeps the registration that was live at that moment.
 *
 * The till's prompt is not the defence. Every one of these calls is made
 * straight at the API with no screen in front of it.
 */
class PharmacistGateTest extends TestCase
{
    use RefreshDatabase;

    private Store $pharmacy;
    private Store $grocery;
    private User $owner;
    private Counter $c01;
    private Counter $c05;
    private Product $alprazolam;
    private Product $paracetamol;
    private Product $rice;
    private ProductBatch $alpBatch;
    private ProductBatch $paraBatch;
    private ProductBatch $riceBatch;
    private Salesperson $firoza;

    /** The pharmacist's own PIN — six digits, pharmacist domain, nothing trivial. */
    private const PIN = '582913';

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->pharmacy = Store::create([
            'name' => 'LamStone Medicos',
            'code' => 'LMS',
            'state_code' => '32',
            'store_type' => 'pharmacy',
            'is_active' => true,
        ]);
        $this->grocery = Store::create([
            'name' => 'Fresh Mart',
            'code' => 'FRM',
            'state_code' => '32',
            'store_type' => 'kirana_general',
            'is_active' => true,
        ]);

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@pharmacist-gate.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->pharmacy->id,
        ]);

        $this->c01 = $this->counter($this->pharmacy, 'C01');
        $this->c05 = $this->counter($this->grocery, 'C05');

        // Q10: H1 is restricted, H needs a prescription but no pharmacist.
        $h1 = $this->schedule($this->pharmacy, 'H1', ['restricted' => true, 'prescription_required' => true]);
        $h = $this->schedule($this->pharmacy, 'H', ['restricted' => false, 'prescription_required' => true]);

        $this->alprazolam = $this->product($this->pharmacy, 'QA Alprazolam 0.25 Strip', 'GATE-ALP', $h1->id);
        $this->paracetamol = $this->product($this->pharmacy, 'Paracetamol 650', 'GATE-PAR', $h->id);
        $this->rice = $this->product($this->grocery, 'Sona Masoori Rice 5kg', 'GATE-RICE', null);

        $this->alpBatch = $this->batch($this->alprazolam, 'BCH-ALP');
        $this->paraBatch = $this->batch($this->paracetamol, 'BCH-PAR');
        $this->riceBatch = $this->batch($this->rice, 'BCH-RICE');

        $this->firoza = $this->pharmacist('Dr. Firoza Ali', 'SP-01');

        // SPR-006 would otherwise answer first: this file is about who vouched
        // for the restricted line, not about who sold it.
        CompanySetting::updateOrCreate(
            ['store_id' => $this->pharmacy->id, 'key' => 'salesperson_on_bill'],
            ['value' => 'optional', 'is_secret' => false]
        );
    }

    // --- fixtures ---------------------------------------------------------

    private function counter(Store $store, string $code): Counter
    {
        return Counter::create([
            'store_id' => $store->id,
            'counter_code' => $code,
            'counter_name' => "Counter {$code}",
            'status' => Counter::STATUS_ACTIVE,
        ]);
    }

    /**
     * @param  array<string,bool>  $config
     */
    private function schedule(Store $store, string $code, array $config): MasterLookup
    {
        return MasterLookup::create([
            'store_id' => $store->id,
            'type' => 'drug_schedule',
            'code' => $code,
            'name' => "Schedule {$code}",
            'config' => $config,
            'is_active' => true,
        ]);
    }

    private function product(Store $store, string $name, string $barcode, ?int $scheduleId): Product
    {
        return Product::create([
            'store_id' => $store->id,
            'name' => $name,
            'barcode' => $barcode,
            'hsn_sac_code' => '3004',
            'current_stock' => 40,
            'mrp' => 200.00,
            'sel_rate' => 100.00,
            'ptr' => 100.00,
            'gst_percent' => 0.00,
            'units_per_pack' => 1,
            'drug_schedule_id' => $scheduleId,
            // The stamp the item master writes when a schedule is chosen.
            'schedule_code' => $scheduleId === null ? null : MasterLookup::find($scheduleId)->code,
            'is_active' => true,
        ]);
    }

    private function batch(Product $product, string $batchNo): ProductBatch
    {
        return ProductBatch::create([
            'store_id' => $product->store_id,
            'product_id' => $product->id,
            'batch_no' => $batchNo,
            'expiry_date' => '2028-12-31',
            'stock_qty' => 40,
            'mrp' => 200.00,
            'selling_rate' => 100.00,
        ]);
    }

    /**
     * @param  array<string,mixed>  $overrides
     */
    private function pharmacist(string $name, string $code, array $overrides = []): Salesperson
    {
        return Salesperson::create(array_merge([
            'store_id' => $this->pharmacy->id,
            'name' => $name,
            'code' => $code,
            'is_pharmacist' => true,
            'reg_no' => 'KPK-2019-45512',
            'reg_valid_from' => '2019-06-01',
            'reg_valid_until' => '2029-05-31',
            'pin' => self::PIN,
            'is_active' => true,
        ], $overrides));
    }

    /**
     * @param  array<int,array<string,mixed>>  $items
     * @param  array<string,mixed>  $overrides
     */
    private function payload(array $items, array $overrides = []): array
    {
        $externalId = $overrides['external_id'] ?? 'ext_pg_' . uniqid();

        return array_merge([
            'counter_code' => 'C01',
            'store_id' => $this->pharmacy->id,
            'external_id' => $externalId,
            'idempotency_key' => $externalId,
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'items' => $items,
        ], $overrides);
    }

    /**
     * @param  array<string,mixed>  $overrides
     */
    private function line(Product $product, ProductBatch $batch, array $overrides = []): array
    {
        return array_merge([
            'product_id' => $product->id,
            'product_name' => $product->name,
            'batch_id' => $batch->id,
            'batch_no' => $batch->batch_no,
            'qty' => 1,
            'unit_price' => 100.00,
            'gst_percent' => 0.00,
        ], $overrides);
    }

    /**
     * @param  array<int,array<string,mixed>>  $items
     * @param  array<string,mixed>  $overrides
     */
    private function bill(array $items, array $overrides = []): \Illuminate\Testing\TestResponse
    {
        return $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/invoices', $this->payload($items, $overrides));
    }

    /** The restricted bill, confirmed the way the till will confirm it. */
    private function confirmedBill(): Invoice
    {
        $saved = $this->bill([
            $this->line($this->alprazolam, $this->alpBatch),
        ], [
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
        ])->assertStatus(201);

        return Invoice::findOrFail($saved->json('invoice.id'));
    }

    // --- the refusal ------------------------------------------------------

    public function test_a_restricted_drug_bill_needs_a_pharmacist_confirmation(): void
    {
        $refused = $this->bill([$this->line($this->alprazolam, $this->alpBatch)])
            ->assertStatus(422);

        $this->assertSame('PHARMACIST_CONFIRMATION_REQUIRED', $refused->json('code'));
        $this->assertSame(['pos.pharmacist_confirmation'], $refused->json('actions'));
        $this->assertSame('pharmacist_id', $refused->json('field'));

        $this->assertSame(0, Invoice::count(), 'the unconfirmed bill was written anyway');
        $this->assertSame(40.0, (float) $this->alpBatch->fresh()->stock_qty, 'stock moved for a refused bill');
        $this->assertSame(40.0, (float) $this->alprazolam->fresh()->current_stock);
    }

    public function test_the_refusal_names_every_restricted_line_on_the_bill(): void
    {
        $second = $this->product($this->pharmacy, 'Diazepam 5mg', 'GATE-DIA', $this->alprazolam->drug_schedule_id);
        $secondBatch = $this->batch($second, 'BCH-DIA');

        $refused = $this->bill([
            $this->line($this->paracetamol, $this->paraBatch),
            $this->line($this->alprazolam, $this->alpBatch),
            $this->line($second, $secondBatch, ['qty' => 2]),
        ])->assertStatus(422);

        $named = collect($refused->json('restricted_items'));

        $this->assertSame(
            ['QA Alprazolam 0.25 Strip', 'Diazepam 5mg'],
            $named->pluck('product_name')->all(),
            'the dialog is built from this list, so it must carry the restricted lines and only those'
        );
        $this->assertSame([2, 3], $named->pluck('line')->all());
        $this->assertSame(['H1', 'H1'], $named->pluck('schedule_code')->all());
    }

    public function test_a_wrong_pharmacist_pin_refuses_and_never_reaches_the_audit_trail(): void
    {
        $refused = $this->bill([$this->line($this->alprazolam, $this->alpBatch)], [
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => '908123',
        ])->assertStatus(422);

        $this->assertSame('PHARMACIST_CONFIRMATION_INVALID', $refused->json('code'));
        $this->assertSame(0, Invoice::count());

        $this->assertStringNotContainsString(
            '908123',
            (string) json_encode(\App\Models\AuditLog::query()->get(['new_values', 'old_values'])->all()),
            'a credential — right or wrong — is never written to the audit trail'
        );
    }

    public function test_an_expired_registration_refuses_and_names_the_date(): void
    {
        Carbon::setTestNow('2031-03-03 10:00:00');

        $refused = $this->bill([$this->line($this->alprazolam, $this->alpBatch)], [
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
        ])->assertStatus(422);

        $this->assertSame('PHARMACIST_CONFIRMATION_INVALID', $refused->json('code'));
        $this->assertStringContainsString('expired on 2029-05-31', (string) $refused->json('message'));
        $this->assertSame(0, Invoice::count());

        Carbon::setTestNow();
    }

    public function test_a_pharmacist_who_has_left_the_staff_list_cannot_confirm(): void
    {
        $this->firoza->update(['archived_at' => Carbon::now()->subWeek()]);

        $refused = $this->bill([$this->line($this->alprazolam, $this->alpBatch)], [
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
        ])->assertStatus(422);

        $this->assertStringContainsString('left the store', (string) $refused->json('message'));
        $this->assertSame(0, Invoice::count());
    }

    public function test_a_plain_salesperson_cannot_confirm_a_restricted_bill(): void
    {
        $salan = Salesperson::create([
            'store_id' => $this->pharmacy->id,
            'name' => 'Salan K',
            'code' => 'SP-02',
            'pin' => '771203',
            'is_active' => true,
        ]);

        $refused = $this->bill([$this->line($this->alprazolam, $this->alpBatch)], [
            'pharmacist_id' => $salan->id,
            'pharmacist_pin' => '771203',
        ])->assertStatus(422);

        $this->assertStringContainsString('not registered as a pharmacist', (string) $refused->json('message'));
        $this->assertSame(0, Invoice::count());
    }

    public function test_the_salesperson_who_sold_and_the_pharmacist_who_confirmed_are_two_people(): void
    {
        $salan = Salesperson::create([
            'store_id' => $this->pharmacy->id,
            'name' => 'Salan K',
            'code' => 'SP-02',
            'is_active' => true,
        ]);

        $saved = $this->bill([$this->line($this->alprazolam, $this->alpBatch)], [
            'salesperson_id' => $salan->id,
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
        ])->assertStatus(201);

        $this->assertSame($salan->id, (int) $saved->json('invoice.salesperson_id'));
        $this->assertSame($this->firoza->id, (int) $saved->json('invoice.pharmacist_id'));
    }

    public function test_the_confirmation_is_not_limited_to_the_counters_the_pharmacist_sells_at(): void
    {
        // counter_ids says where a person earns sales credit. A registration
        // belongs to the store, so the pharmacist standing at any counter of it
        // may confirm a restricted line.
        $this->firoza->update(['counter_ids' => [$this->c01->id]]);

        $counter = $this->counter($this->pharmacy, 'C03');

        $saved = $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/invoices', $this->payload(
                [$this->line($this->alprazolam, $this->alpBatch)],
                [
                    'counter_code' => $counter->counter_code,
                    'pharmacist_id' => $this->firoza->id,
                    'pharmacist_pin' => self::PIN,
                ]
            ))->assertStatus(201);

        $this->assertSame($this->firoza->id, (int) $saved->json('invoice.pharmacist_id'));
    }

    // --- the confirmation -------------------------------------------------

    public function test_a_correct_pharmacist_pin_saves_the_bill_and_stamps_the_registration(): void
    {
        Carbon::setTestNow('2026-11-22 09:15:00');

        $invoice = $this->confirmedBill();

        $this->assertSame($this->firoza->id, (int) $invoice->pharmacist_id);
        $this->assertSame('Dr. Firoza Ali', $invoice->pharmacist_name);
        $this->assertSame('KPK-2019-45512', $invoice->pharmacist_reg_no);
        $this->assertSame('2026-11-22 09:15:00', $invoice->pharmacist_confirmed_at->format('Y-m-d H:i:s'));

        $this->assertDatabaseHas('pharmacist_confirmations', [
            'store_id' => $this->pharmacy->id,
            'counter_id' => $this->c01->id,
            'document_type' => 'invoice',
            'document_id' => (string) $invoice->id,
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_reg_no' => 'KPK-2019-45512',
            'mode' => 'pharmacist_pin',
        ]);

        // The stamp is the registration as it read that day: a later renewal or
        // rename must not rewrite the bill.
        $this->firoza->update(['reg_no' => 'KPK-2029-99001', 'name' => 'Dr. Firoza Ahmed']);
        $invoice->refresh();
        $this->assertSame('KPK-2019-45512', $invoice->pharmacist_reg_no);
        $this->assertSame('Dr. Firoza Ali', $invoice->pharmacist_name);

        $this->assertSame(39.0, (float) $this->alpBatch->fresh()->stock_qty);

        $audit = \App\Models\AuditLog::query()
            ->where('action', 'pharmacist_confirmed')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($audit, 'the confirmation is not auditable');
        $this->assertStringNotContainsString(self::PIN, (string) json_encode($audit->new_values));

        Carbon::setTestNow();
    }

    public function test_a_bill_of_ordinary_medicines_needs_no_confirmation(): void
    {
        $saved = $this->bill([$this->line($this->paracetamol, $this->paraBatch)])->assertStatus(201);

        $this->assertNull($saved->json('invoice.pharmacist_id'));
        $this->assertSame(0, PharmacistConfirmation::count());
    }

    public function test_a_grocery_store_never_sees_the_pharmacist_rule(): void
    {
        $saved = $this->withHeader('X-Store-Id', $this->grocery->id)
            ->postJson('/api/invoices', $this->payload(
                [$this->line($this->rice, $this->riceBatch)],
                ['counter_code' => 'C05', 'store_id' => $this->grocery->id]
            ))->assertStatus(201);

        $this->assertNull($saved->json('invoice.pharmacist_id'));
        $this->assertSame(0, PharmacistConfirmation::count(), 'a grocery sale wrote a pharmacist confirmation');

        // PHR-011: the panel's own document payload does not carry the block at
        // all for a store that sells no medicines.
        $groceryRow = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->grocery->id])
            ->getJson("/api/admin/invoices/{$saved->json('invoice.id')}")
            ->assertOk()
            ->json();
        $this->assertArrayNotHasKey('pharmacist_id', $groceryRow);

        $pharmacyInvoice = $this->confirmedBill();
        $pharmacyRow = $this->actingAs($this->owner, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $this->pharmacy->id])
            ->getJson("/api/admin/invoices/{$pharmacyInvoice->id}")
            ->assertOk()
            ->json();
        $this->assertSame('KPK-2019-45512', $pharmacyRow['pharmacist_reg_no']);
    }

    // --- returns and cancellations ----------------------------------------

    public function test_a_return_of_a_restricted_bill_needs_that_bill_s_pharmacist_again(): void
    {
        $invoice = $this->confirmedBill();

        $refused = $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/returns/sales', [
                'original_invoice_number' => $invoice->invoice_number,
                'refund_mode' => 'Cash',
                'items' => [['product_id' => $this->alprazolam->id, 'qty' => 1]],
            ])->assertStatus(422);

        $this->assertSame('PHARMACIST_CONFIRMATION_REQUIRED', $refused->json('code'));
        $this->assertSame(0, Invoice::query()->where('module_key', 'credit_note')->count());

        // A different valid pharmacist is not the one who vouched for the sale.
        $naseem = $this->pharmacist('Dr. Naseem Backer', 'SP-03', [
            'reg_no' => 'KPK-2021-77120',
            'pin' => '908123',
        ]);

        $wrongPerson = $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/returns/sales', [
                'original_invoice_number' => $invoice->invoice_number,
                'refund_mode' => 'Cash',
                'pharmacist_id' => $naseem->id,
                'pharmacist_pin' => '908123',
                'items' => [['product_id' => $this->alprazolam->id, 'qty' => 1]],
            ])->assertStatus(422);

        $this->assertSame('PHARMACIST_CONFIRMATION_INVALID', $wrongPerson->json('code'));
        $this->assertStringContainsString('Dr. Firoza Ali', (string) $wrongPerson->json('message'));
        $this->assertSame(0, Invoice::query()->where('module_key', 'credit_note')->count());

        $ok = $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/returns/sales', [
                'original_invoice_number' => $invoice->invoice_number,
                'refund_mode' => 'Cash',
                'pharmacist_id' => $this->firoza->id,
                'pharmacist_pin' => self::PIN,
                'items' => [['product_id' => $this->alprazolam->id, 'qty' => 1]],
            ])->assertStatus(201);

        $note = Invoice::query()->where('module_key', 'credit_note')->first();
        $this->assertNotNull($note);
        $this->assertSame($this->firoza->id, (int) $note->pharmacist_id);
        $this->assertSame('KPK-2019-45512', $note->pharmacist_reg_no);
        $this->assertDatabaseHas('pharmacist_confirmations', [
            'document_type' => 'sales_return',
            'document_id' => (string) $note->id,
        ]);
        $this->assertSame(100.0, (float) $note->grand_total, 'the credit is the line as sold');
    }

    public function test_cancelling_a_restricted_bill_needs_a_pharmacist_confirmation(): void
    {
        $invoice = $this->confirmedBill();

        // APR-003..010 already holds a void behind a grant, so every call here
        // carries a fresh one: the only thing left unanswered is the pharmacist.
        $refused = $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson("/api/invoices/{$invoice->id}/cancel", [
                'reason' => 'Wrong patient',
                'approval_token' => $this->cancelToken($invoice),
            ])->assertStatus(422);

        $this->assertSame('PHARMACIST_CONFIRMATION_REQUIRED', $refused->json('code'));
        $this->assertSame('issued', $invoice->fresh()->status, 'the void happened without a pharmacist');

        $wrong = $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson("/api/invoices/{$invoice->id}/cancel", [
                'reason' => 'Wrong patient',
                'approval_token' => $this->cancelToken($invoice),
                'pharmacist_id' => $this->firoza->id,
                'pharmacist_pin' => '908123',
            ])->assertStatus(422);
        $this->assertSame('PHARMACIST_CONFIRMATION_INVALID', $wrong->json('code'));
        $this->assertSame('issued', $invoice->fresh()->status);

        $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson("/api/invoices/{$invoice->id}/cancel", [
                'reason' => 'Wrong patient',
                'approval_token' => $this->cancelToken($invoice),
                'pharmacist_id' => $this->firoza->id,
                'pharmacist_pin' => self::PIN,
            ])->assertStatus(200);

        $cancelled = $invoice->fresh();
        $this->assertSame('cancelled', $cancelled->status);
        // The void is confirmed; the bill still names who sold it under.
        $this->assertSame('KPK-2019-45512', $cancelled->pharmacist_reg_no);
        $this->assertDatabaseHas('pharmacist_confirmations', [
            'document_type' => 'invoice_cancel',
            'document_id' => (string) $invoice->id,
        ]);
        $this->assertSame(40.0, (float) $this->alpBatch->fresh()->stock_qty, 'the void did not restore stock');
    }

    public function test_an_ordinary_bill_is_cancellable_without_a_pharmacist(): void
    {
        $saved = $this->bill([$this->line($this->paracetamol, $this->paraBatch)])->assertStatus(201);
        $invoice = Invoice::findOrFail($saved->json('invoice.id'));

        $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson("/api/invoices/{$invoice->id}/cancel", [
                'reason' => 'Customer left',
                'approval_token' => $this->cancelToken($invoice),
            ])->assertStatus(200);
    }

    /**
     * A grant for one void of this bill, minted the way a manager at the counter
     * mints it.
     */
    private function cancelToken(Invoice $invoice): string
    {
        return $this->grantCancellationToken($invoice, [
            'action' => 'cancel',
            'mode' => 'manager',
            'identifier' => 'owner@pharmacist-gate.in',
            'secret' => 'password123',
        ]);
    }

    // --- the offline upload ------------------------------------------------

    public function test_an_offline_upload_that_nobody_confirmed_is_filed_not_rejected(): void
    {
        $this->push([
            'id' => 'ext_pg_offline_1',
            'invoice_number' => 'TEMP-PG-1',
            'invoice_date' => Carbon::today()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'counter_code' => 'C01',
            'status' => 'issued',
            'items' => [$this->line($this->alprazolam, $this->alpBatch)],
            'subtotal' => 100.00,
            'taxable_subtotal' => 100.00,
            'tax_total' => 0.00,
            'grand_total' => 100.00,
            'paid_amount' => 100.00,
        ]);

        $invoice = Invoice::query()->where('external_id', 'ext_pg_offline_1')->first();
        $this->assertNotNull($invoice, 'Q1: an offline document is never lost at the gate');
        $this->assertNull($invoice->pharmacist_id);

        $exception = \App\Models\CounterProfileException::query()
            ->where('document_type', 'invoice')
            ->where('document_id', (string) $invoice->id)
            ->first();
        $this->assertNotNull($exception, 'the unconfirmed restricted bill was filed nowhere');
        $this->assertSame('pos.pharmacist_confirmation', $exception->violations[0]['action']);
    }

    public function test_an_offline_upload_with_a_valid_confirmation_is_stamped(): void
    {
        $this->push([
            'id' => 'ext_pg_offline_2',
            'invoice_number' => 'TEMP-PG-2',
            'invoice_date' => Carbon::today()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'counter_code' => 'C01',
            'status' => 'issued',
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
            'items' => [$this->line($this->alprazolam, $this->alpBatch)],
            'subtotal' => 100.00,
            'taxable_subtotal' => 100.00,
            'tax_total' => 0.00,
            'grand_total' => 100.00,
            'paid_amount' => 100.00,
        ]);

        $invoice = Invoice::query()->where('external_id', 'ext_pg_offline_2')->first();
        $this->assertNotNull($invoice);
        $this->assertSame($this->firoza->id, (int) $invoice->pharmacist_id);
        $this->assertSame('KPK-2019-45512', $invoice->pharmacist_reg_no);
        $this->assertSame(
            0,
            \App\Models\CounterProfileException::query()->where('document_id', (string) $invoice->id)->count()
        );
    }

    public function test_an_offline_confirmation_whose_registration_lapsed_since_is_still_kept_and_flagged(): void
    {
        Carbon::setTestNow('2031-03-03 10:00:00');

        $this->push([
            'id' => 'ext_pg_offline_3',
            'invoice_number' => 'TEMP-PG-3',
            'invoice_date' => '2026-11-20',
            'customer_name' => 'Walk-in Customer',
            'payment_mode' => 'Cash',
            'counter_code' => 'C01',
            'status' => 'issued',
            'pharmacist_id' => $this->firoza->id,
            'pharmacist_pin' => self::PIN,
            'items' => [$this->line($this->alprazolam, $this->alpBatch)],
            'subtotal' => 100.00,
            'taxable_subtotal' => 100.00,
            'tax_total' => 0.00,
            'grand_total' => 100.00,
            'paid_amount' => 100.00,
        ]);

        $invoice = Invoice::query()->where('external_id', 'ext_pg_offline_3')->first();
        $this->assertNotNull($invoice, 'the sale the store really made is not discarded');
        $this->assertSame($this->firoza->id, (int) $invoice->pharmacist_id);

        $exception = \App\Models\CounterProfileException::query()
            ->where('document_id', (string) $invoice->id)
            ->first();
        $this->assertNotNull($exception, 'a confirmation the rule no longer trusts is an exception the owner must see');
        $this->assertStringContainsString('expired', (string) $exception->violations[0]['message']);

        Carbon::setTestNow();
    }

    private function push(array $payload): void
    {
        $this->withHeader('X-Store-Id', $this->pharmacy->id)
            ->postJson('/api/sync/push/batch', [
                'items' => [[
                    'entity_type' => 'invoice',
                    'entity_id' => $payload['id'],
                    'action' => 'create',
                    'payload' => $payload,
                ]],
            ])->assertStatus(200);
    }
}
