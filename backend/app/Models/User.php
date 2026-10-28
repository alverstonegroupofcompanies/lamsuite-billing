<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'store_id',
        'name',
        'email',
        'username',
        'password',
        'pin_hash',
        'pin_code',
        'must_change_password',
        'role',
        'permissions',
        'enabled_menus',
        'allowed_store_ids',
        'totp_secret',
        'totp_enabled',
        'is_biometric_enabled',
        'idle_timeout_minutes',
        'max_failed_logins',
        'failed_login_attempts',
        'locked_until',
        'ip_allowlist',
    ];

    protected $hidden = [
        'password',
        'pin_hash',
        'pin_code',
        'remember_token',
        'totp_secret',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
        'pin_code' => 'encrypted',
        'must_change_password' => 'boolean',
        'permissions' => 'array',
        'enabled_menus' => 'array',
        'allowed_store_ids' => 'array',
        'totp_enabled' => 'boolean',
        'is_biometric_enabled' => 'boolean',
        'locked_until' => 'datetime',
    ];

    protected $appends = [
        'has_pin',
        'is_locked',
    ];

    public function getHasPinAttribute(): bool
    {
        return !empty($this->pin_hash);
    }

    public function getIsLockedAttribute(): bool
    {
        return !empty($this->locked_until) && $this->locked_until->isFuture();
    }

    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(UserSession::class);
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === 'super_admin';
    }

    public function canAccessStore(?int $storeId): bool
    {
        if ($this->role === 'super_admin') {
            return true;
        }

        if ($storeId === null) {
            return false;
        }

        if ($this->store_id === $storeId) {
            return true;
        }

        if (is_array($this->allowed_store_ids) && in_array($storeId, $this->allowed_store_ids)) {
            return true;
        }

        return false;
    }

    /**
     * Check permission: module (e.g., 'stores', 'invoices', 'reports') and action ('view', 'create', 'edit', 'delete', 'export')
     */
    public function hasPermission(string $module, string $action = 'view'): bool
    {
        if ($this->role === 'super_admin') {
            return true;
        }

        // Role baseline defaults
        if ($this->role === 'support') {
            return $action === 'view' || $action === 'export';
        }

        if ($this->role === 'accountant') {
            // Accountant has reports & financial views only
            if ($module === 'reports' || $module === 'gst' || $module === 'dashboard') {
                return $action === 'view' || $action === 'export';
            }
            return false;
        }

        // Custom granular permissions check
        if (!empty($this->permissions) && is_array($this->permissions)) {
            if (isset($this->permissions[$module])) {
                $modPerms = $this->permissions[$module];
                if (is_array($modPerms) && in_array($action, $modPerms)) {
                    return true;
                }
                if ($modPerms === true || $modPerms === '*') {
                    return true;
                }
            }
        }

        // Store owner default permissions
        if ($this->role === 'store_owner') {
            return true;
        }

        // Manager default permissions (cannot do remote reset or delete users)
        if ($this->role === 'manager') {
            if ($module === 'stores' && ($action === 'delete' || $action === 'reset')) {
                return false;
            }
            return true;
        }

        return false;
    }
}
