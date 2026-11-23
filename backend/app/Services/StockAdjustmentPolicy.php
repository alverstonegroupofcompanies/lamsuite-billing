<?php

namespace App\Services;

use App\Models\CompanySetting;
use App\Models\Counter;
use App\Models\StockAdjustmentDocument;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Single source of truth for per-store stock adjustment restrictions.
 *
 * The policy is stored as one JSON company setting so the desktop app, admin
 * panel and API all evaluate the same rules. Legacy keys are still read as a
 * fallback for allow_negative_stock so existing stores keep working.
 */
class StockAdjustmentPolicy
{
    public const SETTING_KEY = 'stock_adjustment_policy';

    public const DEFAULTS = [
        'allow_negative_stock' => false,
        'allowed_roles' => [],
        'allowed_reasons' => [],
        'max_qty_per_line' => null,
        'max_value_per_document' => null,
        'max_documents_per_day' => null,
        'max_units_per_day' => null,
        'require_notes' => false,
        'approval_threshold_value' => null,
        'approval_threshold_qty' => null,
        'approver_roles' => ['store_owner', 'manager', 'super_admin'],
        'locked_before_date' => null,
        'allowed_time_window' => null,
    ];

    public function forStore(int $storeId): array
    {
        $policy = self::DEFAULTS;

        $setting = CompanySetting::where('store_id', $storeId)
            ->where('key', self::SETTING_KEY)
            ->first();

        if ($setting && is_array($setting->value)) {
            $policy = array_merge($policy, $setting->value);
        }

        if (!array_key_exists('allow_negative_stock', is_array($setting?->value) ? $setting->value : [])) {
            $policy['allow_negative_stock'] = $this->legacyAllowNegativeStock($storeId);
        }

        return $policy;
    }

    public function save(int $storeId, array $policy): array
    {
        $clean = array_merge(self::DEFAULTS, array_intersect_key($policy, self::DEFAULTS));

        CompanySetting::updateOrCreate(
            ['store_id' => $storeId, 'key' => self::SETTING_KEY],
            ['value' => $clean, 'is_secret' => false]
        );

        return $clean;
    }

    private function legacyAllowNegativeStock(int $storeId): bool
    {
        $setting = CompanySetting::where('store_id', $storeId)
            ->where('key', 'stock.allow_negative_stock')
            ->first();

        if ($setting) {
            $val = $setting->value;
            if (is_array($val)) {
                $val = $val['allow_negative_stock'] ?? $val['value'] ?? ($val[0] ?? false);
            }
            return filter_var($val, FILTER_VALIDATE_BOOLEAN);
        }

        $inventory = CompanySetting::where('store_id', $storeId)
            ->where('key', 'inventory_settings')
            ->first();

        if ($inventory && is_array($inventory->value)) {
            return filter_var($inventory->value['allow_negative_stock'] ?? false, FILTER_VALIDATE_BOOLEAN);
        }

        return false;
    }

    public static function normalizeRole(?string $role): string
    {
        $role = strtolower(trim((string) $role));
        return match ($role) {
            'owner', 'admin', 'store_owner' => 'store_owner',
            'store_manager' => 'manager',
            default => $role,
        };
    }

