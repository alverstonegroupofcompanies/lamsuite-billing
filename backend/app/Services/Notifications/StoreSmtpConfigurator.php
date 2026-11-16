<?php

namespace App\Services\Notifications;

use App\Models\CompanySetting;
use App\Models\Store;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Mail;

class StoreSmtpConfigurator
{
    /**
     * Apply a store's saved SMTP settings to the mail transport.
     * Returns false when email delivery is not configured/enabled.
     */
    public static function configure(?int $storeId = null): bool
    {
        $store = $storeId ? Store::find($storeId) : null;
        $store ??= Store::query()->orderBy('id')->first();

        if (!$store) {
            return false;
        }

        $config = CompanySetting::where('store_id', $store->id)->where('key', 'smtp')->value('value');
        if (!is_array($config) || empty($config['enabled'])) {
            return false;
        }

        Config::set('mail.mailers.smtp.host', $config['host'] ?? config('mail.mailers.smtp.host'));
        Config::set('mail.mailers.smtp.port', (int) ($config['port'] ?? config('mail.mailers.smtp.port')));
        Config::set('mail.mailers.smtp.encryption', $config['encryption'] ?? config('mail.mailers.smtp.encryption'));
        Config::set('mail.mailers.smtp.username', $config['username'] ?? config('mail.mailers.smtp.username'));
        Config::set('mail.mailers.smtp.password', $config['password'] ?? config('mail.mailers.smtp.password'));
        Config::set('mail.from.address', $config['from_email'] ?? config('mail.from.address'));
        Config::set('mail.from.name', $config['from_name'] ?? config('mail.from.name'));

        Mail::forgetMailers();

        return true;
    }
}
