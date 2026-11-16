<?php

namespace Tests\Feature;

use App\Models\ComplianceEvent;
use App\Models\Invoice;
use App\Models\Store;
use App\Models\User;
use App\Services\Compliance\ComplianceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ComplianceRegistryTest extends TestCase
{
    use RefreshDatabase;

    private const GSTIN_A = '32ABCDE1234F1Z5';
    private const GSTIN_B = '29ABCDE1234F1Z5';
    private const IRN_A = 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90';

    private Store $store;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store = Store::create([
            'name' => 'Compliance Store',
            'code' => 'CMP01',
            'is_active' => true,
            'state_code' => '32',
            'gstin' => self::GSTIN_B,
            'gst_type' => 'regular',
        ]);

        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@cmp.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store->id,
        ]);
    }

    private function invoice(array $overrides = []): Invoice
    {
        static $seq = 0;
        $seq++;

        return Invoice::create(array_merge([
            'store_id' => $this->store->id,
            'invoice_number' => 'CMP-INV-' . $seq,
            'invoice_date' => now()->toDateString(),
            'customer_name' => 'Acme Traders',
            'customer_gstin' => self::GSTIN_A,
            'place_of_supply' => '32',
            'subtotal' => 10000,
            'taxable_subtotal' => 10000,
            'tax_total' => 1800,
            'cgst_total' => 900,
            'sgst_total' => 900,
            'grand_total' => 11800,
            'status' => 'issued',
            'store_state_code' => '32',
        ], $overrides));
    }

    private function service(): ComplianceService
    {
        return app(ComplianceService::class);
    }

    private function act()
    {
        return $this->actingAs($this->admin, 'sanctum');
    }

    public function test_applicability_and_derived_statuses(): void
    {
        $service = $this->service();
        $b2b = $this->invoice(['grand_total' => 60000]);
        $b2c = $this->invoice(['customer_gstin' => null, 'customer_name' => 'Walk-in']);
        $belowThreshold = $this->invoice(['grand_total' => 20000]);

        $this->assertTrue($service->isIrnApplicable($b2b));
        $this->assertFalse($service->isIrnApplicable($b2c));
        $this->assertSame(ComplianceService::IRN_PENDING, $service->irnStatus($b2b));
        $this->assertSame(ComplianceService::IRN_NOT_APPLICABLE, $service->irnStatus($b2c));

        $this->assertTrue($service->isEwbApplicable($b2b));
        $this->assertFalse($service->isEwbApplicable($belowThreshold));
        $this->assertSame(ComplianceService::EWB_PENDING, $service->ewbStatus($b2b));
        $this->assertSame(ComplianceService::EWB_NOT_APPLICABLE, $service->ewbStatus($belowThreshold));

        $cancelled = $this->invoice(['status' => 'cancelled']);
        $this->assertSame(ComplianceService::IRN_NOT_APPLICABLE, $service->irnStatus($cancelled));
        $this->assertSame(ComplianceService::EWB_NOT_APPLICABLE, $service->ewbStatus($cancelled));

        $composite = Store::create([
            'name' => 'Composite Store',
            'code' => 'CMP02',
            'is_active' => true,
            'state_code' => '32',
            'gst_type' => 'composition',
        ]);
        $compositeInvoice = $this->invoice(['store_id' => $composite->id]);
        $this->assertFalse($service->isIrnApplicable($compositeInvoice));
        $this->assertFalse($service->isEwbApplicable($compositeInvoice));
    }

    public function test_record_irn_success_duplicate_and_validation(): void
    {
        $invoice = $this->invoice();

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn", [
                'irn' => strtolower(self::IRN_A),
                'ack_no' => '115011223344',
                'ack_date' => now()->subMinutes(5)->toIso8601String(),
                'qr' => 'signed-qr-payload',
            ])
            ->assertStatus(200)
            ->assertJsonPath('invoice.irn_status_effective', ComplianceService::IRN_GENERATED)
            ->assertJsonPath('invoice.irn_status', ComplianceService::IRN_GENERATED);

        $invoice->refresh();
        $this->assertSame(self::IRN_A, $invoice->irn);
        $this->assertSame('115011223344', $invoice->irn_ack_no);
        $this->assertNotNull($invoice->irn_ack_date);
        $this->assertSame(1, ComplianceEvent::where('event', 'irn_recorded')->count());

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn", [
                'irn' => self::IRN_A,
                'ack_no' => '115011223344',
                'ack_date' => now()->toIso8601String(),
            ])
            ->assertStatus(422);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn", [
                'irn' => 'NOT-HEX',
                'ack_no' => 'ABC',
                'ack_date' => now()->addDay()->toIso8601String(),
            ])
            ->assertStatus(422);
    }

    public function test_irn_cancel_window_and_ewb_block(): void
    {
        $invoice = $this->invoice(['grand_total' => 60000]);
        $service = $this->service();
        $service->recordIrn($invoice, [
            'irn' => self::IRN_A,
            'ack_no' => '115011223344',
            'ack_date' => now()->subHour()->toIso8601String(),
        ], $this->admin->id);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/eway-bill", [
                'ewb_number' => '123456789012',
                'ewb_date' => now()->toDateString(),
                'distance_km' => 120,
                'vehicle_number' => 'KA01AB1234',
            ])
            ->assertStatus(200);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn/cancel", ['reason' => 'Buyer rejected goods'])
            ->assertStatus(422);

        $invoice->refresh();
        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/eway-bill/cancel", ['reason' => 'Buyer rejected goods'])
            ->assertStatus(200);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn/cancel", ['reason' => 'Buyer rejected goods'])
            ->assertStatus(200)
            ->assertJsonPath('invoice.irn_status_effective', ComplianceService::IRN_CANCELLED);

        $stale = $this->invoice();
        $service->recordIrn($stale, [
            'irn' => self::IRN_A,
            'ack_no' => '115011223344',
            'ack_date' => now()->subHours(25)->toIso8601String(),
        ], $this->admin->id);

        $this->act()
            ->postJson("/api/admin/compliance/{$stale->id}/irn/cancel", ['reason' => 'Too late now'])
            ->assertStatus(422);
    }

    public function test_ewb_lifecycle_validity_update_and_cancel(): void
    {
        $invoice = $this->invoice(['grand_total' => 60000]);

        $response = $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/eway-bill", [
                'ewb_number' => '1234 5678 9012',
                'ewb_date' => now()->toDateString(),
                'transporter_name' => 'Speedy Logistics',
                'transporter_id' => '29ABCDE1234F1Z5',
                'transport_mode' => 'road',
                'vehicle_number' => 'ka01 ab 1234',
                'distance_km' => 400,
                'transport_doc_no' => 'LR-7788',
            ])
            ->assertStatus(200)
            ->assertJsonPath('invoice.ewb_status_effective', ComplianceService::EWB_ACTIVE)
            ->json();

        $invoice->refresh();
        $this->assertSame('123456789012', $invoice->ewb_number);
        $this->assertSame('KA01AB1234', $invoice->ewb_part_b['vehicle_number']);
        $this->assertSame($invoice->ewb_date->copy()->endOfDay()->addDay()->toDateString(), $invoice->ewb_valid_until->toDateString());

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/eway-bill", [
                'ewb_number' => '999999999999',
                'distance_km' => 10,
            ])
            ->assertStatus(422);

        $this->act()
            ->putJson("/api/admin/compliance/{$invoice->id}/eway-bill", [
                'vehicle_number' => 'KA05XY9876',
                'transport_doc_no' => 'LR-9900',
            ])
            ->assertStatus(200);

        $invoice->refresh();
        $this->assertSame('KA05XY9876', $invoice->ewb_part_b['vehicle_number']);
        $this->assertSame('Speedy Logistics', $invoice->ewb_part_a['transporter_name']);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/eway-bill/cancel", ['reason' => 'Wrong vehicle'])
            ->assertStatus(200)
            ->assertJsonPath('invoice.ewb_status_effective', ComplianceService::EWB_CANCELLED);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/eway-bill/cancel", ['reason' => 'Again'])
            ->assertStatus(422);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn", [
                'irn' => self::IRN_A,
                'ack_no' => '1',
                'ack_date' => now()->toIso8601String(),
            ])
            ->assertStatus(200);
    }

    public function test_expired_ewb_cannot_be_updated(): void
    {
        $invoice = $this->invoice(['grand_total' => 60000]);
        $this->service()->recordEwb($invoice, [
            'ewb_number' => '123456789012',
            'ewb_date' => now()->subDays(3)->toDateString(),
            'distance_km' => 100,
            'vehicle_number' => 'KA01AB1234',
        ], $this->admin->id);

        $invoice->refresh();
        $this->assertSame(ComplianceService::EWB_EXPIRED, $this->service()->ewbStatus($invoice));

        $this->act()
            ->putJson("/api/admin/compliance/{$invoice->id}/eway-bill", ['vehicle_number' => 'KA01AB9999'])
            ->assertStatus(422);
    }

    public function test_summary_and_pending_export(): void
    {
        $this->invoice();
        $this->invoice(['grand_total' => 60000]);
        $this->invoice(['customer_gstin' => null, 'customer_name' => 'Walk-in']);
        $this->invoice(['status' => 'cancelled']);

        $summary = $this->act()
            ->getJson('/api/admin/compliance/summary')
            ->assertStatus(200)
            ->json()['summary'];

        $this->assertSame(2, $summary['applicable_b2b']);
        $this->assertSame(2, $summary['irn_pending']);
        $this->assertSame(1, $summary['ewb_pending']);
        $this->assertSame(0, $summary['irn_generated']);

        $export = $this->act()
            ->getJson('/api/admin/compliance/export-pending')
            ->assertStatus(200)
            ->json();

        $this->assertSame(2, $export['count']);
        $this->assertSame(self::GSTIN_A, $export['invoices'][0]['customer_gstin']);
        $this->assertSame(ComplianceService::IRN_PENDING, $export['invoices'][0]['irn_status']);

        $this->act()
            ->getJson('/api/admin/compliance/export-pending?download=1')
            ->assertStatus(200)
            ->assertHeader('Content-Disposition');
    }

    public function test_import_applies_rows_and_reports_unknown_invoice(): void
    {
        $target = $this->invoice(['grand_total' => 60000]);

        $response = $this->act()
            ->postJson('/api/admin/compliance/import', [
                'store_id' => $this->store->id,
                'rows' => [
                    [
                        'invoice_number' => $target->invoice_number,
                        'irn' => self::IRN_A,
                        'ack_no' => '115011223344',
                        'ack_date' => now()->toIso8601String(),
                        'ewb_number' => '123456789012',
                        'ewb_date' => now()->toDateString(),
                        'distance_km' => 50,
                        'vehicle_number' => 'KA01AB1234',
                    ],
                    [
                        'invoice_number' => 'MISSING-INV',
                        'irn' => self::IRN_A,
                        'ack_no' => '1',
                        'ack_date' => now()->toIso8601String(),
                    ],
                ],
            ])
            ->assertStatus(200)
            ->json();

        $this->assertSame(1, $response['applied']);
        $this->assertSame(1, $response['failed']);
        $this->assertSame('Invoice not found for the active store scope.', $response['results'][1]['error']);

        $target->refresh();
        $this->assertSame(self::IRN_A, $target->irn);
        $this->assertSame('123456789012', $target->ewb_number);

        $this->act()
            ->postJson('/api/admin/compliance/import', [
                'rows' => [[
                    'invoice_number' => $target->invoice_number,
                    'irn' => self::IRN_A,
                    'ack_no' => '1',
                    'ack_date' => now()->toIso8601String(),
                ]],
            ])
            ->assertStatus(200)
            ->assertJsonPath('failed', 1)
            ->assertJsonPath('results.0.error', 'An IRN is already recorded for this invoice.');
    }

    public function test_import_csv_parses_column_aliases(): void
    {
        $invoice = $this->invoice();
        $csv = implode("\n", [
            'invoice no,IRN,Ack No,Ack Date',
            "{$invoice->invoice_number}," . self::IRN_A . ',115011223344,' . now()->toDateString(),
        ]);

        $response = $this->act()
            ->postJson('/api/admin/compliance/import', ['csv' => $csv])
            ->assertStatus(200)
            ->json();

        $this->assertSame(1, $response['applied']);
        $invoice->refresh();
        $this->assertSame(self::IRN_A, $invoice->irn);
    }

    public function test_settings_toggle_changes_applicability_and_is_audited(): void
    {
        $invoice = $this->invoice(['grand_total' => 60000]);

        $this->act()
            ->postJson('/api/admin/compliance/settings', [
                'enabled' => true,
                'irn' => ['enabled' => false, 'b2b_only' => true, 'turnover_threshold' => 0],
                'eway' => ['enabled' => true, 'threshold_amount' => 50000, 'default_distance_km' => 10],
            ])
            ->assertStatus(200);

        $this->service()->invalidateConfig($this->store->id);
        $this->assertFalse($this->service()->isIrnApplicable($invoice));
        $this->assertSame(ComplianceService::IRN_NOT_APPLICABLE, $this->service()->irnStatus($invoice));

        $summary = $this->act()->getJson('/api/admin/compliance/summary')->json()['summary'];
        $this->assertSame(0, $summary['irn_pending']);
        $this->assertSame(1, $summary['ewb_pending']);

        $this->act()
            ->getJson('/api/admin/compliance/settings')
            ->assertStatus(200)
            ->assertJsonPath('config.irn.enabled', false)
            ->assertJsonPath('config.provider', 'manual');
    }

    public function test_force_allows_recording_outside_applicability(): void
    {
        $invoice = $this->invoice(['customer_gstin' => null, 'grand_total' => 500]);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn", [
                'irn' => self::IRN_A,
                'ack_no' => '1',
                'ack_date' => now()->toIso8601String(),
            ])
            ->assertStatus(422);

        $this->act()
            ->postJson("/api/admin/compliance/{$invoice->id}/irn", [
                'irn' => self::IRN_A,
                'ack_no' => '1',
                'ack_date' => now()->toIso8601String(),
                'force' => true,
            ])
            ->assertStatus(200);
    }

    public function test_store_scope_limits_import_and_cashier_is_forbidden(): void
    {
        $other = Store::create([
            'name' => 'Other Store',
            'code' => 'CMP03',
            'is_active' => true,
            'state_code' => '29',
            'gst_type' => 'regular',
        ]);
        $foreign = $this->invoice(['store_id' => $other->id]);

        $cashier = User::create([
            'name' => 'Cashier',
            'email' => 'cashier@cmp.test',
            'password' => bcrypt('password123'),
            'role' => 'cashier',
            'store_id' => $this->store->id,
        ]);

        $this->actingAs($cashier, 'sanctum')
            ->getJson('/api/admin/compliance')
            ->assertStatus(403);

        $result = $this->act()
            ->withHeaders(['X-Store-Scope' => $this->store->id])
            ->postJson('/api/admin/compliance/import', [
                'rows' => [[
                    'invoice_number' => $foreign->invoice_number,
                    'irn' => self::IRN_A,
                    'ack_no' => '1',
                    'ack_date' => now()->toIso8601String(),
                ]],
            ])
            ->assertStatus(200)
            ->json();

        $this->assertSame(0, $result['applied']);
        $this->assertSame(1, $result['failed']);
        $this->assertNull($foreign->refresh()->irn);
    }
}
