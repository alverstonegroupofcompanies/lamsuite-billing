<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Store extends Model
{
    protected $table = 'stores';

    protected $fillable = [
        'name',
        'code',
        'wipe_on_revocation',
        'phone',
        'email',
        'address',
        'state_code',
        'gstin',
        'drug_license_numbers',
        'fssai_no',
        'tax_mode',
        'store_type',
        'gst_type',
        'invoice_prefix',
        'is_active',
        'license_plan',
        'license_expires_at',
        'enabled_menu_items',
        'feature_flags',
        'version',
        'timezone',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'wipe_on_revocation' => 'boolean',
        'drug_license_numbers' => 'array',
        'enabled_menu_items' => 'array',
        'feature_flags' => 'array',
        'license_expires_at' => 'date',
        'version' => 'integer',
    ];

    protected $appends = [
        'allow_negative_stock',
    ];

    public function getAllowNegativeStockAttribute(): bool
    {
        // One canonical policy is shared by the desktop, admin panel and MCP.
        return app(\App\Services\StockAdjustmentPolicy::class)->forStore((int) $this->id)['allow_negative_stock'];
    }

    /**
     * The screens a store that never chose still gets, so the settings payload and
     * the feature editor describe the same branch.
     */
    public const DEFAULT_MENUS = [
        'dashboard', 'pos', 'bills', 'sales_returns', 'customer_debit_notes',
        'purchases', 'purchase_returns', 'expenses', 'stock', 'stock_transfers',
        'reports', 'masters', 'import_export', 'settings', 'counters',
    ];

    /**
     * The switches Menu & Feature Control offers, with the answer for a store that
     * never saved them. `allow_data_migration` is a flag rather than a menu because
     * the wizard was reachable on every till before there was a switch: an unset
     * flag has to mean "as it was", which a menu list cannot tell from "removed".
     */
    public const DEFAULT_FEATURE_FLAGS = [
        'allow_offline_billing' => true,
        'require_doctor_on_schedule_h' => true,
        'allow_custom_discounts' => true,
        'auto_print_thermal' => true,
        'enable_wallet_credit' => true,
        'enforce_mrp_capping' => true,
        'gstr1_auto_push' => false,
        'dark_mode_allowed' => true,
        'allow_data_migration' => true,
    ];

    /**
     * A store switch as this branch actually has it: the saved value, or the answer
     * a store that never touched the switch gets.
     */
    public function featureFlag(string $key): bool
    {
        $flags = is_array($this->feature_flags) ? $this->feature_flags : [];

        if (array_key_exists($key, $flags)) {
            return filter_var($flags[$key], FILTER_VALIDATE_BOOLEAN);
        }

        return (bool) (self::DEFAULT_FEATURE_FLAGS[$key] ?? false);
    }

    /** @return array<string,bool> */
    public function featureFlags(): array
    {
        return array_merge(self::DEFAULT_FEATURE_FLAGS, is_array($this->feature_flags) ? $this->feature_flags : []);
    }

    public function activationKeys(): HasMany
    {
        return $this->hasMany(ActivationKey::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function settings(): HasMany
    {
        return $this->hasMany(CompanySetting::class);
    }

    public function syncEvents(): HasMany
    {
        return $this->hasMany(SyncEvent::class);
    }
}
