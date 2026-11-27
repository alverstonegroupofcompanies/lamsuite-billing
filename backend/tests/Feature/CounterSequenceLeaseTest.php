<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Purchase;
use App\Models\StockTransfer;
use App\Models\Store;
use App\Services\CounterSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CNT-014 — the counter owns the number series.
 *
 * Every counter holds one complete set of document types, a lease moves the
 * series it names and nothing else, and no document is filed under a temporary
 * or a foreign number: the server issues the number, adopts a pre-leased one,
 * and never re-issues a number it has already given out.
 */
class CounterSequenceLeaseTest extends TestCase
{
    use RefreshDatabase;

    private const DOC_TYPES = [
        'invoice',
        'sales_return',
        'quotation',
        'purchase_bill',
        'receipt',
        'stock_adjustment',
        'stock_transfer',
    ];

    private const TAILS = [
        'invoice' => 'INV',
        'sales_return' => 'SR',
        'quotation' => 'QUO',
        'purchase_bill' => 'PUR',
        'receipt' => 'REC',
        'stock_adjustment' => 'ADJ',
        'stock_transfer' => 'TRF',
    ];

    private function store(string $code): Store
    {
        return Store::create([
            'name' => "LamStone {$code}",
            'code' => $code,
            'state_code' => '32',
            'tax_mode' => 'inclusive',
            'gst_type' => 'regular',
            'is_active' => true,
        ]);
    }

