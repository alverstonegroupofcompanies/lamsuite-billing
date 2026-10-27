<?php

namespace App\Console\Commands;

use App\Models\ActivationKey;
use App\Models\Store;
use Illuminate\Console\Command;

class MigrateActivationKeysCommand extends Command
{
    protected $signature = 'lamsuite:migrate-activation-keys';
    protected $description = 'Hash and migrate plaintext activation keys into activation_keys table';

    public function handle(): int
    {
        $stores = Store::all();
        $this->info("Scanning {$stores->count()} stores for activation keys...");

        foreach ($stores as $store) {
            $rawKey = $store->activation_key;
            if ($rawKey) {
                $hash = ActivationKey::hashKey($rawKey);
                $store->update(['activation_key_hash' => $hash]);

                $existing = ActivationKey::where('store_id', $store->id)
                    ->where('key_hash', $hash)
                    ->first();

                if (!$existing) {
                    $prefix = substr($rawKey, 0, 12) . '****';
                    ActivationKey::create([
                        'store_id' => $store->id,
                        'key_hash' => $hash,
                        'key_prefix' => $prefix,
                        'max_devices' => 5,
                        'devices_activated_count' => 0,
                        'is_single_use' => false,
                        'expires_at' => now()->addYear(),
                        'is_revoked' => !$store->is_active,
                    ]);
                    $this->info("Migrated key for Store {$store->name} [{$store->code}] (Hash: " . substr($hash, 0, 10) . "...)");
                }
            } else {
                // Generate a fresh secure key
                $res = ActivationKey::generateKey($store);
                $this->info("Generated fresh key for Store {$store->name} [{$store->code}]: {$res['raw_key']}");
            }
        }

        $this->info("Activation key migration complete.");
        return 0;
    }
}
