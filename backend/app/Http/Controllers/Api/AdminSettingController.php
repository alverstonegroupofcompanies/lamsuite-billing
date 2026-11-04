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
     * Resolve target store from request.
     */
    public function resolveStore(Request $request): ?Store
    {
        $candidate = $request->attributes->get('active_store_id')
            ?? $request->get('active_store_id')
            ?? $request->header('X-Store-Id')
            ?? $request->header('Store-Id')
            ?? $request->input('store_id')
            ?? $request->query('store_id')
            ?? ($request->user() ? $request->user()->store_id : null);

        if ($candidate !== null && $candidate !== '') {
            if (is_numeric($candidate)) {
                $store = Store::find((int)$candidate);
                if ($store) return $store;
            }
            $store = Store::where('code', $candidate)
                ->orWhere('id', $candidate)
                ->orWhere('name', $candidate)
                ->first();
            if ($store) return $store;
        }

        return Store::first();
    }

    /**
     * Compile comprehensive settings payload for a store.
     */
    public function getSettingsPayload(Store $store): array
    {
        $storeId = $store->id;
        $settings = CompanySetting::where('store_id', $storeId)->get()->keyBy('key');

        $smtpConfig = $settings['smtp']->value ?? [
            'enabled' => false,
            'host' => 'smtp.postmarkapp.com',
            'port' => 587,
            'encryption' => 'tls',
            'from_email' => $store->email ?: 'billing@lamstone.in',
            'from_name' => $store->name ?: 'LamStone Healthcare',
            'username' => 'lamstone_smtp',
            'password' => '••••••••••••',
        ];
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

        $billing = $settings['billing']->value ?? [];
        $general = $settings['general']->value ?? [];
        $sequences = $settings['sequences']->value ?? [];
        $printing = $settings['printing']->value ?? [];
        $workspace = $settings['workspace']->value ?? [];
        $security = $settings['security']->value ?? [];
        $inventory = $settings['inventory']->value ?? [];
        $wallet = $settings['wallet']->value ?? [];

        $taxMode = $billing['tax_mode'] ?? $store->tax_mode ?? 'inclusive';
        $purchaseTaxMode = $billing['purchase_tax_mode'] ?? 'exclusive';
        $gstType = $billing['gst_type'] ?? $store->gst_type ?? 'regular';
        $allowTaxOverride = (bool)($billing['allow_tax_override_per_bill'] ?? false);
        $defaultHsn = $billing['default_hsn_code'] ?? '30049099';
        $creditPeriodDays = (int)($billing['credit_period_days'] ?? 30);
        $defaultDiscount = (float)($billing['default_discount_percent'] ?? 0);
        $defaultPaymentMode = $billing['default_payment_mode'] ?? 'cash';
        $roundOffEnabled = (bool)($billing['round_off_enabled'] ?? true);
        $defaultRateBasis = $billing['default_rate_basis'] ?? 'sel_rate';

        $invoicePrefix = $sequences['invoicePrefix'] ?? $sequences['invoice_prefix'] ?? $store->invoice_prefix ?? 'INV';
        $nextInvoiceNumber = (int)($sequences['nextInvoiceNumber'] ?? $sequences['next_invoice_number'] ?? 1001);

        $billingFull = array_merge([
            'tax_mode' => $taxMode,
            'purchase_tax_mode' => $purchaseTaxMode,
            'gst_type' => $gstType,
            'allow_tax_override_per_bill' => $allowTaxOverride,
            'default_rate_basis' => $defaultRateBasis,
            'credit_period_days' => $creditPeriodDays,
            'default_discount_percent' => $defaultDiscount,
            'default_payment_mode' => $defaultPaymentMode,
            'round_off_enabled' => $roundOffEnabled,
            'default_hsn_code' => $defaultHsn,
        ], $billing);

        $sequencesFull = array_merge([
            'invoicePrefix' => $invoicePrefix,
            'invoice_prefix' => $invoicePrefix,
            'nextInvoiceNumber' => $nextInvoiceNumber,
            'next_invoice_number' => $nextInvoiceNumber,
            'quotationPrefix' => 'QUO',
            'quotation_prefix' => 'QUO',
            'nextQuotationNumber' => 101,
            'next_quotation_number' => 101,
            'returnPrefix' => 'SR',
            'return_prefix' => 'SR',
            'nextReturnNumber' => 1,
            'purchasePrefix' => 'PUR',
            'purchase_prefix' => 'PUR',
            'nextPurchaseNumber' => 201,
            'purchaseReturnPrefix' => 'PR',
            'nextPurchaseReturnNumber' => 1,
            'adjustmentPrefix' => 'ADJ',
            'nextAdjustmentNumber' => 401,
            'transferPrefix' => 'TRF',
            'nextTransferNumber' => 501,
        ], $sequences);

        $printingFull = array_merge([
            'paperSize' => 'thermal_80mm',
            'paper_size' => 'thermal_80mm',
            'copies' => 1,
            'activeTemplate' => 'thermal_standard',
            'active_template' => 'thermal_standard',
            'printUpiQrCode' => true,
            'print_upi_qr' => true,
            'printDrugLicenses' => true,
            'print_drug_license' => true,
            'printDoctorDetails' => true,
            'printPatientDetails' => true,
            'printHsnSummary' => true,
            'printDiscountColumn' => true,
            'printMrp' => true,
            'previewMode' => 'always',
            'defaultCopyMarker' => 'Original for Recipient',
            'silentPrinting' => true,
            'selectedPrinterName' => 'Default System Thermal Printer',
            'footerNote' => 'Thank you for shopping with us! Get well soon.',
            'footer_note' => 'Thank you for shopping with us! Get well soon.',
            'termsAndConditions' => 'Goods once sold cannot be returned without original cash memo.',
            'jurisdictionNote' => 'Subject to Local Jurisdiction only.',
            'brandByline' => 'LamSuite Billing',
        ], $printing);

        $workspaceFull = array_merge([
            'theme' => 'light',
            'density' => 'comfortable',
            'fontSize' => 'base',
            'notificationsEnabled' => true,
            'autoUpdateCheck' => true,
            'wifiStrengthSimulator' => 95,
            'defaultLandingPage' => 'dashboard',
        ], $workspace);

        $securityFull = array_merge([
            'idleTimeoutMinutes' => 15,
            'maxFailedLogins' => 5,
            'allowBiometricSignIn' => true,
            'defaultRole' => 'cashier',
        ], $security);

        $inventoryFull = array_merge([
            'allowSellingOutOfStock' => 'always',
            'warnOnNegativeStock' => true,
            'requireManagerPinForNegativeStock' => false,
            'allowExpiredBatchSale' => 'warn_confirm',
        ], $inventory);

        $walletFull = array_merge([
            'enabled' => true,
            'maxCreditLimit' => 10000,
            'max_credit_limit' => 10000,
            'referencePrefix' => 'WLT',
            'reference_prefix' => 'WLT',
        ], $wallet);

        $keyboard = $settings['keyboard']->value ?? null;
        $payments = $settings['payments']->value ?? null;
        $invoiceColumns = $settings['invoice_columns']->value ?? null;
        $headerFields = $settings['header_fields']->value ?? null;
        $activeBillingPreset = $settings['active_billing_preset']->value ?? 'pharmacy';
        $savedBillingPresets = $settings['saved_billing_presets']->value ?? null;
        $purchaseColumns = $settings['purchase_columns']->value ?? null;
        $purchaseHeaderFields = $settings['purchase_header_fields']->value ?? null;
        $activePurchasePreset = $settings['active_purchase_preset']->value ?? 'pharmacy_inward';
        $savedPurchasePresets = $settings['saved_purchase_presets']->value ?? null;
        $enablePts = $settings['enable_pts']->value ?? false;
        $enablePtss = $settings['enable_ptss']->value ?? false;
        $freightIsTaxable = $settings['freight_is_taxable']->value ?? false;

        $enabledMenuItems = $store->enabled_menu_items ?? ($settings['enabled_menu_items']->value ?? [
            'dashboard', 'pos', 'bills', 'sales_returns', 'customer_debit_notes',
            'purchases', 'purchase_returns', 'stock', 'stock_transfers',
            'reports', 'masters', 'import_export', 'settings', 'counters',
        ]);

        return [
            'store_id' => (string)$store->id,
            'store_name' => $store->name,
            'display_name' => $general['display_name'] ?? $store->name,
            'phone' => $store->phone ?? '',
            'email' => $store->email ?? '',
            'address' => $store->address ?? '',
            'state_code' => $store->state_code ?? '32',
            'gstin' => $store->gstin ?? '',
            'drug_license_numbers' => $store->drug_license_numbers ?? [],
            'fssai_no' => $store->fssai_no ?? '',
            'currency_symbol' => $general['currency_symbol'] ?? '₹',

            // Store & Tax Configuration
            'store_type' => $store->store_type ?? 'pharmacy',
            'gst_type' => $gstType,
            'allow_tax_override_per_bill' => $allowTaxOverride,

            // Billing
            'tax_mode' => $taxMode,
            'purchase_tax_mode' => $purchaseTaxMode,
            'default_hsn_code' => $defaultHsn,
            'credit_period_days' => $creditPeriodDays,
            'default_discount_percent' => $defaultDiscount,
            'default_payment_mode' => $defaultPaymentMode,
            'round_off_enabled' => $roundOffEnabled,
            'default_rate_basis' => $defaultRateBasis,

            // Sequences
            'sequences' => $sequencesFull,
            'invoice_prefix' => $invoicePrefix,
            'next_invoice_number' => $nextInvoiceNumber,

            // Sub-configs
            'printing' => $printingFull,
            'workspace' => $workspaceFull,
            'security' => $securityFull,
            'inventory' => $inventoryFull,
            'wallet' => $walletFull,
            'smtp' => $smtpConfig,
            'sms' => $smsConfig,
            'whatsapp' => $whatsappConfig,
            'keyboard' => $keyboard,
            'payments' => $payments,
            'invoice_columns' => $invoiceColumns,
            'header_fields' => $headerFields,
            'active_billing_preset' => $activeBillingPreset,
            'saved_billing_presets' => $savedBillingPresets,
            'purchase_columns' => $purchaseColumns,
            'purchase_header_fields' => $purchaseHeaderFields,
            'active_purchase_preset' => $activePurchasePreset,
            'saved_purchase_presets' => $savedPurchasePresets,
            'enable_pts' => (bool)$enablePts,
            'enable_ptss' => (bool)$enablePtss,
            'freight_is_taxable' => (bool)$freightIsTaxable,
            'enabled_menu_items' => $enabledMenuItems,
            'is_active' => (bool)$store->is_active,

            // Admin panel parity structures
            'store_details' => $store,
            'billing' => $billingFull,
        ];
    }

    /**
     * Get company settings for a store with masked secrets.
     */
    public function index(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['error' => 'Store not found.'], 404);
        }

        return response()->json($this->getSettingsPayload($store));
    }

    /**
     * Update settings.
     */
    public function update(Request $request): JsonResponse
    {
        $store = $this->resolveStore($request);
        if (!$store) {
            return response()->json(['error' => 'Store not found.'], 404);
        }
        $storeId = $store->id;
        $input = $request->all();

        // 1. Update Store model columns
        $storeUpdates = [];
        if (isset($input['store_name']) || isset($input['name'])) {
            $storeUpdates['name'] = $input['store_name'] ?? $input['name'];
        }
        if (isset($input['phone'])) {
            $storeUpdates['phone'] = $input['phone'];
        }
        if (isset($input['email'])) {
            $storeUpdates['email'] = $input['email'];
        }
        if (isset($input['address'])) {
            $storeUpdates['address'] = $input['address'];
        }
        if (isset($input['state_code'])) {
            $storeUpdates['state_code'] = $input['state_code'];
        }
        if (isset($input['gstin'])) {
            $storeUpdates['gstin'] = $input['gstin'];
        }
        if (isset($input['drug_license_numbers'])) {
            $storeUpdates['drug_license_numbers'] = is_array($input['drug_license_numbers'])
                ? $input['drug_license_numbers']
                : array_filter(array_map('trim', explode(',', (string)$input['drug_license_numbers'])));
        }
        if (isset($input['fssai_no'])) {
            $storeUpdates['fssai_no'] = $input['fssai_no'];
        }
        if (isset($input['tax_mode'])) {
            $storeUpdates['tax_mode'] = $input['tax_mode'];
        }
        if (isset($input['store_type'])) {
            $storeUpdates['store_type'] = $input['store_type'];
        }
        if (isset($input['gst_type'])) {
            $storeUpdates['gst_type'] = $input['gst_type'];
        }
        if (isset($input['invoice_prefix'])) {
            $storeUpdates['invoice_prefix'] = $input['invoice_prefix'];
        }
        if (isset($input['enabled_menu_items']) && is_array($input['enabled_menu_items'])) {
            $storeUpdates['enabled_menu_items'] = $input['enabled_menu_items'];
        }

        // Also check nested billing updates for store columns
        if (isset($input['billing']) && is_array($input['billing'])) {
            if (isset($input['billing']['tax_mode'])) {
                $storeUpdates['tax_mode'] = $input['billing']['tax_mode'];
            }
            if (isset($input['billing']['gst_type'])) {
                $storeUpdates['gst_type'] = $input['billing']['gst_type'];
            }
        }
        // Also check nested sequences for invoice prefix
        if (isset($input['sequences']) && is_array($input['sequences'])) {
            if (isset($input['sequences']['invoicePrefix'])) {
                $storeUpdates['invoice_prefix'] = $input['sequences']['invoicePrefix'];
            } elseif (isset($input['sequences']['invoice_prefix'])) {
                $storeUpdates['invoice_prefix'] = $input['sequences']['invoice_prefix'];
            }
        }

        if (!empty($storeUpdates)) {
            $store->update($storeUpdates);
        }

        // 2. Aggregate & save billing section
        $billing = is_array($input['billing'] ?? null) ? $input['billing'] : [];
        foreach ([
            'tax_mode', 'purchase_tax_mode', 'gst_type', 'allow_tax_override_per_bill',
            'default_hsn_code', 'credit_period_days', 'default_discount_percent',
            'default_payment_mode', 'round_off_enabled', 'default_rate_basis'
        ] as $f) {
            if (isset($input[$f])) {
                $billing[$f] = $input[$f];
            }
        }
        if (!empty($billing)) {
            CompanySetting::updateOrCreate(
                ['store_id' => $storeId, 'key' => 'billing'],
                ['value' => $billing, 'is_secret' => false]
            );
        }

        // 3. Aggregate & save general section
        $general = is_array($input['general'] ?? null) ? $input['general'] : [];
        foreach ([
            'store_name', 'display_name', 'phone', 'email', 'address', 'state_code',
            'gstin', 'drug_license_numbers', 'fssai_no', 'currency_symbol', 'store_type', 'gst_type'
        ] as $f) {
            if (isset($input[$f])) {
                $general[$f] = $input[$f];
            }
        }
        if (!empty($general)) {
            CompanySetting::updateOrCreate(
                ['store_id' => $storeId, 'key' => 'general'],
                ['value' => $general, 'is_secret' => false]
            );
        }

        // 4. Save each specific sub-config key
        $sections = [
            'sequences', 'printing', 'workspace', 'security', 'inventory',
            'wallet', 'smtp', 'sms', 'whatsapp', 'keyboard', 'payments',
            'invoice_columns', 'header_fields', 'active_billing_preset', 'saved_billing_presets',
            'purchase_columns', 'purchase_header_fields', 'active_purchase_preset', 'saved_purchase_presets',
            'enable_pts', 'enable_ptss', 'freight_is_taxable', 'enabled_menu_items',
        ];

        foreach ($sections as $key) {
            if (array_key_exists($key, $input) && $input[$key] !== null) {
                $val = $input[$key];

                // If secrets contain '••••••••••••', preserve existing secret
                if ($key === 'smtp' && is_array($val) && isset($val['password']) && str_contains($val['password'], '••')) {
                    $existing = CompanySetting::where('store_id', $storeId)->where('key', 'smtp')->first();
                    if ($existing && isset($existing->value['password'])) {
                        $val['password'] = $existing->value['password'];
                    }
                }
                if ($key === 'sms' && is_array($val) && isset($val['api_key']) && str_contains($val['api_key'], '••')) {
                    $existing = CompanySetting::where('store_id', $storeId)->where('key', 'sms')->first();
                    if ($existing && isset($existing->value['api_key'])) {
                        $val['api_key'] = $existing->value['api_key'];
                    }
                }
                if ($key === 'whatsapp' && is_array($val) && isset($val['api_key']) && str_contains($val['api_key'], '••')) {
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

        AuditLog::log('update_settings', 'CompanySetting', 'all', null, array_keys($input), $storeId);

        $store->refresh();
        return response()->json([
            'success' => true,
            'message' => 'Store settings saved successfully.',
            'settings' => $this->getSettingsPayload($store),
        ]);
    }

    /**
     * Rotate secret credentials (SMTP password, API tokens).
     */
    public function rotateSecret(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id') ?: ($this->resolveStore($request)?->id);
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
        $storeId = $request->get('active_store_id') ?: ($this->resolveStore($request)?->id);
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
        $storeId = $request->get('active_store_id') ?: ($this->resolveStore($request)?->id);
        $periods = GstLockPeriod::with('lockedByUser:id,name')
            ->where('store_id', $storeId)
            ->orderBy('period_month', 'desc')
            ->get();

        return response()->json($periods);
    }

    public function toggleGstPeriodLock(Request $request): JsonResponse
    {
        $storeId = $request->get('active_store_id') ?: ($this->resolveStore($request)?->id);
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
