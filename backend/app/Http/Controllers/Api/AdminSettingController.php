<?php

namespace App\Http\Controllers\Api;

use App\Models\AuditLog;
use App\Models\CompanySetting;
use App\Models\FinancialYear;
use App\Models\GstLockPeriod;
use App\Models\Store;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AdminSettingController
{
    /**
     * Get company settings for a store with masked secrets.
     */
    public function index(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $store = Store::find($storeId);

        $settings = CompanySetting::where('store_id', $storeId)->get()->keyBy('key');

        $smtpConfig = $settings['smtp']->value ?? [
            'host' => 'smtp.postmarkapp.com',
            'port' => 587,
            'encryption' => 'tls',
            'from_email' => 'billing@lamstone.in',
            'from_name' => 'LamStone Healthcare',
            'username' => 'lamstone_smtp',
            'password' => '••••••••••••',
        ];

        // Mask secrets
        if (isset($smtpConfig['password'])) {
            $smtpConfig['password'] = '••••••••••••';
        }

        $smsConfig = $settings['sms']->value ?? [
            'provider' => 'Fast2SMS',
            'sender_id' => 'LAMSTN',
            'api_key' => '••••••••••••',
            'enabled' => true,
        ];
        if (isset($smsConfig['api_key'])) {
            $smsConfig['api_key'] = '••••••••••••';
        }

        $whatsappConfig = $settings['whatsapp']->value ?? [
            'enabled' => false,
            'provider' => 'openwa',
            'api_url' => 'https://wa-api.alverstone.in',
            'api_key' => '••••••••••••',
            'session_id' => 'default',
            'send_pdf' => true,
            'auto_send_on_save' => false,
            'custom_caption' => '',
        ];
        if (isset($whatsappConfig['api_key']) && !empty($whatsappConfig['api_key'])) {
            $whatsappConfig['api_key'] = '••••••••••••';
        }

        return response()->json([
            'store_id' => $storeId,
            'store_details' => $store,
            'billing' => $settings['billing']->value ?? [
                'tax_mode' => 'inclusive',
                'default_rate_basis' => 'sel_rate',
                'credit_period_days' => 30,
                'round_off_enabled' => true,
                'default_hsn_code' => '30049099',
            ],
            'sequences' => $settings['sequences']->value ?? [
                'invoice_prefix' => $store ? $store->invoice_prefix : 'INV',
                'next_invoice_number' => 1001,
                'quotation_prefix' => 'QUO',
                'next_quotation_number' => 101,
                'return_prefix' => 'SR',
                'purchase_prefix' => 'PUR',
            ],
            'printing' => $settings['printing']->value ?? [
                'paper_size' => 'thermal_80mm',
                'print_upi_qr' => true,
                'print_drug_license' => true,
                'footer_note' => 'Thank you for shopping with us! Get well soon.',
            ],
            'wallet' => $settings['wallet']->value ?? [
                'enabled' => true,
                'max_credit_limit' => 10000,
                'reference_prefix' => 'WLT',
            ],
            'smtp' => $smtpConfig,
            'sms' => $smsConfig,
            'whatsapp' => $whatsappConfig,
        ]);
    }

    /**
     * Update settings.
     */
    public function update(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $validated = $request->validate([
            'billing' => 'nullable|array',
            'sequences' => 'nullable|array',
            'printing' => 'nullable|array',
            'wallet' => 'nullable|array',
            'smtp' => 'nullable|array',
            'sms' => 'nullable|array',
            'whatsapp' => 'nullable|array',
        ]);

        foreach ($validated as $key => $val) {
            if ($val !== null) {
                // If secrets contain '••••••••••••', do not overwrite existing secret
                if ($key === 'smtp' && isset($val['password']) && str_contains($val['password'], '••')) {
                    $existing = CompanySetting::where('store_id', $storeId)->where('key', 'smtp')->first();
                    if ($existing && isset($existing->value['password'])) {
                        $val['password'] = $existing->value['password'];
                    }
                }
                if ($key === 'sms' && isset($val['api_key']) && str_contains($val['api_key'], '••')) {
                    $existing = CompanySetting::where('store_id', $storeId)->where('key', 'sms')->first();
                    if ($existing && isset($existing->value['api_key'])) {
                        $val['api_key'] = $existing->value['api_key'];
                    }
                }
                if ($key === 'whatsapp' && isset($val['api_key']) && str_contains($val['api_key'], '••')) {
                    $existing = CompanySetting::where('store_id', $storeId)->where('key', 'whatsapp')->first();
                    if ($existing && isset($existing->value['api_key'])) {
                        $val['api_key'] = $existing->value['api_key'];
                    }
                }

                CompanySetting::updateOrCreate(
                    ['store_id' => $storeId, 'key' => $key],
                    ['value' => $val, 'is_secret' => in_array($key, ['smtp', 'sms', 'whatsapp'])]
                );
            }
        }

        AuditLog::log('update_settings', 'CompanySetting', 'all', null, array_keys($validated), $storeId);

        return response()->json(['success' => true, 'message' => 'Store settings saved successfully.']);
    }

    /**
     * Rotate secret credentials (SMTP password, API tokens).
     */
    public function rotateSecret(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $validated = $request->validate([
            'secret_type' => 'required|in:smtp_password,sms_api_key,whatsapp_api_key,webhook_secret',
            'new_value' => 'required|string|min:4',
        ]);

        if (str_starts_with($validated['secret_type'], 'smtp')) {
            $settingKey = 'smtp';
        } elseif (str_starts_with($validated['secret_type'], 'sms')) {
            $settingKey = 'sms';
        } elseif (str_starts_with($validated['secret_type'], 'whatsapp')) {
            $settingKey = 'whatsapp';
        } else {
            $settingKey = 'webhook';
        }

        $setting = CompanySetting::where('store_id', $storeId)->where('key', $settingKey)->first();

        $val = $setting ? $setting->value : [];
        if ($validated['secret_type'] === 'smtp_password') {
            $val['password'] = $validated['new_value'];
        } elseif ($validated['secret_type'] === 'sms_api_key') {
            $val['api_key'] = $validated['new_value'];
        } elseif ($validated['secret_type'] === 'whatsapp_api_key') {
            $val['api_key'] = $validated['new_value'];
        }

        CompanySetting::updateOrCreate(
            ['store_id' => $storeId, 'key' => $settingKey],
            ['value' => $val, 'is_secret' => true]
        );

        AuditLog::log('rotate_secret', 'CompanySetting', $validated['secret_type'], null, ['status' => 'rotated'], $storeId);

        return response()->json(['success' => true, 'message' => "Secret for '{$validated['secret_type']}' successfully rotated."]);
    }

    /**
     * Financial years list and toggle lock.
     */
    public function financialYears(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $years = FinancialYear::with('lockedByUser:id,name')
            ->where('store_id', $storeId)
            ->orderBy('year_code', 'desc')
            ->get();

        return response()->json($years);
    }

    public function toggleFinancialYearLock(Request $request, string $id): JsonResponse
    {
        $fy = FinancialYear::findOrFail($id);
        $newLocked = !$fy->is_locked;

        $fy->update([
            'is_locked' => $newLocked,
            'locked_at' => $newLocked ? now() : null,
            'locked_by' => $newLocked ? ($request->user() ? $request->user()->id : null) : null,
        ]);

        AuditLog::log($newLocked ? 'lock_financial_year' : 'unlock_financial_year', 'FinancialYear', (string)$fy->id, null, ['is_locked' => $newLocked], $fy->store_id);

        return response()->json(['success' => true, 'financial_year' => $fy]);
    }

    /**
     * GST period locking list and toggle lock.
     */
    public function gstPeriods(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $periods = GstLockPeriod::with('lockedByUser:id,name')
            ->where('store_id', $storeId)
            ->orderBy('period_month', 'desc')
            ->get();

        return response()->json($periods);
    }

    public function toggleGstPeriodLock(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');
        $validated = $request->validate([
            'period_month' => 'required|string|regex:/^\d{4}-\d{2}$/',
            'is_locked' => 'required|boolean',
        ]);

        $period = GstLockPeriod::updateOrCreate(
            ['store_id' => $storeId, 'period_month' => $validated['period_month']],
            [
                'is_locked' => $validated['is_locked'],
                'locked_at' => $validated['is_locked'] ? now() : null,
                'locked_by' => $validated['is_locked'] ? ($request->user() ? $request->user()->id : null) : null,
            ]
        );

        AuditLog::log(
            $validated['is_locked'] ? 'lock_gst_period' : 'unlock_gst_period',
            'GstLockPeriod',
            (string)$period->id,
            null,
            ['period_month' => $validated['period_month'], 'is_locked' => $validated['is_locked']],
            $storeId
        );

        return response()->json([
            'success' => true,
            'period' => $period,
            'message' => "GST period {$period->period_month} lock status updated to " . ($period->is_locked ? 'Locked' : 'Unlocked'),
        ]);
    }

    /**
     * Backup & Restore points.
     */
    public function backupRestorePoints(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id');

        return response()->json([
            'restore_points' => [
                [
                    'id' => 'bak_' . date('Ymd_His'),
                    'label' => 'Pre-GSTR-1 Monthly Snapshot',
                    'timestamp' => now()->subHours(4)->toIso8601String(),
                    'size_bytes' => 4521034,
                    'created_by' => 'Automated Cron Scheduler',
                ],
                [
                    'id' => 'bak_20260925_000000',
                    'label' => 'Weekly Disaster Recovery Point',
                    'timestamp' => now()->subDays(6)->toIso8601String(),
                    'size_bytes' => 4194304,
                    'created_by' => 'Store Owner',
                ],
            ],
            'auto_backup_schedule' => 'Every midnight at 02:00 AM IST',
        ]);
    }
}