    /**
     * @param array<int, array<string, mixed>> $lines Resolved lines with system_qty, adjustment_qty, price.
     * @return array{errors: string[], requires_approval: bool, blocker: ?string}
     */
    public function validate(
        int $storeId,
        ?User $user,
        array $lines,
        string $mode,
        ?string $notes,
        ?string $documentDate = null,
        ?Counter $counter = null
    ): array {
        $policy = $this->forStore($storeId);
        $errors = [];
        $blocker = null;

        $block = function (string $message) use (&$errors, &$blocker) {
            $errors[] = $message;
            $blocker ??= $message;
        };

        $role = self::normalizeRole($user?->role);
        $allowedRoles = array_map([self::class, 'normalizeRole'], (array) ($policy['allowed_roles'] ?? []));
        if ($allowedRoles && $role !== 'super_admin' && !in_array($role, $allowedRoles, true)) {
            $block(sprintf('Your role (%s) is not allowed to post stock adjustments. Allowed roles: %s.', $role ?: 'unknown', implode(', ', $allowedRoles)));
        }

        if ($policy['require_notes'] && trim((string) $notes) === '' && trim((string) ($lines[0]['reason'] ?? '')) === '') {
            $block('A note or reason is required for stock adjustments at this store.');
        }

        $allowedReasons = $policy['allowed_reasons'] ?? [];
        if (is_array($allowedReasons) && count($allowedReasons) > 0) {
            $normalized = array_map(fn($r) => strtolower(trim((string) $r)), $allowedReasons);
            foreach ($lines as $line) {
                $reason = strtolower(trim((string) ($line['reason'] ?? '')));
                if ($reason !== '' && !in_array($reason, $normalized, true)) {
                    $block(sprintf('Reason "%s" is not allowed by store policy.', $line['reason'] ?? ''));
                    break;
                }
            }
        }

        $maxQty = $policy['max_qty_per_line'] ?? null;
        if ($maxQty !== null && $maxQty !== '') {
            foreach ($lines as $line) {
                if (abs((float) ($line['adjustment_qty'] ?? 0)) > (float) $maxQty) {
                    $block(sprintf(
                        'Line %s exceeds the maximum %s units per adjustment line.',
                        $line['product_name'] ?? ('#' . ($line['line_no'] ?? '')),
                        $maxQty
                    ));
                    break;
                }
            }
        }

        $totalValue = 0.0;
        $totalQty = 0.0;
        foreach ($lines as $line) {
            $delta = abs((float) ($line['adjustment_qty'] ?? 0));
            $totalQty += $delta;
            $totalValue += $delta * (float) ($line['unit_cost'] ?? 0);
        }

        $maxValue = $policy['max_value_per_document'] ?? null;
        if ($maxValue !== null && $maxValue !== '' && $totalValue > (float) $maxValue) {
            $block(sprintf(
                'Document value ₹%.2f exceeds the ₹%.2f per-adjustment limit.',
                $totalValue,
                (float) $maxValue
            ));
        }

        $maxPerDay = $policy['max_documents_per_day'] ?? null;
        if ($maxPerDay !== null && $maxPerDay !== '') {
            $todayCount = $this->principalDocumentsToday($storeId, $user, $counter)->count();
            if ($todayCount >= (int) $maxPerDay) {
                $block(sprintf(
                    'Daily stock adjustment limit reached (%d of %d documents today).',
                    $todayCount,
                    (int) $maxPerDay
                ));
            }
        }

        $maxUnitsPerDay = $policy['max_units_per_day'] ?? null;
        if ($maxUnitsPerDay !== null && $maxUnitsPerDay !== '') {
            $todayUnits = (float) $this->principalDocumentsToday($storeId, $user, $counter)->sum('total_qty');
            if ($todayUnits + $totalQty > (float) $maxUnitsPerDay) {
                $block(sprintf(
                    'Daily stock adjustment units would reach %s of the %s-unit daily limit.',
                    rtrim(rtrim(number_format($todayUnits + $totalQty, 3, '.', ''), '0'), '.'),
                    rtrim(rtrim(number_format((float) $maxUnitsPerDay, 3, '.', ''), '0'), '.')
                ));
            }
        }

        $lockedBefore = $policy['locked_before_date'] ?? null;
        if ($lockedBefore) {
            $date = $documentDate ?: now()->toDateString();
            if (substr($date, 0, 10) < substr((string) $lockedBefore, 0, 10)) {
                $block(sprintf('Stock adjustments on or before %s are locked by the store policy.', $lockedBefore));
            }
        }

        $window = $policy['allowed_time_window'] ?? null;
        if (is_array($window) && !empty($window['start']) && !empty($window['end'])) {
            $now = now()->format('H:i');
            if ($now < $window['start'] || $now > $window['end']) {
                $block(sprintf(
                    'Stock adjustments are only allowed between %s and %s.',
                    $window['start'],
                    $window['end']
                ));
            }
        }

        if (!($policy['allow_negative_stock'] ?? false)) {
            foreach ($lines as $line) {
                $balance = (float) ($line['system_qty'] ?? 0) + (float) ($line['adjustment_qty'] ?? 0);
                if ($balance < 0) {
                    $block(sprintf(
                        'Adjustment would drive "%s" batch %s to %.3f units; negative stock is blocked.',
                        $line['product_name'] ?? ('Product #' . ($line['product_id'] ?? '')),
                        $line['batch_no'] ?? '-',
                        $balance
                    ));
                    break;
                }
            }
        }

        $approvalValue = $policy['approval_threshold_value'] ?? null;
        $approvalQty = $policy['approval_threshold_qty'] ?? null;
        $requiresApproval = false;
        if ($approvalValue !== null && $approvalValue !== '' && $totalValue >= (float) $approvalValue) {
            $requiresApproval = true;
        }
        if ($approvalQty !== null && $approvalQty !== '' && $totalQty >= (float) $approvalQty) {
            $requiresApproval = true;
        }

        return [
            'errors' => $errors,
            'requires_approval' => $requiresApproval,
            'blocker' => $blocker,
            'policy' => $policy,
        ];
    }

    /**
     * The documents a principal posted today. At a till the principal is the
     * counter; elsewhere it is the signed-in person. Rejected documents never
     * count against the allowance.
     */
    private function principalDocumentsToday(int $storeId, ?User $user, ?Counter $counter): Builder
    {
        return StockAdjustmentDocument::query()
            ->where('store_id', $storeId)
            ->where('status', '!=', 'rejected')
            ->whereDate('created_at', now()->toDateString())
            ->when(
                $counter !== null,
                fn (Builder $query) => $query->where('counter_id', $counter->id),
                fn (Builder $query) => $user !== null
                    ? $query->where('created_by', $user->id)
                    // Neither a person nor a counter: the store's anonymous allowance,
                    // never an unlimited one.
                    : $query->whereNull('created_by')->whereNull('counter_id')
            );
    }

    public function canApprove(?User $user, int $storeId): bool
    {
        if (!$user) {
            return false;
        }

        $role = self::normalizeRole($user->role);
        if ($role === 'super_admin') {
            return true;
        }

        $policy = $this->forStore($storeId);
        $approvers = array_map([self::class, 'normalizeRole'], (array) ($policy['approver_roles'] ?? []));

        return in_array($role, $approvers, true);
    }
}
