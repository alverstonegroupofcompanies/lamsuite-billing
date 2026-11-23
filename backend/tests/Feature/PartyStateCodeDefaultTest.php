<?php

namespace Tests\Feature;

use App\Models\Party;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * MST-01: a party's state is its place of supply. A GSTIN states it; without
 * one the store the party belongs to states it. '32' is Kerala, not a default.
 */
class PartyStateCodeDefaultTest extends TestCase
{
    use RefreshDatabase;

    private Store $kerala;
    private Store $karnataka;
    private User $superAdmin;
    private User $keralaStaff;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actAsClaimedCounterOfRequestedStore();

        $this->kerala = Store::create([
            'name' => 'Kerala Store',
            'code' => 'KL-01',
            'store_type' => 'pharmacy',
            'state_code' => '32',
            'gstin' => '32AAAAA0000A1Z5',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->karnataka = Store::create([
            'name' => 'Karnataka Store',
            'code' => 'KA-01',
            'store_type' => 'pharmacy',
            'state_code' => '29',
            'gstin' => '29AAAAA0000A2Z4',
            'is_active' => true,
            'version' => 1,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'admin@gststates.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'super_admin',
            'store_id' => $this->kerala->id,
        ]);

        $this->keralaStaff = User::create([
            'name' => 'Kerala Cashier',
            'email' => 'cashier@gststates.in',
            'password' => bcrypt('secret-pass'),
            'role' => 'store_owner',
            'store_id' => $this->kerala->id,
        ]);
    }

    private function adminParty(array $payload): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/parties', $payload);
    }

    public function test_admin_party_state_follows_the_gstin_prefix(): void
    {
        $response = $this->adminParty([
            'store_id' => $this->kerala->id,
            'type' => 'supplier',
            'name' => 'Maharashtra Distributors',
            'gstin' => '27ABCDE1234F1Z5',
        ]);

        $response->assertStatus(201);
        $this->assertSame('27', $response->json('state_code'));
        $this->assertSame('27', Party::where('name', 'Maharashtra Distributors')->value('state_code'));
    }

    public function test_admin_party_state_defaults_to_its_own_store_without_gstin(): void
    {
        $response = $this->adminParty([
            'store_id' => $this->karnataka->id,
            'type' => 'customer',
            'name' => 'Bengaluru Walk-in',
        ]);

        $response->assertStatus(201);
        $this->assertSame('29', $response->json('state_code'));
    }

    public function test_admin_party_rejects_a_state_that_contradicts_the_gstin(): void
    {
        $response = $this->adminParty([
            'store_id' => $this->kerala->id,
            'type' => 'supplier',
            'name' => 'Conflicting Supplier',
            'gstin' => '27ABCDE1234F1Z5',
            'state_code' => '32',
        ]);

        $response->assertStatus(422)->assertJsonValidationErrors('state_code');
        $this->assertDatabaseMissing('parties', ['name' => 'Conflicting Supplier']);
    }

    public function test_admin_party_update_keeps_an_explicit_inter_state_party(): void
    {
        $party = Party::create([
            'store_id' => $this->kerala->id,
            'type' => 'customer',
            'name' => 'GST Party',
            'gstin' => '27ABCDE1234F1Z5',
            'state_code' => '27',
            'is_active' => true,
        ]);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->putJson("/api/admin/parties/{$party->id}", ['credit_limit' => 5000]);

        $response->assertStatus(200);
        $this->assertSame('27', $party->fresh()->state_code);
    }

    public function test_till_created_customer_belongs_to_the_store_and_its_state(): void
    {
        Sanctum::actingAs($this->keralaStaff);

        $response = $this->postJson('/api/customers', [
            'name' => 'Till Customer',
            'phone' => '9876500011',
        ]);

        $response->assertStatus(201);

        $party = Party::where('phone', '9876500011')->firstOrFail();
        $this->assertSame($this->kerala->id, (int) $party->store_id);
        $this->assertSame('32', $party->state_code);
    }

    public function test_invoice_auto_created_customer_inherits_the_store_state(): void
    {
        [$product, $batch] = $this->sellableProduct($this->kerala);

        $response = $this->withHeader('X-Store-Id', $this->kerala->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_name' => 'Phone Customer',
                'customer_phone' => '9876500022',
                'payment_mode' => 'Cash',
                'items' => [[
                    'product_id' => $product->id,
                    'batch_id' => $batch->id,
                    'batch_no' => $batch->batch_no,
                    'qty' => 1,
                    'units_per_pack' => 1,
                    'unit_price' => 18.00,
                    'gst_percent' => 12.00,
                ]],
            ]);

        $response->assertStatus(201)->assertJson(['success' => true]);

        $party = Party::where('phone', '9876500022')->firstOrFail();
        $this->assertSame($this->kerala->id, (int) $party->store_id);
        $this->assertSame('32', $party->state_code);
    }

    public function test_invoice_does_not_create_a_master_for_a_bare_typed_name(): void
    {
        [$product, $batch] = $this->sellableProduct($this->kerala);
        $before = Party::count();

        $response = $this->withHeader('X-Store-Id', $this->kerala->id)
            ->postJson('/api/invoices', [
                'counter_code' => 'C01',
                'customer_name' => 'QA Credit',
                'payment_mode' => 'Cash',
                'items' => [[
                    'product_id' => $product->id,
                    'batch_id' => $batch->id,
                    'batch_no' => $batch->batch_no,
                    'qty' => 1,
                    'units_per_pack' => 1,
                    'unit_price' => 18.00,
                    'gst_percent' => 12.00,
                ]],
            ]);

        $response->assertStatus(201)->assertJson(['success' => true]);
        $this->assertSame($before, Party::count());
        $this->assertSame('QA Credit', $response->json('invoice.customer_name'));
    }

    public function test_synced_party_state_follows_its_gstin_over_the_store(): void
    {
        $response = $this->withHeader('X-Store-Id', $this->kerala->id)
            ->postJson('/api/sync/push/parties', [
                'parties' => [[
                    'external_id' => 'sync-mh-1',
                    'type' => 'customer',
                    'name' => 'Synced Maharashtra Customer',
                    'gstin' => '27ABCDE1234F1Z5',
                ]],
            ]);

        $response->assertStatus(200)->assertJson(['success' => true]);

        $party = Party::where('external_id', 'sync-mh-1')->firstOrFail();
        $this->assertSame('27', $party->state_code);
    }

    /** @return array{Product, ProductBatch} */
    private function sellableProduct(Store $store): array
    {
        $product = Product::create([
            'store_id' => $store->id,
            'name' => 'Paracetamol 500mg',
            'current_stock' => 10,
            'mrp' => 20.00,
            'sel_rate' => 18.00,
            'gst_percent' => 12.00,
            'units_per_pack' => 1,
            'is_active' => true,
        ]);

        $batch = ProductBatch::create([
            'store_id' => $store->id,
            'product_id' => $product->id,
            'batch_no' => 'BCH-GST-1',
            'expiry_date' => '2028-12-31',
            'stock_qty' => 10,
            'mrp' => 20.00,
            'purchase_rate' => 15.00,
            'selling_rate' => 18.00,
        ]);

        return [$product, $batch];
    }
}
