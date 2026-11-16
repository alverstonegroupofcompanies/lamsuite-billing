<?php

namespace Tests\Feature;

use App\Mail\ScheduledReportMail;
use App\Models\ScheduledReport;
use App\Models\Store;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class ScheduledReportsTest extends TestCase
{
    use RefreshDatabase;

    protected Store $store1;
    protected Store $store2;
    protected User $superAdmin;
    protected User $managerStore1;

    protected function setUp(): void
    {
        parent::setUp();

        $this->store1 = Store::create([
            'name' => 'Store Palakkad',
            'code' => 'ST-01',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->store2 = Store::create([
            'name' => 'Store Kochi',
            'code' => 'ST-02',
            'state_code' => '32',
            'is_active' => true,
        ]);

        $this->superAdmin = User::create([
            'name' => 'Super Admin',
            'email' => 'super@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'store_id' => $this->store1->id,
            'allowed_store_ids' => [$this->store1->id, $this->store2->id],
        ]);

        $this->managerStore1 = User::create([
            'name' => 'Palakkad Manager',
            'email' => 'pkd@lamstone.in',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'store_id' => $this->store1->id,
            'allowed_store_ids' => [$this->store1->id],
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Daily Sales Digest',
            'report_type' => 'daily_sales',
            'frequency' => 'daily',
            'send_time' => '21:00',
            'recipients' => ['owner@lamstone.in'],
            'is_active' => true,
        ], $overrides);
    }

    public function test_super_admin_can_create_and_list_schedules(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/reports/scheduled', $this->payload())
            ->assertStatus(201)
            ->assertJsonPath('schedule.name', 'Daily Sales Digest')
            ->assertJsonPath('schedule.store_id', $this->store1->id);

        $response = $this->actingAs($this->superAdmin, 'sanctum')
            ->getJson('/api/admin/reports/scheduled')
            ->assertStatus(200);

        $this->assertCount(1, $response->json('schedules'));
        $this->assertSame('Daily at 21:00', $response->json('schedules.0.frequency_label'));
    }

    public function test_weekly_schedule_requires_day_of_week(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/reports/scheduled', $this->payload([
                'frequency' => 'weekly',
                'day_of_week' => null,
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['day_of_week']);
    }

    public function test_manager_cannot_manage_another_stores_schedule(): void
    {
        $schedule = ScheduledReport::create([
            'store_id' => $this->store2->id,
            'name' => 'Kochi GSTR-1',
            'report_type' => 'gstr1',
            'frequency' => 'monthly',
            'send_time' => '09:00',
            'day_of_month' => 5,
            'recipients' => ['ca@lamstone.in'],
            'is_active' => true,
        ]);

        $this->actingAs($this->managerStore1, 'sanctum')
            ->putJson('/api/admin/reports/scheduled/' . $schedule->id, $this->payload(['name' => 'Hijack']))
            ->assertStatus(403);

        $this->actingAs($this->managerStore1, 'sanctum')
            ->deleteJson('/api/admin/reports/scheduled/' . $schedule->id)
            ->assertStatus(403);
    }

    public function test_consolidated_schedule_requires_all_store_access(): void
    {
        $this->actingAs($this->managerStore1, 'sanctum')
            ->postJson('/api/admin/reports/scheduled', $this->payload(['store_id' => null]))
            ->assertStatus(403);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/reports/scheduled', $this->payload(['store_id' => null]))
            ->assertStatus(201)
            ->assertJsonPath('schedule.store_id', null);
    }

    public function test_due_daily_schedule_is_emailed_by_command(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-11-17 21:00:00');

        $schedule = ScheduledReport::create([
            'store_id' => $this->store1->id,
            'name' => 'Daily Sales Digest',
            'report_type' => 'daily_sales',
            'frequency' => 'daily',
            'send_time' => '21:00',
            'recipients' => ['owner@lamstone.in'],
            'is_active' => true,
        ]);

        $this->artisan('reports:send-scheduled')->assertExitCode(0);

        Mail::assertSent(ScheduledReportMail::class, function (ScheduledReportMail $mail) {
            return $mail->hasTo('owner@lamstone.in')
                && $mail->csvFilename !== ''
                && str_contains($mail->csvContent, 'Gross sales');
        });

        $schedule->refresh();
        $this->assertSame('sent', $schedule->last_status);
        $this->assertNotNull($schedule->last_sent_at);
    }

    public function test_command_does_not_resend_an_already_delivered_schedule(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-11-17 21:00:00');

        ScheduledReport::create([
            'store_id' => $this->store1->id,
            'name' => 'Daily Sales Digest',
            'report_type' => 'daily_sales',
            'frequency' => 'daily',
            'send_time' => '21:00',
            'recipients' => ['owner@lamstone.in'],
            'is_active' => true,
            'last_sent_at' => now(),
            'last_status' => 'sent',
        ]);

        $this->artisan('reports:send-scheduled')->assertExitCode(0);

        Mail::assertNothingSent();
    }

    public function test_dry_run_does_not_send_or_stamp_the_schedule(): void
    {
        Mail::fake();
        Carbon::setTestNow('2026-11-17 21:00:00');

        $schedule = ScheduledReport::create([
            'store_id' => $this->store1->id,
            'name' => 'Daily Sales Digest',
            'report_type' => 'daily_sales',
            'frequency' => 'daily',
            'send_time' => '21:00',
            'recipients' => ['owner@lamstone.in'],
            'is_active' => true,
        ]);

        $this->artisan('reports:send-scheduled', ['--dry-run' => true])->assertExitCode(0);

        Mail::assertNothingSent();
        $this->assertNull($schedule->fresh()->last_sent_at);
    }

    public function test_run_now_endpoint_sends_and_records_delivery(): void
    {
        Mail::fake();

        $schedule = ScheduledReport::create([
            'store_id' => $this->store1->id,
            'name' => 'Aging Snapshot',
            'report_type' => 'customer_aging',
            'frequency' => 'daily',
            'send_time' => '10:00',
            'recipients' => ['owner@lamstone.in'],
            'is_active' => true,
        ]);

        $this->actingAs($this->superAdmin, 'sanctum')
            ->postJson('/api/admin/reports/scheduled/' . $schedule->id . '/run-now')
            ->assertStatus(200)
            ->assertJsonPath('schedule.last_status', 'sent');

        Mail::assertSent(ScheduledReportMail::class);
    }

    public function test_consolidated_schedule_can_be_created_under_all_stores_scope(): void
    {
        $this->actingAs($this->superAdmin, 'sanctum')
            ->withHeaders(['X-Store-Scope' => 'all'])
            ->postJson('/api/admin/reports/scheduled', $this->payload(['name' => 'Consolidated Weekly Digest']))
            ->assertStatus(201)
            ->assertJsonPath('schedule.store_id', null);
    }
}
