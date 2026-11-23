<?php

namespace Tests\Feature;

use App\Models\DeviceSession;
use App\Models\Invoice;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * G1-SEC — SEC-01 / SEC-02 / SEC-03 from QA round 3: an anonymous caller could
 * list, create and cancel invoices in any store, read and overwrite store
 * settings, pull another store's catalogue and unlock workstations.
 */
class AnonymousTillRoutesTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;
    private Store $other;
    private Invoice $invoice;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create(['name' => 'Anon Probe Store', 'code' => 'ANS', 'state_code' => '32', 'is_active' => true]);
        $this->other = Store::create(['name' => 'Anon Other Store', 'code' => 'ANO', 'state_code' => '32', 'is_active' => true]);

        $this->invoice = Invoice::create([
            'store_id' => $this->store->id,
            'module_key' => 'invoice',
            'invoice_number' => 'ANS-INV-1',
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Walk-in Customer',
            'subtotal' => 100,
            'tax_total' => 10.71,
            'grand_total' => 100,
            'paid_amount' => 100,
            'payment_mode' => 'Cash',
            'status' => 'issued',
        ]);
    }

    public function test_anonymous_invoice_routes_are_refused_and_change_nothing(): void
    {
        $this->getJson('/api/invoices?store_id=' . $this->store->id)->assertStatus(401);
        $this->getJson('/api/invoices/' . $this->invoice->id)->assertStatus(401);

        $this->postJson('/api/invoices', [
            'store_id' => $this->other->id,
            'invoice_number' => 'ANON-1',
            'items' => [['product_name' => 'X', 'qty' => 1, 'unit_price' => 1, 'gst_percent' => 0]],
        ])->assertStatus(401);

        $this->postJson('/api/invoices/' . $this->invoice->id . '/cancel', ['reason' => 'probe'])->assertStatus(401);
        $this->postJson('/api/invoices/' . $this->invoice->id . '/lock')->assertStatus(401);

        $this->assertSame('issued', $this->invoice->fresh()->status);
        $this->assertSame(0, Invoice::where('store_id', $this->other->id)->count());
    }

    public function test_anonymous_settings_and_catalogue_pull_are_refused(): void
    {
        $this->getJson('/api/settings?store_id=' . $this->other->id)->assertStatus(401);
        $this->postJson('/api/settings', ['store_id' => $this->other->id, 'store_name' => 'Hijacked'])->assertStatus(401);
        $this->getJson('/api/sync/pull/deltas?store_id=' . $this->other->id)->assertStatus(401);
    }

    public function test_anonymous_workstation_and_store_routes_are_refused(): void
    {
        $session = DeviceSession::create([
            'store_id' => $this->store->id,
            'device_uuid' => 'anon-probe-device',
            'session_id' => 'anon-probe-session',
            'device_name' => 'Probe',
            'status' => 'Locked',
        ]);

        $this->postJson("/api/device-sessions/{$session->id}/unlock")->assertStatus(401);
        $this->getJson('/api/held-bills?store_id=' . $this->store->id)->assertStatus(401);
        $this->getJson('/api/inventory/negative-stock-report?store_id=' . $this->store->id)->assertStatus(401);
        $this->getJson('/api/whatsapp/config?store_id=' . $this->store->id)->assertStatus(401);
        $this->getJson('/api/counters?store_id=' . $this->store->id)->assertStatus(401);
        $this->getJson('/api/branches')->assertStatus(401);
        $this->postJson('/api/stores/day-close', ['store_id' => $this->store->id])->assertStatus(401);

        $this->assertSame('Locked', $session->fresh()->status);
    }
}
