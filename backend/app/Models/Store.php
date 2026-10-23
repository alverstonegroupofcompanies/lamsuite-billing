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
        'activation_key',
        'phone',
        'email',
        'address',
        'state_code',
        'gstin',
        'drug_license_numbers',
        'fssai_no',
        'tax_mode',
        'invoice_prefix',
        'is_active',
        'license_plan',
        'license_expires_at',
        'enabled_menu_items',
        'feature_flags',
        'version',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'drug_license_numbers' => 'array',
        'enabled_menu_items' => 'array',
        'feature_flags' => 'array',
        'license_expires_at' => 'date',
        'version' => 'integer',
    ];

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
