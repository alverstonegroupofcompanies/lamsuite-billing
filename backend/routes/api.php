<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AdminAuthController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\AdminStoreController;
use App\Http\Controllers\Api\AdminDeviceController;
use App\Http\Controllers\Api\AdminFeatureController;
use App\Http\Controllers\Api\AdminUserController;
use App\Http\Controllers\Api\AdminMasterController;
use App\Http\Controllers\Api\AdminCatalogController;
use App\Http\Controllers\Api\AdminTransactionController;
use App\Http\Controllers\Api\AdminDayCloseController;
use App\Http\Controllers\Api\InvoiceApprovalController;
use App\Http\Controllers\Api\AdminInventoryController;
use App\Http\Controllers\Api\AdminReportController;
use App\Http\Controllers\Api\AdminSyncController;
use App\Http\Controllers\Api\AdminSettingController;
use App\Http\Controllers\Api\AdminBackupController;
use App\Http\Controllers\Api\AdminWebhookController;
use App\Http\Controllers\Api\AdminGiftCardController;
use App\Http\Controllers\Api\AdminSettlementController;
use App\Http\Controllers\Api\AdminComplianceController;
use App\Http\Controllers\Api\AdminPriceListController;
use App\Http\Controllers\Api\AdminSalesOrderController;
use App\Http\Controllers\Api\AdminLoyaltyController;
use App\Http\Controllers\Api\AdminAccountingExportController;
use App\Http\Controllers\Api\AdminGstWorkingPaperController;
use App\Http\Controllers\Api\AdminPortalController;
use App\Http\Controllers\Api\PortalController;
use App\Http\Controllers\Api\PaymentIntentController;
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
use App\Http\Controllers\Api\WhatsAppController;
use App\Http\Controllers\Api\UserPreferenceController;

/*
|--------------------------------------------------------------------------
| Public Authentication & Device Onboarding
|--------------------------------------------------------------------------
*/
Route::post('/login', [AdminAuthController::class, 'login']);
Route::post('/auth/login', [AdminAuthController::class, 'login']);
Route::post('/auth/forgot-password', [PasswordResetController::class, 'forgot'])->middleware('throttle:6,1');
Route::post('/auth/reset-password', [PasswordResetController::class, 'reset'])->middleware('throttle:6,1');
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
Route::post('/staff/login', [StaffAuthController::class, 'login'])->middleware('throttle:30,1,staff-login');
Route::get('/sync/pull/deltas', [SyncController::class, 'pullDeltas']);

// Workstation-scoped endpoints: the paired device token decides which store
// the request may read credentials from or write tenant data to.
Route::middleware('device.auth')->group(function () {
    Route::get('/staff/offline-cache', [StaffAuthController::class, 'offlineCache']);
    Route::post('/staff/admin-unlock', [StaffAuthController::class, 'adminUnlock'])->middleware('throttle:6,1,staff-admin-unlock');
    Route::post('/sync/push/batch', [SyncController::class, 'pushBatch']);
    Route::post('/sync/push/invoices', [SyncController::class, 'pushInvoices']);
    Route::post('/sync/push/stock-events', [SyncController::class, 'pushStockEvents']);
    Route::post('/sync/push/purchases', [SyncController::class, 'pushPurchases']);
    Route::post('/sync/push/parties', [SyncController::class, 'pushParties']);
    Route::post('/sync/push/products', [SyncController::class, 'pushProducts']);
    Route::post('/sync/push/adjustments', [SyncController::class, 'pushAdjustments']);
    Route::post('/sync/push/transfers', [SyncController::class, 'pushTransfers']);
    Route::post('/sync/push/staff', [SyncController::class, 'pushStaff']);
    Route::post('/sync/push/security-audit', [SyncController::class, 'pushSecurityAudit']);
});

// Central Store Configuration & Sync for all Terminals & Devices
Route::get('/settings', [AdminSettingController::class, 'index']);
Route::post('/settings', [AdminSettingController::class, 'update']);
Route::put('/settings', [AdminSettingController::class, 'update']);

