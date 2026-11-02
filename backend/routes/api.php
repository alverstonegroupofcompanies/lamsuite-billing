<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AdminAuthController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\AdminStoreController;
use App\Http\Controllers\Api\AdminDeviceController;
use App\Http\Controllers\Api\AdminFeatureController;
use App\Http\Controllers\Api\AdminUserController;
use App\Http\Controllers\Api\AdminMasterController;
use App\Http\Controllers\Api\AdminTransactionController;
use App\Http\Controllers\Api\AdminInventoryController;
use App\Http\Controllers\Api\AdminReportController;
use App\Http\Controllers\Api\AdminSyncController;
use App\Http\Controllers\Api\AdminSettingController;
use App\Http\Controllers\Api\AdminAuditController;
use App\Http\Controllers\Api\AdminNotificationController;
use App\Http\Controllers\Api\StoreController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\StockController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\PrintController;
use App\Http\Controllers\Api\DataExchangeController;
use App\Http\Controllers\Api\MigrationController;
use App\Http\Controllers\Api\CounterController;
use App\Http\Controllers\Api\DesktopUpdateController;
use App\Http\Controllers\Api\HeldBillController;
use App\Http\Controllers\Api\StaffAuthController;
use App\Http\Controllers\Api\DeviceSessionController;

/*
|--------------------------------------------------------------------------
| Public Authentication & Device Onboarding
|--------------------------------------------------------------------------
*/
Route::post('/login', [AdminAuthController::class, 'login']);
Route::post('/auth/login', [AdminAuthController::class, 'login']);
Route::post('/devices/register', [AuthController::class, 'registerDevice']);
Route::post('/devices/register-owner', [AuthController::class, 'registerDeviceWithOwner']);
Route::match(['get', 'post'], '/devices/validate', [AuthController::class, 'validateToken']);
Route::post('/counters/enroll', [CounterController::class, 'enroll']);
Route::get('/counters/enrollment-status/{device_uuid}', [CounterController::class, 'checkEnrollmentStatus']);
Route::post('/counters/approve-pairing', [CounterController::class, 'approvePairing']);
Route::get('/counters/{id}/watch', [CounterController::class, 'watch']);
Route::get('/counters', [CounterController::class, 'index']);
Route::get('/branches', [AuthController::class, 'branches']);
Route::get('/license/check', [AuthController::class, 'checkLicense']);

// Staff Terminal Authentication & Offline Hash Cache
Route::post('/staff/login', [StaffAuthController::class, 'login']);
Route::get('/staff/offline-cache', [StaffAuthController::class, 'offlineCache']);
Route::post('/staff/admin-unlock', [StaffAuthController::class, 'adminUnlock']);
Route::post('/sync/push/batch', [SyncController::class, 'pushBatch']);
Route::post('/sync/push/invoices', [SyncController::class, 'pushInvoices']);
Route::post('/sync/push/stock-events', [SyncController::class, 'pushStockEvents']);
Route::post('/sync/push/purchases', [SyncController::class, 'pushPurchases']);
Route::post('/sync/push/parties', [SyncController::class, 'pushParties']);
Route::post('/sync/push/products', [SyncController::class, 'pushProducts']);
Route::post('/sync/push/adjustments', [SyncController::class, 'pushAdjustments']);
Route::post('/sync/push/transfers', [SyncController::class, 'pushTransfers']);
Route::post('/sync/push/staff', [SyncController::class, 'pushStaff']);
Route::get('/sync/pull/deltas', [SyncController::class, 'pullDeltas']);

// Centralized Device Session Tracking & Logged-In Devices (Item 2)
Route::get('/device-sessions', [DeviceSessionController::class, 'index']);
Route::get('/devices/logged-in', [DeviceSessionController::class, 'index']);
Route::get('/devices/connected', [DeviceSessionController::class, 'index']);
Route::post('/device-sessions/heartbeat', [DeviceSessionController::class, 'heartbeat']);
Route::post('/devices/heartbeat', [DeviceSessionController::class, 'heartbeat']);
Route::post('/device-sessions/logout', [DeviceSessionController::class, 'logout']);
Route::post('/devices/logout', [DeviceSessionController::class, 'logout']);
Route::post('/device-sessions/{id}/rename', [DeviceSessionController::class, 'rename']);
Route::post('/device-sessions/{id}/lock', [DeviceSessionController::class, 'lock']);
Route::post('/device-sessions/{id}/unlock', [DeviceSessionController::class, 'unlock']);
Route::post('/device-sessions/{id}/revoke', [DeviceSessionController::class, 'revoke']);
Route::post('/device-sessions/{id}/force-logout', [DeviceSessionController::class, 'forceLogout']);
Route::post('/devices/sessions/{id}/expire', [DeviceSessionController::class, 'expireSession']);
Route::post('/devices/sessions/{id}/logout', [DeviceSessionController::class, 'expireSession']);
Route::post('/staff/logout', [StaffAuthController::class, 'logout']);

