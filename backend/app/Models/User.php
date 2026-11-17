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
        'remember_token',
        'totp_secret',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
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

    /**
     * Enforce strict PIN policy:
     * - Must be 4 to 6 numeric digits
     * - Cannot be all repeated digits (e.g. 1111, 2222, 0000)
     * - Cannot be trivial sequential patterns (e.g. 1234, 4321, 12345, 54321)
     */
    public static function validatePinPolicy(string $pin): ?string
    {
        if (!preg_match('/^\d{4,6}$/', $pin)) {
            return 'PIN must be between 4 and 6 numeric digits.';
        }

        // Check all repeated digits
        if (preg_match('/^(.)\1+$/', $pin)) {
            return 'PIN cannot consist of repeated digits (e.g. 1111).';
        }

        // Check trivial sequential patterns
        $trivialPatterns = ['1234', '4321', '0123', '3210', '12345', '54321', '123456', '654321'];
        if (in_array($pin, $trivialPatterns, true)) {
            return 'Trivial sequential PINs are not allowed for security reasons.';
        }

        return null; // Valid
    }

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

        // Global staff / unassigned to a single store (no restriction configured)
        if ($this->store_id === null && empty($this->allowed_store_ids)) {
            return true;
        }

        if ($this->store_id === $storeId) {
            return true;
        }

        if (is_array($this->allowed_store_ids)) {
            return in_array($storeId, $this->allowed_store_ids) || in_array((string)$storeId, $this->allowed_store_ids);
        }

        return false;
    }

    /**
     * Stores this user may read. Null means unrestricted (all current and future stores).
     */
    public function accessibleStoreIds(): ?array
    {
        if ($this->role === 'super_admin') {
            return null;
        }

        if ($this->store_id === null && empty($this->allowed_store_ids)) {
            return null;
        }

        $ids = [];
        if ($this->store_id !== null) {
            $ids[] = (int) $this->store_id;
        }
        foreach ((array) $this->allowed_store_ids as $id) {
            $ids[] = (int) $id;
        }

        $ids = array_values(array_unique(array_filter($ids)));
        sort($ids);

        return $ids;
    }

    /**
     * Consolidated "All Stores" scope is only safe for users who can already see every store.
     */
    public function canViewAllStores(): bool
    {
        $ids = $this->accessibleStoreIds();
        if ($ids === null) {
            return true;
        }

        $accessible = Store::whereIn('id', $ids)->count();

        return $accessible > 0 && $accessible >= Store::count();
    }

    /**
     * Check permission: module (e.g., 'stores', 'invoices', 'reports') and action ('view', 'create', 'edit', 'delete', 'export')
     */
    public function hasPermission(string $module, string $action = 'view'): bool
    {
        if ($this->role === 'super_admin') {
            return true;
        }

        // Explicit per-user overrides (set from the admin permission matrix)
        // take precedence over the role baseline.
        $explicit = $this->explicitPermissionDecision($module, $action);
        if ($explicit !== null) {
            return $explicit;
        }

        // Role baseline defaults
        if ($this->role === 'support') {
            return $action === 'view' || $action === 'export';
        }

        if ($this->role === 'accountant') {
            // Accountant has reports & financial views only
            if ($module === 'reports' || $module === 'gst' || $module === 'dashboard' || $module === 'compliance') {
                return $action === 'view' || $action === 'export';
            }
            return false;
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

    /**
     * Evaluates the stored permissions map. Returns null when it carries no
     * instruction for the module (fall back to the role baseline). A module key
     * that is present acts as a complete allow-list, so an unknown action is denied.
     */
    private function explicitPermissionDecision(string $module, string $action): ?bool
    {
        $permissions = $this->permissions;
        if (empty($permissions) || !is_array($permissions)) {
            return null;
        }

        // Legacy list form: ["*"], ["sales"], ["sales.view"]
        if (array_is_list($permissions)) {
            $entries = array_map(static fn ($entry) => trim((string) $entry), $permissions);
            if (in_array('*', $entries, true)) {
                return true;
            }
            if (
                in_array($module, $entries, true)
                || in_array("{$module}.*", $entries, true)
                || in_array("{$module}.{$action}", $entries, true)
            ) {
                return true;
            }
            return null;
        }

        if (!array_key_exists($module, $permissions)) {
            return null;
        }

        $value = $permissions[$module];
        if ($value === true || $value === '*') {
            return true;
        }
        if ($value === false) {
            return false;
        }
        if (is_string($value)) {
            return $value === '*' || $value === $action || $value === "{$module}.{$action}";
        }
        if (is_array($value)) {
            return in_array('*', $value, true)
                || in_array($action, $value, true)
                || in_array("{$module}.{$action}", $value, true);
        }

        return false;
    }
}