// Centralized Device Session Tracking & Logged-In Devices (Item 2)
// Customer B2B Portal (bearer portal link issued by an admin)
Route::middleware('portal.auth')->prefix('portal')->group(function () {
    Route::get('/me', [PortalController::class, 'me']);
    Route::get('/invoices', [PortalController::class, 'invoices']);
    Route::get('/invoices/{id}', [PortalController::class, 'showInvoice'])->whereNumber('id');
    Route::get('/statement', [PortalController::class, 'statement']);
    Route::get('/catalog', [PortalController::class, 'catalog']);
    Route::get('/sales-orders', [PortalController::class, 'orders']);
    Route::post('/sales-orders', [PortalController::class, 'createOrder']);
    Route::post('/logout', [PortalController::class, 'logout']);
});

Route::get('/public-ip', [DeviceSessionController::class, 'publicIp']);
Route::get('/network/public-ip', [DeviceSessionController::class, 'publicIp']);
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
Route::post('/invoices/{id}/approvals/verify', [InvoiceApprovalController::class, 'verify']);

// Terminal Customer Lookups & Registration
Route::get('/customers', [CustomerController::class, 'index']);
Route::post('/customers', [CustomerController::class, 'store']);
Route::get('/customers/{id}', [CustomerController::class, 'show']);

// Customer-specific price list resolution for POS terminals
Route::get('/price-lists/resolve', [AdminPriceListController::class, 'resolve']);

// Electronic Dispatch & WhatsApp Gateway (OpenWA)
Route::post('/whatsapp/send-invoice', [WhatsAppController::class, 'sendInvoice']);
Route::post('/whatsapp/test-connection', [WhatsAppController::class, 'testConnection']);
Route::get('/whatsapp/sessions', [WhatsAppController::class, 'sessions']);
Route::get('/whatsapp/config', [WhatsAppController::class, 'getConfig']);

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
Route::get('/app/update/download/{filename}', [DesktopUpdateController::class, 'downloadUpdateBinary'])->where('filename', '[A-Za-z0-9._-]+');
Route::get('/app/update/{target}/{current_version}', [DesktopUpdateController::class, 'checkDynamicUpdate']);

/*
|--------------------------------------------------------------------------
| Desktop Client Protected Store Operations (Sanctum Authenticated)
|--------------------------------------------------------------------------
*/
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/store', [StoreController::class, 'show']);
    Route::put('/store', [StoreController::class, 'update']);

    Route::get('/me/preferences', [UserPreferenceController::class, 'show']);
    Route::put('/me/preferences', [UserPreferenceController::class, 'update']);

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

    // Sales orders taken at the counter (phone orders / delivery later)
    Route::get('/sales-orders', [AdminSalesOrderController::class, 'index']);
    Route::post('/sales-orders', [AdminSalesOrderController::class, 'store']);
    Route::get('/sales-orders/{id}', [AdminSalesOrderController::class, 'show'])->whereNumber('id');

    // Loyalty points & coupons at the counter
    Route::get('/loyalty/balance', [AdminLoyaltyController::class, 'balance']);
    Route::post('/loyalty/earn', [AdminLoyaltyController::class, 'earnPoints']);
    Route::post('/loyalty/redeem', [AdminLoyaltyController::class, 'redeemPoints']);
    Route::post('/coupons/validate', [AdminLoyaltyController::class, 'validateCoupon']);
    Route::post('/coupons/redeem', [AdminLoyaltyController::class, 'redeemCoupon']);

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
    Route::post('/payments/customer', [AdminTransactionController::class, 'storeCustomerPayment']);
    Route::post('/payments/supplier', [AdminTransactionController::class, 'storeSupplierPayment']);
    Route::get('/payments/upi-intent', [PaymentIntentController::class, 'upiIntent']);
    Route::get('/gift-cards/lookup', [AdminGiftCardController::class, 'lookup']);
    Route::post('/returns/sales', [AdminTransactionController::class, 'storeSalesReturn']);
    Route::post('/returns/purchase', [AdminTransactionController::class, 'purchaseReturns']);
});