Route::get('/sync/stream', [SyncController::class, 'streamSSE']);
Route::post('/invoices/{id}/lock', [SyncController::class, 'lockInvoice']);
Route::post('/invoices/{id}/unlock', [SyncController::class, 'unlockInvoice']);
Route::get('/invoices', [InvoiceController::class, 'index']);
Route::post('/invoices', [InvoiceController::class, 'store']);
Route::get('/invoices/{id}', [InvoiceController::class, 'show']);
Route::post('/invoices/{id}/cancel', [InvoiceController::class, 'cancel']);

// Distributed Live Held Bills across all counters
Route::get('/held-bills', [HeldBillController::class, 'index']);
Route::post('/held-bills', [HeldBillController::class, 'store']);
Route::post('/held-bills/{id}/claim', [HeldBillController::class, 'claim']);
Route::delete('/held-bills/{id}', [HeldBillController::class, 'destroy']);

// Counter series sequence block lease
Route::post('/counters/{id}/lease-sequence', [CounterController::class, 'leaseSequence']);

Route::get('/inventory/negative-stock-report', [SyncController::class, 'getNegativeStockReport']);
Route::post('/counters/{id}/shifts/open', [CounterController::class, 'openShift']);
Route::post('/counters/{id}/shifts/close', [CounterController::class, 'closeShift']);
Route::post('/counters/{id}/status', [CounterController::class, 'updateStatus']);
Route::post('/stores/day-close', [CounterController::class, 'closeStoreDay']);

// Desktop Tauri Updater Manifest Endpoints
Route::get('/app/update/latest.json', [DesktopUpdateController::class, 'getLatestManifest']);
Route::get('/app/update/latest-legacy-win7.json', [DesktopUpdateController::class, 'getLegacyManifest']);
Route::get('/app/update/{target}/{current_version}', [DesktopUpdateController::class, 'checkDynamicUpdate']);

/*
|--------------------------------------------------------------------------
| Desktop Client Protected Store Operations (Sanctum Authenticated)
|--------------------------------------------------------------------------
*/
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/store', [StoreController::class, 'show']);
    Route::put('/store', [StoreController::class, 'update']);

    Route::get('/customers', [CustomerController::class, 'index']);
    Route::post('/customers', [CustomerController::class, 'store']);
    Route::get('/customers/{id}', [CustomerController::class, 'show']);
    Route::put('/customers/{id}', [CustomerController::class, 'update']);

    Route::get('/products', [ProductController::class, 'index']);
    Route::post('/products', [ProductController::class, 'store']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
    Route::put('/products/{id}', [ProductController::class, 'update']);
    Route::delete('/products/{id}', [ProductController::class, 'destroy']);
    Route::post('/products/{id}/batches', [ProductController::class, 'addBatch']);

    Route::get('/purchases', [PurchaseController::class, 'index']);
    Route::post('/purchases', [PurchaseController::class, 'store']);
    Route::get('/purchases/{id}', [PurchaseController::class, 'show']);

    Route::post('/stock/adjustments', [StockController::class, 'recordAdjustment']);
    Route::get('/stock/transfers', [StockController::class, 'listTransfers']);
    Route::post('/stock/transfers', [StockController::class, 'dispatchTransfer']);
    Route::post('/stock/transfers/{id}/receive', [StockController::class, 'receiveTransfer']);
    Route::post('/stock/transfers/{id}/cancel', [StockController::class, 'cancelTransfer']);
    Route::get('/stock/batches/near-expiry', [StockController::class, 'nearExpiry']);
    Route::get('/stock/products/low-stock', [StockController::class, 'lowStock']);



    Route::get('/reports/daily-collection', [ReportController::class, 'dailyCollection']);
    Route::get('/reports/top-selling', [ReportController::class, 'topSelling']);
    Route::get('/reports/cash-book', [ReportController::class, 'cashBook']);
    Route::get('/reports/daily-summary', [ReportController::class, 'dailySummary']);
    Route::get('/reports/profit', [ReportController::class, 'profit']);
    Route::get('/reports/stock-ledger', [ReportController::class, 'stockLedger']);
    Route::get('/reports/gstr-1', [ReportController::class, 'gstr1']);
    Route::get('/reports/hsn-summary', [ReportController::class, 'hsnSummary']);
    Route::get('/reports/customer-aging', [ReportController::class, 'customerAging']);
    Route::get('/reports/tax-reconciliation', [ReportController::class, 'taxReconciliation']);
    Route::get('/dashboard/metrics', [ReportController::class, 'dashboardMetrics']);
    Route::post('/staff/change-password', [StaffAuthController::class, 'changePassword']);

    // Data Exchange (Universal Import / Export)
    Route::post('/data-exchange/preview', [DataExchangeController::class, 'preview']);
    Route::post('/data-exchange/commit', [DataExchangeController::class, 'commit']);
    Route::get('/data-exchange/templates/{type}', [DataExchangeController::class, 'template']);
    Route::get('/data-exchange/export/{type}', [DataExchangeController::class, 'export']);
    Route::get('/data-exchange/history', [DataExchangeController::class, 'history']);

    // Payments & Returns API (MCP client parity)
    Route::post('/payments/customer', [AdminTransactionController::class, 'customerPayments']);
    Route::post('/payments/supplier', [AdminTransactionController::class, 'storeSupplierPayment']);
    Route::post('/returns/sales', [AdminTransactionController::class, 'returns']);
    Route::post('/returns/purchase', [AdminTransactionController::class, 'purchaseReturns']);
});