    /** @return array{counter:Counter, token:string, claim:array} */
    private function claim(Store $store, string $counterCode): array
    {
        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => $counterCode,
            'counter_name' => "{$counterCode} Counter",
            'location_name' => 'Shop floor',
        ]);

        $issued = ActivationKey::generateForCounter($counter);

        $claim = $this->postJson('/api/counters/claim', [
            'code' => $issued['raw_key'],
            'device_uuid' => "dev-{$store->id}-{$counterCode}",
        ])->assertOk()->json();

        // G1-SEC: bills and leases are made with the counter's own token.
        $this->tokens["{$store->id}:{$counterCode}"] = $claim['device_token'];

        return ['counter' => $counter->fresh(), 'token' => $claim['device_token'], 'claim' => $claim];
    }

    /** @var array<string,string> device token per "storeId:counterCode" */
    private array $tokens = [];

    private function sequences(string $token, array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/counter/sequences/lease', $body, ['X-Device-Token' => $token]);
    }

    /** A till pushes its queue with its own device token — the only way it can. */
    private function push(string $token, string $path, array $body): \Illuminate\Testing\TestResponse
    {
        return $this->postJson($path, $body, ['X-Device-Token' => $token]);
    }

    private function product(Store $store, string $name = 'Paracetamol 650mg'): array
    {
        $product = Product::create([
            'store_id' => $store->id,
            'name' => $name,
            'mrp' => 30.00,
            'sel_rate' => 25.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'current_stock' => 100,
            'hsn_sac_code' => '30049090',
            'is_active' => true,
        ]);

        $batch = ProductBatch::create([
            'store_id' => $store->id,
            'product_id' => $product->id,
            'batch_no' => 'BATCH-A',
            'expiry_date' => '2028-01-01',
            'stock_qty' => 100,
            'mrp' => 30.00,
            'purchase_rate' => 18.00,
            'selling_rate' => 25.00,
        ]);

        return ['product' => $product, 'batch' => $batch];
    }

    /** A cash bill posted straight to the server, the way an online till posts one. */
    private function bill(Store $store, array $fixture, string $counterCode, array $overrides = []): \Illuminate\Testing\TestResponse
    {
        $response = $this->withHeaders(['X-Device-Token' => $this->tokens["{$store->id}:{$counterCode}"] ?? ''])
            ->postJson('/api/invoices', array_merge([
                'counter_code' => $counterCode,
                'customer_name' => 'Walk-in Customer',
                'payment_mode' => 'Cash',
                'items' => [[
                    'product_id' => $fixture['product']->id,
                    'batch_id' => $fixture['batch']->id,
                    'batch_no' => 'BATCH-A',
                    'qty' => 1,
                    'unit_price' => 25.00,
                    'gst_percent' => 12.00,
                ]],
            ], $overrides));

        return $response;
    }

    /** @return array<int, string> the doc types a manifest covers, in payload order */
    private function docTypesOf(array $manifest): array
    {
        return array_column($manifest, 'doc_type');
    }

    public function test_a_claimed_counter_holds_one_complete_document_type_set(): void
    {
        $claimed = $this->claim($this->store('SEQ01'), 'C01');
        $counter = $claimed['counter'];

        $stored = $counter->sequences()->pluck('doc_type')->all();
        sort($stored);
        $expected = self::DOC_TYPES;
        sort($expected);
        $this->assertSame($expected, $stored, 'a counter owns every document type, not the three the till happened to ask for');

        $context = $this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])
            ->assertOk()
            ->json('sequences');

        $this->assertSame(self::DOC_TYPES, $this->docTypesOf($context['items']), 'the manifest is one complete set, in the canonical order');

        foreach ($context['items'] as $row) {
            $this->assertSame("C01-".self::TAILS[$row['doc_type']], $row['prefix']);
            $this->assertSame(1001, $row['next_number']);
            $this->assertSame($counter->id, $row['counter_id']);
            $this->assertNull($row['range_end'], 'nothing is leased until a till asks');
            // TALLY-01: a store that never set a numbering rule ships one that says so.
            $this->assertArrayHasKey('suffix', $row);
            $this->assertNull($row['suffix']);
            $this->assertNull($row['serial_width']);
            $this->assertFalse($row['pad_zeros']);
        }
    }

    public function test_the_series_exists_as_soon_as_the_owner_creates_the_counter(): void
    {
        $store = $this->store('SEQ02');
        $admin = \App\Models\User::create([
            'store_id' => $store->id,
            'name' => 'Store Owner',
            'email' => 'owner-seq02@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'is_active' => true,
        ]);

        $counterId = $this->actingAs($admin, 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $store->id])
            ->postJson('/api/admin/counters', [
                'counter_name' => 'Front Counter',
                'counter_code' => 'C09',
                'location_name' => 'Shop floor',
            ])
            ->assertCreated()
            ->json('counter.id');

        $this->assertSame(
            count(self::DOC_TYPES),
            CounterSequence::where('counter_id', $counterId)->count(),
            'an unclaimed counter already knows the numbers it will issue'
        );
    }

    public function test_the_claim_and_the_context_answer_with_the_same_series_manifest(): void
    {
        $claimed = $this->claim($this->store('SEQ03'), 'C01');

        $fromClaim = collect($claimed['claim']['sequences']['items'])->map(fn ($r) => [
            $r['doc_type'], $r['prefix'], $r['next_number'],
        ])->all();

        $fromContext = collect($this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])
            ->assertOk()
            ->json('sequences.items'))
            ->map(fn ($r) => [$r['doc_type'], $r['prefix'], $r['next_number']])
            ->all();

        // A8 promised the boot path could be fed either answer; the numbers must agree.
        $this->assertSame($fromClaim, $fromContext);
    }

    public function test_a_lease_moves_the_series_it_names_and_nothing_else(): void
    {
        $claimed = $this->claim($this->store('SEQ04'), 'C01');

        $first = $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 5])
            ->assertOk()
            ->assertJson(['success' => true, 'counter_id' => $claimed['counter']->id, 'doc_type' => 'invoice'])
            ->json();

        $this->assertSame(1001, $first['range_start']);
        $this->assertSame(1005, $first['range_end']);
        $this->assertSame('C01-INV', $first['prefix']);

        $second = $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 5])
            ->assertOk()
            ->json();

        // A lease reserves; it does not spend. Asking again while the block is
        // untouched hands back the same numbers and leaves the series as it was.
        $this->assertSame(1001, $second['range_start']);
        $this->assertSame(1005, $second['range_end']);
        $this->assertSame(1001, $second['next_number']);

        $row = CounterSequence::where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->first();
        $this->assertSame(1001, $row->next_number, 'leasing a block did not burn it');
        $this->assertSame(1005, $row->range_end);

        $untouched = CounterSequence::where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'stock_transfer')
            ->first();
        $this->assertSame(1001, $untouched->next_number);
        $this->assertNull($untouched->range_end);
    }

    public function test_a_lease_is_reused_until_the_block_is_spent(): void
    {
        $claimed = $this->claim($this->store('SEQ20'), 'C01');

        // NUM-01: a till asks on a heartbeat, not once. Every ask before the
        // first bill must answer with the block it already holds.
        $first = $this->sequences($claimed['token'], ['doc_type' => 'invoice'])->assertOk()->json();
        $this->assertSame(1001, $first['range_start']);
        $this->assertSame(1050, $first['range_end']);

        for ($tick = 0; $tick < 5; $tick++) {
            $again = $this->sequences($claimed['token'], ['doc_type' => 'invoice'])->assertOk()->json();
            $this->assertSame(1001, $again['range_start'], 'a heartbeat band did not start a new block');
            $this->assertSame(1050, $again['range_end']);
        }

        $this->assertSame(1001, CounterSequence::where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->value('next_number'), 'no number was spent by leasing it');
    }

    public function test_a_lease_that_reports_what_it_spent_opens_the_next_block(): void
    {
        $claimed = $this->claim($this->store('SEQ21'), 'C01');

        $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 5])->assertOk();

        // The till numbered through 1003 offline; it says so when it asks next.
        $next = $this->sequences($claimed['token'], [
            'doc_type' => 'invoice',
            'block_size' => 5,
            'used_through' => 1003,
        ])->assertOk()->json();

        $this->assertSame(1001, $next['range_start'], 'the block it holds is still its block');
        $this->assertSame(1005, $next['range_end']);
        $this->assertSame(1004, $next['next_number'], 'the cursor sits just past what was spent');
        $this->assertSame(1004, CounterSequence::where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->value('next_number'), 'the series moved to just past what was spent');

        // Asking again without spending answers with that same open block.
        $same = $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 5])
            ->assertOk()
            ->json();
        $this->assertSame(1001, $same['range_start']);
        $this->assertSame(1005, $same['range_end']);
        $this->assertSame(1004, $same['next_number']);

        // Spending the rest of the block opens the next one on the ask after that.
        $opened = $this->sequences($claimed['token'], [
            'doc_type' => 'invoice',
            'block_size' => 5,
            'used_through' => 1005,
        ])->assertOk()->json();
        $this->assertSame(1006, $opened['range_start']);
        $this->assertSame(1010, $opened['range_end']);
    }

    public function test_a_lease_cannot_burn_past_the_block_it_was_given(): void
    {
        $claimed = $this->claim($this->store('SEQ22'), 'C01');

        $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 5])->assertOk();

        // A till claiming it burned a fortnight of numbers is not believed: the
        // series moves only past the five numbers it was actually handed.
        $next = $this->sequences($claimed['token'], [
            'doc_type' => 'invoice',
            'block_size' => 5,
            'used_through' => 9999,
        ])->assertOk()->json();

        $this->assertSame(1006, $next['range_start']);
        $this->assertSame(1010, $next['range_end']);
        $this->assertSame(1006, CounterSequence::where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->value('next_number'));

        // A report that is behind the series changes nothing at all.
        $behind = $this->sequences($claimed['token'], [
            'doc_type' => 'invoice',
            'block_size' => 5,
            'used_through' => 900,
        ])->assertOk()->json();
        $this->assertSame(1006, $behind['range_start']);
    }

    public function test_a_legacy_doc_type_name_addresses_the_same_series(): void
    {
        $claimed = $this->claim($this->store('SEQ05'), 'C01');

        // The till used to say "return"; the server said "sales_return". One row now.
        $res = $this->sequences($claimed['token'], ['doc_type' => 'return', 'block_size' => 5])->assertOk();
        $this->assertSame('sales_return', $res->json('doc_type'));

        $again = $this->sequences($claimed['token'], ['doc_type' => 'sales_return', 'block_size' => 5])->assertOk();

        $this->assertSame(1001, $res->json('range_start'));
        $this->assertSame(1001, $again->json('range_start'), 'the alias addressed the same open block');

        $rows = CounterSequence::where('counter_id', $claimed['counter']->id)->where('doc_type', 'sales_return')->get();
        $this->assertCount(1, $rows, 'an alias must not fork a second series');
        $this->assertSame(1001, $rows->first()->next_number, 'neither name spent a number');
    }

    public function test_a_doc_type_that_exists_nowhere_is_refused(): void
    {
        $claimed = $this->claim($this->store('SEQ06'), 'C01');

        $res = $this->sequences($claimed['token'], ['doc_type' => 'purchase_return_note'])->assertStatus(422);
        $this->assertStringContainsString('invoice', $res->json('errors.doc_type.0'));
    }

    public function test_a_till_leases_for_the_counter_its_token_names(): void
    {
        $mine = $this->claim($this->store('SEQ07'), 'C01');
        $other = $this->claim($this->store('SEQ08'), 'C02');

        // IS1: a counter id in the body is decoration — the token decides.
        $res = $this->sequences($mine['token'], [
            'doc_type' => 'invoice',
            'block_size' => 5,
            'counter_id' => $other['counter']->id,
        ])->assertOk();

        $this->assertSame($mine['counter']->id, $res->json('counter_id'));
        $this->assertSame(1001, CounterSequence::where('counter_id', $other['counter']->id)
            ->where('doc_type', 'invoice')
            ->value('next_number'), 'the other counter kept its own series');
    }

    public function test_a_till_cannot_lease_for_another_stores_counter(): void
    {
        $mine = $this->claim($this->store('SEQ09'), 'C01');
        $other = $this->claim($this->store('SEQ10'), 'C02');

        $this->sequences($mine['token'], [
            'doc_type' => 'invoice',
            'store_id' => $other['counter']->store_id,
        ])->assertStatus(403);
    }

    public function test_two_counters_in_one_store_never_issue_the_same_number(): void
    {
        $store = $this->store('SEQ11');
        $this->claim($store, 'C01');
        $this->claim($store, 'C02');
        $fixture = $this->product($store);

        $a1 = $this->bill($store, $fixture, 'C01')->assertStatus(201)->json('invoice.invoice_number');
        $b1 = $this->bill($store, $fixture, 'C02')->assertStatus(201)->json('invoice.invoice_number');
        $a2 = $this->bill($store, $fixture, 'C01')->assertStatus(201)->json('invoice.invoice_number');

        $this->assertSame('C01-INV-1001', $a1);
        $this->assertSame('C02-INV-1001', $b1);
        $this->assertSame('C01-INV-1002', $a2);
        $this->assertNotSame($a1, $b1, 'the counter, not the store, owns the number');
        $this->assertSame(3, Invoice::count());
    }

    public function test_a_temporary_number_never_persists_as_a_final_document_number(): void
    {
        $store = $this->store('SEQ12');
        $claimed = $this->claim($store, 'C01');

        $res = $this->push($claimed['token'], '/api/sync/push/invoices', [
            'store_id' => $store->id,
            'invoices' => [[
                'external_id' => 'offline_inv_temp_1',
                'invoice_number' => 'TEMP-C01-4821',
                'is_offline_temp' => true,
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in',
                'payment_mode' => 'Cash',
                'grand_total' => 112.00,
                'taxable_subtotal' => 100.00,
                'tax_total' => 12.00,
                'payments' => [['mode' => 'Cash', 'amount' => 112.00]],
            ]],
        ])->assertOk();

        $this->assertSame('C01-INV-1001', $res->json('renumbered.0.to'));
        $this->assertSame('TEMP-C01-4821', $res->json('renumbered.0.from'));

        $invoice = Invoice::where('external_id', 'offline_inv_temp_1')->firstOrFail();
        $this->assertSame('C01-INV-1001', $invoice->invoice_number);
        $this->assertSame(0, Invoice::where('invoice_number', 'like', 'TEMP-%')->count());
        $this->assertSame(1002, CounterSequence::where('counter_id', $invoice->counter_id)
            ->where('doc_type', 'invoice')
            ->value('next_number'));
    }

    public function test_a_re_pushed_offline_document_keeps_the_number_it_was_given(): void
    {
        $store = $this->store('SEQ13');
        $claimed = $this->claim($store, 'C01');

        $payload = [
            'store_id' => $store->id,
            'invoices' => [[
                'external_id' => 'offline_inv_temp_2',
                'invoice_number' => 'TEMP-C01-7712',
                'is_offline_temp' => true,
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in',
                'payment_mode' => 'Cash',
                'grand_total' => 112.00,
                'taxable_subtotal' => 100.00,
                'tax_total' => 12.00,
                'payments' => [['mode' => 'Cash', 'amount' => 112.00]],
            ]],
        ];

        $this->push($claimed['token'], '/api/sync/push/invoices', $payload)->assertOk();
        $again = $this->push($claimed['token'], '/api/sync/push/invoices', $payload)->assertOk();

        // The till still holds its queue entry and pushes it a second time; the
        // document must not be renumbered or duplicated by that retry.
        $this->assertSame(1, Invoice::where('external_id', 'offline_inv_temp_2')->count());
        $this->assertSame('C01-INV-1001', Invoice::where('external_id', 'offline_inv_temp_2')->value('invoice_number'));
        $this->assertEmpty($again->json('renumbered'), 'a retry has nothing new to name');
    }

    public function test_a_pre_leased_number_is_adopted_so_no_issued_number_returns(): void
    {
        $store = $this->store('SEQ14');
        $claimed = $this->claim($store, 'C01');
        $fixture = $this->product($store);

        // A till works offline through a block it leased: 1001..1050.
        $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 50])->assertOk();

        $this->push($claimed['token'], '/api/sync/push/invoices', [
            'store_id' => $store->id,
            'invoices' => [[
                'external_id' => 'leased_inv_1003',
                'invoice_number' => 'C01-INV-1003',
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in',
                'payment_mode' => 'Cash',
                'grand_total' => 50.00,
                'taxable_subtotal' => 50.00,
                'tax_total' => 0,
                'payments' => [['mode' => 'Cash', 'amount' => 50.00]],
            ]],
        ])->assertOk();

        $this->assertSame('C01-INV-1003', Invoice::where('external_id', 'leased_inv_1003')->value('invoice_number'));

        $series = CounterSequence::where('counter_id', $claimed['counter']->id)->where('doc_type', 'invoice')->first();
        $this->assertGreaterThanOrEqual(1004, $series->next_number, 'the server never hands out 1003 again');

        $next = $this->bill($store, $fixture, 'C01')->assertStatus(201)->json('invoice.invoice_number');
        $this->assertNotSame('C01-INV-1003', $next);
    }

    public function test_a_number_from_another_counters_series_is_replaced(): void
    {
        $store = $this->store('SEQ15');
        $c01 = $this->claim($store, 'C01');
        $c02 = $this->claim($store, 'C02');

        $this->push($c02['token'], '/api/sync/push/invoices', [
            'store_id' => $store->id,
            'invoices' => [[
                'external_id' => 'borrowed_number_inv',
                'invoice_number' => 'C01-INV-1001',
                'counter_code' => 'C02',
                'customer_name' => 'Walk-in',
                'payment_mode' => 'Cash',
                'grand_total' => 50.00,
                'taxable_subtotal' => 50.00,
                'tax_total' => 0,
                'payments' => [['mode' => 'Cash', 'amount' => 50.00]],
            ]],
        ])->assertOk();

        $invoice = Invoice::where('external_id', 'borrowed_number_inv')->firstOrFail();
        $this->assertSame('C02-INV-1001', $invoice->invoice_number, 'a counter issues only its own numbers');

        $numbered = fn (Counter $counter) => CounterSequence::where('counter_id', $counter->id)
            ->where('doc_type', 'invoice')
            ->value('next_number');

        $this->assertSame(1002, $numbered($c02['counter']), 'C02 issued its own 1001');
        $this->assertSame(1001, $numbered($c01['counter']), 'C01 was never advanced by C02 traffic');
    }

    public function test_an_online_bill_uses_the_number_its_counter_reserved(): void
    {
        $store = $this->store('SEQ20');
        $claimed = $this->claim($store, 'C01');
        $fixture = $this->product($store);

        // The till boots onto its counter's block; the cashier sees 1001.
        $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 5])->assertOk();

        $first = $this->bill($store, $fixture, 'C01', ['invoice_number' => 'C01-INV-1001'])->assertStatus(201);
        $this->assertSame('C01-INV-1001', $first->json('invoice.invoice_number'), 'the number on screen is the number in the book');

        // The next bill keeps counting from the same block, with no jump.
        $second = $this->bill($store, $fixture, 'C01', ['invoice_number' => 'C01-INV-1002'])->assertStatus(201);
        $this->assertSame('C01-INV-1002', $second->json('invoice.invoice_number'));
    }

    public function test_an_online_bill_outside_the_counter_series_is_reissued(): void
    {
        $store = $this->store('SEQ21');
        $this->claim($store, 'C01');
        $this->claim($store, 'C02');
        $fixture = $this->product($store);

        // NUM-02: the till's header came from another series, so the server names it.
        $borrowed = $this->bill($store, $fixture, 'C01', ['invoice_number' => 'C02-INV-1001'])->assertStatus(201);
        $this->assertSame('C01-INV-1001', $borrowed->json('invoice.invoice_number'));

        $legacy = $this->bill($store, $fixture, 'C01', ['invoice_number' => 'INV-8301'])->assertStatus(201);
        $this->assertSame('C01-INV-1002', $legacy->json('invoice.invoice_number'), 'a live bill is never filed under a number no counter issued');

        $this->assertSame(0, Invoice::whereIn('invoice_number', ['C02-INV-1001', 'INV-8301'])->count());
    }

    public function test_an_online_bill_never_files_a_number_the_counter_already_gave_out(): void
    {
        $store = $this->store('SEQ22');
        $claimed = $this->claim($store, 'C01');
        $fixture = $this->product($store);

        $first = $this->bill($store, $fixture, 'C01', ['invoice_number' => 'C01-INV-1001'])->assertStatus(201);
        $this->assertSame('C01-INV-1001', $first->json('invoice.invoice_number'));

        // A stale screen offers 1001 again: the bill is renumbered, never duplicated.
        $second = $this->bill($store, $fixture, 'C01', ['invoice_number' => 'C01-INV-1001'])->assertStatus(201);
        $this->assertSame('C01-INV-1002', $second->json('invoice.invoice_number'));
        $this->assertSame(1, Invoice::where('invoice_number', 'C01-INV-1001')->count());
        $this->assertSame(2, Invoice::count());

        // A number the series already passed is not taken even if nothing holds it.
        CounterSequence::where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->update(['next_number' => 1010]);

        $third = $this->bill($store, $fixture, 'C01', ['invoice_number' => 'C01-INV-1005'])->assertStatus(201);
        $this->assertSame('C01-INV-1010', $third->json('invoice.invoice_number'));
    }

    public function test_the_manifest_reports_the_block_the_counter_still_holds(): void
    {
        $store = $this->store('SEQ23');
        $claimed = $this->claim($store, 'C01');
        $fixture = $this->product($store);

        $this->sequences($claimed['token'], ['doc_type' => 'invoice', 'block_size' => 5])->assertOk();

        $invoiceRow = fn () => collect($this->getJson('/api/counter/context', ['X-Device-Token' => $claimed['token']])
            ->assertOk()
            ->json('sequences.items'))
            ->firstWhere('doc_type', 'invoice');

        $held = $invoiceRow();
        $this->assertSame(1001, $held['next_number']);
        $this->assertSame(1001, $held['range_start']);
        $this->assertSame(1005, $held['range_end']);

        $this->bill($store, $fixture, 'C01')->assertStatus(201);
        $this->bill($store, $fixture, 'C01')->assertStatus(201);

        // The till reads how much of its block is left, so it knows when to ask for more.
        $after = $invoiceRow();
        $this->assertSame(1003, $after['next_number']);
        $this->assertSame(1005, $after['range_end']);
    }

    public function test_a_sales_return_offline_gets_its_own_series_number(): void
    {
        $store = $this->store('SEQ16');
        $claimed = $this->claim($store, 'C01');

        $this->push($claimed['token'], '/api/sync/push/invoices', [
            'store_id' => $store->id,
            'invoices' => [[
                'external_id' => 'offline_sr_temp',
                'invoice_number' => 'TEMP-C01-SR-9001',
                'module_key' => 'credit_note',
                'counter_code' => 'C01',
                'customer_name' => 'Walk-in',
                'payment_mode' => 'Cash',
                'grand_total' => 112.00,
                'taxable_subtotal' => 100.00,
                'tax_total' => 12.00,
                'original_invoice_number' => 'C01-INV-1001',
            ]],
        ])->assertOk();

        $row = Invoice::where('external_id', 'offline_sr_temp')->firstOrFail();
        $this->assertSame('C01-SR-1001', $row->invoice_number);
        $this->assertStringNotContainsString('TEMP', $row->invoice_number);
    }

    public function test_a_purchase_or_transfer_without_a_real_number_is_given_one(): void
    {
        $store = $this->store('SEQ17');
        $claimed = $this->claim($store, 'C01');

        $pushedPurchase = $this->push($claimed['token'], '/api/sync/push/purchases', [
            'store_id' => $store->id,
            'counter_code' => 'C01',
            'purchases' => [[
                'external_id' => 'pur-offline-1',
                'invoice_number' => 'TEMP-C01-PUR-1188',
                'supplier_name' => 'Apex Pharma',
                'purchase_date' => '2026-11-15',
                'subtotal' => 1000.00,
                'tax_total' => 120.00,
                'grand_total' => 1120.00,
                'items' => [[
                    'external_id' => 'pur-offline-1-item',
                    'product_name' => 'Amoxicillin 500mg',
                    'batch_no' => 'AMX-01',
                    'expiry_date' => '2027-12-31',
                    'qty' => 10,
                    'purchase_rate' => 100.00,
                    'gst_percent' => 12,
                    'taxable_amount' => 1000.00,
                    'total_amount' => 1120.00,
                ]],
            ]],
        ])->assertOk();

        $pushedPurchase->assertJson([
            'renumbered' => [['from' => 'TEMP-C01-PUR-1188', 'to' => 'C01-PUR-1001', 'doc_type' => 'purchase_bill']],
        ]);
        $this->assertSame('C01-PUR-1001', Purchase::where('store_id', $store->id)->value('invoice_number'));

        $destination = $this->store('SEQ17B');
        $pushedTransfer = $this->push($claimed['token'], '/api/sync/push/transfers', [
            'store_id' => $store->id,
            'counter_code' => 'C01',
            'transfers' => [[
                'transfer_number' => 'TEMP-C01-TRF-4477',
                'destination_store_id' => $destination->id,
                'status' => 'dispatched',
                'lines' => [],
            ]],
        ]);

        $pushedTransfer->assertOk();

        $this->assertSame(
            [['from' => 'TEMP-C01-TRF-4477', 'to' => 'C01-TRF-1001', 'doc_type' => 'stock_transfer']],
            array_map(
                fn (array $row) => array_intersect_key($row, ['from' => 1, 'to' => 1, 'doc_type' => 1]),
                $pushedTransfer->json('renumbered')
            )
        );
        $this->assertSame('C01-TRF-1001', StockTransfer::where('from_store_id', $store->id)->value('transfer_number'));
    }

    public function test_the_lease_path_still_answers_for_a_counter_code_or_an_id(): void
    {
        $store = $this->store('SEQ18');
        $claimed = $this->claim($store, 'C01');

        // A till in the field has always said "C01"; the route binds a counter id.
        $byCode = $this->withHeaders(['X-Device-Token' => $claimed['token']])
            ->postJson('/api/counters/C01/lease-sequence', [
                'doc_type' => 'receipt',
                'allocate_block' => true,
                'block_size' => 5,
            ])
            ->assertOk();

        $this->assertSame($claimed['counter']->id, $byCode->json('counter_id'));
        $this->assertSame('C01-REC', $byCode->json('leased_block.prefix'));
        $this->assertSame(1005, $byCode->json('leased_block.range_end'));

        $byId = $this->withHeaders(['X-Device-Token' => $claimed['token']])
            ->postJson("/api/counters/{$claimed['counter']->id}/lease-sequence", [
                'doc_type' => 'receipt',
                'allocate_block' => true,
                'block_size' => 5,
            ])
            ->assertOk();

        // Both names reach the same series and the same open block.
        $this->assertSame(1001, $byId->json('leased_block.range_start'));
        $this->assertSame(1005, $byId->json('leased_block.range_end'));
    }

    public function test_the_series_survives_a_financial_year_turn_without_reuse(): void
    {
        $claimed = $this->claim($this->store('SEQ19'), 'C01');
        $service = app(CounterSequenceService::class);

        $current = $service->issue($claimed['counter'], 'invoice');
        $nextYear = $service->issue($claimed['counter'], 'invoice', '2027-28');

        $this->assertSame('C01-INV-1001', $current);
        $this->assertSame('C01-INV-1001', $nextYear, 'a new year restarts the count on its own row');
        $this->assertSame(1002, $service->nextNumber($claimed['counter'], 'invoice'));
        $this->assertCount(1, CounterSequence::where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->where('financial_year', '2027-28')
            ->get());
    }
}
