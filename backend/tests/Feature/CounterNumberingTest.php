<?php

namespace Tests\Feature;

use App\Models\ActivationKey;
use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\CounterSequence;
use App\Models\Invoice;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use App\Services\CounterSequenceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * TALLY-01 — how a serial is rendered.
 *
 * A store sets the numbering for each series (a suffix, a minimum digit width, zero fill), a counter
 * may override it for one of its own series, and the server resolves the rule and ships it with the
 * series so the till prints the number the store's book holds. A width is a floor, never a ceiling:
 * a serial that outgrew it keeps every digit, because shortening it would re-issue a number.
 */
class CounterNumberingTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<string,string> */
    private array $tokens = [];

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

    /** @return array{counter:Counter, token:string} */
    private function claim(Store $store, string $counterCode): array
    {
        $counter = Counter::create([
            'store_id' => $store->id,
            'counter_code' => $counterCode,
            'counter_name' => "{$counterCode} Counter",
            'location_name' => 'Shop floor',
        ]);

        $claim = $this->postJson('/api/counters/claim', [
            'code' => ActivationKey::generateForCounter($counter)['raw_key'],
            'device_uuid' => "dev-{$store->id}-{$counterCode}",
        ])->assertOk()->json();

        $this->tokens["{$store->id}:{$counterCode}"] = $claim['device_token'];

        return ['counter' => $counter->fresh(), 'token' => $claim['device_token']];
    }

    private function owner(Store $store): User
    {
        return User::create([
            'store_id' => $store->id,
            'name' => 'Store Owner',
            'email' => "owner-{$store->code}@lamstone.in",
            'password' => bcrypt('password123'),
            'role' => 'store_owner',
            'is_active' => true,
        ]);
    }

    /** The store's numbering defaults, written the way the admin panel writes them. */
    private function numberStore(Store $store, array $numbering): void
    {
        CompanySetting::updateOrCreate(
            ['store_id' => $store->id, 'key' => 'sequences'],
            ['value' => [
                'invoicePrefix' => 'INV',
                'nextInvoiceNumber' => 1001,
                'returnPrefix' => 'SR',
                'nextReturnNumber' => 1,
                'numbering' => $numbering,
            ]]
        );
    }

    private function product(Store $store): array
    {
        $product = Product::create([
            'store_id' => $store->id,
            'name' => 'Paracetamol 650mg',
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

    /** @return \Illuminate\Testing\TestResponse */
    private function bill(Store $store, array $fixture, string $counterCode, array $overrides = [])
    {
        return $this->withHeaders(['X-Device-Token' => $this->tokens["{$store->id}:{$counterCode}"]])
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
    }

    /** @return array<string,array> doc_type => item */
    private function manifestOf(string $token): array
    {
        $items = $this->getJson('/api/counter/sequences', ['X-Device-Token' => $token])
            ->assertOk()
            ->json('items');

        return array_column($items, null, 'doc_type');
    }

    public function test_a_series_without_a_rule_prints_exactly_as_it_did_before(): void
    {
        $store = $this->store('NUMB01');
        $claimed = $this->claim($store, 'C01');

        $items = $this->manifestOf($claimed['token']);
        $this->assertNull($items['invoice']['suffix']);
        $this->assertNull($items['invoice']['serial_width']);
        $this->assertFalse($items['invoice']['pad_zeros']);

        $this->assertSame('C01-INV-1001', app(CounterSequenceService::class)->issue($claimed['counter'], 'invoice'));
    }

    public function test_the_store_default_reaches_every_counter_series_and_the_numbers_it_issues(): void
    {
        $store = $this->store('NUMB02');
        $this->numberStore($store, [
            'invoice' => ['width' => 6, 'pad' => true],
            'sales_return' => ['suffix' => '/27', 'width' => 5, 'pad' => true],
        ]);

        $first = $this->claim($store, 'C01');
        $second = $this->claim($store, 'C02');

        foreach ([$first, $second] as $claimed) {
            $items = $this->manifestOf($claimed['token']);
            $this->assertSame(6, $items['invoice']['serial_width']);
            $this->assertTrue($items['invoice']['pad_zeros']);
            $this->assertSame('/27', $items['sales_return']['suffix']);
        }

        $service = app(CounterSequenceService::class);
        $this->assertSame('C01-INV-001001', $service->issue($first['counter'], 'invoice'));
        $this->assertSame('C01-SR-01001/27', $service->issue($first['counter'], 'sales_return'));
        $this->assertSame('C02-INV-001001', $service->issue($second['counter'], 'invoice'));
    }

    public function test_a_counter_rule_overrides_the_store_default_and_never_truncates(): void
    {
        $store = $this->store('NUMB03');
        $this->numberStore($store, [
            'invoice' => ['width' => 6, 'pad' => true],
            'sales_return' => ['width' => 6, 'pad' => true],
        ]);
        $claimed = $this->claim($store, 'C01');
        $counter = $claimed['counter'];

        $response = $this->actingAs($this->owner($store), 'sanctum')
            ->withHeaders(['X-Store-Id' => (string) $store->id])
            ->putJson("/api/admin/counters/{$counter->id}/sequence", [
                'doc_type' => 'invoice',
                'suffix' => '-IN',
                'serial_width' => 2,
                'pad_zeros' => true,
            ])
            ->assertOk()
            ->json();

        // Width 2 cannot shorten the serial the store is already at: 1001 keeps all four digits.
        $this->assertSame(['suffix' => '-IN', 'serial_width' => 2, 'pad_zeros' => true], $response['numbering']);
        $this->assertSame('C01-INV-1001-IN', $response['next_number']);

        $this->assertSame('-IN', $this->manifestOf($claimed['token'])['invoice']['suffix']);

        $service = app(CounterSequenceService::class);
        $this->assertSame('C01-INV-1001-IN', $service->issue($counter, 'invoice'));
        $this->assertSame('C01-INV-1002-IN', $service->issue($counter, 'invoice'));

        // The other series of the same counter still follow the store default.
        $this->assertSame('C01-SR-001001', $service->issue($counter, 'sales_return'));
    }

    public function test_clearing_a_counter_rule_puts_the_series_back_on_the_store_default(): void
    {
        $store = $this->store('NUMB04');
        $this->numberStore($store, ['quotation' => ['width' => 5, 'pad' => true]]);
        $claimed = $this->claim($store, 'C01');
        $counter = $claimed['counter'];
        $admin = $this->actingAs($this->owner($store), 'sanctum')->withHeaders(['X-Store-Id' => (string) $store->id]);

        $admin->putJson("/api/admin/counters/{$counter->id}/sequence", [
            'doc_type' => 'quotation',
            'suffix' => '/Q',
            'serial_width' => 3,
        ])->assertOk();

        $service = app(CounterSequenceService::class);
        $this->assertSame('C01-QUO-1001/Q', $service->issue($counter, 'quotation'));

        $admin->putJson("/api/admin/counters/{$counter->id}/sequence", [
            'doc_type' => 'quotation',
            'inherit_store' => true,
        ])->assertOk();

        $this->assertNull(CounterSequence::query()->where('counter_id', $counter->id)->where('doc_type', 'quotation')->value('numbering'));
        $this->assertSame('C01-QUO-01002', $service->issue($counter, 'quotation'));
    }

    public function test_a_till_lease_returns_the_rule_its_numbers_print_under(): void
    {
        $store = $this->store('NUMB05');
        $this->numberStore($store, ['transfer' => ['suffix' => '/27', 'width' => 4, 'pad' => true]]);
        $claimed = $this->claim($store, 'C01');

        $block = $this->postJson('/api/counter/sequences/lease', [
            'doc_type' => 'stock_transfer',
            'block_size' => 5,
        ], ['X-Device-Token' => $claimed['token']])->assertOk()->json();

        // The till parses the lease answer itself, not only `leased_block`, so the rule is on both.
        $this->assertSame('/27', $block['suffix']);
        $this->assertSame(4, $block['serial_width']);
        $this->assertTrue($block['pad_zeros']);
        $this->assertNotNull($block['range_end']);
        $this->assertSame('/27', $block['leased_block']['suffix']);

        // Nothing was written onto the counter's row: it inherits, so a later store change still lands.
        $this->assertNull(CounterSequence::query()
            ->where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'stock_transfer')
            ->value('numbering'));

        $this->assertSame('C01-TRF-1001/27', app(CounterSequenceService::class)->issue($claimed['counter'], 'stock_transfer'));
    }

    public function test_a_padded_number_the_till_printed_offline_is_adopted_and_the_series_follows_it(): void
    {
        $store = $this->store('NUMB06');
        $this->numberStore($store, ['invoice' => ['width' => 5, 'pad' => true]]);
        $claimed = $this->claim($store, 'C01');
        $fixture = $this->product($store);

        $this->bill($store, $fixture, 'C01', [
            'external_id' => 'offline_inv_1042',
            'invoice_number' => 'C01-INV-01042',
        ])->assertStatus(201)->assertJsonPath('invoice.invoice_number', 'C01-INV-01042');

        $this->assertSame(1043, (int) CounterSequence::query()
            ->where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->value('next_number'));

        $this->bill($store, $fixture, 'C01')
            ->assertStatus(201)
            ->assertJsonPath('invoice.invoice_number', 'C01-INV-01043');
    }

    public function test_one_serial_cannot_be_filed_twice_under_two_spellings(): void
    {
        $store = $this->store('NUMB07');
        $this->numberStore($store, ['invoice' => ['width' => 5, 'pad' => true]]);
        $claimed = $this->claim($store, 'C01');
        $fixture = $this->product($store);

        // Filed before the padding rule was written, so the book holds the bare spelling.
        $this->bill($store, $fixture, 'C01', ['external_id' => 'inv_bare_1050', 'invoice_number' => 'C01-INV-1050'])
            ->assertStatus(201);

        // The till lost its cursor and comes back asking for the same serial, padded this time.
        CounterSequence::query()
            ->where('counter_id', $claimed['counter']->id)
            ->where('doc_type', 'invoice')
            ->update(['next_number' => 1001]);

        $second = $this->bill($store, $fixture, 'C01', ['external_id' => 'inv_padded_1050', 'invoice_number' => 'C01-INV-01050'])
            ->assertStatus(201)
            ->json('invoice.invoice_number');

        $this->assertNotSame('C01-INV-01050', $second, 'padding is part of a number\'s spelling, not its value');
        $this->assertSame('C01-INV-01001', $second);
        $this->assertSame(1, Invoice::where('store_id', $store->id)
            ->whereIn('invoice_number', ['C01-INV-1050', 'C01-INV-01050'])
            ->count());
    }

    public function test_the_till_receives_the_numbering_defaults_with_the_rest_of_the_settings(): void
    {
        $store = $this->store('NUMB08');
        $this->numberStore($store, ['invoice' => ['width' => 6, 'pad' => true]]);
        $claimed = $this->claim($store, 'C01');

        $sequences = $this->getJson('/api/settings', ['X-Device-Token' => $claimed['token']])
            ->assertOk()
            ->json('sequences');

        $this->assertSame(['invoice' => ['width' => 6, 'pad' => true]], $sequences['numbering']);
        $this->assertSame('INV', $sequences['invoicePrefix']);
    }
}