/*
|--------------------------------------------------------------------------
| Web Admin Panel API (Sanctum + Tenant Scoping + RBAC + IP Allowlist)
|--------------------------------------------------------------------------
*/
// Alias for backwards compatibility / un-prefixed store operations
Route::middleware(['auth:sanctum', 'session.timeout', 'ip.allowlist', 'scope.store'])
    ->post('/stores/{id}/regenerate-key', [AdminStoreController::class, 'regenerateKey'])
    ->middleware('rbac:stores,edit');

Route::middleware(['auth:sanctum', 'session.timeout', 'ip.allowlist', 'scope.store'])->prefix('admin')->group(function () {
    // Auth, 2FA, Sessions & Impersonation
    Route::get('/me', [AdminAuthController::class, 'me']);
    Route::post('/logout', [AdminAuthController::class, 'logout']);
    Route::post('/2fa/setup', [AdminAuthController::class, 'setup2fa']);
    Route::post('/2fa/enable', [AdminAuthController::class, 'enable2fa']);
    Route::post('/2fa/disable', [AdminAuthController::class, 'disable2fa']);
    Route::post('/impersonate', [AdminAuthController::class, 'impersonate']);
    Route::post('/stop-impersonate', [AdminAuthController::class, 'stopImpersonate']);
    Route::post('/switch-store', [AdminAuthController::class, 'switchStore']);
    Route::post('/password-reset', [AdminAuthController::class, 'resetPassword']);
    Route::get('/sessions', [AdminAuthController::class, 'activeSessions']);
    Route::post('/sessions/{id}/logout', [AdminAuthController::class, 'forceLogoutSession']);

    // Module 1: Dashboard
    Route::get('/dashboard', [AdminDashboardController::class, 'index'])->middleware('rbac:dashboard,view');

    // Module 2: Stores
    Route::get('/stores', [AdminStoreController::class, 'index'])->middleware('rbac:stores,view');
    Route::post('/stores', [AdminStoreController::class, 'store'])->middleware('rbac:stores,create');
    Route::get('/stores/{id}', [AdminStoreController::class, 'show'])->middleware('rbac:stores,view');
    Route::put('/stores/{id}', [AdminStoreController::class, 'update'])->middleware('rbac:stores,edit');
    Route::post('/stores/{id}/toggle-status', [AdminStoreController::class, 'toggleStatus'])->middleware('rbac:stores,edit');
    Route::post('/stores/{id}/regenerate-key', [AdminStoreController::class, 'regenerateKey'])->middleware('rbac:stores,edit');
    Route::post('/stores/{id}/reset', [AdminStoreController::class, 'resetStore'])->middleware('rbac:stores,delete');

    // Module 3: Devices / Counters
    Route::get('/devices', [AdminDeviceController::class, 'index'])->middleware('rbac:devices,view');
    Route::get('/devices/audit/rogue', [AdminDeviceController::class, 'auditRogueRegistrations'])->middleware('rbac:devices,view');
    Route::post('/devices/audit/purge/{id}', [AdminDeviceController::class, 'purgeRogueDevice'])->middleware('rbac:devices,edit');
    Route::post('/devices/{id}/status', [AdminDeviceController::class, 'updateStatus'])->middleware('rbac:devices,edit');
    Route::post('/devices/{id}/force-resync', [AdminDeviceController::class, 'forceResync'])->middleware('rbac:devices,edit');
    Route::get('/counters', [CounterController::class, 'index'])->middleware('rbac:devices,view');
    Route::post('/counters/approve-pairing', [CounterController::class, 'approvePairing'])->middleware('rbac:devices,edit');
    Route::post('/counters/{id}/status', [CounterController::class, 'updateStatus'])->middleware('rbac:devices,edit');
    Route::post('/counters/{id}/settings', [CounterController::class, 'updateSettings'])->middleware('rbac:devices,edit');
    Route::post('/counters/{id}/lease-sequence', [CounterController::class, 'leaseSequence'])->middleware('rbac:devices,edit');

    // Module 4: Menu & Feature Control
    Route::get('/stores/{id}/features', [AdminFeatureController::class, 'show'])->middleware('rbac:features,view');
    Route::put('/stores/{id}/features', [AdminFeatureController::class, 'update'])->middleware('rbac:features,edit');

    // Module 5: Users & Roles
    Route::get('/users', [AdminUserController::class, 'index'])->middleware('rbac:users,view');
    Route::post('/users', [AdminUserController::class, 'store'])->middleware('rbac:users,create');
    Route::get('/users/login-diagnostics', [AdminUserController::class, 'loginDiagnostics'])->middleware('rbac:users,view');
    Route::get('/users/{id}', [AdminUserController::class, 'show'])->middleware('rbac:users,view');
    Route::put('/users/{id}', [AdminUserController::class, 'update'])->middleware('rbac:users,edit');
    Route::delete('/users/{id}', [AdminUserController::class, 'destroy'])->middleware('rbac:users,delete');
    Route::post('/users/{id}/toggle-biometric', [AdminUserController::class, 'toggleBiometric'])->middleware('rbac:users,edit');
    Route::post('/users/{id}/force-logout', [AdminUserController::class, 'forceLogout'])->middleware('rbac:users,edit');
    Route::post('/users/{id}/unlock', [AdminUserController::class, 'unlock'])->middleware('rbac:users,edit');
    Route::post('/users/{id}/lock', [AdminUserController::class, 'lock'])->middleware('rbac:users,edit');
    Route::post('/users/{id}/reset-pin', [AdminUserController::class, 'resetPin'])->middleware('rbac:users,edit');

    // Module 6: Master Data
    Route::get('/products', [AdminMasterController::class, 'products'])->middleware('rbac:masters,view');
    Route::post('/products', [AdminMasterController::class, 'storeProduct'])->middleware('rbac:masters,create');
    Route::put('/products/{id}', [AdminMasterController::class, 'updateProduct'])->middleware('rbac:masters,edit');
    Route::post('/products/{id}/batches', [AdminMasterController::class, 'addBatch'])->middleware('rbac:masters,create');
    Route::post('/products/bulk-edit', [AdminMasterController::class, 'bulkEditProducts'])->middleware('rbac:masters,edit');

    Route::get('/lookups', [AdminMasterController::class, 'lookups'])->middleware('rbac:masters,view');
    Route::post('/lookups', [AdminMasterController::class, 'storeLookup'])->middleware('rbac:masters,create');

    Route::get('/parties', [AdminMasterController::class, 'parties'])->middleware('rbac:masters,view');
    Route::post('/parties', [AdminMasterController::class, 'storeParty'])->middleware('rbac:masters,create');
    Route::put('/parties/{id}', [AdminMasterController::class, 'updateParty'])->middleware('rbac:masters,edit');

    Route::post('/masters/merge', [AdminMasterController::class, 'mergeDuplicates'])->middleware('rbac:masters,edit');
    Route::post('/masters/import', [AdminMasterController::class, 'import'])->middleware('rbac:masters,create');

    // Module 7: Transactions
    Route::get('/invoices', [AdminTransactionController::class, 'invoices'])->middleware('rbac:transactions,view');
    Route::get('/invoices/{id}', [AdminTransactionController::class, 'showInvoice'])->middleware('rbac:transactions,view');
    Route::post('/invoices/{id}/cancel', [AdminTransactionController::class, 'cancelInvoice'])->middleware('rbac:transactions,edit');
    Route::put('/invoices/{id}', [AdminTransactionController::class, 'updateInvoice'])->middleware('rbac:transactions,edit');

    Route::get('/returns', [AdminTransactionController::class, 'returns'])->middleware('rbac:transactions,view');
    Route::get('/quotations', [AdminTransactionController::class, 'quotations'])->middleware('rbac:transactions,view');

    Route::get('/purchases', [AdminTransactionController::class, 'purchases'])->middleware('rbac:transactions,view');
    Route::get('/purchases/{id}', [AdminTransactionController::class, 'showPurchase'])->middleware('rbac:transactions,view');
    Route::get('/purchase-returns', [AdminTransactionController::class, 'purchaseReturns'])->middleware('rbac:transactions,view');
    Route::get('/purchase-orders', [AdminTransactionController::class, 'purchaseOrders'])->middleware('rbac:transactions,view');

    Route::get('/held-bills', [AdminTransactionController::class, 'heldBills'])->middleware('rbac:transactions,view');
    Route::get('/held-bills/{id}', [AdminTransactionController::class, 'showHeldBill'])->middleware('rbac:transactions,view');

    Route::get('/shifts', [AdminTransactionController::class, 'shifts'])->middleware('rbac:transactions,view');

    Route::get('/stock/adjustments', [AdminTransactionController::class, 'stockAdjustments'])->middleware('rbac:transactions,view');
    Route::get('/stock/transfers', [AdminTransactionController::class, 'stockTransfers'])->middleware('rbac:transactions,view');
    Route::get('/expenses', [AdminTransactionController::class, 'expenses'])->middleware('rbac:transactions,view');
    Route::get('/customer-payments', [AdminTransactionController::class, 'customerPayments'])->middleware('rbac:transactions,view');
    Route::get('/supplier-payments', [AdminTransactionController::class, 'supplierPayments'])->middleware('rbac:transactions,view');
    Route::post('/supplier-payments', [AdminTransactionController::class, 'storeSupplierPayment'])->middleware('rbac:transactions,create');

    Route::get('/customers/{id}/ledger', [AdminTransactionController::class, 'customerLedger'])->middleware('rbac:transactions,view');
    Route::get('/suppliers/{id}/ledger', [AdminTransactionController::class, 'supplierLedger'])->middleware('rbac:transactions,view');

    // Module 8: Inventory
    Route::get('/inventory/batches', [AdminInventoryController::class, 'batchInventory'])->middleware('rbac:inventory,view');
    Route::get('/inventory/ledger', [AdminInventoryController::class, 'stockLedger'])->middleware('rbac:inventory,view');
    Route::get('/inventory/near-expiry', [AdminInventoryController::class, 'nearExpiry'])->middleware('rbac:inventory,view');
    Route::post('/inventory/transfers/dispatch', [AdminInventoryController::class, 'dispatchTransfer'])->middleware('rbac:inventory,create');
    Route::post('/inventory/transfers/{id}/receive', [AdminInventoryController::class, 'receiveTransfer'])->middleware('rbac:inventory,edit');
    Route::post('/inventory/reconcile', [AdminInventoryController::class, 'reconcileStock'])->middleware('rbac:inventory,edit');

    // Module 9: Reports (Accessible to Accountant & Managers)
    Route::get('/reports/sales', [AdminReportController::class, 'salesSummary'])->middleware('rbac:reports,view');
    Route::get('/reports/gstr1', [AdminReportController::class, 'gstr1'])->middleware('rbac:reports,view');
    Route::get('/reports/customer-aging', [AdminReportController::class, 'customerAging'])->middleware('rbac:reports,view');
    Route::get('/reports/pharmacy', [AdminReportController::class, 'pharmacyReport'])->middleware('rbac:reports,view');
    Route::get('/reports/scheduled', [AdminReportController::class, 'scheduledReports'])->middleware('rbac:reports,view');
    Route::get('/reports/daily-collection', [ReportController::class, 'dailyCollection'])->middleware('rbac:reports,view');
    Route::get('/reports/top-selling', [ReportController::class, 'topSelling'])->middleware('rbac:reports,view');
    Route::get('/reports/cash-book', [ReportController::class, 'cashBook'])->middleware('rbac:reports,view');
    Route::get('/reports/daily-summary', [ReportController::class, 'dailySummary'])->middleware('rbac:reports,view');
    Route::get('/reports/profit', [ReportController::class, 'profit'])->middleware('rbac:reports,view');
    Route::get('/reports/stock-ledger', [ReportController::class, 'stockLedger'])->middleware('rbac:reports,view');
    Route::get('/reports/tax-reconciliation', [ReportController::class, 'taxReconciliation'])->middleware('rbac:reports,view');

    // Module 10: Sync Center
    Route::get('/sync/events', [AdminSyncController::class, 'index'])->middleware('rbac:sync,view');
    Route::post('/sync/events/{id}/resolve', [AdminSyncController::class, 'resolveConflict'])->middleware('rbac:sync,edit');
    Route::post('/sync/events/{id}/retry', [AdminSyncController::class, 'retry'])->middleware('rbac:sync,edit');
    Route::get('/sync/diagnostics', [AdminSyncController::class, 'diagnostics'])->middleware('rbac:sync,view');

    // Module 11: Settings
    Route::get('/settings', [AdminSettingController::class, 'index'])->middleware('rbac:settings,view');
    Route::post('/settings', [AdminSettingController::class, 'update'])->middleware('rbac:settings,edit');
    Route::post('/settings/rotate-secret', [AdminSettingController::class, 'rotateSecret'])->middleware('rbac:settings,edit');
    Route::get('/settings/financial-years', [AdminSettingController::class, 'financialYears'])->middleware('rbac:settings,view');
    Route::post('/settings/financial-years/{id}/toggle-lock', [AdminSettingController::class, 'toggleFinancialYearLock'])->middleware('rbac:settings,edit');
    Route::get('/settings/gst-periods', [AdminSettingController::class, 'gstPeriods'])->middleware('rbac:settings,view');
    Route::post('/settings/gst-periods/toggle-lock', [AdminSettingController::class, 'toggleGstPeriodLock'])->middleware('rbac:settings,edit');
    Route::get('/settings/backup-restore', [AdminSettingController::class, 'backupRestorePoints'])->middleware('rbac:settings,view');
    Route::get('/settings/min-app-version', [DesktopUpdateController::class, 'getMinVersion'])->middleware('rbac:settings,view');
    Route::post('/settings/min-app-version', [DesktopUpdateController::class, 'setMinVersion'])->middleware('rbac:settings,edit');

    // Module 12: Audit Log (Read-only)
    Route::get('/audit-logs', [AdminAuditController::class, 'index'])->middleware('rbac:audit,view');

    // Module 13: Notifications
    Route::get('/notifications', [AdminNotificationController::class, 'index'])->middleware('rbac:notifications,view');
    Route::post('/notifications/{id}/read', [AdminNotificationController::class, 'markAsRead'])->middleware('rbac:notifications,view');
    Route::post('/notifications/mark-all-read', [AdminNotificationController::class, 'markAllAsRead'])->middleware('rbac:notifications,view');
    Route::post('/notifications/check-alerts', [AdminNotificationController::class, 'checkAlerts'])->middleware('rbac:notifications,view');

    // Module 14: Print & Vector PDF Parity
    Route::post('/print/render-pdf', [PrintController::class, 'renderPdf']);
    Route::get('/print/templates', [PrintController::class, 'syncTemplates']);
    Route::post('/print/history', [PrintController::class, 'recordHistory']);

    // Module 15: Universal Data Exchange
    Route::post('/data-exchange/preview', [DataExchangeController::class, 'preview'])->middleware('rbac:masters,create');
    Route::post('/data-exchange/commit', [DataExchangeController::class, 'commit'])->middleware('rbac:masters,create');
    Route::get('/data-exchange/templates/{type}', [DataExchangeController::class, 'template'])->middleware('rbac:masters,view');
    Route::get('/data-exchange/export/{type}', [DataExchangeController::class, 'export'])->middleware('rbac:masters,view');
    Route::get('/data-exchange/history', [DataExchangeController::class, 'history'])->middleware('rbac:audit,view');

    // Module 16: Data Migration Engine
    Route::get('/migrations', [MigrationController::class, 'index']);
    Route::post('/migrations/precheck', [MigrationController::class, 'precheck']);
    Route::post('/migrations/start', [MigrationController::class, 'start']);
    Route::get('/migrations/{uuid}', [MigrationController::class, 'show']);
    Route::post('/migrations/{uuid}/reconcile', [MigrationController::class, 'reconcile']);
    Route::post('/migrations/{uuid}/rollback', [MigrationController::class, 'rollback']);
    Route::post('/migrations/{uuid}/cutover', [MigrationController::class, 'cutover']);
});
