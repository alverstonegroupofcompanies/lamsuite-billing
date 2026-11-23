<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** SYNC-02: devices revoked before revoked_at existed get their time from the row. */
class BackfillDeviceRevokedAtCommandTest extends TestCase
{
    use RefreshDatabase;

    private Store $store;

    protected function setUp(): void
    {
        parent::setUp();
        $this->store = Store::create(['name' => 'Backfill Store', 'code' => 'BF1', 'state_code' => '32', 'is_active' => true]);
    }

    private function legacyDevice(string $uuid, string $status, ?string $updatedAt): int
    {
        // Written the way a pre-column build left it: no hook, no revoked_at.
        return DB::table('devices')->insertGetId([
            'store_id' => $this->store->id,
            'device_name' => $uuid,
            'device_uuid' => $uuid,
            'status' => $status,
            'revoke_reason' => $status === 'revoked' ? 'Replaced by a re-issued activation code' : null,
            'created_at' => '2026-11-01 09:00:00',
            'updated_at' => $updatedAt,
        ]);
    }

    public function test_dry_run_lists_the_devices_and_writes_nothing(): void
    {
        $id = $this->legacyDevice('uuid-old-revoked', 'revoked', '2026-11-20 18:30:00');

        $this->artisan('devices:backfill-revoked-at')
            ->expectsOutputToContain('Dry run: 1 device(s)')
            ->assertSuccessful();

        $this->assertNull(DB::table('devices')->where('id', $id)->value('revoked_at'));
    }

    public function test_apply_stamps_only_revoked_devices_from_their_last_update(): void
    {
        $revoked = $this->legacyDevice('uuid-old-revoked', 'revoked', '2026-11-20 18:30:00');
        $active = $this->legacyDevice('uuid-active', 'active', '2026-11-20 18:30:00');

        $this->artisan('devices:backfill-revoked-at', ['--apply' => true])->assertSuccessful();

        $this->assertSame('2026-11-20 18:30:00', Device::find($revoked)->revoked_at->format('Y-m-d H:i:s'));
        $this->assertNull(Device::find($active)->revoked_at);

        // A second run finds nothing left to do.
        $this->artisan('devices:backfill-revoked-at', ['--apply' => true])
            ->expectsOutputToContain('No revoked device is missing')
            ->assertSuccessful();
    }
}