/*
|--------------------------------------------------------------------------
| Web Admin Panel API (Sanctum + Tenant Scoping + RBAC + IP Allowlist)
|--------------------------------------------------------------------------
*/
// Alias for backwards compatibility / un-prefixed store operations
Route::middleware(['auth:sanctum', 'ip.allowlist', 'scope.store'])
    ->post('/stores/{id}/regenerate-key', [AdminStoreController::class, 'regenerateKey'])
    ->middleware('rbac:stores,edit');

Route::middleware(['auth:sanctum', 'ip.allowlist', 'scope.store'])->prefix('admin')->group(function () {
    // Auth, 2FA, Sessions & Impersonation
    Route::get('/me', [AdminAuthController::class, 'me']);
    Route::get('/me/preferences', [UserPreferenceController::class, 'show']);
    Route::put('/me/preferences', [UserPreferenceController::class, 'update']);
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
    Route::get('/device-sessions', [DeviceSessionController::class, 'index'])->middleware('rbac:devices,view');
    Route::post('/device-sessions/{id}/rename', [DeviceSessionController::class, 'rename'])->middleware('rbac:devices,edit');
    Route::post('/device-sessions/{id}/lock', [DeviceSessionController::class, 'lock'])->middleware('rbac:devices,edit');
    Route::post('/device-sessions/{id}/unlock', [DeviceSessionController::class, 'unlock'])->middleware('rbac:devices,edit');
    Route::post('/device-sessions/{id}/revoke', [DeviceSessionController::class, 'revoke'])->middleware('rbac:devices,edit');
    Route::post('/device-sessions/{id}/force-logout', [DeviceSessionController::class, 'forceLogout'])->middleware('rbac:devices,edit');
    Route::get('/inventory/negative-stock', [SyncController::class, 'getNegativeStockReport'])->middleware('rbac:inventory,view');
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
    Route::delete('/products/{id}', [AdminMasterController::class, 'deleteProduct'])->middleware('rbac:masters,delete');
    Route::post('/products/{id}/batches', [AdminMasterController::class, 'addBatch'])->middleware('rbac:masters,create');
    Route::post('/products/bulk-edit', [AdminMasterController::class, 'bulkEditProducts'])->middleware('rbac:masters,edit');

    // Shared central catalog publishing
    Route::get('/catalog/publications', [AdminCatalogController::class, 'publications'])->middleware('rbac:masters,view');
    Route::post('/catalog/publish', [AdminCatalogController::class, 'publish'])->middleware('rbac:masters,create');
    Route::post('/catalog/unpublish', [AdminCatalogController::class, 'unpublish'])->middleware('rbac:masters,edit');

    Route::get('/batches', [AdminMasterController::class, 'batches'])->middleware('rbac:masters,view');
    Route::put('/batches/{id}', [AdminMasterController::class, 'updateBatch'])->middleware('rbac:masters,edit');
    Route::delete('/batches/{id}', [AdminMasterController::class, 'deleteBatch'])->middleware('rbac:masters,delete');

    Route::get('/lookups', [AdminMasterController::class, 'lookups'])->middleware('rbac:masters,view');
    Route::post('/lookups', [AdminMasterController::class, 'storeLookup'])->middleware('rbac:masters,create');
    Route::put('/lookups/{id}', [AdminMasterController::class, 'updateLookup'])->middleware('rbac:masters,edit');
    Route::delete('/lookups/{id}', [AdminMasterController::class, 'deleteLookup'])->middleware('rbac:masters,delete');

    Route::get('/parties', [AdminMasterController::class, 'parties'])->middleware('rbac:masters,view');
    Route::post('/parties', [AdminMasterController::class, 'storeParty'])->middleware('rbac:masters,create');
    Route::put('/parties/{id}', [AdminMasterController::class, 'updateParty'])->middleware('rbac:masters,edit');
    Route::delete('/parties/{id}', [AdminMasterController::class, 'deleteParty'])->middleware('rbac:masters,delete');

    Route::get('/parties/{id}/portal-status', [AdminPortalController::class, 'status'])->middleware('rbac:masters,view')->whereNumber('id');
    Route::post('/parties/{id}/portal-link', [AdminPortalController::class, 'issue'])->middleware('rbac:masters,edit')->whereNumber('id');
    Route::delete('/parties/{id}/portal-link', [AdminPortalController::class, 'revoke'])->middleware('rbac:masters,edit')->whereNumber('id');

    Route::post('/masters/merge', [AdminMasterController::class, 'mergeDuplicates'])->middleware('rbac:masters,edit');
    Route::post('/masters/import', [AdminMasterController::class, 'import'])->middleware('rbac:masters,create');

    // Module 7: Transactions
    Route::get('/invoices', [AdminTransactionController::class, 'invoices'])->middleware('rbac:transactions,view');
    Route::get('/invoices/{id}', [AdminTransactionController::class, 'showInvoice'])->middleware('rbac:transactions,view');
    Route::post('/invoices/{id}/cancel', [AdminTransactionController::class, 'cancelInvoice'])->middleware('rbac:transactions,edit');
    Route::put('/invoices/{id}', [AdminTransactionController::class, 'updateInvoice'])->middleware('rbac:transactions,edit');
    Route::get('/invoices/{id}/edit-approvals', [InvoiceApprovalController::class, 'index'])->middleware('rbac:transactions,view');
    Route::post('/invoices/{id}/edit-approvals', [InvoiceApprovalController::class, 'issue'])->middleware('rbac:transactions,edit');
    Route::post('/invoices/{id}/edit-approvals/{approvalId}/revoke', [InvoiceApprovalController::class, 'revoke'])->middleware('rbac:transactions,edit');

    Route::get('/returns', [AdminTransactionController::class, 'returns'])->middleware('rbac:transactions,view');
    Route::get('/quotations', [AdminTransactionController::class, 'quotations'])->middleware('rbac:transactions,view');
    Route::post('/quotations', [AdminTransactionController::class, 'storeQuotation'])->middleware('rbac:transactions,create');
    Route::put('/quotations/{id}', [AdminTransactionController::class, 'updateQuotation'])->middleware('rbac:transactions,edit');
    Route::delete('/quotations/{id}', [AdminTransactionController::class, 'destroyQuotation'])->middleware('rbac:transactions,edit');
    Route::post('/quotations/{id}/convert', [AdminTransactionController::class, 'convertQuotation'])->middleware('rbac:transactions,edit');

    Route::get('/purchases', [AdminTransactionController::class, 'purchases'])->middleware('rbac:transactions,view');
    Route::get('/purchases/{id}', [AdminTransactionController::class, 'showPurchase'])->middleware('rbac:transactions,view');
    Route::get('/purchase-returns', [AdminTransactionController::class, 'purchaseReturns'])->middleware('rbac:transactions,view');
    Route::get('/purchase-orders', [AdminTransactionController::class, 'purchaseOrders'])->middleware('rbac:transactions,view');
    Route::post('/purchase-orders', [AdminTransactionController::class, 'storePurchaseOrder'])->middleware('rbac:transactions,create');
    Route::put('/purchase-orders/{id}', [AdminTransactionController::class, 'updatePurchaseOrder'])->middleware('rbac:transactions,edit');
    Route::delete('/purchase-orders/{id}', [AdminTransactionController::class, 'destroyPurchaseOrder'])->middleware('rbac:transactions,edit');
    Route::post('/purchase-orders/{id}/receive', [AdminTransactionController::class, 'receivePurchaseOrder'])->middleware('rbac:transactions,edit');

    Route::get('/held-bills', [AdminTransactionController::class, 'heldBills'])->middleware('rbac:transactions,view');
    Route::get('/held-bills/{id}', [AdminTransactionController::class, 'showHeldBill'])->middleware('rbac:transactions,view');

    Route::get('/shifts', [AdminTransactionController::class, 'shifts'])->middleware('rbac:transactions,view');

    // Day close & cash reconciliation
    Route::get('/day-close', [AdminDayCloseController::class, 'show'])->middleware('rbac:transactions,view');
    Route::get('/day-close/history', [AdminDayCloseController::class, 'history'])->middleware('rbac:transactions,view');
    Route::post('/day-close/close', [AdminDayCloseController::class, 'close'])->middleware('rbac:transactions,edit');
    Route::post('/day-close/reconcile', [AdminDayCloseController::class, 'reconcile'])->middleware('rbac:transactions,edit');
    Route::post('/day-close/reopen', [AdminDayCloseController::class, 'reopen'])->middleware('rbac:transactions,edit');

    Route::get('/stock/adjustments', [AdminTransactionController::class, 'stockAdjustments'])->middleware('rbac:transactions,view');
    Route::get('/stock/transfers', [AdminTransactionController::class, 'stockTransfers'])->middleware('rbac:transactions,view');
    Route::get('/expenses', [AdminTransactionController::class, 'expenses'])->middleware('rbac:transactions,view');
    Route::post('/expenses', [AdminTransactionController::class, 'storeExpense'])->middleware('rbac:transactions,create');
    Route::put('/expenses/{id}', [AdminTransactionController::class, 'updateExpense'])->middleware('rbac:transactions,edit');
    Route::delete('/expenses/{id}', [AdminTransactionController::class, 'destroyExpense'])->middleware('rbac:transactions,edit');
    Route::get('/customer-payments', [AdminTransactionController::class, 'customerPayments'])->middleware('rbac:transactions,view');
    Route::post('/payments/customer', [AdminTransactionController::class, 'storeCustomerPayment'])->middleware('rbac:transactions,create');
    Route::get('/supplier-payments', [AdminTransactionController::class, 'supplierPayments'])->middleware('rbac:transactions,view');
    Route::post('/supplier-payments', [AdminTransactionController::class, 'storeSupplierPayment'])->middleware('rbac:transactions,create');

    Route::get('/customers/{id}/ledger', [AdminTransactionController::class, 'customerLedger'])->middleware('rbac:transactions,view');
    Route::get('/suppliers/{id}/ledger', [AdminTransactionController::class, 'supplierLedger'])->middleware('rbac:transactions,view');

    // Module 7b: Gift cards & store credit
    Route::get('/gift-cards', [AdminGiftCardController::class, 'index'])->middleware('rbac:transactions,view');
    Route::post('/gift-cards', [AdminGiftCardController::class, 'store'])->middleware('rbac:transactions,create');
    Route::post('/gift-cards/lookup', [AdminGiftCardController::class, 'lookup'])->middleware('rbac:transactions,view');
    Route::get('/gift-cards/{id}', [AdminGiftCardController::class, 'show'])->middleware('rbac:transactions,view');
    Route::post('/gift-cards/{id}/status', [AdminGiftCardController::class, 'updateStatus'])->middleware('rbac:transactions,edit');
    Route::post('/gift-cards/{id}/adjust', [AdminGiftCardController::class, 'adjust'])->middleware('rbac:transactions,edit');

    // Module 7c: Settlement import & reconciliation
    Route::get('/settlements', [AdminSettlementController::class, 'index'])->middleware('rbac:transactions,view');
    Route::post('/settlements/preview', [AdminSettlementController::class, 'preview'])->middleware('rbac:transactions,create');
    Route::post('/settlements', [AdminSettlementController::class, 'store'])->middleware('rbac:transactions,create');
    Route::get('/settlements/{id}', [AdminSettlementController::class, 'show'])->middleware('rbac:transactions,view');
    Route::post('/settlements/{id}/rematch', [AdminSettlementController::class, 'rematch'])->middleware('rbac:transactions,edit');
    Route::post('/settlements/lines/{id}/resolve', [AdminSettlementController::class, 'resolveLine'])->middleware('rbac:transactions,edit');

    // Provider-agnostic payment intents (UPI)
    Route::get('/payments/upi-intent', [PaymentIntentController::class, 'upiIntent'])->middleware('rbac:transactions,view');

    // Module 7d: Statutory compliance (provider-agnostic e-invoice / e-way bill registry)
    Route::get('/compliance', [AdminComplianceController::class, 'index'])->middleware('rbac:compliance,view');
    Route::get('/compliance/summary', [AdminComplianceController::class, 'summary'])->middleware('rbac:compliance,view');
    Route::get('/compliance/settings', [AdminComplianceController::class, 'settings'])->middleware('rbac:compliance,view');
    Route::post('/compliance/settings', [AdminComplianceController::class, 'updateSettings'])->middleware('rbac:compliance,edit');
    Route::get('/compliance/export-pending', [AdminComplianceController::class, 'exportPending'])->middleware('rbac:compliance,export');
    Route::get('/compliance/backfill/preview', [AdminComplianceController::class, 'backfillPreview'])->middleware('rbac:compliance,view');
    Route::post('/compliance/import', [AdminComplianceController::class, 'import'])->middleware('rbac:compliance,edit');
    Route::get('/compliance/{id}', [AdminComplianceController::class, 'show'])->middleware('rbac:compliance,view')->whereNumber('id');
    Route::post('/compliance/{id}/irn', [AdminComplianceController::class, 'recordIrn'])->middleware('rbac:compliance,edit')->whereNumber('id');
    Route::post('/compliance/{id}/irn/cancel', [AdminComplianceController::class, 'cancelIrn'])->middleware('rbac:compliance,edit')->whereNumber('id');
    Route::post('/compliance/{id}/eway-bill', [AdminComplianceController::class, 'recordEwb'])->middleware('rbac:compliance,edit')->whereNumber('id');
    Route::put('/compliance/{id}/eway-bill', [AdminComplianceController::class, 'updateEwb'])->middleware('rbac:compliance,edit')->whereNumber('id');
    Route::post('/compliance/{id}/eway-bill/cancel', [AdminComplianceController::class, 'cancelEwb'])->middleware('rbac:compliance,edit')->whereNumber('id');

    // Module 7e: Price lists & customer-specific pricing
    Route::get('/price-lists', [AdminPriceListController::class, 'index'])->middleware('rbac:pricing,view');
    Route::post('/price-lists', [AdminPriceListController::class, 'store'])->middleware('rbac:pricing,edit');
    Route::get('/price-lists/customers', [AdminPriceListController::class, 'customers'])->middleware('rbac:pricing,view');
    Route::get('/price-lists/products', [AdminPriceListController::class, 'products'])->middleware('rbac:pricing,view');
    Route::get('/price-lists/{id}', [AdminPriceListController::class, 'show'])->middleware('rbac:pricing,view')->whereNumber('id');
    Route::put('/price-lists/{id}', [AdminPriceListController::class, 'update'])->middleware('rbac:pricing,edit')->whereNumber('id');
    Route::delete('/price-lists/{id}', [AdminPriceListController::class, 'destroy'])->middleware('rbac:pricing,edit')->whereNumber('id');
    Route::put('/price-lists/{id}/items', [AdminPriceListController::class, 'saveItems'])->middleware('rbac:pricing,edit')->whereNumber('id');
    Route::post('/price-lists/{id}/assign', [AdminPriceListController::class, 'assign'])->middleware('rbac:pricing,edit')->whereNumber('id');

    // Module 7f: Sales orders & delivery challans
    Route::get('/sales-orders', [AdminSalesOrderController::class, 'index'])->middleware('rbac:sales_orders,view');
    Route::post('/sales-orders', [AdminSalesOrderController::class, 'store'])->middleware('rbac:sales_orders,edit');
    Route::get('/sales-orders/{id}', [AdminSalesOrderController::class, 'show'])->middleware('rbac:sales_orders,view')->whereNumber('id');
    Route::put('/sales-orders/{id}', [AdminSalesOrderController::class, 'update'])->middleware('rbac:sales_orders,edit')->whereNumber('id');
    Route::delete('/sales-orders/{id}', [AdminSalesOrderController::class, 'destroy'])->middleware('rbac:sales_orders,edit')->whereNumber('id');
    Route::post('/sales-orders/{id}/status', [AdminSalesOrderController::class, 'updateStatus'])->middleware('rbac:sales_orders,edit')->whereNumber('id');
    Route::post('/sales-orders/{id}/challans', [AdminSalesOrderController::class, 'storeChallan'])->middleware('rbac:sales_orders,edit')->whereNumber('id');
    Route::get('/delivery-challans', [AdminSalesOrderController::class, 'challans'])->middleware('rbac:sales_orders,view');
    Route::get('/delivery-challans/{id}', [AdminSalesOrderController::class, 'showChallan'])->middleware('rbac:sales_orders,view')->whereNumber('id');
    Route::post('/delivery-challans/{id}/status', [AdminSalesOrderController::class, 'updateChallanStatus'])->middleware('rbac:sales_orders,edit')->whereNumber('id');

    // Module 7g: Loyalty points & coupons
    Route::get('/loyalty/program', [AdminLoyaltyController::class, 'program'])->middleware('rbac:loyalty,view');
    Route::put('/loyalty/program', [AdminLoyaltyController::class, 'updateProgram'])->middleware('rbac:loyalty,edit');
    Route::get('/loyalty/coupons', [AdminLoyaltyController::class, 'coupons'])->middleware('rbac:loyalty,view');
    Route::post('/loyalty/coupons', [AdminLoyaltyController::class, 'storeCoupon'])->middleware('rbac:loyalty,edit');
    Route::put('/loyalty/coupons/{id}', [AdminLoyaltyController::class, 'updateCoupon'])->middleware('rbac:loyalty,edit')->whereNumber('id');
    Route::delete('/loyalty/coupons/{id}', [AdminLoyaltyController::class, 'destroyCoupon'])->middleware('rbac:loyalty,edit')->whereNumber('id');
    Route::get('/loyalty/ledger', [AdminLoyaltyController::class, 'ledger'])->middleware('rbac:loyalty,view');
    Route::post('/loyalty/points/adjust', [AdminLoyaltyController::class, 'adjustPoints'])->middleware('rbac:loyalty,edit');

    // Module 7h: Accounting Exports (Tally XML / Busy XML / CSV)
    Route::get('/accounting/exports', [AdminAccountingExportController::class, 'catalog'])->middleware('rbac:reports,view');
    Route::get('/accounting/export-parties', [AdminAccountingExportController::class, 'parties'])->middleware('rbac:reports,view');
    Route::get('/accounting/exports/{type}/{format}', [AdminAccountingExportController::class, 'download'])->middleware('rbac:reports,export');

    // Module 8: Inventory
    Route::get('/inventory/batches', [AdminInventoryController::class, 'batchInventory'])->middleware('rbac:inventory,view');
    Route::get('/inventory/ledger', [AdminInventoryController::class, 'stockLedger'])->middleware('rbac:inventory,view');
    Route::get('/inventory/near-expiry', [AdminInventoryController::class, 'nearExpiry'])->middleware('rbac:inventory,view');
    Route::post('/inventory/transfers/dispatch', [AdminInventoryController::class, 'dispatchTransfer'])->middleware('rbac:inventory,create');
    Route::post('/inventory/transfers/{id}/receive', [AdminInventoryController::class, 'receiveTransfer'])->middleware('rbac:inventory,edit');
    Route::post('/inventory/reconcile', [AdminInventoryController::class, 'reconcileStock'])->middleware('rbac:inventory,edit');

    // Stock adjustment policy + multi-line documents (items 27 & 28)
    Route::get('/stock-adjustments/policy', [AdminInventoryController::class, 'getAdjustmentPolicy'])->middleware('rbac:inventory,view');
    Route::put('/stock-adjustments/policy', [AdminInventoryController::class, 'updateAdjustmentPolicy'])->middleware('rbac:inventory,edit');
    Route::get('/stock-adjustments', [AdminInventoryController::class, 'listAdjustments'])->middleware('rbac:inventory,view');
    Route::get('/stock-adjustments/{id}', [AdminInventoryController::class, 'showAdjustment'])->middleware('rbac:inventory,view');
    Route::post('/stock-adjustments/{id}/approve', [AdminInventoryController::class, 'approveAdjustment'])->middleware('rbac:inventory,edit');
    Route::post('/stock-adjustments/{id}/reject', [AdminInventoryController::class, 'rejectAdjustment'])->middleware('rbac:inventory,edit');

    // Module 9: Reports (Accessible to Accountant & Managers)
    Route::get('/reports/sales', [AdminReportController::class, 'salesSummary'])->middleware('rbac:reports,view');
    Route::get('/reports/gstr1', [AdminReportController::class, 'gstr1'])->middleware('rbac:reports,view');
    Route::get('/reports/gstr3b', [AdminGstWorkingPaperController::class, 'gstr3b'])->middleware('rbac:reports,view');
    Route::get('/reports/gstr3b/export', [AdminGstWorkingPaperController::class, 'gstr3bExport'])->middleware('rbac:reports,export');
    Route::get('/reports/gstr9', [AdminGstWorkingPaperController::class, 'gstr9'])->middleware('rbac:reports,view');
    Route::get('/reports/gstr9/export', [AdminGstWorkingPaperController::class, 'gstr9Export'])->middleware('rbac:reports,export');
    Route::get('/reports/gstr2b/imports', [AdminGstWorkingPaperController::class, 'gstr2bImports'])->middleware('rbac:reports,view');
    Route::post('/reports/gstr2b/import', [AdminGstWorkingPaperController::class, 'importGstr2b'])->middleware('rbac:reports,edit');
    Route::get('/reports/gstr2b/imports/{id}', [AdminGstWorkingPaperController::class, 'gstr2bReport'])->middleware('rbac:reports,view')->whereNumber('id');
    Route::get('/reports/gstr2b/imports/{id}/export', [AdminGstWorkingPaperController::class, 'gstr2bExport'])->middleware('rbac:reports,export')->whereNumber('id');
    Route::delete('/reports/gstr2b/imports/{id}', [AdminGstWorkingPaperController::class, 'destroyGstr2bImport'])->middleware('rbac:reports,edit')->whereNumber('id');
    Route::get('/reports/customer-aging', [AdminReportController::class, 'customerAging'])->middleware('rbac:reports,view');
    Route::get('/reports/pharmacy', [AdminReportController::class, 'pharmacyReport'])->middleware('rbac:reports,view');
    Route::get('/reports/scheduled', [AdminReportController::class, 'scheduledReports'])->middleware('rbac:reports,view');
    Route::post('/reports/scheduled', [AdminReportController::class, 'storeScheduledReport'])->middleware('rbac:reports,edit');
    Route::put('/reports/scheduled/{id}', [AdminReportController::class, 'updateScheduledReport'])->middleware('rbac:reports,edit');
    Route::delete('/reports/scheduled/{id}', [AdminReportController::class, 'destroyScheduledReport'])->middleware('rbac:reports,edit');
    Route::post('/reports/scheduled/{id}/run-now', [AdminReportController::class, 'runScheduledReport'])->middleware('rbac:reports,edit');
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
    Route::get('/settings/backups', [AdminBackupController::class, 'index'])->middleware('rbac:settings,view');
    Route::post('/settings/backups', [AdminBackupController::class, 'store'])->middleware('rbac:settings,edit');
    Route::get('/settings/backups/{id}/download', [AdminBackupController::class, 'download'])->middleware('rbac:settings,view');
    Route::post('/settings/backups/{id}/restore', [AdminBackupController::class, 'restore'])->middleware('rbac:settings,edit');
    Route::delete('/settings/backups/{id}', [AdminBackupController::class, 'destroy'])->middleware('rbac:settings,edit');
    Route::get('/webhooks', [AdminWebhookController::class, 'index'])->middleware('rbac:settings,view');
    Route::post('/webhooks/test', [AdminWebhookController::class, 'test'])->middleware('rbac:settings,edit');
    Route::post('/webhooks/{id}/retry', [AdminWebhookController::class, 'retry'])->middleware('rbac:settings,edit');
    Route::get('/settings/whatsapp/sessions', [WhatsAppController::class, 'sessions'])->middleware('rbac:settings,view');
    Route::post('/settings/whatsapp/test', [WhatsAppController::class, 'testConnection'])->middleware('rbac:settings,view');
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
