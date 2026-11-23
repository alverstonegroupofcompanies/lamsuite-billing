<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Counter;
use App\Models\Device;
use App\Models\DeviceActivationAttempt;
use Illuminate\Console\Command;

class AuditActivationsCommand extends Command
{
    protected $signature = 'lamsuite:audit-activations {--purge : Revoke and purge any unverified/rogue devices}';
    protected $description = 'Audit devices registered through activation endpoint, report unverified devices, and optionally purge them';

    public function handle(): int
    {
        $this->info("=== LamSuite Device Activation Security Audit ===");

        // 1. Audit devices
        $devices = Device::with(['store', 'activationKey'])->get();
        $this->info("Total registered devices on server: " . $devices->count());

        $rogueDevices = [];
        $validDevices = [];

        foreach ($devices as $dev) {
            $isRogue = false;
            $reasons = [];

            // A device must have a valid device_token_hash
            if (empty($dev->device_token_hash)) {
                $isRogue = true;
                $reasons[] = "Missing token hash";
            }

            // If registered via activation_key, key must exist and be valid
            if ($dev->registered_via === 'activation_key') {
                if (!$dev->activation_key_id) {
                    $isRogue = true;
                    $reasons[] = "Registered without activation_key_id";
                } elseif ($dev->activationKey && $dev->activationKey->is_revoked) {
                    $reasons[] = "Activation key revoked";
                }
            }

            // If registered via owner_login, approver must exist
            if ($dev->registered_via === 'owner_login' && !$dev->approved_by) {
                $isRogue = true;
                $reasons[] = "Owner login registration without verified approver";
            }

            if ($isRogue) {
                $rogueDevices[] = [
                    'id' => $dev->id,
                    'store' => $dev->store ? "{$dev->store->name} [{$dev->store->code}]" : "Unknown ({$dev->store_id})",
                    'device_name' => $dev->device_name,
                    'device_uuid' => $dev->device_uuid,
                    'status' => $dev->status,
                    'registered_via' => $dev->registered_via,
                    'reasons' => implode(", ", $reasons),
                ];
            } else {
                $validDevices[] = [
                    'id' => $dev->id,
                    'store' => $dev->store ? $dev->store->code : $dev->store_id,
                    'device_name' => $dev->device_name,
                    'device_uuid' => $dev->device_uuid,
                    'status' => $dev->status,
                ];
            }
        }

        $this->newLine();
        $this->info("--- Verified Devices (" . count($validDevices) . ") ---");
        if (count($validDevices) > 0) {
            $this->table(['ID', 'Store', 'Device Name', 'UUID', 'Status'], $validDevices);
        } else {
            $this->comment("No verified devices found.");
        }

        $this->newLine();
        $this->info("--- Flagged / Rogue Devices (" . count($rogueDevices) . ") ---");
        if (count($rogueDevices) > 0) {
            $this->table(['ID', 'Store', 'Device Name', 'UUID', 'Status', 'Via', 'Anomaly Reasons'], $rogueDevices);

            if ($this->option('purge')) {
                $this->warn("Purging " . count($rogueDevices) . " flagged devices...");
                foreach ($rogueDevices as $rogue) {
                    $d = Device::find($rogue['id']);
                    if ($d) {
                        // Also delete or revoke corresponding counter, in the
                        // store this device row belongs to (CNT-008).
                        Counter::where('store_id', $d->store_id)
                            ->where('device_uuid', $d->device_uuid)
                            ->update([
                                'status' => 'revoked',
                                'revoke_reason' => 'Purged during security audit: unverified activation',
                            ]);
                        $d->delete();
                        $this->line("Purged device ID {$rogue['id']} ({$rogue['device_uuid']})");
                    }
                }
                AuditLog::log('purge_rogue_devices', 'Device', 'all', null, ['count' => count($rogueDevices)], null);
                $this->info("Flagged devices purged successfully.");
            } else {
                $this->comment("Tip: Re-run with --purge to remove or revoke flagged devices.");
            }
        } else {
            $this->info("Zero unverified devices detected in database.");
        }

        // 2. Audit recent attempts
        $this->newLine();
        $this->info("--- Recent Activation Attempts (Last 50) ---");
        $attempts = DeviceActivationAttempt::orderBy('created_at', 'desc')->take(50)->get();
        if ($attempts->count() > 0) {
            $rows = $attempts->map(fn($a) => [
                'Time' => $a->created_at->toDateTimeString(),
                'IP' => $a->ip_address,
                'UUID' => $a->device_uuid,
                'Key Prefix' => $a->attempted_key_prefix,
                'Success' => $a->success ? 'YES' : 'NO',
                'Reason' => $a->failure_reason ?? 'OK',
            ]);
            $this->table(['Time', 'IP', 'UUID', 'Key Prefix', 'Success', 'Reason'], $rows);
        } else {
            $this->comment("No activation attempts recorded yet.");
        }

        // 3. CNT-013 retired the store-wide key, so there is nothing left to rotate
        // here: an owner revokes a counter and re-issues its code instead.

        return 0;
    }
}
